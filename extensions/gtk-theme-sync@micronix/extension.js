// GTK Theme Sync: mirrors the MacTahoe Light/Dark stylesheets into
// ~/.config/gtk-4.0/gtk.css whenever the system color scheme changes, so
// switching dark/light actually resticks. Kiwi's managed import block is
// preserved on top; anything else in the file is left alone only if there
// is no Kiwi block (then we do nothing).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MARKER_BEGIN = '/* Kiwi (is not Apple) - managed imports: begin */';
const MARKER_END = '/* Kiwi (is not Apple) - managed imports: end */';

function configPath(name) {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', name]);
}

function readFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null))
            return null;
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return null;
    }
}

function writeFile(path, content) {
    const file = Gio.File.new_for_path(path);
    file.replace_contents(new TextEncoder().encode(content), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function syncTheme() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const theme = iface.get_string('gtk-theme') || '';
        if (!theme.startsWith('MacTahoe')) {
            console.log('[gtk-theme-sync] gtk-theme is not MacTahoe, leaving gtk.css alone');
            return;
        }

        const dark = iface.get_string('color-scheme') === 'prefer-dark';
        const variant = dark ? 'gtk-Dark.css' : 'gtk-Light.css';
        const themeCss = readFile(configPath(variant));
        if (!themeCss) {
            console.error(`[gtk-theme-sync] missing ${variant}, skipping`);
            return;
        }

        const current = readFile(configPath('gtk.css')) ?? '';
        const begin = current.indexOf(MARKER_BEGIN);
        const end = current.indexOf(MARKER_END);
        if (begin === -1 || end === -1 || end < begin) {
            console.log('[gtk-theme-sync] no Kiwi block in gtk.css, leaving it alone');
            return;
        }
        const block = current.slice(begin, end + MARKER_END.length) + '\n';

        writeFile(configPath('gtk.css'), block + themeCss);
        console.log(`[gtk-theme-sync] gtk.css now follows ${dark ? 'dark' : 'light'} (${variant})`);
    } catch (e) {
        console.error(`[gtk-theme-sync] sync failed: ${e}`);
    }
}

export default class GtkThemeSyncExtension extends Extension {
    enable() {
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._changedId = this._interfaceSettings.connect('changed::color-scheme',
            () => syncTheme());
        this._themeChangedId = this._interfaceSettings.connect('changed::gtk-theme',
            () => syncTheme());
        syncTheme();
    }

    disable() {
        if (this._changedId && this._interfaceSettings) {
            try {
                this._interfaceSettings.disconnect(this._changedId);
            } catch (e) {
                // already gone
            }
            this._changedId = 0;
        }
        if (this._themeChangedId && this._interfaceSettings) {
            try {
                this._interfaceSettings.disconnect(this._themeChangedId);
            } catch (e) {
                // already gone
            }
            this._themeChangedId = 0;
        }
        this._interfaceSettings = null;
    }
}
