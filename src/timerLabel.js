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
 */

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';

import {SECOND} from './timer.js';


const NumericLabel = GObject.registerClass({
    Properties: {
        'value': GObject.ParamSpec.int(
            'value', null, null,
            GObject.ParamFlags.READWRITE,
            0, GLib.MAXINT32, 0),
        'digits': GObject.ParamSpec.int(
            'digits', null, null,
            GObject.ParamFlags.READWRITE,
            0, GLib.MAXINT32, 0),
        'text-align': GObject.ParamSpec.enum(
            'text-align', null, null,
            GObject.ParamFlags.READWRITE,
            Pango.Alignment, Pango.Alignment.LEFT),
    },
}, class FocusTimerNumericLabel extends St.Bin {
    _init(params) {
        params = Params.parse(params, {
            style_class: 'extension-focus-timer-numeric-label',
        }, true);

        super._init(params);

        this._delegate = this;
        this._digitWidth = 0.0;

        const label = new St.Label({
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        label.clutter_text.single_line_mode = true;
        label.clutter_text.line_wrap = false;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.NONE;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.child = label;

        this.bind_property_full('text-align',
            label, 'x-align',
            GObject.BindingFlags.SYNC_CREATE,
            (bind, source) => {
                switch (source) {
                case Pango.Alignment.LEFT:
                    return [true, Clutter.ActorAlign.START];

                case Pango.Alignment.CENTER:
                    return [true, Clutter.ActorAlign.CENTER];

                case Pango.Alignment.RIGHT:
                    return [true, Clutter.ActorAlign.END];

                default:
                    return [true, Clutter.ActorAlign.FILL];
                }
            },
            null);

        this.connect('style-changed', this._onStyleChanged.bind(this));

        this._updateLabelText();
    }

    set value(value) {
        if (this._value === value)
            return;

        this._value = value;
        this.notify('value');
        this._updateLabelText();
    }

    get value() {
        return this._value;
    }

    set digits(value) {
        if (this._digits === value)
            return;

        this._digits = value;
        this.notify('digits');
        this._updateLabelText();
    }

    get digits() {
        return this._digits;
    }

    set textAlign(value) {
        if (this._textAlign === value)
            return;

        // Alignment is done through allocation, not the CSS text-align property.
        this._textAlign = value;
        this.notify('text-align');
        this.queue_relayout();
    }

    get textAlign() {
        return this._textAlign;
    }

    _updateLabelText() {
        const valueStr = String(this._value);
        const label = this.child;

        if (label)
            label.text = valueStr.padStart(this._digits, '0');
    }

    vfunc_get_preferred_width(_forHeight) {
        const themeNode = this.get_theme_node();

        if (!this._digitWidth) {
            const font    = themeNode.get_font();
            const context = this.get_pango_context();
            const metrics = context.get_metrics(font, context.get_language());

            this._digitWidth = metrics.get_approximate_digit_width() / Pango.SCALE;
        }

        const naturalWidth = this.child
            ? Math.ceil(this.child.text.length * this._digitWidth)
            : 0;

        return themeNode.adjust_preferred_width(naturalWidth, naturalWidth);
    }

    _onStyleChanged() {
        this._digitWidth = 0.0;
        this.queue_relayout();
    }
});


export const TimerLabel = GObject.registerClass(
class FocusTimerTimerLabel extends St.Widget {
    _init(timer, params) {
        params = Params.parse(params, {
            style_class: 'extension-focus-timer-label',
            reactive: false,
            can_focus: false,
            track_hover: false,
            accessible_role: Atk.Role.LABEL,
        }, true);

        super._init(params);

        this._delegate = this;
        this._timer = timer;
        this._lastValue = NaN;
        this._frozenValue = NaN;
        this._hasHours = true;

        this._hoursLabel = new NumericLabel({
            digits: 1,
            text_align: Pango.Alignment.RIGHT,
        });
        this._hoursSeparatorLabel = new St.Label({
            style_class: 'extension-focus-timer-label-separator',
            text: ':',
        });
        this._minutesLabel = new NumericLabel({
            digits: 2,
            text_align: Pango.Alignment.LEFT,
        });
        this._minutesSeparatorLabel = new St.Label({
            style_class: 'extension-focus-timer-label-separator',
            text: ':',
        });
        this._secondsLabel = new NumericLabel({
            digits: 2,
            text_align: Pango.Alignment.LEFT,
        });

        this._hoursSeparatorLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._minutesSeparatorLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this._box = new St.BoxLayout();
        this._box.add_child(this._hoursLabel);
        this._box.add_child(this._hoursSeparatorLabel);
        this._box.add_child(this._minutesLabel);
        this._box.add_child(this._minutesSeparatorLabel);
        this._box.add_child(this._secondsLabel);
        this.add_child(this._box);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    vfunc_get_preferred_height(_forWidth) {
        const layout = this._minutesSeparatorLabel.clutter_text?.get_layout().copy();
        layout.set_text('00:00', 5);

        const [inkRect] = layout.get_extents();
        const minimumSize = Math.ceil(inkRect.height / Pango.SCALE);
        const naturalSize = minimumSize;

        return [minimumSize, naturalSize];
    }

    vfunc_allocate(box, _flags) {
        this.set_allocation(box);

        const [width, height] = box.get_size();
        const [, childHeight] = this._box.get_preferred_height(width);

        const childBox = new Clutter.ActorBox();
        childBox.set_origin(0, Math.floor((height - childHeight) / 2));
        childBox.set_size(width, childHeight);
        this._box.allocate(childBox);
    }

    vfunc_map() {
        this._timer.connectObject('tick', this._onTimerTick.bind(this), this);
        this._timer.connectObject('changed', this._onTimerChanged.bind(this), this);
        this._updateLabels(this._timer.lastTickTime);

        super.vfunc_map();
    }

    vfunc_unmap() {
        if (this._timer)
            this._timer.disconnectObject(this);

        super.vfunc_unmap();

        this._lastValue = NaN;
    }

    freeze() {
        this._frozenValue = this._lastValue;
    }

    unfreeze() {
        this._frozenValue = NaN;
    }

    _updateLabels(timestamp) {
        const remaining = isNaN(this._frozenValue)
            ? this._timer.getRemaining(timestamp)
            : this._frozenValue;
        const seconds = Math.trunc(remaining / SECOND);
        const hasHours = seconds >= 3600;

        this._hoursLabel.value = Math.trunc(seconds / 3600);
        this._minutesLabel.value = Math.trunc((hasHours ? seconds % 3600 : seconds) / 60);
        this._secondsLabel.value = seconds % 60;

        if (this._hasHours !== hasHours || !this._lastValue) {
            this._hasHours = hasHours;
            this._hoursLabel.visible = hasHours;
            this._hoursSeparatorLabel.visible = hasHours;
            this._minutesLabel.text_align = hasHours
                ? Pango.Alignment.LEFT
                : Pango.Alignment.RIGHT;

            if (hasHours)
                this.add_style_class_name('extension-focus-timer-has-hours');
            else
                this.remove_style_class_name('extension-focus-timer-has-hours');
        }

        this._lastValue = remaining;
    }

    _onTimerChanged(timer) {
        this._updateLabels(timer.lastChangedTime);
    }

    _onTimerTick(timer, timestamp) {
        this._updateLabels(timestamp);
    }

    _onDestroy() {
        if (this._timer) {
            this._timer.disconnectObject(this);
            this._timer = null;
        }

        this.remove_child(this._box);

        this._delegate = null;
        this._box = null;
        this._hoursLabel = null;
        this._hoursSeparatorLabel = null;
        this._minutesLabel = null;
        this._minutesSeparatorLabel = null;
        this._secondsLabel = null;
    }
});
