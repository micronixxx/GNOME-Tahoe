// SPDX-License-Identifier: GPL-3.0-or-later
// Per-application shortcut menus ported from orbit-global-menu
// (https://github.com/Unmade760/orbit-global-menu, GPL-3.0-or-later):
// JSON catalog under ./orbit-shortcuts (169 apps). Clicking an item sends
// the app's documented keyboard shortcut to the focused window (see
// orbitKeys.js), which is how apps that export nothing (Chrome, Electron
// on Wayland) still get a working menu bar.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const FALLBACK_DIR = GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/globalmenu@ShiroOSL.github.io';
const MODULE_DIR = (() => {
    try {
        const p = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
        if (p)
            return p;
    } catch (_) {
        // old GJS without import.meta
    }
    return FALLBACK_DIR;
})();

// Top-level titles only (macOS Tahoe Russian bar); items stay in English
// (translating ~5000 shortcut labels is a separate project).
const TITLE_RU = {
    'File': 'Файл',
    'Edit': 'Правка',
    'View': 'Вид',
    'History': 'История',
    'Bookmarks': 'Закладки',
    'Tools': 'Инструменты',
    'Window': 'Окно',
    'Help': 'Справка',
    'Tabs': 'Вкладки',
    'Actions': 'Действия',
    'Settings': 'Настройки',
    'Profile': 'Профиль',
    'Project': 'Проект',
    'Run': 'Запуск',
    'Debug': 'Отладка',
    'Terminal': 'Терминал',
    'Selection': 'Выделение',
    'Insert': 'Вставка',
    'Format': 'Формат',
    'Go': 'Переход',
};

let _mappings = null;

function _load() {
    if (_mappings)
        return _mappings;
    _mappings = [];
    try {
        const dir = Gio.File.new_for_path(
            GLib.build_filenamev([MODULE_DIR, 'orbit-shortcuts']));
        const it = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        let info = null;
        const names = [];
        while ((info = it.next_file(null)))
            names.push(info.get_name());
        try {
            it.close(null);
        } catch (_) {
            // done
        }
        names.sort();
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            try {
                const [ok, bytes] = Gio.File.new_for_path(
                    GLib.build_filenamev([MODULE_DIR, 'orbit-shortcuts', name]))
                    .load_contents(null);
                if (!ok)
                    continue;
                const data = JSON.parse(imports.byteArray.toString(bytes));
                if (!data || data.format !== 1 || !Array.isArray(data.menus))
                    continue;
                const stem = name.slice(0, -5);
                if (data.app !== stem)
                    continue;
                const ids = (Array.isArray(data.identifiers) ? data.identifiers : [])
                    .filter(id => typeof id === 'string' && id.length > 0)
                    .map(id => id.toLowerCase());
                if (!ids.length)
                    continue;
                _mappings.push({app: data.app, name: data.name || data.app, ids, menus: data.menus});
            } catch (_) {
                // malformed file: skip
            }
        }
    } catch (_) {
        // no catalog
    }
    return _mappings;
}

function _candidates(desktopId, appName, wmClass, wmClassInstance) {
    const out = new Set();
    const add = v => {
        if (typeof v === 'string' && v.length > 0)
            out.add(v.toLowerCase());
    };
    add(desktopId);
    if (typeof desktopId === 'string' && desktopId.toLowerCase().endsWith('.desktop'))
        add(desktopId.slice(0, -8));
    add(appName);
    add(wmClass);
    add(wmClassInstance);
    return out;
}

// Returns the mapping whose identifiers contain one of the candidates,
// or null. First match wins (catalog sorted by filename).
export function resolveOrbitMenu(desktopId, appName, wmClass, wmClassInstance) {
    try {
        const maps = _load();
        if (!maps.length)
            return null;
        const cands = _candidates(desktopId, appName, wmClass, wmClassInstance);
        if (!cands.size)
            return null;
        for (const m of maps) {
            for (const id of m.ids) {
                if (cands.has(id))
                    return m;
            }
        }
    } catch (_) {
        // no match
    }
    return null;
}

export function orbitTitle(label) {
    try {
        if (typeof label === 'string' && TITLE_RU[label])
            return TITLE_RU[label];
    } catch (_) {
        // keep original
    }
    return label;
}

// orbit item shapes -> our menuData children ({type,label,children,action,
// enabled} as consumed by TopLevelMenuButton._buildSubMenu).
export function orbitToChildren(items) {
    const out = [];
    try {
        for (const it of items || []) {
            if (!it)
                continue;
            if (it.separator === true) {
                out.push({type: 'separator'});
                continue;
            }
            if (Array.isArray(it.items)) {
                out.push({
                    type: 'submenu',
                    label: it.label || '?',
                    children: orbitToChildren(it.items),
                });
                continue;
            }
            if (typeof it.shortcut === 'string' && it.shortcut.length > 0) {
                out.push({label: it.label || it.shortcut, action: `orbit-shortcut:${it.shortcut}`});
                continue;
            }
            out.push({label: it.label || '?', enabled: false});
        }
    } catch (_) {
        // partial menu stays
    }
    return out;
}
