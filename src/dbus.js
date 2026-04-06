/*
 * Copyright (c) 2012-2026 focus-timer contributors
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
 *
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Config from './config.js';

const ApplicationInterface = `
<node>
  <interface name="io.github.focustimerhq.FocusTimer">
    <property type="s" name="Version" access="read"/>
    <property type="a{sv}" name="Settings" access="read"/>
    <method name="ShowWindow">
      <arg type="s" name="view" direction="in"/>
    </method>
    <method name="ShowPreferences">
      <arg type="s" name="view" direction="in"/>
    </method>
    <method name="Quit"/>
    <signal name="RequestFocus"/>
  </interface>
</node>`;

const TimerInterface = `
<node>
  <interface name="io.github.focustimerhq.FocusTimer.Timer">
    <property type="s" name="State" access="readwrite"/>
    <property type="x" name="Duration" access="readwrite"/>
    <property type="x" name="Offset" access="read"/>
    <property type="x" name="StartedTime" access="read"/>
    <property type="x" name="PausedTime" access="read"/>
    <property type="x" name="FinishedTime" access="read"/>
    <property type="x" name="LastChangedTime" access="read"/>
    <method name="IsStarted">
      <arg type="b" name="result" direction="out"/>
    </method>
    <method name="IsRunning">
      <arg type="b" name="result" direction="out"/>
    </method>
    <method name="IsPaused">
      <arg type="b" name="result" direction="out"/>
    </method>
    <method name="IsFinished">
      <arg type="b" name="result" direction="out"/>
    </method>
    <method name="GetElapsed">
      <arg type="x" name="timestamp" direction="in"/>
      <arg type="x" name="result" direction="out"/>
    </method>
    <method name="GetRemaining">
      <arg type="x" name="timestamp" direction="in"/>
      <arg type="x" name="result" direction="out"/>
    </method>
    <method name="GetProgress">
      <arg type="x" name="timestamp" direction="in"/>
      <arg type="d" name="result" direction="out"/>
    </method>
    <method name="Start"/>
    <method name="Stop"/>
    <method name="Pause"/>
    <method name="Resume"/>
    <method name="Rewind">
      <arg type="x" name="interval" direction="in"/>
    </method>
    <method name="Extend">
      <arg type="x" name="interval" direction="in"/>
    </method>
    <method name="Skip"/>
    <method name="Reset"/>
    <signal name="Changed"/>
    <signal name="Tick">
      <arg type="x" name="timestamp"/>
    </signal>
    <signal name="Finished"/>
  </interface>
</node>`;

const SessionInterface = `
<node>
  <interface name="io.github.focustimerhq.FocusTimer.Session">
    <property type="s" name="CurrentState" access="read"/>
    <property type="x" name="StartTime" access="read"/>
    <property type="x" name="EndTime" access="read"/>
    <property type="b" name="HasUniformBreaks" access="read"/>
    <property type="b" name="CanReset" access="read"/>
    <method name="Advance"/>
    <method name="AdvanceToState">
      <arg type="s" name="state" direction="in"/>
    </method>
    <method name="Reset"/>
    <method name="GetCurrentTimeBlock">
      <arg type="a{sv}" name="result" direction="out"/>
    </method>
    <method name="GetCurrentGap">
      <arg type="a{sv}" name="result" direction="out"/>
    </method>
    <method name="GetNextTimeBlock">
      <arg type="a{sv}" name="result" direction="out"/>
    </method>
    <method name="ListTimeBlocks">
      <arg type="aa{sv}" name="result" direction="out"/>
    </method>
    <method name="ListCycles">
      <arg type="aa{sv}" name="result" direction="out"/>
    </method>
    <signal name="EnterTimeBlock">
      <arg type="v" name="time_block"/>
    </signal>
    <signal name="LeaveTimeBlock">
      <arg type="v" name="time_block"/>
    </signal>
    <signal name="ConfirmAdvancement">
      <arg type="v" name="current_time_block"/>
      <arg type="v" name="next_time_block"/>
    </signal>
    <signal name="Changed"/>
  </interface>
</node>`;

const ShellIntegrationInterface = `
<node>
  <interface name="io.github.focustimerhq.FocusTimer.ShellIntegration">
    <property type="s" name="Version" access="read"/>
    <property type="s" name="IndicatorType" access="readwrite"/>
    <property type="b" name="EnableBlurEffect" access="readwrite"/>
    <property type="b" name="EnableDismissGesture" access="readwrite"/>
    <property type="b" name="EnableManageNotifications" access="readwrite"/>
    <method name="OpenScreenOverlay"/>
  </interface>
</node>`;


export const BUS_NAME = 'io.github.focustimerhq.FocusTimer';

export const OBJECT_PATH = '/io/github/focustimerhq/FocusTimer';

export const ApplicationProxy = Gio.DBusProxy.makeProxyWrapper(ApplicationInterface);

export const TimerProxy = Gio.DBusProxy.makeProxyWrapper(TimerInterface);

export const SessionProxy = Gio.DBusProxy.makeProxyWrapper(SessionInterface);

export class ShellIntegrationService {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.settings;

        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ShellIntegrationInterface, this);
        this._dbusImpl.export(Gio.DBus.session, `${OBJECT_PATH}/ShellIntegration`);
        this._dbusId = Gio.DBus.session.own_name(`${BUS_NAME}.ShellIntegration`,
            Gio.BusNameOwnerFlags.REPLACE, null, null);

        this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));
    }

    get Version() {
        return Config.PACKAGE_VERSION;
    }

    get IndicatorType() {
        return this._settings.get_string('indicator-type');
    }

    set IndicatorType(value) {
        this._settings.set_string('indicator-type', value);
    }

    get EnableBlurEffect() {
        return this._settings.get_boolean('blur-effect');
    }

    set EnableBlurEffect(value) {
        this._settings.set_boolean('blur-effect', value);
    }

    get EnableDismissGesture() {
        return this._settings.get_boolean('dismiss-gesture');
    }

    set EnableDismissGesture(value) {
        this._settings.set_boolean('dismiss-gesture', value);
    }

    get EnableManageNotifications() {
        return this._settings.get_boolean('manage-notifications');
    }

    set EnableManageNotifications(value) {
        this._settings.set_boolean('manage-notifications', value);
    }

    OpenScreenOverlay() {
        this._extension.openScreenOverlay();
    }

    _onSettingsChanged(_settings, key) {
        switch (key) {
        case 'indicator-type':
            this._dbusImpl.emit_property_changed('IndicatorType', new GLib.Variant('s', this.IndicatorType));
            break;

        case 'blur-effect':
            this._dbusImpl.emit_property_changed('EnableBlurEffect', new GLib.Variant('b', this.EnableBlurEffect));
            break;

        case 'dismiss-gesture':
            this._dbusImpl.emit_property_changed('EnableDismissGesture', new GLib.Variant('b', this.EnableDismissGesture));
            break;

        case 'manage-notifications':
            this._dbusImpl.emit_property_changed('EnableManageNotifications', new GLib.Variant('b', this.EnableManageNotifications));
            break;
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._dbusId) {
            Gio.DBus.session.unown_name(this._dbusId);
            this._dbusId = 0;
        }

        this._dbusImpl?.unexport();

        this._settings = null;
        this._extension = null;
        this._dbusImpl = null;
    }
};

/**
 * @param {number} timestamp - Unix timestamp in microseconds, or -1 if absent.
 */
function normalizeTimestamp(timestamp) {
    return timestamp >= 0 ? timestamp : NaN;
}

/**
 * @param {GLib.Variant|object} variant - Packed or unpacked D-Bus time-block dictionary.
 */
export function deserializeTimeBlock(variant) {
    if (variant instanceof GLib.Variant)
        variant = variant.deepUnpack();

    if (!Object.keys(variant).length)
        return null;

    return {
        state: variant['state'].get_string()[0],
        status: variant['status'].get_string()[0],
        startTime: normalizeTimestamp(variant['start_time'].get_int64()),
        endTime: normalizeTimestamp(variant['end_time'].get_int64()),
    };
}

/**
 * @param {GLib.Variant|object} variant - Packed or unpacked D-Bus cycle dictionary.
 */
export function deserializeCycle(variant) {
    if (variant instanceof GLib.Variant)
        variant = variant.deepUnpack();

    if (!Object.keys(variant).length)
        return null;

    return {
        status: variant['status'].get_string()[0],
        weight: variant['weight'].get_double(),
    };
}
