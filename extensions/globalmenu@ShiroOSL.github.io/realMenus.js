// SPDX-License-Identifier: GPL-3.0-or-later
// Real application menus over D-Bus.
//
// Two sources, best first:
//   Path A - exported menu models (org.gtk.Menus, GTK3/Qt/LO style):
//     discovered by walking the app's bus objects, read live through
//     Gio.DBusMenuModel, invoked through Gio.DBusActionGroup.
//   Path B - exported actions only (org.gtk.Actions, the common GTK4
//     case: no menubar model exists): app.* actions go to the App menu,
//     win.* actions go to the Window menu, labels prettified from ids.
// Neither found -> the caller falls back to Window/View built from
// real MetaWindow operations.
//
// Menu items that invoke remote actions carry `remote: <index>`; the
// matching entry lives in the per-build remoteMap handed to the button:
// {service, path, name, target}. The executor activates by basename,
// falling back to the full detailed name.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

const MAX_WALK_NODES = 120;
const MAX_DEPTH = 6;
const REBUILD_DEBOUNCE_MS = 400;

// window id -> discovery (null = nothing exported, use fallback)
const _discCache = new Map();
// pid -> bus name (null = none)
const _pidBusCache = new Map();

function _busCall(bus, path, iface, method, params) {
    const proxy = Gio.DBusProxy.new_sync(Gio.DBus.session,
        Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
        bus, path, iface, null);
    return proxy.call_sync(method, params,
        Gio.DBusCallFlags.NONE, -1, null);
}

function _nameHasOwner(name) {
    try {
        const r = _busCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'NameHasOwner',
            new GLib.Variant('(s)', [name]));
        return r.deep_unpack()[0] === true;
    } catch (_) {
        return false;
    }
}

function _busForPid(pid) {
    try {
        const r = _busCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null);
        const names = r.deep_unpack()[0] ?? [];
        for (const n of names) {
            if (!n.startsWith(':'))
                continue;
            try {
                const pr = _busCall('org.freedesktop.DBus',
                    '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                    'GetConnectionUnixProcessID',
                    new GLib.Variant('(s)', [n]));
                if (pr.deep_unpack()[0] === pid)
                    return n;
            } catch (_) {
                // vanished, next
            }
        }
    } catch (_) {
        // no bus
    }
    return null;
}

function _candidateBuses(window) {
    const out = [];
    try {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const id = app?.get_id?.() ?? '';
        if (id) {
            const base = id.endsWith('.desktop') ? id.slice(0, -8) : id;
            if (base && _nameHasOwner(base) && !out.includes(base))
                out.push(base);
        }
    } catch (_) {
        // no tracker match
    }
    try {
        const pid = window.get_pid?.() ?? 0;
        if (pid > 0) {
            let bus = _pidBusCache.has(pid) ? _pidBusCache.get(pid) : null;
            if (!_pidBusCache.has(pid)) {
                bus = _busForPid(pid);
                _pidBusCache.set(pid, bus);
            }
            if (bus && !out.includes(bus))
                out.push(bus);
        }
    } catch (_) {
        // no pid
    }
    return out;
}

function _walkBus(bus) {
    const menus = [];
    const actions = [];
    const seen = new Set();
    let budget = MAX_WALK_NODES;
    const walk = (path, depth) => {
        if (depth > MAX_DEPTH || seen.has(path) || budget-- <= 0)
            return;
        seen.add(path);
        let xml = null;
        try {
            const r = _busCall(bus, path,
                'org.freedesktop.DBus.Introspectable', 'Introspect', null);
            xml = r.deep_unpack()[0];
        } catch (_) {
            return;
        }
        if (typeof xml !== 'string')
            return;
        if (xml.includes('org.gtk.Menus'))
            menus.push(path);
        if (xml.includes('org.gtk.Actions'))
            actions.push(path);
        for (const m of xml.matchAll(/<node\s+name="([^"]+)"\s*\/?>/g)) {
            const child = m[1];
            if (!child)
                continue;
            walk(path === '/' ? `/${child}` : `${path}/${child}`, depth + 1);
        }
    };
    try {
        walk('/', 0);
    } catch (_) {
        // partial walk is fine
    }
    return {menus, actions};
}

// Map every hosted action name to its group: {service, path, form}.
// Names are matched by basename first ("quit" for "app.quit"), then full.
function _mapActionGroups(service, actionPaths) {
    const groups = [];
    for (const path of actionPaths) {
        let names = [];
        try {
            const r = _busCall(service, path, 'org.gtk.Actions', 'List', null);
            names = r.deep_unpack()[0] ?? [];
        } catch (_) {
            continue;
        }
        groups.push({service, path, names,
            winish: /window/i.test(path) || /\/\d+$/.test(path)});
    }
    const byName = new Map();
    for (const g of groups) {
        for (const n of g.names) {
            if (!byName.has(n))
                byName.set(n, []);
            byName.get(n).push(g);
        }
    }
    return {
        resolve(full) {
            const base = full.includes('.') ? full.split('.').pop() : full;
            const prefix = full.includes('.') ? full.split('.')[0] : '';
            const cands = byName.get(base) ?? byName.get(full) ?? [];
            if (!cands.length)
                return null;
            const wantWin = prefix === 'win';
            const scoped = cands.filter(g => wantWin ? g.winish : !g.winish);
            const g = scoped[0] ?? cands[0];
            const form = (g.names.includes(base) ? base : full);
            return {service: g.service, path: g.path, form};
        },
        // raw "prefixless" actions of one scope for Path B
        namesFor(wantWin) {
            const out = [];
            for (const g of groups) {
                if (!!g.winish !== !!wantWin)
                    continue;
                for (const n of g.names) {
                    if (!n.includes('.'))
                        out.push({group: g, name: n});
                }
            }
            return out;
        },
        groups,
    };
}

function _strAttr(model, i, name) {
    try {
        const v = model.get_item_attribute_value(i, name,
            new GLib.VariantType('s'));
        return v?.unpack?.() ?? null;
    } catch (_) {
        return null;
    }
}

function _boolAttr(model, i, name, dflt) {
    try {
        const v = model.get_item_attribute_value(i, name,
            new GLib.VariantType('b'));
        const b = v?.unpack?.();
        return typeof b === 'boolean' ? b : dflt;
    } catch (_) {
        return dflt;
    }
}

function _targetParam(model, i) {
    try {
        const v = model.get_item_attribute_value(i, 'target', null);
        if (!v)
            return null;
        // the 'target' attribute is a variant holding the parameter
        if (v.get_type_string() === 'v') {
            try {
                return v.get_variant();
            } catch (_) {
                return null;
            }
        }
        return v;
    } catch (_) {
        return null;
    }
}

function _cleanLabel(raw, fallback) {
    let s = (raw ?? '').toString();
    // strip mnemonic underscores, keep escaped ones
    s = s.replace(/__/g, '\u0000').replace(/_/g, '').replace(/\u0000/g, '_');
    s = s.trim();
    return s || fallback || '';
}

function _prettify(name) {
    return name.replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// GDBusMenuModel populates ASYNCHRONOUSLY: a fresh instance reads empty
// until items-changed fires. Models are cached per service+path so a
// rebuild reuses the (now populated) instance instead of looping forever.
const _modelCache = new Map();

function _getModel(service, path, live, onChange) {
    const key = `${service}\n${path}`;
    let entry = _modelCache.get(key);
    if (!entry) {
        let model = null;
        try {
            model = Gio.DBusMenuModel.get(Gio.DBus.session, service, path);
        } catch (_) {
            return null;
        }
        if (!model)
            return null;
        entry = {model, hid: 0};
        _modelCache.set(key, entry);
        if (_modelCache.size > 40) {
            const first = _modelCache.keys().next().value;
            _modelCache.delete(first);
        }
    }
    if (!entry.hid) {
        try {
            entry.hid = entry.model.connect('items-changed', onChange);
        } catch (_) {
            entry.hid = 0;
        }
    }
    live.push(entry);
    return entry.model;
}

// read one model (path or object) into item trees;
// live models register for rebuilds
function _readModelObj(service, pathOrModel, act, remoteMap, live, onChange, depth) {
    const items = [];
    if (depth > 5)
        return items;
    let model = null;
    if (typeof pathOrModel === 'string') {
        model = _getModel(service, pathOrModel, live, onChange);
    } else {
        model = pathOrModel;
        if (model) {
            let hid = 0;
            try {
                hid = model.connect('items-changed', onChange);
            } catch (_) {
                hid = 0;
            }
            live.push({model, hid});
        }
    }
    if (!model)
        return items;
    let n = 0;
    try {
        n = model.get_n_items();
    } catch (_) {
        return items;
    }
    for (let i = 0; i < n; i++) {
        try {
            items.push(..._readItem(service, model, i, act, remoteMap, live, onChange, depth));
        } catch (_) {
            // unreadable item, skip
        }
    }
    return items;
}

function _readItem(service, model, i, act, remoteMap, live, onChange, depth) {
    let sub = null;
    let sec = null;
    try {
        sub = model.get_item_link(i, 'submenu');
    } catch (_) {
        sub = null;
    }
    try {
        sec = model.get_item_link(i, 'section');
    } catch (_) {
        sec = null;
    }
    const label = _cleanLabel(_strAttr(model, i, 'label'), '');
    if (sub) {
        const kids = _readModelObj(service, sub, act, remoteMap, live, onChange, depth + 1);
        if (!kids.length)
            return [];
        return [{type: 'submenu', label: label || '…', children: kids}];
    }
    if (sec) {
        // sections flatten into the parent, separated from each other
        return _readModelObj(service, sec, act, remoteMap, live, onChange, depth + 1);
    }
    const action = _strAttr(model, i, 'action');
    if (action) {
        const entry = act.resolve(action);
        if (!entry)
            return [];
        const enabled = _boolAttr(model, i, 'sensitive',
            _boolAttr(model, i, 'enabled', true));
        const toggled = _boolAttr(model, i, 'toggled', false);
        const idx = remoteMap.length;
        remoteMap.push({
            service: entry.service,
            path: entry.path,
            name: entry.form,
            target: _targetParam(model, i),
        });
        return [{
            label: (toggled ? '✓ ' : '') + (label || action),
            enabled,
            action: `remote:${idx}`,
        }];
    }
    if (label)
        return [{label, enabled: false}];
    return [{type: 'separator'}];
}

function _pickMenubar(paths) {
    if (!paths.length)
        return null;
    const score = p => {
        if (/menubar/i.test(p))
            return 0;
        if (/app/i.test(p))
            return 3;
        if (/window|menu/i.test(p))
            return 1;
        return 2;
    };
    const sorted = [...paths].sort((a, b) => score(a) - score(b));
    // a lone app-model is not a menubar (the App menu covers that scope)
    if (sorted.length && score(sorted[0]) >= 3 && sorted.length > 1)
        return sorted.find(p => score(p) < 3) ?? null;
    if (sorted.length && score(sorted[0]) >= 3)
        return null;
    return sorted[0] ?? null;
}

function _discover(window) {
    const buses = _candidateBuses(window);
    for (const bus of buses) {
        const found = _walkBus(bus);
        if (found.menus.length || found.actions.length)
            return {service: bus, menus: found.menus, actions: found.actions};
    }
    return null;
}

export function discoverWindowMenus(window) {
    try {
        if (!window)
            return null;
        const wid = window.get_id();
        if (_discCache.has(wid))
            return _discCache.get(wid);
        const disc = _discover(window);
        _discCache.set(wid, disc);
        try {
            window.connect('unmanaged', () => _discCache.delete(wid));
        } catch (_) {
            // gone
        }
        return disc;
    } catch (_) {
        return null;
    }
}

export function dropWindowMenus(window) {
    try {
        if (window)
            _discCache.delete(window.get_id());
    } catch (_) {
        // gone
    }
}

// Build real menu data for a focused window.
// Returns {topLevels, appActions, winActions, remoteMap, live}
// and calls onChange() when a tracked model updates (debounced by caller).
export function buildRealMenus(window, onChange) {
    const out = {topLevels: [], appActions: [], winActions: [], remoteMap: [], live: [], disc: 'none'};
    try {
        const disc = discoverWindowMenus(window);
        if (!disc)
            return out;
        out.disc = `${disc.service} menus=${disc.menus.length} acts=${disc.actions.length}`;
        const act = _mapActionGroups(disc.service, disc.actions);
        const menuPath = _pickMenubar(disc.menus);
        if (menuPath) {
            // cached model: empty on first sight (async), populated
            // after items-changed -> debounced rebuild converges
            let items = _readModelObj(disc.service, menuPath, act,
                out.remoteMap, out.live, onChange, 0);
            // a lone unlabeled wrapper -> descend one level
            if (items.length === 1 && items[0].type === 'submenu' &&
                (items[0].label === '…' || !items[0].label)) {
                items = items[0].children;
            }
            // keep only real submenus at the top level
            out.topLevels = items.filter(it => it.type === 'submenu');
        }
        if (!out.topLevels.length) {
            // Path B: actions only (typical GTK4) - app.* to App, win.* to Window
            for (const {group, name} of act.namesFor(false)) {
                if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
                    continue;
                const idx = out.remoteMap.length;
                out.remoteMap.push({service: group.service, path: group.path, name, target: null});
                out.appActions.push({label: _prettify(name), enabled: true, action: `remote:${idx}`});
            }
            for (const {group, name} of act.namesFor(true)) {
                if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
                    continue;
                const idx = out.remoteMap.length;
                out.remoteMap.push({service: group.service, path: group.path, name, target: null});
                out.winActions.push({label: _prettify(name), enabled: true, action: `remote:${idx}`});
            }
        }
    } catch (_) {
        // discovery failed -> caller falls back
    }
    return out;
}

// Fallback Window menu: real window actions first, then WM operations.
export function fallbackWindowItems(winActions) {
    const items = [...winActions];
    if (items.length)
        items.push({type: 'separator'});
    items.push(
        {label: 'Свернуть', action: 'minimize'},
        {label: 'Развернуть', action: 'maximize'},
        {type: 'separator'},
        {label: 'Закрыть', action: 'close'},
    );
    return items;
}

// Fallback View menu: the only universal view op.
export function fallbackViewItems() {
    return [{label: 'Во весь экран', action: 'toggle-fullscreen'}];
}
