/*
 * Copyright (c) 2014-2026 gnome-pomodoro contributors
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
 * Authors: Kamil Prusko <kamilprusko@gmail.com>
 *
 */

import Gio from 'gi://Gio';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {MessageTray} from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {State} from './timer.js';
import * as Utils from './utils.js';

let DoNotDisturb;
try {
    DoNotDisturb = await import('resource:///org/gnome/shell/ui/status/doNotDisturb.js');
} catch {
}


/**
 * Helper for managing presence according to the timer state.
 */
export const DistractionManager = class extends Signals.EventEmitter {
    constructor(timer, settings) {
        super();

        this._timer = timer;
        this._settings = settings;
        this._busy = false;
        this._notificationSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });
        this._injectionManager = new InjectionManager();
        this._overridesApplied = false;

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._settings.connectObject('changed', this._onSettingsChanged.bind(this), this);

        this._update();
    }

    _hideDoNotDisturbButton() {
        if (DoNotDisturb) {
            const indicator = Main.panel.statusArea.quickSettings._doNotDisturb;

            if (indicator) {
                for (const toggle of indicator.quickSettingsItems)
                    toggle.reactive = false;

                if (indicator.get_parent()) {
                    indicator._parent = indicator.get_parent();
                    indicator._previousSibling = indicator.get_previous_sibling();
                    indicator._parent.remove_child(indicator);
                }
            } else {
                Utils.logWarning('Unable to hide DoNotDisturb button');
            }
        } else {
            const dndButton = Main.panel.statusArea.dateMenu._messageList._dndButton;
            dndButton.hide();

            for (const sibling of [dndButton.get_previous_sibling(), dndButton.get_next_sibling()]) {
                if (sibling instanceof St.Label)
                    sibling.hide();
            }
        }
    }

    _showDoNotDisturbButton() {
        if (DoNotDisturb) {
            const indicator = Main.panel.statusArea.quickSettings._doNotDisturb;

            if (indicator) {
                for (const toggle of indicator.quickSettingsItems)
                    toggle.reactive = true;

                if (indicator._parent) {
                    indicator._parent.insert_child_above(indicator, indicator._previousSibling);
                    delete indicator._previousSibling;
                    delete indicator._parent;
                }
            } else {
                Utils.logWarning('Unable to show DoNotDisturb button');
            }
        } else {
            const dndButton = Main.panel.statusArea.dateMenu._messageList._dndButton;
            dndButton.show();

            for (const sibling of [dndButton.get_previous_sibling(), dndButton.get_next_sibling()]) {
                if (sibling instanceof St.Label)
                    sibling.show();
            }
        }
    }

    _updateBusyStatus() {
        try {
            Main.messageTray._busy = this._busy;
            Main.messageTray._onStatusChanged();
        } catch (error) {
            Utils.logWarning(error.message);
        }
    }

    _emulateStatusChanged() {
        try {
            const status = Main.messageTray._presence.status;

            Main.messageTray._onStatusChanged(status);
        } catch (error) {
            Utils.logWarning(error.message);
        }
    }

    _applyOverrides() {
        if (this._overridesApplied)
            return;

        // Replace the presence status handler so that `DistractionManager` becomes the
        // main presence controller. Instead basing the `busy` status on user presence,
        // the status will depend on timer state.
        this._injectionManager.overrideMethod(MessageTray.prototype, '_onStatusChanged',
            _originalMethod => {
                return function (_status) {
                    this._updateState();  // eslint-disable-line no-invalid-this
                };
            });

        this._overridesApplied = true;
        this._updateBusyStatus();
    }

    _revertOverrides() {
        if (!this._overridesApplied)
            return;

        this._injectionManager.clear();
        this._overridesApplied = false;
        this._emulateStatusChanged();
    }

    _setDefaults() {
        this._busy = false;
        this._notificationSettings.set_boolean('show-banners', true);
        this._showDoNotDisturbButton();
        this._revertOverrides();
    }

    _update() {
        const timerState = this._timer.state;
        const manageNotifications = this._settings.get_boolean('manage-notifications');

        if (timerState !== State.STOPPED && manageNotifications) {
            this._busy = timerState === State.POMODORO;

            if (!this._patchApplied)
                this._applyOverrides();
            else
                this._updateBusyStatus();

            this._hideDoNotDisturbButton();
            this._notificationSettings.set_boolean('show-banners', !this._busy);
        } else {
            this._setDefaults();
        }
    }

    _onTimerChanged() {
        this._update();
    }

    _onSettingsChanged(settings, key) {
        switch (key) {
        case 'manage-notifications':
            this._update();
            break;
        }
    }

    destroy() {
        this._setDefaults();

        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        if (this._notificationSettings) {
            this._notificationSettings.run_dispose();
            this._notificationSettings = null;
        }

        this.emit('destroy');
    }
};
