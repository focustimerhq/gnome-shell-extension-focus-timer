/*
 * Copyright (c) 2023-2026 focus-timer contributors
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

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {State, SECOND} from './timer.js';
import {TimerControlButtons} from './timerControlButtons.js';
import {TimerLabel} from './timerLabel.js';
import {TimerProgressBar} from './timerProgressBar.js';
import * as Utils from './utils.js';


// Time in seconds to announce next timer state.
const TIME_BLOCK_ABOUT_TO_END_TIMEOUT = 15;

const FADE_IN_DURATION = 200;
const FADE_OUT_DURATION = 250;
const BLINKING_DURATION = 1500;
const TRANSITION_DURATION = 100;
const STOPPED_OPACITY = 89;  // 0.349 * 255


const ScreenShieldWidget = GObject.registerClass({
    Signals: {
        'needs-attention': {},
    },
},
class FocusTimerScreenShieldWidget extends St.Widget {
    _init(timer, session) {
        super._init({
            style_class: 'extension-focus-timer-widget',
            layout_manager: new Clutter.BinLayout(),
        });

        this._delegate = this;
        this._timer = timer;
        this._session = session;
        this._timerState = State.STOPPED;
        this._isFinished = false;
        this._blinkingGroup = new Utils.BlinkingGroup(BLINKING_DURATION);
        this._frozen = false;
        this._destroying = false;

        const box = new St.BoxLayout({
            style_class: 'extension-focus-timer-widget-content',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        const headerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        box.add_child(headerBox);

        const stateLabel = new St.Label({
            style_class: 'extension-focus-timer-state-label',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
        });
        headerBox.add_child(stateLabel);

        const cycleLabel = new St.Label({
            style_class: 'extension-focus-timer-cycle-label',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            visible: false,
        });
        headerBox.add_child(cycleLabel);

        const timerLabel = new TimerLabel(this._timer, {
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
        });
        headerBox.add_child(timerLabel);

        const progressBar = new TimerProgressBar(this._timer, {});
        box.add_child(progressBar);

        const controlButtons = new TimerControlButtons(this._timer, this._session, {
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
        });
        box.add_child(controlButtons);

        this._stateLabel = stateLabel;
        this._cycleLabel = cycleLabel;
        this._timerLabel = timerLabel;
        this._progressBar = progressBar;
        this._controlButtons = controlButtons;
        this._blinkingGroup.addActor(timerLabel, 'opacity', STOPPED_OPACITY * 0.5, 255);

        this._updateStateLabel();
        this._updateBlinkingGroup();

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._session.connectObject('changed', this._onSessionChanged.bind(this), this);
        this.connect('destroy', this._onDestroy.bind(this));
    }

    freeze() {
        this._frozen = true;
        this._timerLabel.freeze();
        this._progressBar.freeze();
        this._controlButtons.freeze();
    }

    unfreeze() {
        this._frozen = false;
        this._timerLabel.unfreeze();
        this._progressBar.unfreeze();
        this._controlButtons.unfreeze();

        this._updateStateLabel();
        this._updateBlinkingGroup();
    }

    _updateBlinkingGroup(animate = true) {
        const transitionDuration = animate && St.Settings.get().enable_animations
            ? TRANSITION_DURATION
            : 0;

        if (this._timer.state !== State.STOPPED) {
            if (this._timer.isPaused() || this._timer.isFinished() || !this._timer.isStarted())
                this._blinkingGroup.blink();
            else
                this._blinkingGroup.fadeIn(transitionDuration);
        } else {
            this._blinkingGroup.fadeOut(transitionDuration);
        }
    }

    _updateStateLabel() {
        if (this._frozen)
            return;

        this._session.getCycleNumberCount().then(
            ([cycleNumber, cycleCount]) => {
                if (this._frozen || this._destroying)
                    return;

                this._stateLabel.text = this._timer.isFinished()
                    ? _('Finished!')
                    : State.label(this._timer.state);
                this._cycleLabel.text = _('%d of %d').format(cycleNumber, cycleCount);
                this._cycleLabel.visible = cycleNumber > 0 && cycleCount > 1 && (
                    this._timer.state === State.POMODORO ||
                    this._timer.state === State.SHORT_BREAK);
            }
        ).catch(logError);
    }

    _onTimerChanged() {
        const timerState = this._timer.state;
        const isFinished = this._timer.isFinished();
        let needsAttention = State.isBreak(this._timerState) !== State.isBreak(timerState) ||
            this._isFinished !== isFinished;

        this._timerState = timerState;
        this._isFinished = isFinished;

        this._updateStateLabel();
        this._updateBlinkingGroup();

        const timeSinceInteraction = this._controlButtons.lastInteractionTime
            ? this._timer.lastChangedTime - this._controlButtons.lastInteractionTime
            : NaN;
        if (timeSinceInteraction && timeSinceInteraction < 5 * SECOND)
            needsAttention = false;

        if (needsAttention)
            this.emit('needs-attention');
    }

    _onSessionChanged() {
        this._updateStateLabel();
    }

    _onDestroy() {
        this._destroying = true;

        if (this._stateLabel) {
            this._stateLabel.destroy();
            this._stateLabel = null;
        }

        if (this._cycleLabel) {
            this._cycleLabel.destroy();
            this._cycleLabel = null;
        }

        if (this._timerLabel) {
            this._timerLabel.destroy();
            this._timerLabel = null;
        }

        if (this._progressBar) {
            this._progressBar.destroy();
            this._progressBar = null;
        }

        if (this._controlButtons) {
            this._controlButtons.destroy();
            this._controlButtons = null;
        }

        if (this._blinkingGroup) {
            this._blinkingGroup.destroy();
            this._blinkingGroup = null;
        }

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._session) {
            this._session.disconnectObject(this);
            this._session = null;
        }
    }
});


const ScreenShieldLayout = GObject.registerClass(
class FocusTimerScreenShieldLayout extends Clutter.LayoutManager {
    _init(widget, yOffset) {
        super._init();

        this._widget = widget;
        this._yOffset = yOffset;
    }

    vfunc_get_preferred_width(container, forHeight) {
        return this._widget.get_preferred_width(forHeight);
    }

    vfunc_get_preferred_height(container, forWidth) {
        let [minimumHeight, naturalHeight] = this._widget.get_preferred_height(forWidth);
        minimumHeight += this._yOffset;
        naturalHeight += this._yOffset;

        return [minimumHeight, naturalHeight];
    }

    vfunc_allocate(container, box) {
        const [width] = box.get_size();
        const [, , widgetWidth, widgetHeight] = this._widget.get_preferred_size();

        const actorBox = new Clutter.ActorBox();
        actorBox.x1 = Math.trunc((width - widgetWidth) / 2);
        actorBox.y1 = this._yOffset;
        actorBox.x2 = actorBox.x1 + widgetWidth;
        actorBox.y2 = actorBox.y1 + widgetHeight;

        this._widget.allocate(actorBox);
    }
});

export class ScreenShieldManager extends EventEmitter {
    constructor(timer, session) {
        super();

        this._timer = timer;
        this._session = session;
        this._widget = null;
        this._revealer = null;
        this._revealed = false;
        this._destroying = false;
        this._annoucementTimeoutId = 0;
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);

        this._update(false);
    }

    // Wrap date actor instead of adding it as sibling to avoid `BoxLayout` spacing.
    // The revealer needs custom layout manager to respect `margin_top` and to display widget with
    // a fixed height.
    _createWidget() {
        if (this._widget)
            return;

        const unlockDialog = Main.screenShield._dialog;
        const clock = unlockDialog._clock;
        const date = clock._date;
        const yOffset = Math.round(clock.get_theme_node().get_length('spacing'));

        const container = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
        });
        clock.replace_child(date, container);
        container.add_child(date);

        const widget = new ScreenShieldWidget(this._timer, this._session);
        widget.connectObject('needs-attention', this._onNeedsAttention.bind(this), this);

        const revealer = new St.Widget({
            style_class: 'extension-focus-timer-revealer',
            layout_manager: new ScreenShieldLayout(widget, yOffset),
        });
        container.add_child(revealer);
        revealer.add_child(widget);

        this._revealer = revealer;
        this._widget = widget;
    }

    _destroyWidget() {
        if (!this._widget)
            return;

        const revealer = this._revealer;
        const container = revealer.get_parent();
        const date = revealer.get_previous_sibling();

        container.remove_child(date);
        container.get_parent().replace_child(container, date);
        container.destroy();

        this._widget.disconnectObject(this);
        this._widget = null;
        this._revealer = null;
    }

    _showWidget(animate = true) {
        const duration = animate && St.Settings.get().enable_animations ? FADE_IN_DURATION : 0;
        const delay = duration;

        if (this._revealed)
            return;

        if (!this._widget)
            this._createWidget();

        const revealer = this._revealer;
        const widget = this._widget;
        const [, revealerHeight] = revealer.get_preferred_height(-1);

        this._revealed = true;

        revealer.remove_all_transitions();
        revealer.height = 0;
        revealer.ease_property('height', revealerHeight, {
            duration: duration + delay,
            mode: Clutter.AnimationMode.EASE_IN_OUT,
            onComplete: () => {
                revealer.set_height(-1);
            },
        });

        widget.unfreeze();
        widget.remove_all_transitions();
        widget.opacity = 0;
        widget.set_pivot_point(0.5, 0.5);
        widget.scale_x = 0.9;
        widget.scale_y = 0.9;
        widget.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            delay,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideWidget(animate = true) {
        const duration = animate && St.Settings.get().enable_animations ? FADE_OUT_DURATION : 0;

        if (!this._widget || !this._revealed)
            return;

        this._revealed = false;

        const revealer = this._revealer;
        revealer.remove_all_transitions();
        revealer.height = revealer.allocation.get_height();
        revealer.ease_property('height', 0, {
            duration: duration * 2,
            mode: Clutter.AnimationMode.EASE_IN_OUT,
            onComplete: () => {
                this._destroyWidget();
            },
        });

        const widget = this._widget;
        widget.freeze();
        widget.remove_all_transitions();
        widget.set_pivot_point(0.5, 0.5);
        widget.ease({
            opacity: 0,
            scale_x: 0.9,
            scale_y: 0.9,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onNeedsAttention() {
        Utils.wakeUpScreen();
    }

    _onAnnoucementTimeout() {
        this._annoucementTimeoutId = 0;

        Utils.wakeUpScreen();

        return GLib.SOURCE_REMOVE;
    }

    _scheduleAnnoucement() {
        const timeout = Math.round(this._timer.getRemaining() / SECOND) - TIME_BLOCK_ABOUT_TO_END_TIMEOUT;

        this._unscheduleAnnoucement();

        if (timeout <= 0) {
            this._onAnnoucementTimeout();
            return;
        }

        this._annoucementTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            timeout,
            this._onAnnoucementTimeout.bind(this));
        GLib.Source.set_name_by_id(this._annoucementTimeoutId,
            '[gnome-pomodoro] ScreenShieldManager._onAnnoucementTimeout');
    }

    _unscheduleAnnoucement() {
        if (this._annoucementTimeoutId) {
            GLib.source_remove(this._annoucementTimeoutId);
            this._annoucementTimeoutId = 0;
        }
    }

    _update(animate = true) {
        this._unscheduleAnnoucement();

        if (this._timer.isRunning())
            this._scheduleAnnoucement();

        try {
            if (this._timer.state !== State.STOPPED)
                this._showWidget(animate);
            else
                this._hideWidget();
        } catch (error) {
            Utils.logError(error);
        }
    }

    _onTimerChanged() {
        this._update();
    }

    destroy() {
        this._destroying = true;
        this._session = null;
        this._unscheduleAnnoucement();
        this._destroyWidget();

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        this.emit('destroy');
    }
}
