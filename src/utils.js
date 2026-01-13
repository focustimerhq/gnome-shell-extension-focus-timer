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
 *
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

// import {trySpawnCommandLine} from 'resource:///org/gnome/shell/misc/util.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ShellConfig from 'resource:///org/gnome/shell/misc/config.js';

import {extension} from './extension.js';
import * as Config from './config.js';

const icons = {};


// TODO: port to https://gjs.guide/extensions/topics/extension.html#injectionmanager
export const Patch = class extends EventEmitter {
    constructor(object, overrides) {
        super();

        this.object = object;
        this.overrides = overrides;
        this.initial = {};
        this.applied = false;

        for (let name in this.overrides) {
            this.initial[name] = this.object[name];

            if (typeof this.initial[name] == 'undefined')
                logWarning(`Property "${name}" for ${this.object} is not defined`);
        }
    }

    apply() {
        if (!this.applied) {
            for (let name in this.overrides)
                this.object[name] = this.overrides[name];

            this.applied = true;

            this.emit('applied');
        }
    }

    revert() {
        if (this.applied) {
            for (let name in this.overrides)
                this.object[name] = this.initial[name];

            this.applied = false;

            this.emit('reverted');
        }
    }

    destroy() {
        this.revert();
        this.disconnectAll();
    }
};

export const BlinkingGroup = class {
    constructor(blinkDuration) {
        this._blinkDuration = blinkDuration;
        this._active = false;
        this._baseline = 1.0;
        this._items = [];
        this._reference = null;
        this._destroying = false;
    }

    get blinkDuration() {
        return this._blinkDuration;
    }

    set blinkDuration(value) {
        this._blinkDuration = value;
    }

    _indexItem(actor) {
        return this._items.findIndex((item) => item.actor === actor);
    }

    _removeItem(index) {
        const item = this._items.splice(index, 1);

        if (item && item.actor) {
            item.actor.disconnectObject(this);
            item.actor.remove_transition(item.propertyName);
            this._unbindItem(item);
        }

        if (this._reference === item) {
            this._reference = null;
            this._selectReference();
        }
    }

    _bindItem(item) {
        if (item.binding)
            return;

        if (!this._reference || this._reference.actor === item.actor)
            return;

        const x1 = this._reference.lowerValue;
        const x2 = this._reference.upperValue;
        const y1 = item.lowerValue;
        const y2 = item.upperValue;

        item.binding = this._reference.actor.bind_property_full(
            this._reference.propertyName,
            item.actor, item.propertyName,
            GObject.BindingFlags.DEFAULT,
            (binding, source) => [
                true,
                Math.min(Math.max((y2 - y1) * (source - x1) / (x2 - x1) + y1, y1), y2)
            ],
            null
        );
    }

    _unbindItem(item) {
        if (item.binding) {
            item.binding.unbind ();
            item.binding = null;
        }
    }

    _bind() {
        if (!this._reference)
            return;

        for (const item of this._items)
            this._bindItem(item);
    }

    _unbind() {
        for (const item of this._items)
            this._unbindItem(item);
    }

    _setReference(item) {
        if (this._reference === item)
            return;

        if (this._reference) {
            this._unbind();
            this._reference.actor.remove_transition(this._reference.propertyName);
        }

        this._reference = item;

        if (this._reference) {
            this._bind();

            if (this._active)
                this._blink();
        }
    }

    _selectReference() {
        if (!this._items.length || this._destroying)
            return;

        if (this._reference && this._reference.actor.mapped)
            return;

        this._setReference(this._items.find(item => item.actor.mapped) || this._items[0]);
    }

    _transformReferenceValue(referenceValue) {
        return (referenceValue - this._reference.lowerValue) /
            (this._reference.upperValue - this._reference.lowerValue);
    }

    _transformValue(value, item) {
        const y1 = item.lowerValue;
        const y2 = item.upperValue;

        return Math.min(Math.max(value * (y2 - y1) + y1, y1), y2);
    }

    _getValue() {
        if (this._active && !this._reference?.actor.mapped)
            return 0.0;

        return this._reference
            ? this._transformReferenceValue(this._reference.actor[this._reference.propertyName])
            : this._baseline;
    }

    _transition(valueTo, duration) {
        if (!this._reference || this._destroying)
            return;

        const reference = this._reference;
        const actor = reference.actor;
        const propertyName = reference.propertyName;
        const valueFrom = this._transformReferenceValue(actor[propertyName]);  // this._getValue();
        const referenceValueTo = this._transformValue(valueTo, reference);

        if (isNaN(referenceValueTo)) {
            logWarning(`Invalid transition from ${valueFrom} to ${valueTo}`);
            return;
        }

        if (Math.abs(valueTo - valueFrom) > 0.01 && duration > 0 && actor.mapped) {
            let transitionStarted = false;
            actor.ease_property(propertyName, referenceValueTo, {
                duration: duration,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                animationRequired: true,
                onComplete: () => {
                    if (this._active && transitionStarted)
                        this._blink();
                },
            });
            transitionStarted = true;
        } else {
            actor.remove_transition(propertyName);
            actor[propertyName] = referenceValueTo;
        }
    }

    _blink() {
        this._transition(this._getValue() < 0.5 ? 1.0 : 0.0, this._blinkDuration);
    }

    _onActorNotifyMapped(obj, pspec) {
        if (this._reference?.actor === obj) {
            if (!obj.mapped)
                this._selectReference();
            else if (this._active)
                this._blink();
        }
        else if (!this._reference?.mapped && obj.mapped)
            this._setReference(this._items[this._indexItem(obj)] || null);
    }

    _onActorDestroy(actor) {
        this.removeActor(actor);
    }

    addActor(actor, propertyName, lowerValue, upperValue) {
        const index = this._indexItem(actor);

        if (!actor || index >= 0 || this._destroying)
            return;

        const item = {
            actor,
            propertyName,
            lowerValue,
            upperValue,
            binding: null,
        };
        this._items.push(item);

        actor[propertyName] = this._transformValue(this._getValue(), item);
        actor.connectObject('notify::mapped', this._onActorNotifyMapped.bind(this), this);
        actor.connectObject('destroy', this._onActorDestroy.bind(this), this);

        if (!this._reference || (!this._reference.actor.mapped && actor.mapped))
            this._setReference(item);
        else
            this._bindItem(item);
    }

    removeActor(actor) {
        const index = this._indexItem(actor);
        if (index >= 0)
            this._removeItem(index);
    }

    blink() {
        if (this._active)
            return;

        this._active = true;
        this._blink();
    }

    fadeIn(transitionDuration) {
        this._active = false;
        this._baseline = 1.0;
        this._transition(1.0, transitionDuration || 0);
    }

    fadeOut(transitionDuration) {
        this._active = false;
        this._baseline = 0.0;
        this._transition(0.0, transitionDuration || 0);
    }

    destroy() {
        this._active = false;
        this._transition(this._baseline, 0);
        this._reference = null;
        this._destroying = true;

        while (this._items.length)
            this._removeItem(0);
    }
};

export function logError(error) {
    Main.extensionManager.logExtensionError(extension.uuid, error);
}

export function logWarning(message) {
    extension.getLogger().warn(message);
}

// TODO: test this
export function openUri(uri) {
    const context = global.create_app_launch_context(global.get_current_time(), -1);

    // try {
    Gio.AppInfo.launch_default_for_uri(uri, context);
    // } catch (error) {
    //     trySpawnCommandLine(`xdg-open ${GLib.shell_quote(Config.PACKAGE_FLATHUB_URL)}`);
    // }
}

export function isVersionAtLeast(version) {
    const currentVersionParts = ShellConfig.PACKAGE_VERSION.split('.');
    const versionParts = version.split('.');

    if (versionParts[0] <= currentVersionParts[0] &&
        (versionParts[1] <= currentVersionParts[1] || versionParts[1] === undefined) &&
        (versionParts[2] <= currentVersionParts[2] || versionParts[2] === undefined))
        return true;

    return false;
}

export function wakeUpScreen() {
    const unlockDialog = Main.screenShield?._dialog;

    if (unlockDialog) {
        unlockDialog.emit('wake-up-screen');
    } else {
        try {
            Main.screenShield?._wakeUpScreen();
        } catch (error) {
            logWarning(`Error while waking up the screen: ${error}`);
        }
    }
}

export function loadIcon(iconName) {
    let icon = icons[iconName];

    if (!icon) {
        const extensionUri = extension.dir.get_uri();
        const iconUri = `${extensionUri}/icons/${iconName}.svg`;
        icon = new Gio.FileIcon({
            file: Gio.File.new_for_uri(iconUri),
        });
        icons[iconName] = icon;
    }

    return icon;
}
