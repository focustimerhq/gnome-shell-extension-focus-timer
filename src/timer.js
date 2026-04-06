/*
 * Copyright (c) 2014-2026 focus-timer contributors
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

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';


export const MILLISECOND = 1000;
export const SECOND = 1000000;
export const MINUTE = 60000000;


export const State = {
    STOPPED: 'stopped',
    POMODORO: 'pomodoro',
    BREAK: 'break',
    SHORT_BREAK: 'short-break',
    LONG_BREAK: 'long-break',

    label(state) {
        switch (state) {
        case State.STOPPED:
            return _('Stopped');

        case State.POMODORO:
            return _('Pomodoro');

        case State.SHORT_BREAK:
            return _('Short Break');

        case State.LONG_BREAK:
            return _('Long Break');

        case State.BREAK:
            return _('Break');

        default:
            return '';
        }
    },

    isBreak(state) {
        return state === State.SHORT_BREAK || state === State.LONG_BREAK || state === State.BREAK;
    },
};


/**
 * @param {number} timestamp - Unix timestamp in microseconds, or -1 if absent.
 */
function normalizeTimestamp(timestamp) {
    return timestamp >= 0 ? timestamp : NaN;
}



export class Timer extends Signals.EventEmitter {
    constructor(proxy) {
        super();

        this._proxy = proxy;
        this._tickId = this._proxy.connectSignal('Tick', this._onTick.bind(this));
        this._changedId = this._proxy.connectSignal('Changed', this._onChanged.bind(this));
        this._cancellable = new Gio.Cancellable();
        this._lastTickTime = NaN;
        this._monotonicTimeOffset = 0;
    }

    get state() {
        return this._proxy?.State || State.STOPPED;
    }

    set state(value) {
        if (this._proxy)
            this._proxy.State = value;
    }

    get duration() {
        return this._proxy?.Duration || 0;
    }

    set duration(value) {
        if (this._proxy)
            this._proxy.Duration = value;
    }

    get offset() {
        return this._proxy?.Offset || 0;
    }

    get startedTime() {
        return normalizeTimestamp(this._proxy?.StartedTime);
    }

    get pausedTime() {
        return normalizeTimestamp(this._proxy?.PausedTime);
    }

    get finishedTime() {
        return normalizeTimestamp(this._proxy?.FinishedTime);
    }

    get lastChangedTime() {
        return normalizeTimestamp(this._proxy?.LastChangedTime);
    }

    get lastTickTime() {
        return this._lastTickTime;
    }

    getCurrentTime() {
        if (this._monotonicTimeOffset !== 0)
            return GLib.get_monotonic_time() + this._monotonicTimeOffset;

        return GLib.get_real_time();
    }

    _synchronize() {
        const currentTime = GLib.get_real_time();
        const monotonicTime = GLib.get_monotonic_time();

        this._monotonicTimeOffset = currentTime - monotonicTime;
    }

    _onChanged(_proxy) {
        if (this.isRunning())
            this._synchronize();

        this.emit('changed');
    }

    _onTick(proxy, sender, [timestamp]) {
        this._lastTickTime = timestamp;

        this.emit('tick', timestamp);
    }

    isStarted() {
        if (!this._proxy)
            return false;

        return !!this.startedTime;
    }

    isPaused() {
        if (!this._proxy)
            return false;

        return !!this.pausedTime;
    }

    isRunning() {
        if (!this._proxy)
            return false;

        return this.startedTime && !this.pausedTime && !this.finishedTime;
    }

    isFinished() {
        if (!this._proxy)
            return false;

        return !!this.finishedTime;
    }

    getElapsed(timestamp = NaN) {
        if (!this.startedTime)
            return 0;

        if (this.pausedTime)
            timestamp = this.pausedTime;
        else if (this.finishedTime)
            timestamp = this.finishedTime;
        else if (!timestamp)
            timestamp = this.getCurrentTime();

        return Math.max(0, Math.min(timestamp - this.startedTime - this.offset, this.duration));
    }

    getRemaining(timestamp = NaN) {
        return this.duration - this.getElapsed(timestamp);
    }

    getProgress(timestamp = NaN) {
        const duration = this.duration;

        return duration > 0 ? this.getElapsed(timestamp) / duration : 0.0;
    }

    start() {
        this._proxy?.StartAsync(this._cancellable).catch(logError);
    }

    stop() {
        this._proxy?.StopAsync(this._cancellable).catch(logError);
    }

    pause() {
        this._proxy?.PauseAsync(this._cancellable).catch(logError);
    }

    resume() {
        this._proxy?.ResumeAsync(this._cancellable).catch(logError);
    }

    rewind(interval) {
        this._proxy?.RewindAsync(interval, this._cancellable).catch(logError);
    }

    extend(interval) {
        this._proxy?.ExtendAsync(interval, this._cancellable).catch(logError);
    }

    skip() {
        this._proxy?.SkipAsync(this._cancellable).catch(logError);
    }

    reset() {
        this._proxy?.ResetAsync(this._cancellable).catch(logError);
    }

    destroy() {
        if (this._changedId) {
            this._proxy.disconnectSignal(this._changedId);
            this._changedId = 0;
        }

        if (this._tickId) {
            this._proxy.disconnectSignal(this._tickId);
            this._tickId = 0;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._proxy)
            this._proxy = null;
    }
}
