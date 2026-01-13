/*
 * Copyright (c) 2011-2026 focus-timer contributors
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
 * Authors: Arun Mahapatra <pratikarun@gmail.com>
 *          Kamil Prusko <kamilprusko@gmail.com>
 */

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {Indicator, IndicatorType} from './indicator.js';
import {NotificationManager} from './notifications.js';
import {ApplicationProxy, TimerProxy, SessionProxy, ShellIntegrationService, BUS_NAME, OBJECT_PATH} from './dbus.js';
import {DistractionManager} from './distractions.js';
import {ScreenShieldManager} from './screenShield.js';
import {InstallApplicationNotification} from './notifications.js';
import {Timer, State} from './timer.js';
import {Session} from './session.js';
import {SettingsWrapper} from './settings.js';
import * as Config from './config.js';
import * as Utils from './utils.js';


const ExtensionMode = {
    DISCONNECTED: 0,
    DEFAULT: 1,
    SCREEN_SHELD: 2,
};

export let extension = null;


export default class FocusTimerExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        this._mode                  = ExtensionMode.DISCONNECTED;
        this._settings              = null;
        this._settingsWrapper       = null;
        this._cancellable           = null;
        this._proxy                 = null;
        this._timer                 = null;
        this._timerProxy            = null;
        this._session               = null;
        this._sessionProxy          = null;
        this._indicator             = null;
        this._notificationManager   = null;
        this._distractionManager    = null;
        this._notification          = null;
        this._initialized           = false;
        this._nameWatcherId         = 0;
        this._sessionModeUpdatedId  = 0;

        extension = this;
    }

    get settings() {
        return this._settingsWrapper ?? this._settings;
    }

    get timer() {
        return this._timer;
    }

    get session() {
        return this._session;
    }

    get application() {
        const appSystem = Shell.AppSystem.get_default();

        return appSystem.lookup_app(`${Config.APPLICATION_ID}.desktop`);
    }

    get indicator() {
        return this._indicator;
    }

    _isConnected() {
        return this._proxy ? this._proxy.g_name_owner !== null : false;
    }

    async _initializeDBusProxies() {
        this._cancellable = new Gio.Cancellable();

        try {
            const connection = Gio.DBus.session;
            const flags = this._settings.get_boolean('autostart')
                ? Gio.DBusProxyFlags.NONE : Gio.DBusProxyFlags.DO_NOT_AUTO_START;
            const [applicationProxy, timerProxy, sessionProxy] = await Promise.all([
                new Promise((resolve, reject) => {
                    new ApplicationProxy(connection, BUS_NAME, OBJECT_PATH,
                        (proxy, error) => error ? reject(error) : resolve(proxy),
                        this._cancellable,
                        flags);
                }),
                new Promise((resolve, reject) => {
                    new TimerProxy(connection, BUS_NAME, OBJECT_PATH,
                        (proxy, error) => error ? reject(error) : resolve(proxy),
                        this._cancellable,
                        Gio.DBusProxyFlags.NONE,
                    );
                }),
                new Promise((resolve, reject) => {
                    new SessionProxy(connection, BUS_NAME, OBJECT_PATH,
                        (proxy, error) => error ? reject(error) : resolve(proxy),
                        this._cancellable,
                        Gio.DBusProxyFlags.NONE,
                    );
                })
            ]);

            this._proxy = applicationProxy;
            this._timerProxy = timerProxy;
            this._sessionProxy = sessionProxy;

            applicationProxy.connectSignal('RequestFocus', (_proxy) => {
                this._focusApplication();
            });
            applicationProxy.connect('notify::g-name-owner', (_object, _pspec) => {
                console.log('### notify::g-name-owner');

                // TODO: handle disconnected?
            });
        } catch (error) {
            Utils.logError(error);  // `Failed to connect to D-Bus: ${error.message}`);
        }

        this._cancellable = null;
    }

    _uninitializeDBusProxies() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._proxy) {
            this._proxy.run_dispose();
            this._proxy = null;
        }

        if (this._timerProxy) {
            this._timerProxy.run_dispose();
            this._timerProxy = null;
        }

        if (this._sessionProxy) {
            this._sessionProxy.run_dispose();
            this._sessionProxy = null;
        }
    }

    _initialize() {
        this._timer = new Timer(this._timerProxy);
        this._session = new Session(this._sessionProxy);
        this._settingsWrapper = new SettingsWrapper(this._settings, this._proxy);

        if (this._notification) {
            this._notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            this._notification = null;
        }

        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', () => {
            try {
                this._updateMode();
            } catch (error) {
                Utils.logError(error);
            }
        });

        this._initialized = true;
        this._updateMode();
    }

    _uninitialize() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        this._setMode(ExtensionMode.DISCONNECTED);
        this._initialized = false;

        if (this._settingsWrapper) {
            this._settingsWrapper.destroy();
            this._settingsWrapper = null;
        }

        if (this._timer) {
            this._timer.destroy();
            this._timer = null;
        }

        if (this._session) {
            this._session.destroy();
            this._session = null;
        }

        if (this._sessionModeUpdatedId != 0) {
            Main.sessionMode.disconnect(this._sessionModeUpdatedId);
            this._sessionModeUpdatedId = 0;
        }
    }

    _notifyApplicationNotInstalled() {
        if (this._notification instanceof InstallApplicationNotification)
            return;

        const notification = new InstallApplicationNotification();
        notification.connect('destroy', () => {
            if (this._notification === notification)
                this._notification = null;
        });

        this._notification = notification;

        notification.source.addNotification(notification);
    }

    _onNameAppeared() {
        if (this._proxy)
            return;

        this._initializeDBusProxies().then(() => {
            try {
                this._initialize();
            } catch (error) {
                this.logError(error);
            }
        });
    }

    _onNameVanished() {
        if (this._initialized)
            this._uninitialize();

        if (this._proxy)
            this._uninitializeDBusProxies();
        else if (!this.application)
            this._notifyApplicationNotInstalled();
    }

    _createNameWatcher() {
        if (this._nameWatcherId)
            return;

        const flags = this._settings.get_boolean('autostart')
             ? Gio.BusNameWatcherFlags.AUTO_START : Gio.BusNameWatcherFlags.NONE;

        this._nameWatcherId = Gio.DBus.session.watch_name(
            BUS_NAME,
            flags,
            this._onNameAppeared.bind(this),
            this._onNameVanished.bind(this));
    }

    _destroyNameWatcher() {
        if (this._nameWatcherId) {
            Gio.DBus.session.unwatch_name(this._nameWatcherId);
            this._nameWatcherId = 0;
        }
    }

    _enableIndicator() {
        if (!this._indicator) {
            const indicatorType = this._settings.get_string('indicator-type') === 'text'
                ? IndicatorType.TEXT
                : IndicatorType.ICON;

            this._indicator = new Indicator(this._timer, this._session, indicatorType);
            this._indicator.connect('destroy', () => {
                this._indicator = null;
            });

            try {
                Main.panel.addToStatusArea(this.uuid, this._indicator);
            } catch (error) {
                Utils.logError(error);
            }
        }
    }

    _disableIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _enableNotificationManager(animate) {
        const params = {
            animate,
        };

        if (!this._notificationManager)
            this._notificationManager = new NotificationManager(
                this._timer, this._session, this._settingsWrapper, params);
    }

    _disableNotificationManager() {
        if (this._notificationManager) {
            this._notificationManager.destroy();
            this._notificationManager = null;
        }
    }

    _enableDistractionManager() {
        if (!this._distractionManager)
            this._distractionManager = new DistractionManager(this._timer, this._settingsWrapper);
    }

    _disableDistractionManager() {
        if (this._distractionManager) {
            this._distractionManager.destroy();
            this._distractionManager = null;
        }
    }

    _enableScreenShieldManager() {
        if (!Main.screenShield?._dialog)
            return;

        if (!this._screenShieldManager)
            this._screenShieldManager = new ScreenShieldManager(this._timer, this._session);
    }

    _disableScreenShieldManager() {
        if (this._screenShieldManager) {
            this._screenShieldManager.destroy();
            this._screenShieldManager = null;
        }
    }

    _setMode(mode) {
        const previousMode = this._mode;

        if (this._mode === mode)
            return;

        this._mode = mode;

        switch (mode) {
        case ExtensionMode.DEFAULT:
            this._enableIndicator();
            this._enableNotificationManager(previousMode !== ExtensionMode.SCREEN_SHIELD);
            this._enableDistractionManager();
            this._disableScreenShieldManager();
            break;

        case ExtensionMode.SCREEN_SHIELD:
            this._disableIndicator();
            this._disableNotificationManager();
            this._enableDistractionManager();
            this._enableScreenShieldManager();
            break;

        default:
            this._disableIndicator();
            this._disableNotificationManager();
            this._disableDistractionManager();
            this._disableScreenShieldManager();
        }
    }

    _updateMode() {
        if (!this._isConnected())
            this._setMode(ExtensionMode.DISCONNECTED);
        else if (Main.sessionMode.isLocked)
            this._setMode(ExtensionMode.SCREEN_SHIELD);
        else
            this._setMode(ExtensionMode.DEFAULT);
    }

    _focusApplication() {
        const application = this.application;

        if (application) {
            const currentTime = global.display.get_current_time_roundtrip();
            Main.overview.hide();
            application.activate_full(-1, currentTime);
        } else {
            Utils.logWarning(`Unable to focus application ${Config.APPLICATION_ID}`);
        }
    }

    openScreenOverlay() {
        if (this._timer.isPaused() && State.isBreak(this._timer.state))
            this._timer.resume();
        else if (this._settingsWrapper.get_boolean('screen-overlay'))
            this._notificationManager?.openScreenOverlay(true);
    }

    async showWindow(view) {
        if (!this._proxy) {
            Utils.logWarning(`Unable to call showWindow(${view}). D-Bus proxy not initialized.`);
            return;
        }

        try {
            await this._proxy.ShowWindowAsync(view || 'default');
        } catch (error) {
            Utils.logWarning(`Error activating window: ${error.message}`);
        }
    }

    async showPreferences(view) {
        if (!this._proxy) {
            Utils.logWarning(`Unable to call showPreferences(${view}). D-Bus proxy not initialized.`);
            return;
        }

        try {
            await this._proxy.ShowPreferencesAsync(view || 'timer');
        } catch (error) {
            Utils.logWarning(`Error activating preferences: ${error.message}`);
        }
    }

    async quit() {
        if (!this._proxy) {
            Utils.logWarning('Unable to call quit(). D-Bus proxy not initialized.');
            return;
        }

        try {
            await this._proxy.QuitAsync();
        } catch (error) {
            Utils.logWarning(`Error activating quit: ${error.message}`);
        }
    }

    _onSettingsChanged(settings, key) {
        if (!this._initialized)
            return;

        switch (key) {
        case 'autostart':
            if (this._nameWatcherId) {
                this._destroyNameWatcher();
                this._createNameWatcher();
            }
            break;

        case 'indicator-type':
            const indicatorType = settings.get_string(key) === 'text'
                ? IndicatorType.TEXT
                : IndicatorType.ICON;
            if (this._indicator)
                this._indicator.type = indicatorType;

            break;
        }
    }

    enable() {
        this._settings = this.getSettings();
        this._settings.connect('changed', this._onSettingsChanged.bind(this));

        this._dbusService = new ShellIntegrationService(this);
        this._createNameWatcher();
    }

    disable() {
        this._destroyNameWatcher();
        this._uninitialize();
        this._uninitializeDBusProxies();

        if (this._dbusService) {
            this._dbusService.destroy();
            this._dbusService = null;
        }

        if (this._notification) {
            this._notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            this._notification = null;
        }

        if (this._settings) {
            this._settings.run_dispose();
            this._settings = null;
        }

        if (this._settingsWrapper) {
            this._settingsWrapper.destroy();
            this._settingsWrapper = null;
        }
    }
}
