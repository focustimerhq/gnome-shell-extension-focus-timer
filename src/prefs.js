import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const GeneralPreferencesGroup = GObject.registerClass(
class GeneralPreferencesGroup extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({
            title: _('General'),
        });

        this._settings = settings;

        const autostartRow = new Adw.SwitchRow({
            title: _('Autostart The App'),
            subtitle: _('Makes the indicator instantly visible and allows keyboard shortcuts'),
        });
        this._settings.bind('autostart',
            autostartRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        this.add(autostartRow);
    }
});

const IndicatorPreferencesGroup = GObject.registerClass(
class IndicatorPreferencesGroup extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({
            title: _('Indicator'),
        });

        this._settings = settings;

        const typeToggleGroup = new Adw.ToggleGroup({
            homogeneous: true,
            can_shrink: false,
            valign: Gtk.Align.CENTER,
        });
        typeToggleGroup.add(
            new Adw.Toggle({
                name: 'icon',
                label: _('Icon'),
            })
        );
        typeToggleGroup.add(
            new Adw.Toggle({
                name: 'text',
                label: _('Text'),
            })
        );
        this._settings.bind('indicator-type',
            typeToggleGroup, 'active-name',
            Gio.SettingsBindFlags.DEFAULT);
        const typeRow = new Adw.ActionRow({
            title: _('Display As'),
            subtitle: _('Choose how the timer appears in the status bar'),
            activatable: false,
        });
        typeRow.add_suffix(typeToggleGroup);
        this.add(typeRow);
    }
});

const ScreenOverlayPreferencesGroup = GObject.registerClass(
class ScreenOverlayPreferencesGroup extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({
            title: _('Screen Overlay'),
        });

        this._settings = settings;

        const blurEffectRow = new Adw.SwitchRow({
            title: _('Blur Effect'),
            subtitle: _('Helps to acknowledge the break'),
        });
        this._settings.bind('blur-effect',
            blurEffectRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        this.add(blurEffectRow);

        const dismissGestureRow = new Adw.SwitchRow({
            title: _('Dismiss Gesture'),
            subtitle: _('Flick the mouse or press any key to dismiss'),
        });
        this._settings.bind('dismiss-gesture',
            dismissGestureRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        this.add(dismissGestureRow);
    }
});

const DistractionsPreferencesGroup = GObject.registerClass(
class DistractionsPreferencesGroup extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({
            title: _('Distractions'),
        });

        this._settings = settings;

        const manageNotificationsRow = new Adw.SwitchRow({
            title: _('Manage Notifications'),
            subtitle: _('Toggle Do Not Disturb mode during Pomodoro'),
        });
        this._settings.bind('manage-notifications',
            manageNotificationsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        this.add(manageNotificationsRow);
    }
});

const PreferencesPage = GObject.registerClass(
class FocusTimerPreferencesPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init();

        this.add(new GeneralPreferencesGroup(settings));
        this.add(new IndicatorPreferencesGroup(settings));
        this.add(new ScreenOverlayPreferencesGroup(settings));
        this.add(new DistractionsPreferencesGroup(settings));
    }
});

export default class FocusTimerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.add(new PreferencesPage(this.getSettings()));
    }
}
