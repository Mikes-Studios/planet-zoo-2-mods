// Error banner for the FrontEnd view.
//
// Sources:
//  - Lua (server errors, script errors, api.debug.Error) via "PZ2QoL_Error"
//  - JS errors and unhandled promise rejections in this view
//  - a watchdog for loading spinners that never finish
//
// Everything is plain DOM in its own root under <body>, outside the
// game's preact tree.

import { dlog } from '/js/mods/pz2qol/debuglog.js';

const MAX_LOG = 50;
const SPINNER_WARN_MS = 20000;
const log = [];
const subscribers = new Set();
let root = null;
let listEl = null;
let titleEl = null;
let detailEl = null;
let countEl = null;
let toggleEl = null;
let iconEl = null;
let expanded = false;
let hideTimer = -1;
let unseen = 0;
// the Kin setting errorBanner (main.js): off, every report is logged, none shown
let bannerOn = true;

// Severity per source: drives the stripe colour and icon.
const SEVERITY = {
    server: { cls: 'sev_error', label: 'Server', icon: 'IconWarning' },
    lister: { cls: 'sev_error', label: 'Lister', icon: 'IconTrade' },
    lua: { cls: 'sev_error', label: 'Script', icon: 'IconWarning' },
    debug: { cls: 'sev_warn', label: 'Game', icon: 'IconWarning' },
    watchdog: { cls: 'sev_warn', label: 'Waiting', icon: 'TimeRemaining' },
    ui: { cls: 'sev_info', label: 'UI', icon: 'IconInformation' },
    mod: { cls: 'sev_info', label: 'Mod', icon: 'IconInformation' },
    assert: { cls: 'sev_info', label: 'Assert', icon: 'IconInformation' },
};
const sev = source => SEVERITY[source] || SEVERITY.ui;

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != undefined) e.textContent = text;
    return e;
}

// Gameface supports appendChild everywhere; avoid ParentNode.append.
function appendAll(parent, ...children) {
    for (const c of children) if (c) parent.appendChild(c);
}

function iconDiv(name, tint) {
    const d = el('div', `PZ2QoL_icon tint_${tint} sm`);
    d.style.backgroundImage = `url(/img/icons/${name}.svg)`;
    return d;
}

function button(label, cls, onClick) {
    const b = el('div', `PZ2QoL_errorButton ${cls || ''}`, label);
    b.addEventListener('click', e => {
        e.stopPropagation();
        onClick();
    });
    return b;
}

function ensureRoot() {
    if (root && root.parentNode) {
        return;
    }
    root = el('div', 'PZ2QoL_errorBanner hidden');
    const header = el('div', 'PZ2QoL_errorHeader');
    iconEl = el('div', 'PZ2QoL_errorIcon');
    const texts = el('div', 'PZ2QoL_errorTexts');
    titleEl = el('div', 'PZ2QoL_errorTitleMain');
    detailEl = el('div', 'PZ2QoL_errorCount');
    appendAll(texts, titleEl, detailEl);
    countEl = el('div', 'PZ2QoL_errorBubble');
    toggleEl = button('Details', '', () => {
        expanded = !expanded;
        root.classList.toggle('expanded', expanded);
        toggleEl.textContent = expanded ? 'Less' : 'Details';
        clearTimeout(hideTimer);
    });
    const close = button('Dismiss', 'close', () => {
        root.classList.add('hidden');
        expanded = false;
        unseen = 0;
        root.classList.remove('expanded');
        toggleEl.textContent = 'Details';
    });
    appendAll(header, iconEl, texts, countEl, toggleEl, close);
    listEl = el('div', 'PZ2QoL_errorList');
    const drawerHead = el('div', 'PZ2QoL_errorDrawerHead');
    appendAll(drawerHead, el('div', 'PZ2QoL_errorDrawerTitle', 'Recent problems'), el('div', 'PZ2QoL_flex1'), button('Clear', 'ghost', () => {
        log.length = 0;
        unseen = 0;
        render();
        root.classList.add('hidden');
    }));
    const drawer = el('div', 'PZ2QoL_errorDrawer');
    appendAll(drawer, drawerHead, listEl);
    appendAll(root, header, drawer);
    document.body.appendChild(root);
}

function timeString(d) {
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function render() {
    ensureRoot();
    // the header shows the latest problem that was meant to be seen
    let latest = null;
    for (let i = log.length - 1; i >= 0 && !latest; i--) if (log[i].shown) latest = log[i];
    latest = latest || log[log.length - 1];
    const s = sev(latest ? latest.source : 'ui');
    root.className = root.className.replace(/\bsev_\w+/g, '').trim() + ' ' + s.cls;
    iconEl.style.backgroundImage = `url(/img/icons/${s.icon}.svg)`;
    titleEl.textContent = latest ? latest.title : '';
    detailEl.textContent = latest ? latest.detail || s.label : '';
    detailEl.title = latest ? latest.detail : '';
    countEl.textContent = unseen > 1 ? String(unseen) : '';
    countEl.classList.toggle('show', unseen > 1);
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        const es = sev(e.source);
        const row = el('div', `PZ2QoL_errorRow ${es.cls}`);
        const head = el('div', 'PZ2QoL_errorRowHead');
        appendAll(head, iconDiv(es.icon, 'brown'), el('span', 'PZ2QoL_errorSource', es.label), el('span', 'PZ2QoL_errorTitle', e.title), el('div', 'PZ2QoL_flex1'), el('span', 'PZ2QoL_errorTime', timeString(e.time)));
        row.appendChild(head);
        if (e.detail) {
            row.appendChild(el('div', 'PZ2QoL_errorDetail', e.detail));
        }
        listEl.appendChild(row);
    }
}

function errorText(err) {
    if (err == undefined) return '';
    if (typeof err === 'string') return err;
    if (err.stack) return String(err.stack).split('\n').slice(0, 4).join(' | ');
    if (err.message) return err.message;
    try {
        return JSON.stringify(err);
    }
    catch (e) {
        return String(err);
    }
}

// Debug builds: Lua appends "js_<name>" to dbg/trace.log on every call
// (breadcrumbs for crash hunting). A no-op for the game otherwise.
export function breadcrumb(name) {
    try {
        if (typeof engine !== 'undefined') engine.trigger('PZ2QoL_Trace', name);
    }
    catch (e) {
        // tracing must never break the page
    }
}

export function reportError(source, title, detail, opts = {}) {
    breadcrumb('report');
    const entry = { source: String(source), title: String(title), detail: errorText(detail), time: new Date(), shown: !opts.silent && bannerOn };
    // the detailed log (debug builds): every report, shown or silent
    dlog('ui', 'report', { source: entry.source, title: entry.title, detail: entry.detail, shown: entry.shown });
    const last = log[log.length - 1];
    if (last && last.title == entry.title && last.detail == entry.detail && entry.time - last.time < 5000) {
        return;
    }
    log.push(entry);
    if (log.length > MAX_LOG) {
        log.shift();
    }
    subscribers.forEach(fn => {
        try {
            fn(entry);
        }
        catch (e) {
            // a subscriber must never break reporting
        }
    });
    try {
        console.error(`[PZ2QoL] ${entry.source}: ${entry.title} ${entry.detail}`);
        render();
        if (!entry.shown) {
            return;
        }
        if (root.classList.contains('hidden')) unseen = 0;
        unseen++;
        render();
        root.classList.remove('hidden');
        clearTimeout(hideTimer);
        if (!expanded && opts.autoHideMs) {
            hideTimer = setTimeout(() => root.classList.add('hidden'), opts.autoHideMs);
        }
    }
    catch (e) {
        // never let the banner itself break the page
    }
}

export function setErrorBanner(on) {
    bannerOn = on !== false;
    if (!bannerOn && root) root.classList.add('hidden');
}

// Called for every reported entry (used by the lister to stop on errors).
export function onErrorReported(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

export function getErrorLog() {
    return log.slice();
}

// Spinners that stay up too long usually mean a request failed silently.
const spinnerSince = new WeakMap();
let lastSpinnerWarning = 0;
function checkSpinners() {
    const now = Date.now();
    const spinners = document.querySelectorAll('.loadingLoop');
    for (const s of spinners) {
        const rect = s.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible) {
            spinnerSince.delete(s);
            continue;
        }
        const since = spinnerSince.get(s);
        if (since == undefined) {
            spinnerSince.set(s, now);
        }
        else if (now - since > SPINNER_WARN_MS && now - lastSpinnerWarning > 60000) {
            lastSpinnerWarning = now;
            const serverErrors = log.filter(e => e.source == 'server' && now - e.time < 120000);
            const hint = serverErrors.length
                ? `Recent server error: ${serverErrors[serverErrors.length - 1].title}`
                : 'No error was reported. The request may still be queued, or failed without a message. Try Refresh, or leave and reopen this screen.';
            reportError('watchdog', `Still loading after ${Math.round((now - since) / 1000)}s`, hint);
        }
    }
}

// The game's own UI code throws a few harmless errors while the menu boots
// (e.g. its debug file helper reading 'LoadFileAsString' of null). Those are
// logged under Details but don't pop the banner; anything from the mod, and
// any game UI error after the first 30 s, is shown.
const STARTUP_QUIET_MS = 30000;
const loadedAt = Date.now();
function isModStack(err, filename) {
    const text = `${(err && err.stack) || ''} ${filename || ''}`;
    return text.indexOf('/js/mods/pz2qol/') >= 0;
}
function uiErrorOpts(err, filename) {
    const quiet = !isModStack(err, filename) && Date.now() - loadedAt < STARTUP_QUIET_MS;
    return { silent: quiet };
}

export function installErrorCapture() {
    ensureRoot();
    window.addEventListener('error', e => {
        const err = e.error || `${e.message} (${e.filename}:${e.lineno})`;
        reportError('ui', 'UI script error', err, uiErrorOpts(e.error, e.filename));
    });
    window.addEventListener('unhandledrejection', e => {
        reportError('ui', 'UI request failed', e.reason, uiErrorOpts(e.reason));
    });
    if (typeof engine !== 'undefined') {
        // silent: a copy for this page's features; another view shows it
        engine.on('PZ2QoL_Error', (source, title, detail, silent) => reportError(source, title, detail, { silent: silent === true }));
        engine.on('PZ2QoL_Hello', version => {
            console.log(`[PZ2QoL] Lua side v${version} connected`);
        });
    }
    setInterval(checkSpinners, 2000);
}
