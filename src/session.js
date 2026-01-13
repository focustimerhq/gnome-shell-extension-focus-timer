/*
 * Copyright (c) 2026 focus-timer contributors
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Authors: Kamil Prusko <kamilprusko@gmail.com>
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Params from 'resource:///org/gnome/shell/misc/params.js';

import {deserializeTimeBlock, deserializeCycle} from './dbus.js';
import {State} from './timer.js';


export const TimeBlockStatus = {
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    UNCOMPLETED: 'uncompleted',
};


export class Session extends Signals.EventEmitter {
    constructor(proxy) {
        super();

        this._proxy = proxy;
        this._changedId = this._proxy.connectSignal('Changed', this._onChanged.bind(this));
        this._confirmAdvancementId = this._proxy.connectSignal('ConfirmAdvancement', this._onConfirmAdvancement.bind(this));
        this._cancellable = new Gio.Cancellable();
        this._cyclesPromise = null;
    }

    get currentState() {
        return this._proxy?.CurrentState || State.STOPPED;
    }

    get hasUniformBreaks() {
        return !!this._proxy?.HasUniformBreaks;
    }

    get canReset() {
        return !!this._proxy?.CanReset;
    }

    advance() {
        this._proxy?.AdvanceAsync(this._cancellable).catch(logError);
    }

    advanceToState(state) {
        this._proxy?.AdvanceToStateAsync(state, this._cancellable).catch(logError);
    }

    reset() {
        this._proxy?.ResetAsync(this._cancellable).catch(logError);
    }

    async getNextTimeBlock() {
        if (!this._proxy)
            return null;

        try {
            const [timeBlock] = await this._proxy.GetNextTimeBlockAsync(this._cancellable);

            return timeBlock ? deserializeTimeBlock(timeBlock) : null;
        } catch (error) {
            logError(error);

            return null;
        }
    }

    async listCycles() {
        if (!this._proxy)
            return [];

        if (!this._cyclesPromise)
            this._cyclesPromise = this._proxy.ListCyclesAsync(this._cancellable).then(
                ([cycles]) => cycles.map(deserializeCycle),
                (error) => {
                    logError(error);
                    return [];
                }
            );

        return this._cyclesPromise;
    }

    async getCycleNumberCount() {
        let cycleNumber = 0;
        let cycleCount = 0;

        for (const cycle of await this.listCycles()) {
            if (cycle.status === TimeBlockStatus.UNCOMPLETED || cycle.weight <= 0)
                continue;

            if (cycle.status === TimeBlockStatus.COMPLETED ||
                    cycle.status === TimeBlockStatus.IN_PROGRESS)
                cycleNumber++;

            cycleCount++;
        }

        return [cycleNumber, cycleCount];
    }

    _onChanged(_proxy, _sender) {
        this._cyclesPromise = null;

        this.emit('changed');
    }

    _onConfirmAdvancement(_proxy, _sender, [currentTimeBlock, nextTimeBlock]) {
        currentTimeBlock = deserializeTimeBlock(currentTimeBlock);
        nextTimeBlock = deserializeTimeBlock(nextTimeBlock);

        if (currentTimeBlock && nextTimeBlock)
            this.emit('confirm-advancement', currentTimeBlock, nextTimeBlock);
    }

    destroy() {
        if (this._changedId) {
            this._proxy.disconnectSignal(this._changedId);
            this._changedId = 0;
        }

        if (this._confirmAdvancementId) {
            this._proxy.disconnectSignal(this._confirmAdvancementId);
            this._confirmAdvancementId = 0;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        this._cyclesPromise = null;
        this._proxy = null;
    }
}
