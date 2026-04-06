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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ShellConfig from 'resource:///org/gnome/shell/misc/config.js';

import {extension} from './extension.js';

const icons = {};


const Dummy = GObject.registerClass({
    Properties: {
        'fade': GObject.ParamSpec.double(
            'fade', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 1.0),
    },
},
class FocusTimerDummy extends Clutter.Actor {
});

export const BlinkingGroup = class {
    constructor(blinkDuration) {
        this._blinkDuration = blinkDuration;
        this._active = false;
        this._baseline = 1.0;
        this._items = [];
        this._dummy = null;
        this._destroying = false;
    }

    get blinkDuration() {
        return this._blinkDuration;
    }

    set blinkDuration(value) {
        this._blinkDuration = value;
    }

    _indexItem(actor) {
        return this._items.findIndex(item => item.actor === actor);
    }

    _ensureDummy() {
        if (this._dummy)
            return;

        this._dummy = new Dummy();
        this._dummy.fade = this._baseline;
        Main.uiGroup.add_child(this._dummy);

        for (const item of this._items)
            this._bindItem(item);
    }

    _destroyDummy() {
        if (!this._dummy)
            return;

        this._dummy.remove_transition('fade');

        for (const item of this._items)
            this._unbindItem(item);

        Main.uiGroup.remove_child(this._dummy);
        this._dummy.destroy();
        this._dummy = null;
    }

    _removeItem(index) {
        const [item] = this._items.splice(index, 1);

        if (item) {
            item.actor.disconnectObject(this);
            this._unbindItem(item);
        }
    }

    _bindItem(item) {
        if (item.binding || !this._dummy)
            return;

        const y1 = item.lowerValue;
        const y2 = item.upperValue;

        if (y1 === 0.0 && y2 === 1.0) {
            item.binding = this._dummy.bind_property(
                'fade',
                item.actor, item.propertyName,
                GObject.BindingFlags.SYNC_CREATE
            );
        } else {
            item.binding = this._dummy.bind_property_full(
                'fade',
                item.actor, item.propertyName,
                GObject.BindingFlags.SYNC_CREATE,
                (binding, source) => [true, y1 + (y2 - y1) * source],
                null
            );
        }
    }

    _unbindItem(item) {
        if (item.binding) {
            item.binding.unbind();
            item.binding = null;
        }
    }

    _transition(valueTo, duration) {
        if (!this._dummy || this._destroying)
            return;

        const valueFrom = this._dummy.fade;

        if (Math.abs(valueTo - valueFrom) > 0.01 && duration > 0) {
            let transitionStarted = false;
            this._dummy.ease_property('fade', valueTo, {
                duration,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (this._active && transitionStarted)
                        this._blink();
                    else if (this._dummy?.fade === 1.0)
                        this._destroyDummy();
                },
            });
            transitionStarted = true;
        } else {
            this._dummy.remove_transition('fade');
            this._dummy.fade = valueTo;

            if (!this._active && this._dummy.fade === 1.0)
                this._destroyDummy();
        }
    }

    _blink() {
        this._transition(this._dummy.fade < 0.5 ? 1.0 : 0.0, this._blinkDuration);
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

        actor.connectObject('destroy', this._onActorDestroy.bind(this), this);

        if (this._dummy)
            this._bindItem(item);
        else
            actor[propertyName] = lowerValue + (upperValue - lowerValue) * this._baseline;
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
        this._ensureDummy();
        this._blink();
    }

    fadeIn(transitionDuration) {
        this._active = false;
        this._baseline = 1.0;

        if (this._dummy)
            this._transition(1.0, transitionDuration || 0);
    }

    fadeOut(transitionDuration) {
        this._active = false;

        if (!this._dummy)
            this._ensureDummy();

        this._baseline = 0.0;
        this._transition(0.0, transitionDuration || 0);
    }

    destroy() {
        this._active = false;
        this._destroying = true;

        if (this._dummy)
            this._destroyDummy();

        while (this._items.length)
            this._removeItem(0);
    }
};

/**
 * @param {Error} error - Error to log via the extension manager.
 */
export function logError(error) {
    Main.extensionManager.logExtensionError(extension.uuid, error);
}

/**
 * @param {string} message - Warning message to log.
 */
export function logWarning(message) {
    extension.getLogger().warn(message);
}

/**
 * @param {string} uri - URI to open with the default application.
 */
export function openUri(uri) {
    const context = global.create_app_launch_context(global.get_current_time(), -1);

    Gio.AppInfo.launch_default_for_uri(uri, context);
}

/**
 * @param {string} version - Minimum required GNOME Shell version.
 */
export function isVersionAtLeast(version) {
    const currentVersionParts = ShellConfig.PACKAGE_VERSION.split('.');
    const versionParts = version.split('.');

    if (versionParts[0] <= currentVersionParts[0] &&
        (versionParts[1] <= currentVersionParts[1] || versionParts[1] === undefined) &&
        (versionParts[2] <= currentVersionParts[2] || versionParts[2] === undefined))
        return true;

    return false;
}

/**
 *
 */
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

/**
 * @param {string} iconName - Icon file name (without extension) from the icons/ directory.
 */
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
