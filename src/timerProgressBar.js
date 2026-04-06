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
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';

import {State, MILLISECOND} from './timer.js';


const PROGRESS_BAR_HEIGHT = 5;
const THROUGH_OPACITY = 26;  // 0.1
const RESOLUTION = 2;
const VALUE_TRANSITION = 300;
const FADE_TRANSITION = 150;


const ProgressBar = GObject.registerClass({
    Properties: {
        'value': GObject.ParamSpec.double(
            'value', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 0.0),
        'fade': GObject.ParamSpec.double(
            'fade', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 1.0),
    },
},
class FocusTimerProgressBar extends St.DrawingArea {
    _init() {
        this._value = 0.0;
        this._fade = 1.0;

        super._init({
            accessible_role: Atk.Role.LEVEL_BAR,
            reactive: false,
            can_focus: false,
            track_hover: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._delegate = this;
    }

    get value() {
        return this._value;
    }

    set value(value) {
        if (this._value !== value) {
            this._value = value;
            this.queue_repaint();
        }
    }

    get fade() {
        return this._fade;
    }

    set fade(value) {
        if (this._fade !== value) {
            this._fade = value;
            this.queue_repaint();
        }
    }

    vfunc_style_changed() {
        const themeNode = this.get_theme_node();

        this._highlightColor = themeNode.get_foreground_color();
        this._throughColor = themeNode.get_foreground_color().copy();
        this._throughColor.alpha = THROUGH_OPACITY;

        super.vfunc_style_changed();
    }

    vfunc_get_preferred_height(_forWidth) {
        const preferredHeight = PROGRESS_BAR_HEIGHT;

        return this.get_theme_node().adjust_preferred_height(preferredHeight, preferredHeight);
    }

    vfunc_get_preferred_width(_forHeight) {
        const preferredWidth = 0;

        return this.get_theme_node().adjust_preferred_width(preferredWidth, preferredWidth);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        let [width, height] = this.get_surface_size();

        const lineWidth = Math.min(width, height);
        const lineCap = lineWidth / 2;
        const y = lineCap;
        const x1 = lineCap;
        const x3 = width - lineCap;
        const x2 = this._value * x3;

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(lineWidth);
        cr.setSourceColor(this._throughColor);
        cr.moveTo(x1, y);
        cr.lineTo(x3, y);
        cr.stroke();

        if (this._fade > 0.0) {
            const highlightColor = this._highlightColor.copy();
            highlightColor.alpha = Math.trunc(highlightColor.alpha * this._fade);

            if (this.get_text_direction() === Clutter.TextDirection.RTL) {
                cr.translate(width, 0.0);
                cr.scale(-1.0, 1.0);
            }

            if (x2 < x1) {
                cr.arc(x1, y, lineCap, 0.0, 2.0 * Math.PI);
                cr.clip();
                cr.moveTo(0.0, y);
            } else {
                cr.moveTo(x1, y);
            }

            cr.setSourceColor(highlightColor);
            cr.lineTo(x2, y);
            cr.stroke();
        }

        cr.$dispose();
    }
});


export const TimerProgressBar = GObject.registerClass(
class FocusTimerTimerProgressBar extends St.Bin {
    _init(timer, params) {
        params = Params.parse(params, {
            style_class: 'extension-focus-timer-progressbar',
            child: new ProgressBar(),
        }, true);

        super._init(params);

        this._delegate = this;
        this._timer = timer;
        this._frozen = false;

        this.connect('notify::allocation', this._onNotifyAllocation.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _startTimeout() {
        const width = this.allocation.get_width();

        if (this._timeoutId || !this.mapped || !width)
            return;

        const timeout = Math.trunc(this._timer.duration / (width * RESOLUTION * MILLISECOND));

        if (timeout > 0) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, this._onTimeout.bind(this));
            GLib.Source.set_name_by_id(this._timeoutId, '[focus-timer-extension] TimerProgressBar._onTimeout');
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

        if (this._timer.isRunning() && !this._frozen)
            this._startTimeout();
    }

    _updateChild(animate) {
        if (this._frozen)
            return;

        const progressBar = this.child;
        const timer = this._timer;

        if (timer.state !== State.STOPPED) {
            const value = timer.getProgress(
                timer.getCurrentTime() + animate * VALUE_TRANSITION * MILLISECOND);

            progressBar.ease_property('value', value, {
                duration: animate ? VALUE_TRANSITION : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                animationRequired: animate,
            });
            progressBar.ease_property('fade', 1.0, {
                duration: animate ? FADE_TRANSITION : 0,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            });
        } else {
            progressBar.ease_property('fade', 0.0, {
                duration: animate ? FADE_TRANSITION : 0,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onStopped: _isFinished => {
                    if (timer.state === State.STOPPED)
                        progressBar.value = 0.0;
                },
            });
        }
    }

    freeze() {
        this._frozen = true;
        this._stopTimeout();
    }

    unfreeze() {
        this._frozen = false;
        this._updateTimeout();
    }

    vfunc_map() {
        this._updateChild(false);

        super.vfunc_map();

        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._updateTimeout();
    }

    vfunc_unmap() {
        this._stopTimeout();

        if (this._timer)
            this._timer.disconnectObject(this);

        super.vfunc_unmap();
    }

    _onNotifyAllocation(_obj, _pspec) {
        this._updateTimeout();
    }

    _onTimerChanged(_timer) {
        if (this._frozen)
            return;

        this._updateChild(true);
        this._updateTimeout();
    }

    _onTimeout() {
        const valueTransition = this.child.get_transition('value');
        if (!valueTransition)
            this._updateChild(false);

        return GLib.SOURCE_CONTINUE;
    }

    _onDestroy() {
        this._stopTimeout();

        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        this._delegate = null;
    }
});
