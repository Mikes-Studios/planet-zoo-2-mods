// Detailed debug log (debug builds only; reference/debugging.md "Detailed
// log"). One line per event, with values, so an agent can read a play
// session back and follow every animal through the Market desk and the
// lister:
//
//   js#<seq>@<HH:MM:SS.mmm> <area> <event> k=v k=v ...
//
// dlog(area, event, data) keeps the line in a ring buffer (the last
// LOG_MAX) and sends it to Lua in batches (PZ2QoL_Log), which spells it into
// dbg\trace.log next to its own lines (Core:LogText). Lua says whether the
// build has the log (PZ2QoL_LogState 'on' / 'off'); until it does, lines
// wait (at most EARLY_MAX); after 'off' (a release build) every call returns
// at once. Nothing here can throw into the caller, and nothing is sent to
// the game but the log text.
//
// Ctrl+Shift+L opens a small panel with the newest lines (the fallback when
// the file channel is missing).

export const LOG_MAX = 2000;         // lines kept in memory
const EARLY_MAX = 500;               // lines kept before Lua said on/off
const BATCH_MS = 150;                // how often lines go to Lua
const BATCH_MAX = 100;               // lines per batch (Lua takes 200)
const RATE_MAX = 400;                // lines per second sent; more are counted, then reported
const VALUE_MAX = 160;               // characters per value
const LINE_MAX = 900;                // characters per line (Lua's cap)
const LEAD = ['run', 'i', 'guid', 'key', 'step'];
// keys never written: no account, session or personal data
const SENSITIVE = /token|password|account|steam|session|email|user|auth/i;

let enabled = null;                  // null: not known yet; true / false from Lua
let seq = 0;
const ring = [];                     // { seq, at, area, event, text }
let early = [];                      // lines waiting for Lua's answer
let queue = [];                      // lines waiting for the next batch
let timer = null;
let rateStart = 0;
let rateCount = 0;
let dropped = 0;
let clock = () => Date.now();
let sender = null;                   // test hook: replaces engine.trigger
let installed = false;
const priceSeen = new Map();         // logPriceDecision dedupe: id -> signature

function pad(n, w = 2) {
    return String(n).padStart(w, '0');
}

export function timeText(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function cut(s, max) {
    return s.length > max ? s.slice(0, max) + '~' : s;
}

function plain(s) {
    // printable ASCII only (the log channel spells bytes 0x20..0x7e)
    return String(s).replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7e]/g, '?');
}

// One value as the log writes it. depth: tables nest one level.
export function formatValue(v, depth = 0) {
    try {
        if (v === null) return 'null';
        if (v === undefined) return 'nil';
        if (typeof v === 'number') {
            if (!isFinite(v)) return 'nan';
            return Number.isInteger(v) ? String(v) : String(+v.toPrecision(4));
        }
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'bigint') return String(v);
        if (typeof v === 'function') return '[fn]';
        if (typeof v === 'object') {
            if (depth >= 1) return '[...]';
            if (v instanceof Map) v = Object.fromEntries(v);
            if (v instanceof Set) v = Array.from(v);
            const parts = [];
            if (Array.isArray(v)) {
                for (let i = 0; i < v.length; i++) {
                    if (i >= 12) {
                        parts.push(`...${v.length}`);
                        break;
                    }
                    parts.push(formatValue(v[i], depth + 1));
                }
            }
            else {
                let n = 0;
                for (const k of Object.keys(v)) {
                    if (++n > 12) {
                        parts.push('...');
                        break;
                    }
                    if (SENSITIVE.test(k)) continue;
                    parts.push(`${k}:${formatValue(v[k], depth + 1)}`);
                }
            }
            return cut(plain(`[${parts.join(',')}]`), VALUE_MAX);
        }
        let s = cut(plain(v), VALUE_MAX);
        if (s === '' || /[\s="]/.test(s)) s = `"${s.replace(/"/g, "'")}"`;
        return s;
    }
    catch (e) {
        return '?';
    }
}

// " k=v k=v" (run, i, guid, key, step first, then as written; undefined
// left out), " <text>" for a non-object, "" for none.
export function formatData(data) {
    try {
        if (data === undefined || data === null) return '';
        if (typeof data !== 'object' || Array.isArray(data)) return ' ' + formatValue(data);
        const out = [];
        for (const k of LEAD) if (data[k] !== undefined) out.push(`${k}=${formatValue(data[k])}`);
        for (const k of Object.keys(data)) {
            if (LEAD.includes(k) || data[k] === undefined) continue;
            out.push(SENSITIVE.test(k) ? `${k}=[redacted]` : `${k}=${formatValue(data[k])}`);
        }
        return out.length ? ' ' + out.join(' ') : '';
    }
    catch (e) {
        return ' [unformattable]';
    }
}

function word(s, fallback) {
    const w = plain(s == undefined ? '' : s).replace(/\s+/g, '_');
    return w || fallback;
}

export function formatLine(entry) {
    return cut(`js#${entry.seq}@${timeText(entry.at)} ${entry.area} ${entry.event}${entry.text}`, LINE_MAX);
}

function send(text) {
    if (sender) {
        sender(text);
        return;
    }
    if (typeof engine !== 'undefined') engine.trigger('PZ2QoL_Log', text);
}

function flush() {
    timer = null;
    if (enabled !== true || !queue.length) return;
    const batch = queue.slice(0, BATCH_MAX);
    queue = queue.slice(BATCH_MAX);
    try {
        send(batch.join('\n'));
    }
    catch (e) {
        // the log never breaks the page
    }
    if (queue.length) schedule();
}

function schedule() {
    if (timer == null) timer = setTimeout(flush, BATCH_MS);
}

function enqueue(line) {
    const now = clock();
    if (now - rateStart >= 1000) {
        if (dropped) {
            queue.push(cut(`js#${++seq}@${timeText(now)} log dropped n=${dropped} reason=rate`, LINE_MAX));
            dropped = 0;
        }
        rateStart = now;
        rateCount = 0;
    }
    if (++rateCount > RATE_MAX) {
        dropped++;
        return;
    }
    queue.push(line);
    schedule();
}

// The one call every feature uses. area: the feature, one word (desk,
// lister, market, ui...); event: one word; data: a flat object (or a
// value). Never throws.
export function dlog(area, event, data) {
    if (enabled === false) return;
    try {
        const entry = { seq: ++seq, at: clock(), area: word(area, 'ui'), event: word(event, 'event'), text: formatData(data) };
        ring.push(entry);
        if (ring.length > LOG_MAX) ring.splice(0, ring.length - LOG_MAX);
        const line = formatLine(entry);
        if (enabled === true) enqueue(line);
        else {
            early.push(line);
            if (early.length > EARLY_MAX) early.splice(0, early.length - EARLY_MAX);
        }
        if (panel && panel.open) renderPanel();
    }
    catch (e) {
        // never into the caller
    }
}

// Lua's answer: 'on' (a debug build with the log channel) or 'off'.
export function setLogState(state) {
    try {
        if (state === 'on' || state === true) {
            const was = enabled;
            enabled = true;
            // the early lines are capped already (EARLY_MAX); the rate limit is for live bursts
            if (was !== true && early.length) {
                queue.push(...early);
                schedule();
            }
            early = [];
        }
        else {
            enabled = false;
            early = [];
            queue = [];
            ring.length = 0;
            priceSeen.clear();
        }
    }
    catch (e) {
        // ignore
    }
}

export function isLogEnabled() {
    return enabled;
}

// The newest n lines (all by default), oldest first.
export function getLogLines(n = LOG_MAX, area = '') {
    const list = area ? ring.filter(e => e.area === area) : ring;
    return list.slice(Math.max(0, list.length - n)).map(formatLine);
}

export function logText(n = LOG_MAX) {
    return getLogLines(n).join('\n');
}

// ------------------------------------------------------------- pricing

// The inputs of one price decision, compact (recommendPrice's answer).
export function priceFields(advice) {
    if (!advice || typeof advice !== 'object') return { price: 'none' };
    const c = advice.comps || {};
    const f = {
        price: advice.price ?? 'none',
        base: advice.basePrice,
        conf: advice.confidence,
        method: advice.method,
        comps: Array.isArray(c.list) ? c.list.length : undefined,
        tier: c.tier,
        medal: advice.medal,
        medalMode: c.medalMode,
        sameMedal: c.sameCount,
        morph: advice.morph || undefined,
        morphMode: c.morphMode,
        morphCount: c.morphCount,
        guessed: c.guessed || (c.morphFactor && c.morphFactor.guessed) || undefined,
        score: advice.score,
        market: advice.marketPrice,
        game: advice.gameValue,
        offset: advice.offset || undefined,
        reason: advice.reason,
    };
    return f;
}

// Logs a price decision once per animal and outcome (renders call this for
// every row; only a changed price, confidence or method writes again).
export function logPriceDecision(where, id, advice, extra = {}) {
    if (enabled === false) return;
    try {
        const f = priceFields(advice);
        const sig = `${f.price}|${f.conf}|${f.method}|${f.comps}|${f.game}`;
        const key = `${where}|${id}`;
        if (priceSeen.get(key) === sig) return;
        priceSeen.set(key, sig);
        if (priceSeen.size > 5000) priceSeen.clear();
        dlog('pricing', 'decision', Object.assign({ where, id }, extra, f));
    }
    catch (e) {
        // ignore
    }
}

// --------------------------------------------------------------- panel

let panel = null; // { root, list, info, open, offset, area }
const PANEL_LINES = 36;

// inline styles (Gameface needs display set explicitly; no stylesheet to load)
const STYLE = {
    PZ2QoL_dlog: 'position:fixed;left:1rem;top:1rem;width:70rem;max-width:96vw;z-index:100000;display:none;flex-direction:column;'
        + 'background-color:rgba(10,14,20,0.94);border:1px solid #6c7a89;border-radius:0.4rem;padding:0.5rem;pointer-events:auto;',
    PZ2QoL_dlogHead: 'display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;margin-bottom:0.4rem;',
    PZ2QoL_dlogTitle: 'display:flex;color:#ffffff;font-size:1.1rem;font-weight:bold;margin-right:0.8rem;',
    PZ2QoL_dlogInfo: 'display:flex;flex-grow:1;color:#b8c4d0;font-size:0.85rem;margin-right:0.5rem;',
    PZ2QoL_dlogBtn: 'display:flex;color:#ffffff;font-size:0.85rem;padding:0.15rem 0.55rem;margin-left:0.3rem;border:1px solid #6c7a89;'
        + 'border-radius:0.3rem;background-color:#26313d;cursor:pointer;',
    PZ2QoL_dlogList: 'display:flex;flex-direction:column;overflow:hidden;',
    PZ2QoL_dlogLine: 'display:flex;color:#d8e2ec;font-family:monospace;font-size:0.72rem;line-height:1.05rem;white-space:nowrap;overflow:hidden;',
};

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) {
        e.className = cls;
        if (STYLE[cls]) e.setAttribute('style', STYLE[cls]);
    }
    if (text != undefined) e.textContent = text;
    return e;
}

function button(label, onClick) {
    const b = el('div', 'PZ2QoL_dlogBtn', label);
    b.addEventListener('click', e => {
        e.stopPropagation();
        try {
            onClick();
        }
        catch (err) {
            // ignore
        }
    });
    return b;
}

function copyText(text) {
    // Gameface has no clipboard API in the game's own UI (guess: none works)
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            return true;
        }
    }
    catch (e) {
        // fall through
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        ta.remove();
        return !!ok;
    }
    catch (e) {
        return false;
    }
}

function renderPanel() {
    if (!panel) return;
    const lines = getLogLines(LOG_MAX, panel.area);
    const end = Math.max(0, lines.length - panel.offset);
    const shown = lines.slice(Math.max(0, end - PANEL_LINES), end);
    while (panel.list.firstChild) panel.list.removeChild(panel.list.firstChild);
    for (const l of shown) panel.list.appendChild(el('div', 'PZ2QoL_dlogLine', l));
    const state = enabled === true ? 'writing to dbg/trace.log' : enabled === false ? 'off (release build)' : 'waiting for the game';
    panel.info.textContent = `${lines.length} lines${panel.area ? ` (${panel.area})` : ''}, ${state}${panel.offset ? `, ${panel.offset} newer hidden` : ''}`;
    panel.areaBtn.textContent = `Area: ${panel.area || 'all'}`;
}

export function showLogPanel(open = true) {
    try {
        if (!panel) {
            if (!open) return;
            const root = el('div', 'PZ2QoL_dlog');
            const head = el('div', 'PZ2QoL_dlogHead');
            const title = el('div', 'PZ2QoL_dlogTitle', 'Debug log');
            const info = el('div', 'PZ2QoL_dlogInfo', '');
            panel = { root, list: null, info, open: false, offset: 0, area: '', areaBtn: null };
            panel.areaBtn = button('Area: all', () => {
                const areas = [''].concat(Array.from(new Set(ring.map(e => e.area))).sort());
                panel.area = areas[(areas.indexOf(panel.area) + 1) % areas.length];
                panel.offset = 0;
                renderPanel();
            });
            const older = button('Older', () => {
                panel.offset += PANEL_LINES;
                renderPanel();
            });
            const newer = button('Newer', () => {
                panel.offset = Math.max(0, panel.offset - PANEL_LINES);
                renderPanel();
            });
            const copy = button('Copy', () => {
                copy.textContent = copyText(logText()) ? 'Copied' : 'No clipboard';
                setTimeout(() => {
                    copy.textContent = 'Copy';
                }, 1500);
            });
            const clear = button('Clear', () => {
                ring.length = 0;
                panel.offset = 0;
                renderPanel();
            });
            const close = button('Close', () => showLogPanel(false));
            for (const c of [title, info, panel.areaBtn, older, newer, copy, clear, close]) head.appendChild(c);
            panel.list = el('div', 'PZ2QoL_dlogList');
            root.appendChild(head);
            root.appendChild(panel.list);
            document.body.appendChild(root);
        }
        panel.open = !!open;
        panel.root.classList.toggle('open', panel.open);
        panel.root.style.display = panel.open ? 'flex' : 'none';
        if (panel.open) renderPanel();
    }
    catch (e) {
        // ignore
    }
}

export function isLogPanelOpen() {
    return !!panel && panel.open;
}

// Listens for Lua's on/off and the panel's hotkey. Safe to call twice.
export function installDebugLog() {
    if (installed) return true;
    installed = true;
    try {
        if (typeof engine !== 'undefined') {
            engine.on('PZ2QoL_LogState', state => setLogState(state));
            // Lua also says it when the view is ready; ask in case that came
            // first (a debug build answers; a release build sends 'off' there)
            const ask = () => {
                if (enabled === null) engine.trigger('PZ2QoL_LogHello');
            };
            setTimeout(ask, 500);
            setTimeout(ask, 5000);
        }
    }
    catch (e) {
        // no engine: lines stay in memory
    }
    try {
        document.addEventListener('keydown', e => {
            if (enabled === false) return;
            if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l' || e.keyCode === 76)) {
                showLogPanel(!isLogPanelOpen());
            }
        });
    }
    catch (e) {
        // ignore
    }
    try {
        if (typeof window !== 'undefined') window.PZ2QoL_debugLog = { lines: getLogLines, show: showLogPanel, text: logText };
    }
    catch (e) {
        // ignore
    }
    dlog('ui', 'page_start', { page: typeof location !== 'undefined' ? String(location.pathname || '').split('/').pop() : '' });
    return true;
}

// test hooks
export function _configureForTests({ now, send: fn } = {}) {
    if (now) clock = now;
    if (fn !== undefined) sender = fn;
}

export function _flushForTests() {
    if (timer != null) clearTimeout(timer);
    timer = null;
    while (queue.length && enabled === true) flush();
}

export function _resetForTests() {
    enabled = null;
    seq = 0;
    ring.length = 0;
    early = [];
    queue = [];
    if (timer != null) clearTimeout(timer);
    timer = null;
    rateStart = 0;
    rateCount = 0;
    dropped = 0;
    clock = () => Date.now();
    sender = null;
    priceSeen.clear();
}
