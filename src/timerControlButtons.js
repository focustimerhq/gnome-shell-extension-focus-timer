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

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';

import {State, MINUTE} from './timer.js';
import * as Utils from './utils.js';


const ICONS = {
    'start': 'timer-start-symbolic',
    'stop': 'timer-stop-symbolic',
    'pause': 'timer-pause-symbolic',
    'resume': 'timer-start-symbolic',
    'rewind': 'timer-rewind-symbolic',
    'skip': 'timer-skip-symbolic',
    'advance': 'timer-start-symbolic',
    'reset': 'timer-reset-symbolic',
};


export const TimerControlButtons = GObject.registerClass(
class FocusTimerTimerControlButtons extends St.BoxLayout {
    _init(timer, session, params) {
        params = Params.parse(params, {
            style_class: 'extension-focus-timer-control-buttons',
            orientation: Clutter.Orientation.HORIZONTAL,
        }, true);

        super._init(params);

        this._delegate = this;
        this._timer = timer;
        this._session = session;
        this._frozen = false;
        this._lastInteractionTime;

        this._leftButton = this._createIconButton();
        this._leftButton.connect('clicked', this._onButtonClicked.bind(this));
        this.add_child(this._leftButton);

        this._centerButton = this._createIconButton();
        this._centerButton.connect('clicked', this._onButtonClicked.bind(this));
        this.add_child(this._centerButton);

        this._rightButton = this._createIconButton();
        this._rightButton.connect('clicked', this._onButtonClicked.bind(this));
        this.add_child(this._rightButton);

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._session.connectObject('changed', this._onSessionChanged.bind(this), this);
        this.connect('destroy', this._onDestroy.bind(this));

        this._update();
    }

    get lastInteractionTime() {
        return this._lastInteractionTime;
    }

    _createIconButton(iconName) {
        const icon = new St.Icon({
            gicon: iconName ? Utils.loadIcon(iconName) : null,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        return new St.Button({
             style_class: 'icon-button flat',
             can_focus: false,
             x_align: Clutter.ActorAlign.CENTER,
             y_align: Clutter.ActorAlign.CENTER,
             child: icon,
        });
    }

    _updateButton(button, actionName) {
        if (button.actionName === actionName)
            return;

        if (actionName) {
            const iconName = ICONS[actionName];
            if (!iconName)
                Utils.logWarning(`No icon for action '${actionName}'`);

            button.child.gicon = iconName ? Utils.loadIcon(iconName) : null;
            button.actionName = actionName;
            button.opacity = 255;
        } else {
            button.actionName = actionName;
            button.opacity = 0;
        }
    }

    _update() {
        if (this._frozen)
            return;

        let leftActionName = null;
        let centerActionName = null;
        let rightActionName = null;

        if (!this._timer.isStarted()) {
            leftActionName = this._session.canReset ? 'reset' : null;
            centerActionName = 'start';
        } else {
            if (this._timer.isPaused()) {
                leftActionName = 'rewind';
                centerActionName = 'resume';
                rightActionName = 'stop';
            } else if (this._timer.isFinished()) {
                leftActionName = 'rewind';
                centerActionName = 'advance';
                rightActionName = 'stop';
            } else {
                leftActionName = 'rewind';
                centerActionName = 'pause';
                rightActionName = 'skip';
            }
        }

        this._updateButton(this._leftButton, leftActionName);
        this._updateButton(this._centerButton, centerActionName);
        this._updateButton(this._rightButton, rightActionName);
    }

    freeze() {
        this._frozen = true;
        this._leftButton.reactive = false;
        this._leftButton.track_hover = false;
        this._centerButton.reactive = false;
        this._centerButton.track_hover = false;
        this._rightButton.reactive = false;
        this._rightButton.track_hover = false;
    }

    unfreeze() {
        this._frozen = false;
        this._leftButton.reactive = true;
        this._leftButton.track_hover = true;
        this._centerButton.reactive = true;
        this._centerButton.track_hover = true;
        this._rightButton.reactive = true;
        this._rightButton.track_hover = true;

        this._update();
    }

    vfunc_map() {
        this._update();

        super.vfunc_map();
    }

    _onTimerChanged() {
        if (this.mapped)
            this._update();
    }

    _onSessionChanged() {
        if (this.mapped)
            this._update();
    }

    _activateAction(actionName) {
        this._lastInteractionTime = this._timer.getCurrentTime();

        switch(actionName) {
        case 'start':
            this._timer.start();
            break;

        case 'stop':
            this._timer.stop();
            break;

        case 'pause':
            this._timer.pause();
            break;

        case 'resume':
            this._timer.resume();
            break;

        case 'rewind':
            this._timer.rewind(MINUTE);
            break;

        case 'skip':
            this._timer.skip();
            break;

        case 'advance':
            this._session.advance();
            break;

        case 'reset':
            this._session.reset();
            break;

        default:
            Utils.logWarning(`Unknown action: ${actionName}`);
        }
    }

    _onButtonClicked(button) {
        if (button.actionName && button.opacity > 0)
            this._activateAction(button.actionName);
    }

    _onDestroy() {
        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._session) {
            this._session.disconnectObject(this);
            this._session = null;
        }

        this._leftButton = null;
        this._centerButton = null;
        this._rightButton = null;
        this._delegate = null;
    }
});
