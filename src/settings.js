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

import Gio from 'gi://Gio';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * Convenience wrapper for combining application settings with the extension settings.
 *
 * It's read-only and mimic API of `GLib.Settings`.
 */
export const SettingsWrapper = class extends EventEmitter {
    constructor(extensionSettings, applicationProxy) {
        super();

        this._extensionSettings = extensionSettings;
        this._applicationProxy = applicationProxy;
        this._applicationSettings = applicationProxy.Settings ?? {};
        this._bindings = new Map();

        this._extensionSettingsChangedId = extensionSettings.connect(
            'changed', this._onExtensionSettingsChanged.bind(this));
        this._applicationProxyChangedId = applicationProxy.connect(
            'g-properties-changed', this._onApplicationSettingsChanged.bind(this));
    }

    _onExtensionSettingsChanged(settings, key) {
        this.emit('changed', key);
    }

    _onApplicationSettingsChanged(proxy, properties) {
        const settingsChanged = !!properties.lookup_value('Settings', null);

        if (settingsChanged) {
            const previousSettings = this._applicationSettings;
            const currentSettings = proxy.Settings ?? {};
            const allKeys = new Set([
                ...Object.keys(previousSettings),
                ...Object.keys(currentSettings),
            ]);

            this._applicationSettings = currentSettings;

            for (const key of allKeys) {
                const previousValue = previousSettings[key];
                const currentValue = currentSettings[key];

                if (currentValue === undefined || previousValue === undefined)
                    this.emit('changed', key);
                else if (!currentValue.equal(previousValue))
                    this.emit('changed', key);
            }
        }
    }

    get_value(key) {
        return this._applicationSettings[key] ??
               this._extensionSettings.get_value(key);
    }

    get_boolean(key) {
        return this.get_value(key).get_boolean();
    }

    get_uint(key) {
        return this.get_value(key).get_uint32();
    }

    get_string(key) {
        return this.get_value(key).get_string();
    }

    /**
     * Create a binding between a settings key and object[property].
     *
     * Only the GET direction (settings → object) is supported since this class is read-only.
     *
     * @param {string} key - Settings key.
     * @param {object} object - Target object.
     * @param {string} property - Property name on the target object.
     * @param {number} flags - Gio.SettingsBindFlags bitmask.
     */
    bind(key, object, property, flags) {
        this.bind_with_mapping(key, object, property, flags, null, null);
    }

    /**
     * Like bind(), but with optional mapping functions.
     *
     * @param {string} key - Settings key.
     * @param {object} object - Target object.
     * @param {string} property - Property name on the target object.
     * @param {number} flags - Gio.SettingsBindFlags bitmask.
     * @param {Function|null} getMappingFunc - Maps variant to value; return `false` to skip update.
     * @param {Function|null} _setMappingFunc - Accepted for API compatibility but ignored (read-only).
     */
    bind_with_mapping(key, object, property, flags, getMappingFunc, _setMappingFunc) {
        const bindFlags = flags ?? Gio.SettingsBindFlags.DEFAULT;
        const invertBoolean = !!(bindFlags & Gio.SettingsBindFlags.INVERT_BOOLEAN);

        const applyToObject = () => {
            const variant = this.get_value(key);
            if (!variant)
                return;

            let value;
            if (getMappingFunc) {
                value = getMappingFunc(variant);
                if (value === false)
                    return;
            } else {
                value = variant.unpack();
                if (invertBoolean)
                    value = !value;
            }

            object[property] = value;
        };

        if (!(bindFlags & Gio.SettingsBindFlags.GET_NO_CHANGES))
            applyToObject();

        const handlerId = this.connect('changed', (_settings, changedKey) => {
            if (changedKey === key)
                applyToObject();
        });

        let objectBindings = this._bindings.get(object);
        if (!objectBindings) {
            objectBindings = new Map();
            this._bindings.set(object, objectBindings);
        }

        const existing = objectBindings.get(property);
        if (existing)
            this.disconnect(existing.handlerId);

        objectBindings.set(property, {handlerId, key});
    }

    unbind(object, property) {
        const objectBindings = this._bindings.get(object);
        if (!objectBindings)
            return;

        const binding = objectBindings.get(property);
        if (binding) {
            this.disconnect(binding.handlerId);
            objectBindings.delete(property);
        }

        if (objectBindings.size === 0)
            this._bindings.delete(object);
    }

    destroy() {
        for (const objectBindings of this._bindings.values()) {
            for (const {handlerId} of objectBindings.values())
                this.disconnect(handlerId);
        }
        this._bindings.clear();

        if (this._extensionSettingsChangedId) {
            this._extensionSettings.disconnect(this._extensionSettingsChangedId);
            this._extensionSettingsChangedId = 0;
        }

        if (this._applicationProxyChangedId) {
            this._applicationProxy.disconnect(this._applicationProxyChangedId);
            this._applicationProxyChangedId = 0;
        }

        this.emit('destroy');
    }
};
