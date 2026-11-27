/* Desktop Dog — preferences (libadwaita / GTK4, GNOME 46). */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['bottom-right', _('Bottom-right')],
    ['bottom-left',  _('Bottom-left')],
    ['top-right',    _('Top-right')],
    ['top-left',     _('Top-left')],
    ['center',       _('Center')],
];

export default class DesktopDogPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 640);

        const page = new Adw.PreferencesPage({title: _('Desktop Dog')});
        window.add(page);

        // ---- Appearance ------------------------------------------------
        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(appearance);

        const showRow = new Adw.SwitchRow({
            title: _('Show the dog'),
            subtitle: _('Display the dog on the desktop'),
        });
        settings.bind('show-dog', showRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(showRow);

        const sizeRow = new Adw.SpinRow({
            title: _('Dog size'),
            subtitle: _('On-screen size in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 64, upper: 220, step_increment: 2, page_increment: 10,
                value: settings.get_int('dog-size'),
            }),
        });
        settings.bind('dog-size', sizeRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(sizeRow);

        const posRow = new Adw.ComboRow({
            title: _('Initial position'),
            subtitle: _('Corner used on first run and after “Reset position”'),
            model: this._positionModel(),
        });
        posRow.selected = Math.max(0, POSITIONS.findIndex(
            p => p[0] === settings.get_string('initial-position')));
        posRow.connect('notify::selected', () =>
            settings.set_string('initial-position', POSITIONS[posRow.selected][0]));
        settings.connect('changed::initial-position', () => {
            const i = POSITIONS.findIndex(
                p => p[0] === settings.get_string('initial-position'));
            if (i >= 0 && posRow.selected !== i)
                posRow.selected = i;
        });
        appearance.add(posRow);

        // ---- Behaviour -------------------------------------------------
        const behaviour = new Adw.PreferencesGroup({
            title: _('Behaviour'),
            description: _('The dog never walks or jumps around on its own.'),
        });
        page.add(behaviour);

        const animRow = new Adw.SwitchRow({
            title: _('Enable animations'),
            subtitle: _('Master switch for idle and reaction animations'),
        });
        settings.bind('enable-animations', animRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(animRow);

        const breatheRow = new Adw.SwitchRow({
            title: _('Idle breathing'),
            subtitle: _('Subtle breathing motion while idle'),
        });
        settings.bind('idle-breathing', breatheRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(breatheRow);

        const freqRow = new Adw.SpinRow({
            title: _('Idle animation frequency'),
            subtitle: _('How often the dog blinks and wags (0 = rarely, 100 = often)'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 100, step_increment: 5, page_increment: 10,
                value: settings.get_int('animation-frequency'),
            }),
        });
        settings.bind('animation-frequency', freqRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(freqRow);

        const soundRow = new Adw.SwitchRow({
            title: _('Enable sound'),
            subtitle: _('Play a short cue on interactions (needs GSound)'),
        });
        settings.bind('enable-sound', soundRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(soundRow);

        // ---- Position / reset -----------------------------------------
        const maintenance = new Adw.PreferencesGroup({title: _('Position & reset')});
        page.add(maintenance);

        const resetPosRow = new Adw.ActionRow({
            title: _('Reset position'),
            subtitle: _('Move the dog back to the initial corner'),
        });
        const resetPosBtn = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        resetPosBtn.connect('clicked', () =>
            settings.set_boolean('reset-position', true));
        resetPosRow.add_suffix(resetPosBtn);
        resetPosRow.activatable_widget = resetPosBtn;
        maintenance.add(resetPosRow);

        const resetAllRow = new Adw.ActionRow({
            title: _('Reset all settings'),
            subtitle: _('Restore every option (including position) to defaults'),
        });
        const resetAllBtn = new Gtk.Button({
            label: _('Reset all'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetAllBtn.connect('clicked', () =>
            settings.list_keys().forEach(key => settings.reset(key)));
        resetAllRow.add_suffix(resetAllBtn);
        resetAllRow.activatable_widget = resetAllBtn;
        maintenance.add(resetAllRow);
    }

    _positionModel() {
        const model = new Gtk.StringList();
        for (const [, label] of POSITIONS)
            model.append(label);
        return model;
    }
}
