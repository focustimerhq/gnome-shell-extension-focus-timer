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
 * Authors: Kamil Prusko <kamilprusko@gmail.com>
 *
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {gettext as _, ngettext, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Params from 'resource:///org/gnome/shell/misc/params.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {extension} from './extension.js';
import {State, SECOND, MINUTE} from './timer.js';
import * as Config from './config.js';
import * as ScreenOverlay from './screenOverlay.js';
import * as Utils from './utils.js';


// Time in seconds to announce next timer state.
const TIME_BLOCK_ABOUT_TO_END_TIMEOUT = 10;

// Extra display time in milliseconds after content update.
const NOTIFICATION_SHORT_TIMEOUT = 1500;

// Display time in milliseconds after popping up the notification.
const NOTIFICATION_LONG_TIMEOUT = 2000;

let source = null;
let extensionSource = null;


/**
 * The source that should be used for our notifications.
 */
export function getDefaultSource() {
    if (!source) {
        source = new MessageTray.Source({
            title: _('Focus Timer'),
            icon: Utils.loadIcon('focus-timer-symbolic'),
            policy: new NotificationPolicy(),
        });
        source.connect('destroy', () => {
            source = null;
        });
        Main.messageTray.add(source);
    }

    return source;
}


/**
 * The source that should be used for our notifications.
 */
export function getExtensionSource() {
    if (!extensionSource) {
        extensionSource = new MessageTray.Source({
            title: _('Focus Timer Extension'),
            icon: Utils.loadIcon('gnome-shell-extension-symbolic'),
            policy: new NotificationPolicy(),
        });
        extensionSource.connect('destroy', () => {
            extensionSource = null;
        });
        Main.messageTray.add(extensionSource);
    }

    return extensionSource;
}

function toSeconds(interval) {
    const seconds = Math.trunc(interval / SECOND);

    if (seconds < 10)
        return seconds;

    if (seconds < 30)
        return 5 * Math.round(seconds / 5);

    if (seconds < 60)
        return 10 * Math.round(seconds / 10);

    return 60 * Math.round(seconds / 60);
}

function formatSeconds(seconds) {
    const hours = Math.trunc(seconds / 3600);
    const minutes = Math.trunc((seconds % 3600) / 60);
    const parts = [];

    seconds = seconds % 60;

    if (hours > 0)
        parts.push(ngettext("%d hour", "%d hours", hours).format(hours));

    if (minutes > 0)
        parts.push(ngettext("%d minute", "%d minutes", minutes).format(minutes));

    if (seconds > 0 && hours === 0 || !parts.length)
        parts.push(ngettext("%d second", "%d seconds", seconds).format(seconds));

    return parts.join(' ');
}

function formatRemainingSeconds(seconds) {
    // translators: time remaining eg. "3 minutes 50 seconds remaining"
    return _("%s remaining").format(formatSeconds(seconds));
}

/**
 * @param {string} a - timer state
 * @param {string} b - timer state
 */
function stateEquals(a, b) {
    return a === b || State.isBreak(a) && State.isBreak(b);
}

/**
 * @param {number} a - timestamp
 * @param {number} b - timestamp
 */
function timestampEquals(a, b) {
    return a === b || isNaN(a) && isNaN(b);
}

const NotificationView = {
    NULL: 0,
    TIME_BLOCK_ABOUT_TO_END: 1,
    TIME_BLOCK_ENDED: 2,
    TIME_BLOCK_STARTED: 3,
    TIME_BLOCK_RUNNING: 4,
    CONFIRM_ADVANCEMENT: 5,
};


const NotificationPolicy = GObject.registerClass(
class FocusTimerNotificationPolicy extends MessageTray.NotificationPolicy {
    get showBanners() {
        return true;
    }

    get showInLockScreen() {
        return false;
    }
});


export const Notification = GObject.registerClass({
    Properties: {
        'view': GObject.ParamSpec.int(
            'view', '', '',
            GObject.ParamFlags.READWRITE,
            Math.min(...Object.values(NotificationView)),
            Math.max(...Object.values(NotificationView)),
            NotificationView.NULL),
    },
},
class FocusTimerNotification extends MessageTray.Notification {
    constructor(timer, params) {
        params = Params.parse(params, {
            source: getDefaultSource(),
            useBodyMarkup: false,
        });

        super(params);

        // Notification will update its contents.
        this.resident = true;

        // Notification should not be destroyed when it gets hidden.
        this.isTransient = false;

        // Show notification regardless of session busy status.
        this.forFeedback = true;

        // Hide notification on screen shield.
        this.privacyScope = MessageTray.PrivacyScope.USER;

        // We want notifications to be shown right after the action,
        // therefore urgency bump.
        this.urgency = MessageTray.Urgency.HIGH;

        this._timer = timer;
        this._timerState = State.STOPPED;
        this._timerDuration = 0;
        this._timerOffset = 0;
        this._nextTimerState = State.STOPPED;

        // TODO: watch for updates only when a banner is displayed
        this._timer.connectObject('tick', this._onTimerTick.bind(this), this);

        this.connect('destroy', () => {
            if (this._timer) {
                this._timer.disconnectObject(this);
                this._timer = null;
            }
        });
    }

    get timer() {
        return this._timer;
    }

    get view() {
        return this._view;
    }

    set view(value) {
        this.update(value, this._timer.state);
    }

    get timerState() {
        return this._timerState;
    }

    get datetime() {
        return null;
    }

    set datetime(value) {
    }

    _assertNotReached() {
        throw new Error('Condition should not be reached');
    }

    _updateTitle() {
        let title;

        switch (this._view) {
        case NotificationView.TIME_BLOCK_STARTED:
            if (this._timerState === State.POMODORO)
                title = _("Pomodoro");
            else if (this._timerState === State.BREAK)
                title = _("Take a break");
            else if (this._timerState === State.SHORT_BREAK)
                title = _("Take a short break");
            else if (this._timerState === State.LONG_BREAK)
                title = _("Take a long break");
            else
                this._assertNotReached();

            break;

        case NotificationView.TIME_BLOCK_ABOUT_TO_END:
            if (this._timerState === State.POMODORO)
                title = _("Pomodoro is about to end");
            else if (State.isBreak(this._timerState))
                title = _("Break is about to end");
            else
                this._assertNotReached();

            break;

        case NotificationView.TIME_BLOCK_ENDED:
            if (this._timerState === State.POMODORO)
                title = _("Break is over!");
            else if (State.isBreak(this._timerState))
                title = _("Pomodoro is over!");
            else
                this._assertNotReached();

            break;

        case NotificationView.CONFIRM_ADVANCEMENT:
            if (this._timerState === State.POMODORO)
                title = _("Pomodoro is over!");
            else if (State.isBreak(this._timerState))
                title = _("Break is over!");
            else {
                this._assertNotReached();
            }
            break;

        default:
            title = State.label(this._timerState);
            break;
        }

        this.title = title;
    }

    _updateBody() {
        let body;

        switch (this._view) {
        case NotificationView.TIME_BLOCK_ENDED:
            body = _("Get ready…");
            break;

        case NotificationView.CONFIRM_ADVANCEMENT:
            if (this._nextTimerState === State.POMODORO)
                body = _("Confirm the start of a Pomodoro…");
            else if (this._nextTimerState === State.BREAK)
                body = _("Confirm the start of a break…");
            else if (this._nextTimerState === State.SHORT_BREAK)
                body = _("Confirm the start of a short break…");
            else if (this._nextTimerState === State.LONG_BREAK)
                body = _("Confirm the start of a long break…");
            else
                this._assertNotReached();

            break;

        default:
            body = formatRemainingSeconds(toSeconds(
                this._timer.getRemaining(this._timer.lastTickTime)));
            break;
        }

        if (this.body !== body)
            this.body = body;
    }

    _activateAction(actionName) {
        switch (actionName) {
        case 'extend':
            // Force not closing the banner after click. This may be reverted back to proper
            // value after the timer state change.
            this.resident = true;

            this._timer.extend(MINUTE);
            break;

        case 'start-pomodoro':
            this._timer.state = State.POMODORO;
            break;

        case 'start-break':
            this._timer.state = State.BREAK;
            break;
        }
    }

    _updateActions() {
        const actions = [];
        const actionLabels = {
            'extend': _("+1 minute"),
            'start-pomodoro': _("Start Pomodoro"),
            'start-break': _("Start Break"),
        };

        switch (this._view) {
        case NotificationView.TIME_BLOCK_ABOUT_TO_END:
            actions.push('extend');

            if (this._timerState === State.POMODORO)
                actions.push('start-break');
            else if (State.isBreak(this._timerState))
                actions.push('start-pomodoro');

            break;

        case NotificationView.CONFIRM_ADVANCEMENT:
            if (this._nextTimerState === State.POMODORO)
                actions.push('start-pomodoro');
            else if (State.isBreak(this._nextTimerState))
                actions.push('start-break');

            break;
        }

        this.clearActions();

        for (const actionName of actions)
            this.addAction(actionLabels[actionName], () => this._activateAction(actionName));
    }

    update(view, timerState, nextTimerState = undefined) {
        if (!Object.values(NotificationView).includes(view))
            throw new Error('Invalid value');

        if (view === NotificationView.NULL)
            return;

        this._view = view;
        this._timerState = timerState;
        this._nextTimerState = nextTimerState ?? timerState;

        this._updateTitle();
        this._updateBody();
        this._updateActions();
    }

    _onTimerTick() {
        if (this._timer.state === this._timerState)
            this._updateBody();
    }
});


export const IssueNotification = GObject.registerClass(
class FocusTimerIssueNotification extends MessageTray.Notification {
    constructor(message) {
        super({
            source: getExtensionSource(),
            title: _('Something went wrong'),
            body: message,
            urgency: MessageTray.Urgency.HIGH,
            useBodyMarkup: true,
        });

        this.addAction(_('Report issue'), () => {
            this._activateReportIssue();
        });

        this.connect('activated', () => {
            this._activateReportIssue();
        });
    }

    _activateReportIssue() {
        Utils.openUri(Config.PACKAGE_BUGREPORT);
    }
});


export const InstallApplicationNotification = GObject.registerClass(
class FocusTimerInstallApplicationNotification extends MessageTray.Notification {
    constructor() {
        super({
            source: getExtensionSource(),
            title: _('Focus Timer Not Found'),
            body: _('Install Focus Timer app to start using the extension.'),
            urgency: MessageTray.Urgency.NORMAL,
            useBodyMarkup: true,
        });

        this.addAction(_('Install from Flathub'), () => {
            this._activateInstall();
        });

        this.connect('activated', () => {
            this._activateInstall();
        });
    }

    _activateInstall() {
        Utils.openUri(Config.PACKAGE_FLATHUB_URL);
    }
});


export const NotificationManager = class extends Signals.EventEmitter {
    constructor(timer, session, settings, params) {
        params = Params.parse(params, {
            animate: true,
        });

        super();

        this._timer = timer;
        this._session = session;
        this._settings = settings;
        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._notification = null;
        this._screenOverlay = null;
        this._injectionManager = new InjectionManager();
        this._overridesApplied = false;
        this._annoucementTimeoutId = 0;
        this._reopenScreenOverlayIdleId = 0;
        this._lockScreenIdleId = 0;
        this._queueChangedId = 0;
        this._viewData = {
            view: NotificationView.NULL,
            timerState: State.STOPPED,
            duration: 0,
            offset: 0,
            startedTime: NaN,
            pausedTime: NaN,
        };
        this._nextViewData = null;
        this._destroying = false;

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._session.connectObject('confirm-advancement', this._onConfirmAdvancement.bind(this), this);
        this._settings.connectObject('changed', this._onSettingsChanged.bind(this), this);

        this._update(params.animate);
    }

    get timer() {
        return this._timer;
    }

    get notification() {
        return this._notification;
    }

    get screenOverlay() {
        return this._screenOverlay;
    }

    _applyOverrides() {
        if (this._overridesApplied)
            return;

        // Suppress auto-expanding of notification banners for timer notifications.
        // We don't want them to auto-expand and take extra screen space,
        // even if they are marked with Urgency.CRITICAL.
        this._injectionManager.overrideMethod(Main.messageTray, '_expandBanner',
            originalMethod => {
                return function (autoExpanding) {
                    if (autoExpanding && this._notification instanceof Notification)
                        return;

                    originalMethod.call(this, autoExpanding);
                };
            });

        this._overridesApplied = true;
    }

    _revertOverrides() {
        if (!this._overridesApplied)
            return;

        this._injectionManager.clear();
        this._overridesApplied = false;
    }

    _getBanner() {
        const banner = Main.messageTray._banner;

        if (!this._notification || banner?.notification !== this._notification)
            return null;

        if (Main.messageTray._notificationState === State.HIDING)
            return null;

        return banner;
    }

    _createScreenOverlay() {
        const screenOverlay = new ScreenOverlay.ScreenOverlay(this._timer, {
            enable_blur_effect: this._settings.get_boolean('blur-effect'),
            enable_dismiss_gesture: this._settings.get_boolean('dismiss-gesture'),
        });
        screenOverlay.connect('opening',
            () => {
                // `MessageTray` opens a banner as soon as the date menu starts closing. To avoid unnecessary flicker
                // destroy the notification before `MessageTray` considers it.
                const dateMenu = Main.panel.statusArea.dateMenu?.menu;

                this._expireNotification();
                this._removeReopenScreenOverlayIdleWatch();

                if (dateMenu && dateMenu.actor.visible)
                    dateMenu.close(PopupAnimation.NONE);

            });
        screenOverlay.connect('opened',
            () => {
                this._addLockScreenIdleWatch();
            });
        screenOverlay.connect('closing',
            () => {
                this._removeLockScreenIdleWatch();

                if (this._viewData.view === NotificationView.NULL ||
                    this._viewData.view === NotificationView.CONFIRM_ADVANCEMENT ||
                    this._destroying)
                    return;

                this._viewData.view = this._resolveView();
                this._notify();

                if (State.isBreak(this._viewData.timerState))
                    this._addReopenScreenOverlayIdleWatch();
            });
        screenOverlay.connect('destroy',
            () => {
                if (this._screenOverlay === screenOverlay)
                    this._screenOverlay = null;
            });

        return screenOverlay;
    }

    _isScreenOverlayOpened() {
        return this._screenOverlay && (
            this._screenOverlay.state === ScreenOverlay.OverlayState.OPENED ||
            this._screenOverlay.state === ScreenOverlay.OverlayState.OPENING);
    }

    openScreenOverlay(animate = true) {
        if (this._destroying)
            return false;

        if (!this._screenOverlay)
            this._screenOverlay = this._createScreenOverlay();

        return this._screenOverlay.open(animate);
    }

    _openScreenOverlayOrNotify(animate) {
        if (this._destroying)
            return;

        // TODO: detect webcam

        if (!this.openScreenOverlay(animate))
            this._notify();
    }

    _shouldScheduleAnnoucement() {
        switch (this._viewData.view) {
        case NotificationView.TIME_BLOCK_STARTED:
        case NotificationView.TIME_BLOCK_RUNNING:
            return this._settings.get_boolean('announce-about-to-end');

        default:
            return false;
        }
    }

    _scheduleAnnoucement() {
        const timeout = Math.round(this._timer.getRemaining() / SECOND - TIME_BLOCK_ABOUT_TO_END_TIMEOUT);

        this._unscheduleAnnoucement();

        if (timeout <= 0) {
            this._onAnnoucementTimeout();
            return;
        }

        this._annoucementTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            timeout,
            this._onAnnoucementTimeout.bind(this));
        GLib.Source.set_name_by_id(this._annoucementTimeoutId,
            '[focus-timer] NotificationManager._onAnnoucementTimeout');
    }

    _unscheduleAnnoucement() {
        if (this._annoucementTimeoutId) {
            GLib.source_remove(this._annoucementTimeoutId);
            this._annoucementTimeoutId = 0;
        }
    }

    _createNotification() {
        const notification = new Notification(this._timer);
        notification.connect('activated',
            () => {
                switch (notification.view) {
                case NotificationView.TIME_BLOCK_STARTED:
                case NotificationView.TIME_BLOCK_RUNNING:
                    if (State.isBreak(this._timer.state))
                        this.openScreenOverlay();

                    break;

                case NotificationView.CONFIRM_ADVANCEMENT:
                    if (this._timer.state === notification.timerState)
                        this._timer.skip();

                    break;
                }
            });
        notification.connect('destroy',
            () => {
                if (this._notification === notification)
                    this._notification = null;
            });

        return notification;
    }

    _updateNotification() {
        if (!this._notification || this._destroying)
            return;

        const notification = this._notification;
        const timerState = this._viewData.timerState;
        const nextTimerState = this._nextViewData?.timerState;
        const isBreak = State.isBreak(timerState);
        let view = this._viewData.view;

        // Use Urgency.CRITICAL to force notification banner to stay open.
        const isUrgent =
            view === NotificationView.TIME_BLOCK_ABOUT_TO_END ||
            view === NotificationView.TIME_BLOCK_ENDED ||
            view === NotificationView.CONFIRM_ADVANCEMENT;
        const urgency = isUrgent ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.HIGH;
        if (notification.urgency !== urgency)
            notification.urgency = urgency;

        const isTransient =
            view === NotificationView.TIME_BLOCK_RUNNING && !isBreak ||
            view === NotificationView.TIME_BLOCK_STARTED && !isBreak ||
            view === NotificationView.TIME_BLOCK_ENDED;
            view === NotificationView.TIME_BLOCK_ABOUT_TO_END;
        if (notification.isTransient !== isTransient)
            notification.isTransient = isTransient;

        const isResident = isBreak ||
            view === NotificationView.TIME_BLOCK_ABOUT_TO_END ||
            view === NotificationView.CONFIRM_ADVANCEMENT;
        if (notification.resident !== isResident)
            notification.resident = isResident;

        // Keep the view shown in the banner after extending duration.
        const banner = this._getBanner();
        if (banner &&
            State.isBreak(notification.timerState) === isBreak &&
            notification.view === NotificationView.TIME_BLOCK_ABOUT_TO_END &&
            view === NotificationView.TIME_BLOCK_RUNNING)
            view = notification.view;

        notification.update(view, timerState, nextTimerState);

        if (isUrgent)
            Main.messageTray._updateNotificationTimeout(0);  // no timeout
        else
            Main.messageTray._updateNotificationTimeout(banner
                ? NOTIFICATION_SHORT_TIMEOUT : NOTIFICATION_LONG_TIMEOUT);
    }

    _queueUpdateNotification() {
        if (this._destroying)
            return;

        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._updateNotification();

            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, '[focus-timer] NotificationManager._updateNotification');
    }

    _notify() {
        if (this._destroying)
            return;

        if (this._screenOverlay)
            this._screenOverlay.close(true);

        if (this._viewData.view === NotificationView.NULL)
            return;

        if (!this._queueChangedId)
            this._queueChangedId = Main.messageTray.connect('queue-changed', this._onMessageTrayQueueChanged.bind(this));

        this._expireNotification(false);

        this._notification = this._createNotification();
        this._updateNotification();
        this._notification.source.addNotification(this._notification);

        if (this._notification &&
            this._notification.urgency !== MessageTray.Urgency.CRITICAL &&
            Main.messageTray._notification === this._notification)
            Main.messageTray._updateNotificationTimeout(NOTIFICATION_LONG_TIMEOUT);
    }

    _expireNotification(animate = false) {
        if (!this._notification)
            return;

        const notification = this._notification;

        this._notification = null;

        if (animate &&
            Main.messageTray._notification === notification &&
            Main.messageTray._notificationState !== MessageTray.State.HIDDEN) {
            notification.isTransient = true;
            notification.acknowledged = true;

            Main.messageTray._expireNotification();
        } else {
            notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        }
    }

    _resolveView() {
        if (this._timer.isPaused() || !this._timer.duration)
            return NotificationView.NULL;

        if (!this._timer.isStarted())
            return NotificationView.TIME_BLOCK_ENDED;

        if (this._timer.isFinished())
            return NotificationView.CONFIRM_ADVANCEMENT;

        if (this._timer.startedTime === this._timer.lastChangedTime &&
            this._timer.getElapsed() < 10 * SECOND)
            return NotificationView.TIME_BLOCK_STARTED;

        if (this._timer.getRemaining() < 15 * SECOND)
            return NotificationView.TIME_BLOCK_ABOUT_TO_END;

        return NotificationView.TIME_BLOCK_RUNNING;
    }

    _shouldOpenScreenOverlay(data, previousData) {
        if (!State.isBreak(data.timerState))
            return false;

        if (data.view === NotificationView.NULL ||
            data.view === NotificationView.TIME_BLOCK_ABOUT_TO_END)
            return false;

        if (stateEquals(data.timerState, previousData.timerState) &&
            timestampEquals(data.startedTime, previousData.startedTime) &&
            timestampEquals(data.pausedTime, previousData.pausedTime)) {
            if (data.offset !== previousData.offset)
                return false;  // rewinded

            if (data.duration !== previousData.duration)
                return false;  // extended
        }

        return this._settings.get_boolean('screen-overlay');
    }

    _shouldCloseScreenOverlay(data) {
        if (!State.isBreak(data.timerState))
            return true;

        if (data.view === NotificationView.NULL ||
            data.view === NotificationView.CONFIRM_ADVANCEMENT)
            return true;

        return false;
    }

    /**
     * Return whether we should pop a fresh notification or update existing one.
     */
    _shouldNotify(data, previousData) {
        if (data.view === NotificationView.NULL)
            return false;

        if (previousData.timerState === State.STOPPED)
            return true;

        if (this._getBanner())
            return false;  // update banner

        if (previousData.view !== NotificationView.TIME_BLOCK_ABOUT_TO_END &&
            data.view === NotificationView.TIME_BLOCK_ABOUT_TO_END)
            return true;

        if (previousData.view === NotificationView.TIME_BLOCK_ABOUT_TO_END &&
            data.view === NotificationView.TIME_BLOCK_RUNNING)
            return false;

        if (previousData.view !== NotificationView.TIME_BLOCK_STARTED &&
            data.view === NotificationView.TIME_BLOCK_STARTED)
            return true;

        if (data.view === NotificationView.CONFIRM_ADVANCEMENT)
            return true;

        if (data.timerState !== previousData.timerState)
            return true;

        if (data.offset !== previousData.offset)
            return true;

        return false;
    }

    _update(animate = true) {
        if (this._timer.state && this._timer.state !== State.STOPPED) {
            const data = {
                view: this._resolveView(),
                timerState: this._timer.state,
                duration: this._timer.duration,
                offset: this._timer.offset,
                startedTime: this._timer.startedTime,
                pausedTime: this._timer.pausedTime,
            };
            const previousData = this._viewData;

            if (data.view == NotificationView.CONFIRM_ADVANCEMENT) {
                if (!this._nextViewData && previousData.timerState === State.STOPPED) {
                    this._viewData = data;
                    this._session.getNextTimeBlock().then(
                        (timeBlock) => {
                            if (this._viewData !== data)
                                return;
                            this._onConfirmAdvancement(this._session, null, timeBlock);
                        }
                    ).catch(logError);
                }

                return;
            }

            this._viewData = data;
            this._nextViewData = null;

            this._applyOverrides();

            if (this._isScreenOverlayOpened()) {
                if (this._shouldCloseScreenOverlay(data, previousData))
                    this._screenOverlay.close(animate);
            } else {
                if (this._shouldOpenScreenOverlay(data, previousData))
                    this._openScreenOverlayOrNotify(animate);
                else if (this._shouldNotify(data, previousData))
                    this._notify();
                else if (data.view !== NotificationView.NULL)
                    this._updateNotification();
                else
                    this._expireNotification(false);
            }

            if (this._shouldScheduleAnnoucement())
                this._scheduleAnnoucement();
            else
                this._unscheduleAnnoucement();
        } else {
            this._viewData = {
                view: NotificationView.NULL,
                timerState: State.STOPPED,
                duration: 0,
                offset: 0,
                startedTime: NaN,
                pausedTime: NaN,
            };
            this._nextViewData = null;

            this._unscheduleAnnoucement();

            if (this._screenOverlay) {
                this._screenOverlay.destroy();
                this._screenOverlay = null;
            }

            if (this._notification) {
                this._notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
                this._notification = null;
            }

            // Ensure stopping the timer removes all notifications.
            if (source) {
                const notifications = source ? source.notifications : [];

                notifications.forEach(notification => {
                    if (notification instanceof Notification)
                        notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
                });
            }

            this._revertOverrides();
        }
    }

    _onLockScreenIdle(_monitor) {
        if (this._screenOverlay && this._screenOverlay.state === ScreenOverlay.OverlayState.OPENED)
            this._screenOverlay?.lock();
    }

    _addLockScreenIdleWatch() {
        const lockDelay = this._settings.get_uint('screen-overlay-lock-delay') * 1000;

        if (!this._lockScreenIdleId && lockDelay > 0)
            this._lockScreenIdleId = this._idleMonitor.add_idle_watch(lockDelay,
                this._onLockScreenIdle.bind(this));
    }

    _removeLockScreenIdleWatch() {
        if (this._lockScreenIdleId != 0) {
            this._idleMonitor.remove_watch(this._lockScreenIdleId);
            this._lockScreenIdleId = 0;
        }
    }

    _onReopenScreenOverlayIdle(_monitor) {
        if (this._notification?.view === NotificationView.TIME_BLOCK_ABOUT_TO_END)
            return;

        this.openScreenOverlay();
    }

    _addReopenScreenOverlayIdleWatch() {
        const reopenDelay = this._settings.get_uint('screen-overlay-reopen-delay') * 1000;

        if (!this._reopenScreenOverlayIdleId && reopenDelay > 0)
            this._reopenScreenOverlayIdleId = this._idleMonitor.add_idle_watch(reopenDelay,
                this._onReopenScreenOverlayIdle.bind(this));
    }

    _removeReopenScreenOverlayIdleWatch() {
        if (this._reopenScreenOverlayIdleId) {
            this._idleMonitor.remove_watch(this._reopenScreenOverlayIdleId);
            this._reopenScreenOverlayIdleId = 0;
        }
    }

    _resetReopenScreenOverlayIdleWatch() {
        this._removeReopenScreenOverlayIdleWatch();
        this._addReopenScreenOverlayIdleWatch();
    }

    _onAnnoucementTimeout() {
        this._annoucementTimeoutId = 0;
        this._viewData.view = NotificationView.TIME_BLOCK_ABOUT_TO_END;

        if (this._isScreenOverlayOpened())
            return;

        if (this._getBanner())
            this._updateNotification();
        else
            this._notify();

        return GLib.SOURCE_REMOVE;
    }

    _onTimerChanged(_timer) {
        this._update(true);
    }

    _onConfirmAdvancement(_session, _currentTimeBlock, nextTimeBlock) {
        this._viewData = {
            view: NotificationView.CONFIRM_ADVANCEMENT,
            timerState: this._timer.state,
            duration: this._timer.duration,
            offset: this._timer.offset,
            startedTime: this._timer.startedTime,
            pausedTime: this._timer.pausedTime,
        };
        this._nextViewData = {
            view: NotificationView.TIME_BLOCK_STARTED,
            timerState: nextTimeBlock.state,
            duration: nextTimeBlock.endTime ? nextTimeBlock.endTime - nextTimeBlock.startTime : 0,
            offset: 0,
            startedTime: NaN,
            pausedTime: NaN,
        };

        this._applyOverrides();
        this._notify();
    }

    _onSettingsChanged(settings, key) {
        switch (key) {
        case 'announce-about-to-end':
            if (this._shouldScheduleAnnoucement())
                this._scheduleAnnoucement();
            else
                this._unscheduleAnnoucement();

            break;

        case 'screen-overlay':
            if (this._screenOverlay && !settings.get_boolean(key)) {
                this._screenOverlay.destroy();
                this._screenOverlay = null;
            }

            if (State.isBreak(this._timerState) &&
                this._view !== NotificationView.TIME_BLOCK_ABOUT_TO_END &&
                settings.get_boolean(key))
                this._openScreenOverlayOrNotify(true);

            break;

        case 'blur-effect':
        case 'dismiss-gesture':
            if (this._screenOverlay) {
                this._screenOverlay.destroy();
                this._screenOverlay = this._createScreenOverlay();
            }

            break;

        case 'screen-overlay-lock-delay':
            if (this._lockScreenIdleId) {
                this._removeLockScreenIdleWatch();
                this._addLockScreenIdleWatch();
            }

            break;

        case 'screen-overlay-reopen-delay':
            if (this._reopenScreenOverlayIdleId) {
                this._removeReopenScreenOverlayIdleWatch();
                this._addReopenScreenOverlayIdleWatch();
            }

            break;
        }
    }

    _onBannerDestroy(banner) {
        banner.disconnectObject(this);

        if (this._view === NotificationView.TIME_BLOCK_STARTED && this._notification?.resident) {
            this._view = NotificationView.TIME_BLOCK_RUNNING;
            this._queueUpdateNotification();
        }
    }

    _onMessageTrayQueueChanged(messageTray) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const banner = messageTray._banner;

            if (banner?.notification && banner.notification === this._notification) {
                banner.disconnectObject(this);
                banner.connectObject('destroy', this._onBannerDestroy.bind(this), this);
            }

            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, '[focus-timer] NotificationManager._onMessageTrayQueueChanged');
    }

    destroy() {
        this._destroying = true;
        this._unscheduleAnnoucement();
        this._removeReopenScreenOverlayIdleWatch();
        this._removeLockScreenIdleWatch();

        if (this._screenOverlay) {
            this._screenOverlay.destroy();
            this._screenOverlay = null;
        }

        if (this._notification) {
            this._notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            this._notification = null;
        }

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._session) {
            this._session.disconnectObject(this);
            this._session = null;
        }

        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        if (this._queueChangedId) {
            Main.messageTray.disconnect(this._queueChangedId);
            this._queueChangedId = 0;
        }

        this._injectionManager.clear();
        this._injectionManager = null;

        this._timerState = State.STOPPED;
        this._timerDuration = 0;
        this._timerOffset = 0;
        this._idleMonitor = null;

        this.emit('destroy');
    }
};
