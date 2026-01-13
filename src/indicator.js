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

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {extension} from './extension.js';
import {State, MINUTE, SECOND, MILLISECOND} from './timer.js';
import {TimeBlockStatus} from './session.js';
import {TimerControlButtons} from './timerControlButtons.js';
import {TimerLabel} from './timerLabel.js';
import {TimerProgressBar} from './timerProgressBar.js';
import * as Utils from './utils.js';


const MENU_ALIGNMENT = 0.5;
const BLINKING_DURATION = 1500;
const TRANSITION_DURATION = 100;
const STOPPED_OPACITY = 89;  // 0.349 * 255
const DIM_BRIGHTNESS = -0.4;
const POPUP_ANIMATION_TIME = 200;


export const IndicatorType = {
    ICON: 0,
    TEXT: 1,
};


// Based on QuickToggleMenu from quickSettings.js in gnome-shell
class OverlayMenuBase extends PopupMenu.PopupMenuBase {
    constructor(sourceActor) {
        super(sourceActor, 'quick-toggle-menu');

        const constraints = new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.Y,
            source: sourceActor,
        });
        sourceActor.bind_property('height',
            constraints, 'offset',
            GObject.BindingFlags.DEFAULT);

        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'quick-toggle-menu-container',
            reactive: true,
            x_expand: true,
            y_expand: false,
            opacity: 0,
            constraints,
        });
        this.actor._delegate = this;
        this.actor.add_child(this.box);
        this.actor.hide();

        global.focus_manager.add_group(this.actor);
    }

    open(animate) {
        if (this.isOpen)
            return;

        this.isOpen = true;

        this.actor.show();
        this.actor.ease_property('opacity', 255, {
            duration: Math.trunc(POPUP_ANIMATION_TIME * 0.75),
        });

        this.emit('open-state-changed', true);
    }

    close(animate) {
        if (!this.isOpen)
            return;

        const {opacity} = this.actor;
        const duration = animate !== PopupAnimation.NONE
            ? POPUP_ANIMATION_TIME / 2
            : 0;

        this.actor.ease_property('opacity', 0, {
            duration: duration * (opacity / 255),
            onStopped: () => {
                this.actor.hide();
                this.actor.opacity = 0;
                this.emit('menu-closed');
            },
        });

        this.isOpen = false;
        this.emit('open-state-changed', false);
    }
}


class StateMenu extends OverlayMenuBase {
    constructor(sourceActor) {
        super(sourceActor);

        this._addStateItem(State.POMODORO);
        const shortBreakItem = this._addStateItem(State.SHORT_BREAK);
        const longBreakItem = this._addStateItem(State.LONG_BREAK);
        const breakItem = this._addStateItem(State.BREAK);

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const stoppedItem = this._addStateItem(State.STOPPED);

        breakItem.bind_property('visible',
            shortBreakItem, 'visible',
            GObject.BindingFlags.INVERT_BOOLEAN |
            GObject.BindingFlags.SYNC_CREATE);
        breakItem.bind_property('visible',
            longBreakItem, 'visible',
            GObject.BindingFlags.INVERT_BOOLEAN |
            GObject.BindingFlags.SYNC_CREATE);

        this._breakItem = breakItem;
        this._stoppedItem = stoppedItem;

        this._session = extension.session;
        this._session.connectObject('changed', this._onSessionChanged.bind(this), this);

        this._update();
    }

    _addStateItem(state) {
        const item = this.addAction(State.label(state), () => {
            extension.indicator.menu.close(false);
            this._session.advanceToState(state);

            if (State.isBreak(state))
                extension.openScreenOverlay();
        });

        return item;
    }

    _update() {
        this._breakItem.visible = this._session.hasUniformBreaks;
        this._stoppedItem.sensitive = this._session.currentState !== State.STOPPED;
    }

    _onSessionChanged(_session) {
        this._update();
    }

    destroy() {
        if (this._session) {
            this._session.disconnectObject(this);
            this._session = null;
        }

        super.destroy();
    }
}


const TimerMenuItem = GObject.registerClass({
    Signals: {
        'state-button-clicked': {},
    },
},
class FocusTimerMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init() {
        super._init({
            style_class: 'extension-focus-timer-menu-item',
            reactive: false,
            activate: false,
            hover: false,
        });

        this._timer = extension.timer;
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);

        this._session = extension.session;
        this._session.connectObject('changed', this._onSessionChanged.bind(this), this);

        this._updatePromise = null;
        this._destroying = false;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this.add_child(box);

        this._stateButton = new St.Button({
            style_class: 'button flat extension-focus-timer-state-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._stateButton.connect('clicked', this._onStateButtonClicked.bind(this));

        this._cycleLabel = new St.Label({
            style_class: 'extension-focus-timer-cycle-label',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const headerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        headerBox.add_child(this._stateButton);
        headerBox.add_child(this._cycleLabel);
        box.add_child(headerBox);

        this._timerLabel = new TimerLabel(this._timer, {
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        this._shortenButton = this._createInlineButton('timer-shorten-symbolic');
        this._shortenButton.connect('clicked', this._onShortenButtonClicked.bind(this));

        this._extendButton = this._createInlineButton('timer-extend-symbolic');
        this._extendButton.connect('clicked', this._onExtendButtonClicked.bind(this));

        const timerBox = new St.BoxLayout({
            style_class: 'extension-focus-timer-box',
            orientation: Clutter.Orientation.HORIZONTAL,
        });
        timerBox.add_child(this._shortenButton);
        timerBox.add_child(this._timerLabel);
        timerBox.add_child(this._extendButton);
        box.add_child(timerBox);

        const progressBar = new TimerProgressBar(this._timer, {});
        box.add_child(progressBar);

        const controlButtons = new TimerControlButtons(this._timer, this._session, {
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
        });
        box.add_child(controlButtons);

        this._update();

        this.connect('destroy', this._onDestroy.bind(this));
    }

    get stateButton() {
        return this._stateButton;
    }

    get timerLabel() {
        return this._timerLabel;
    }

    _createIconButton(iconName) {
        const icon = new St.Icon({
            gicon: Utils.loadIcon(iconName),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        return new St.Button({
            style_class: 'icon-button flat',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: icon,
        });
    }

    _createInlineButton(iconName) {
        const button = this._createIconButton(iconName);
        button.add_style_class_name('extension-focus-timer-inline-button');
        button.bind_property_full(
            'hover',
            button, 'opacity',
            GObject.BindingFlags.SYNC_CREATE,
            (binding, source) => [true, source ? 255 : 26],
            null
        );

        return button;
    }

    _update() {
        if (this._updatePromise || this._destroying)
            return;

        this._updatePromise = this._session.getCycleNumberCount().then(
            ([cycleNumber, cycleCount]) => {
                if (this._destroying)
                    return;

                this._stateButton.label = this._timer.isFinished()
                    ? _("Finished!")
                    : State.label(this._timer.state);
                this._cycleLabel.text = _('%d of %d').format(cycleNumber, cycleCount);
                this._cycleLabel.visible =  cycleNumber > 0 && cycleCount > 1 && (
                    this._timer.state === State.POMODORO ||
                    this._timer.state === State.SHORT_BREAK);
                this._shortenButton.visible = this._timer.state !== State.STOPPED;
                this._extendButton.visible = this._timer.state !== State.STOPPED;
            }
        ).catch(
            logError
        ).finally(
            () => {
                this._updatePromise = null;
            }
        );
    }

    _onTimerChanged(timer) {
        this._update();
    }

    _onSessionChanged(session) {
        this._update();
    }

    _onStateButtonClicked() {
        this.emit('state-button-clicked');
    }

    _onShortenButtonClicked() {
        this._timer.extend(-MINUTE, this._timer.lastTickTime);
    }

    _onExtendButtonClicked() {
        this._timer.extend(MINUTE, this._timer.lastTickTime);
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

        this._destroying = true;
        this._stateButton = null;
        this._timerLabel = null;
        this._shortenButton = null;
        this._extendButton = null;
        this._updatePromise = null;
    }
});


const IndicatorMenu = class extends PopupMenu.PopupMenu {
    constructor(indicator) {
        super(indicator, MENU_ALIGNMENT, St.Side.TOP);

        // Wrap the `BoxPointer` in an outer container so that `_overlay`
        // can be a sibling of `_boxPointer`.
        const actor = new St.Widget({
            style_class: 'extension-focus-timer-indicator-menu',
            reactive: true,
            width: 0,
            height: 0,
        });
        actor.add_child(this._boxPointer);
        actor._delegate = this;
        this.actor = actor;

        global.focus_manager.add_group(this.actor);

        this._timer = extension.timer;
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);

        this._settings = extension.settings;
        this._settings.connectObject('changed', this._onSettingsChanged.bind(this), this);

        const timerMenuItem = new TimerMenuItem();
        timerMenuItem.connect('state-button-clicked', () => {
            this._stateMenu.open(PopupAnimation.FULL);
        });
        indicator.blinkingGroup.addActor(timerMenuItem.timerLabel, 'opacity', STOPPED_OPACITY * 0.5, 255);

        this._timerLabel = timerMenuItem.timerLabel;

        this.addMenuItem(timerMenuItem);
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._screenOverlayItem = this.addAction(_('Screen Overlay'), this._activateScreenOverlay.bind(this));

        this.addAction(_('Preferences'), this._activatePreferences.bind(this));
        this.addAction(_('Stats'), this._activateStats.bind(this));
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.addAction(_('Quit'), this._activateQuit.bind(this));

        this._activeMenu = null;
        this._stateMenu = new StateMenu(timerMenuItem.stateButton);
        this._stateMenu.connect('open-state-changed', (menu, isOpen) => {
            this._activeMenu = isOpen ? menu : null;
            this._setDimmed(isOpen);
        });

        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this._stateMenu);

        this._overlay = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
        });
        this._overlay.add_child(this._stateMenu.actor);
        this._overlay.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.X,
            source: this._boxPointer,
        }));
        this._overlay.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.Y,
            source: this._boxPointer,
        }));
        this._overlay.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.WIDTH,
            source: this._boxPointer,
        }));
        this.actor.add_child(this._overlay);

        this._dimEffect = new Clutter.BrightnessContrastEffect({
            enabled: false,
        });
        this._boxPointer.add_effect_with_name('dim', this._dimEffect);

        this._update();

        this.connect('menu-closed', () => {
            this.actor.hide();
        });
    }

    _activateStats() {
        this.itemActivated(PopupAnimation.NONE);
        Main.overview.hide();

        extension.showWindow('stats');
    }

    _activateScreenOverlay() {
        extension.openScreenOverlay();
    }

    _activatePreferences() {
        this.itemActivated(PopupAnimation.NONE);
        Main.overview.hide();

        extension.showPreferences();
    }

    _activateQuit() {
        extension.quit();
    }

    _setDimmed(dim) {
        if (!dim && !this._dimEffect.enabled)
            return;

        const brightnessValue = 127 * (1 + (dim ? 1 : 0) * DIM_BRIGHTNESS);
        const brightness = new Cogl.Color({
            red: brightnessValue,
            green: brightnessValue,
            blue: brightnessValue,
            alpha: 255,
        });

        this._boxPointer.ease_property('@effects.dim.brightness', brightness, {
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: POPUP_ANIMATION_TIME,
            onStopped: () => {
                this._dimEffect.brightness = brightness;
                this._dimEffect.enabled = dim;
            },
        });
        this._dimEffect.enabled = true;
    }

    _update() {
        this._screenOverlayItem.visible = State.isBreak(this._timer.state) &&
            extension.settings.get_boolean('screen-overlay');
        this._screenOverlayItem.reactive = !this._timer.isFinished();
    }

    _onTimerChanged() {
        this._update();
    }

    _onSettingsChanged() {
        this._update();
    }

    open(animate) {
        this._timerLabel?.unfreeze();

        this.actor.show();
        super.open(animate);
    }

    close(animate) {
        this._timerLabel?.freeze();
        this._activeMenu?.close(animate);

        super.close(animate);
    }

    destroy() {
        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._stateMenu) {
            this._stateMenu.destroy();
            this._stateMenu = null;
        }

        this._timerLabel = null;
        this._screenOverlayItem = null;

        super.destroy();
    }
};


const TextIndicator = GObject.registerClass({
    Properties: {
        'fade': GObject.ParamSpec.double(
            'fade', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 1.0),
    },
},
class FocusTimerTextIndicator extends St.Widget {
    _init(timer, session) {
        this._fade = 1.0;

        super._init();

        this._delegate = this;
        this._timer = timer;
        this._session = session;
        this._lastValue = NaN;
        this._placeholderValue = 0;

        this._label = new St.Label({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.single_line_mode = true;
        this._label.clutter_text.line_wrap = false;
        this._label.clutter_text.line_wrap_mode = Pango.WrapMode.NONE;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.add_child(this._label);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    get fade() {
        return this._fade;
    }

    set fade(value) {
        if (this._fade !== value) {
            this._fade = value;
            this._label.opacity = Math.trunc((255 - STOPPED_OPACITY) * value) + STOPPED_OPACITY;
        }
    }

    _formatRemaining(interval) {
        interval = interval > 0
            ? Math.trunc(interval / SECOND)
            : 0;

        let minutes = Math.round(interval / 60);
        let hours = Math.trunc(minutes / 60);
        const parts = [];

        if (hours > 0) {
            minutes -= 60 * hours;
            parts.push(_('%dh').format(hours));
        }

        if (interval >= 52.5)
            parts.push(_('%dm').format(minutes).padStart(parts.length ? 3 : 2, '0'));
        else if (interval >= 27.5)
            parts.push(_('%ds').format(Math.round(interval / 15) * 15));
        else if (interval >= 10)
            parts.push(_('%ds').format(Math.round(interval / 5) * 5));
        else
            parts.push(_('%ds').format(interval));

        return parts.join(' ');
    }

    _getReferenceText(interval) {
        interval = interval > 0
            ? Math.trunc(interval / SECOND)
            : 0;

        const minutes = Math.round(interval / 60);
        const hours = Math.trunc(minutes / 60);
        const parts = ['00x'];

        if (hours > 0)
            parts.push('%dx'.format(hours));

        return parts.join('_');
    }

    _updatePlaceholderValue() {
        this._session.getNextTimeBlock().then(
            (timeBlock) => {
                if (timeBlock && timeBlock.state === State.POMODORO)
                    this._placeholderValue = timeBlock.endTime - timeBlock.startTime;

                this._updateLabel(this._session.currentState, NaN);
            }).catch(logError);
    }

    _updateLabel(state, timestamp) {
        const remaining = state !== State.STOPPED
            ? this._timer.getRemaining(timestamp)
            : this._placeholderValue;
        const text = this._formatRemaining(remaining);

        if (this._label.text.length !== text.length)
            this.queue_relayout();

        this._label.text = text;
        this._lastValue = remaining;
    }

    vfunc_get_preferred_width(forHeight) {
        const layout = this._label.clutter_text?.get_layout().copy();
        if (!layout)
            return super.vfunc_get_preferred_width(forHeight);

        const text = this._getReferenceText(this._timer.getRemaining());
        layout.set_text(text, text.length);

        const [layoutWidth, layoutHeight] = layout.get_pixel_size();

        return this.get_theme_node().adjust_preferred_width(layoutWidth, layoutWidth);
    }

    vfunc_allocate(box, flags) {
        this.set_allocation(box);

        const [width, height] = box.get_size();
        const [childWidth, ] = this._label.get_preferred_width(height);

        const childBox = new Clutter.ActorBox();
        childBox.set_origin(Math.floor((width - childWidth) / 2), 0);
        childBox.set_size(childWidth, height);
        this._label.allocate(childBox);
    }

    vfunc_map() {
        this._timer.connectObject('tick', this._onTimerTick.bind(this), this);
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._session.connectObject('changed', this._onSessionChanged.bind(this), this);

        this._label.text = '';

        if (this._timer.state === State.STOPPED)
            this._updatePlaceholderValue();
        else
            this._updateLabel(
                this._timer.state,
                this._timer.lastTickTime || this._timer.lastChangedTime
            );

        super.vfunc_map();
    }

    vfunc_unmap() {
        this._timer?.disconnectObject(this);
        this._session?.disconnectObject(this);

        super.vfunc_unmap();
    }

    _onTimerChanged(timer) {
        if (this._timer.state !== State.STOPPED)
            this._updateLabel(timer.state, timer.lastChangedTime);
    }

    _onTimerTick(timer, timestamp) {
        this._updateLabel(timer.state, timestamp);
    }

    _onSessionChanged() {
        if (this._session.currentState === State.STOPPED)
            this._updatePlaceholderValue();
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

        this.remove_child(this._label);

        this._delegate = null;
        this._label = null;
    }
});


const IconIndicator = GObject.registerClass({
    Properties: {
        'fade': GObject.ParamSpec.double(
            'fade', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 1.0),
    },
},
class FocusTimerIconIndicator extends St.Widget {
    static RESOLUTION = 2;
    static DEFAULT_ICON_SIZE = 16;
    static PADDING = 1.8;
    static LINE_WIDTH = 2.2;
    static CAP_ANGLE = 0.25;  // radians
    static SPACING_ANGLE = 0.5;  // radians

    _init(timer) {
        this._fade = 1.0;

        super._init({
            style_class: 'system-status-icon',
            layout_manager: new Clutter.BinLayout(),
        });

        this._delegate = this;
        this._timer = timer;
        this._timeoutId = 0;
        this._lastValue = NaN;
        this._iconSize = IconIndicator.DEFAULT_ICON_SIZE;
        this._throughColor = null;
        this._highlightColor = null;

        this._content = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._content);

        this._through = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });
        this._through.connect('repaint', this._onThroughRepaint.bind(this));
        this._content.add_child(this._through);

        this._highlight = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });
        this._highlight.bind_property_full(
            'opacity',
            this._through, 'opacity',
            GObject.BindingFlags.SYNC_CREATE,
            (binding, source) => [true, 255 - source],
            null
        );
        this._highlight.connect('repaint', this._onHighlightRepaint.bind(this));
        this._content.add_child(this._highlight);

        this._pausedIconBin = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            opacity: 0,
        });
        this._pausedIconBin.bind_property_full(
            'opacity',
            this._content, 'opacity',
            GObject.BindingFlags.SYNC_CREATE,
            (binding, source) => [true, 255 - source],
            null
        );
        this.add_child(this._pausedIconBin);

        this._pausedIcon = new St.Icon({
            gicon: Utils.loadIcon('indicator-paused-symbolic'),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pausedIconBin.add_child(this._pausedIcon);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    get fade() {
        return this._fade;
    }

    set fade(value) {
        if (this._fade !== value) {
            this._fade = value;
            this._highlight.opacity = Math.trunc(255 * value);
            this._pausedIcon.opacity = Math.trunc(
                (255 - STOPPED_OPACITY) * value + STOPPED_OPACITY);
        }
    }

    _startTimeout() {
        if (this._timeoutId || !this.mapped)
            return;

        const diameter = this._iconSize ?? IconIndicator.DEFAULT_ICON_SIZE;
        const timeout = Math.trunc(this._timer.duration / (diameter * Math.PI * IconIndicator.RESOLUTION * MILLISECOND));

        if (timeout > 1000) {
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.trunc(timeout / 1000), this._onTimeout.bind(this));
            GLib.Source.set_name_by_id(this._timeoutId, '[focus-timer-extension] IconIndicator._onTimeout');
        } else if (timeout > 0) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, this._onTimeout.bind(this));
            GLib.Source.set_name_by_id(this._timeoutId, '[focus-timer-extension] IconIndicator._onTimeout');
        }
    }

    _stopTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _updateTimeout() {
        this._stopTimeout();

        if (this._timer.isRunning())
            this._startTimeout();
    }

    vfunc_style_changed() {
        const themeNode = this.get_theme_node();
        const [found, iconSize] = themeNode.lookup_length('icon-size', false);
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);

        this._iconSize = found
            ? Math.round(iconSize / scaleFactor)
            : IconIndicator.DEFAULT_ICON_SIZE;
        this._highlightColor = themeNode.get_foreground_color();
        this._throughColor = themeNode.get_foreground_color();
        this._throughColor.alpha = STOPPED_OPACITY;

        super.vfunc_style_changed();
    }

    vfunc_get_preferred_height(_forWidth) {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const iconSize = Math.ceil(this._iconSize * scaleFactor);

        return this.get_theme_node().adjust_preferred_height(iconSize, iconSize);
    }

    vfunc_get_preferred_width(_forHeight) {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const iconSize = Math.ceil(this._iconSize * scaleFactor);

        return this.get_theme_node().adjust_preferred_width(iconSize, iconSize);
    }

    vfunc_map() {
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._updatePausedIcon(false);

        super.vfunc_map();

        this._updateTimeout();
    }

    vfunc_unmap() {
        this._timer?.disconnectObject(this);
        this._stopTimeout();

        super.vfunc_unmap();
    }

    _onThroughRepaint(actor) {
        const cr = actor.get_context();
        const [width, height] = actor.get_surface_size();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const radius = (this._iconSize / 2 - IconIndicator.PADDING) * scaleFactor;

        cr.translate(width / 2, height / 2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(IconIndicator.LINE_WIDTH * scaleFactor);
        cr.setSourceColor(this._throughColor);
        cr.arc(0.0, 0.0, radius, 0.0, 2.0 * Math.PI);
        cr.stroke();
        cr.$dispose();
    }

    _onHighlightRepaint(actor) {
        const cr = actor.get_context();
        const [width, height] = actor.get_surface_size();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const radius = (this._iconSize / 2 - IconIndicator.PADDING) * scaleFactor;

        cr.translate(width / 2, height / 2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(IconIndicator.LINE_WIDTH * scaleFactor);

        if (this._timer.state !== State.STOPPED) {
            const progress = this._timer.getProgress();
            const angle1 = -0.5 * Math.PI;
            const angle2 = 1.5 * Math.PI - IconIndicator.CAP_ANGLE - 2.0 * Math.PI * progress;

            const highlightFade = angle2 < angle1
                ? 1.0 - (angle1 - angle2) / IconIndicator.CAP_ANGLE
                : 1.0;
            const highlightColor = this._highlightColor.copy();
            highlightColor.alpha = Math.trunc(highlightColor.alpha * highlightFade);

            const throughFade = Math.min(progress / 0.15, 1.0);
            const throughColor = this._throughColor.copy();
            throughColor.alpha = Math.trunc(throughColor.alpha * throughFade);

            cr.setSourceColor(throughColor);
            cr.arcNegative(
                0.0, 0.0, radius,
                angle1 - IconIndicator.SPACING_ANGLE * highlightFade,
                Math.max(angle2, angle1 + 0.000001) + IconIndicator.SPACING_ANGLE * highlightFade
            );
            cr.stroke();

            cr.setSourceColor(highlightColor);
            cr.arc(0.0, 0.0, radius, angle1, Math.max(angle2, angle1));
            cr.stroke();
        } else {
            cr.setSourceColor(this._highlightColor);
            cr.arc(0.0, 0.0, radius, 0.0, 2.0 * Math.PI);
            cr.stroke();
        }

        cr.$dispose();
    }

    _updatePausedIcon(animate = true) {
        const transitionDuration = animate && St.Settings.get().enable_animations ? TRANSITION_DURATION : 0;
        const opacity = this._timer.isPaused() ? 255 : 0;

        this._pausedIconBin.show();
        this._content.show();

        this._pausedIconBin.ease_property('opacity', opacity, {
            duration: transitionDuration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (opacity === 0)
                    this._pausedIconBin.hide();
                else
                    this._content.hide();
            }
        });
    }

    _onTimerChanged(timer) {
        this._updateTimeout();
        this._updatePausedIcon();

        this._highlight.queue_repaint();
    }

    _onTimeout() {
        this._highlight.queue_repaint();

        return GLib.SOURCE_CONTINUE;
    }

    _onDestroy() {
        this._stopTimeout();

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        if (this._through) {
            this._content.remove_child(this._through);
            this._through.destroy();
            this._through = null;
        }

        if (this._highlight) {
            this._content.remove_child(this._highlight);
            this._highlight.destroy();
            this._highlight = null;
        }

        if (this._content) {
            this.remove_child(this._content);
            this._content = null;
        }

        if (this._pausedIcon) {
            this._pausedIconBin.remove_child(this._pausedIcon);
            this._pausedIcon = null;
        }

        if (this._pausedIconBin) {
            this.remove_child(this._pausedIconBin);
            this._pausedIconBin = null;
        }

        this._delegate = null;
    }
});


export const Indicator = GObject.registerClass({
    Properties: {
        'type': GObject.ParamSpec.int(
            'type', null, null,
            GObject.ParamFlags.READWRITE,
            Math.min(...Object.values(IndicatorType)),
            Math.max(...Object.values(IndicatorType)),
            IndicatorType.ICON),
    },
},
class FocusTimerIndicator extends PanelMenu.Button {
    _init(timer, session, type) {
        super._init(0.5, _('Focus Timer'), true);

        this._type = type;
        this._timer = timer;
        this._session = session;
        this._widget = null;
        this._blinkingGroup = new Utils.BlinkingGroup(BLINKING_DURATION);
        this._blinkingGroup.fadeOut(0);

        this.add_style_class_name('extension-focus-timer-indicator');
        this.setMenu(new IndicatorMenu(this));

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);

        this._update();
    }

    get type() {
        return this._type;
    }

    set type(value) {
        if (this._type === value)
            return;

        this._type = value;

        this._updateWidget(false);
    }

    get blinkingGroup() {
        return this._blinkingGroup;
    }

    _updateBlinkingGroup() {
        const transitionDuration = St.Settings.get().enable_animations
            ? TRANSITION_DURATION
            : 0;

        if (this._timer.state === State.STOPPED)
            this._blinkingGroup.fadeOut(transitionDuration);
        else if (this._timer.isPaused() || this._timer.isFinished() || !this._timer.isStarted())
            this._blinkingGroup.blink();
        else
            this._blinkingGroup.fadeIn(transitionDuration);
    }

    _updateWidget() {
        let widget = this._widget;

        if (widget) {
            this._blinkingGroup.removeActor(widget);
            this.remove_child(widget);
        }

        switch (this._type) {
        case IndicatorType.TEXT:
            widget = new TextIndicator(this._timer, this._session);
            break;

        default:
            widget = new IconIndicator(this._timer);
            break;
        }

        this._widget = widget;

        this.add_child(widget);
        this._blinkingGroup.addActor(widget, 'fade', 0.0, 1.0);
    }

    _update() {
        if (!this._widget)
            this._updateWidget();

        this._updateBlinkingGroup();

        if (State.isBreak(this._timer.state))
            this.add_style_class_name('extension-focus-timer-break');
        else
            this.remove_style_class_name('extension-focus-timer-break');
    }

    _onTimerChanged() {
        this._update();
    }

    _onDestroy() {
        if (this._blinkingGroup) {
            this._blinkingGroup.destroy();
            this._blinkingGroup = null;
        }

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        this._session = null;
        this._stack = null;
        this._widget = null;

        super._onDestroy();
    }
});
