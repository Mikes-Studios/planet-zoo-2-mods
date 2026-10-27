// Trade shortcuts, pure helpers (no game imports, so node tests can load them).
// See tradejump.js for the runtime and pz2qol.tradejump.lua for the Lua side.
import { normSpecies } from './scores.js';

export { normSpecies };

export const PENDING_MAX_MS = 10 * 60 * 1000; // a storage filter older than this is dropped
export const EMPTY_STORAGE_WAIT_MS = 3000;    // storage shown with no rows: apply after this anyway

// Why the Storage / Market buttons can't be used right now ('' = they can).
// s: { engine, hasBuilding, hubDisabled, planRunning, sendRunning }
export function tradeBlockReason(s = {}) {
    if (s.engine === false) return 'Not available here';
    if (s.hasBuilding === false) return 'Build a trade centre to use Market & Storage';
    if (s.hubDisabled) return "The hub can't be opened right now";
    if (s.planRunning) return 'A move plan is running';
    if (s.sendRunning) return 'Animals from storage are still being placed';
    return '';
}

// The Lua answer to PZ2QoL_TradeCounts: '{"ok":true,"mode":"franchise",
// "bySpecies":{"Lion":{"m":2,"f":3}}}' -> { ok, mode, bySpecies } keyed by
// normSpecies, or null when it can't be read.
export function parseCounts(json) {
    let raw;
    try {
        raw = typeof json === 'string' ? JSON.parse(json) : json;
    }
    catch (e) {
        return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const bySpecies = {};
    const src = raw.bySpecies && typeof raw.bySpecies === 'object' ? raw.bySpecies : {};
    for (const k of Object.keys(src)) {
        const v = src[k] || {};
        const m = Number(v.m), f = Number(v.f);
        if (!Number.isFinite(m) || !Number.isFinite(f) || m < 0 || f < 0) continue;
        bySpecies[normSpecies(k)] = { m: Math.floor(m), f: Math.floor(f) };
    }
    const out = { ok: raw.ok === true, mode: typeof raw.mode === 'string' ? raw.mode : 'unknown', bySpecies };
    // the trade centre (Bring to the trade centre): has one, used / max
    if (typeof raw.tc === 'boolean') out.tc = raw.tc;
    const now = Number(raw.tcNow), max = Number(raw.tcMax);
    if (raw.tcNow != null && raw.tcMax != null && Number.isFinite(now) && Number.isFinite(max) && now >= 0 && max >= 0) {
        out.tcNow = Math.floor(now);
        out.tcMax = Math.floor(max);
    }
    return out;
}

// One species' adults in storage as a short line. c: { m, f } or null.
// want: 'm' | 'f' for one sex only. '' when unknown (the line is hidden).
export function countsText(c, want) {
    if (!c || !Number.isFinite(c.m) || !Number.isFinite(c.f)) return '';
    if (want === 'm' || want === 'f') {
        const n = want === 'm' ? c.m : c.f;
        const word = want === 'm' ? 'male' : 'female';
        return n ? `${n} adult ${word}${n === 1 ? '' : 's'} in storage` : `No adult ${word}s in storage`;
    }
    if (!c.m && !c.f) return 'No adults in storage';
    return `${c.m}♂ ${c.f}♀ adult${c.m + c.f === 1 ? '' : 's'} in storage`;
}

// The hub page's next step for a pending storage filter p ({ seq, species, at }).
// o: { now, storageVisible, rowCount, visibleSince } (visibleSince: when
// Storage came on screen, 0 when it is not).
// 'expire' (too old), 'apply' (Storage is on screen with its rows, or has
// been for 3 s with none), else 'wait'.
export function pendingStep(p, o = {}) {
    if (!p) return 'wait';
    const now = o.now || 0;
    if (now - (p.at || 0) > PENDING_MAX_MS) return 'expire';
    if (!o.storageVisible) return 'wait';
    if ((o.rowCount || 0) > 0) return 'apply';
    if (o.visibleSince && now - o.visibleSince >= EMPTY_STORAGE_WAIT_MS) return 'apply';
    return 'wait';
}

// a mate's genes travel as 48 letters: these four strands, 12 single-letter alleles each
const GENE_KEYS = ['F', 'I', 'S', 'L'];
// a harem: the male is judged by his average over every female he fathers with
const MAX_MATES = 24;

function packGenes(genes) {
    const parts = GENE_KEYS.map(k => genes && genes[k]);
    return parts.every(s => typeof s === 'string' && /^[A-Za-z]{12}$/.test(s)) ? parts.join('') : null;
}

function unpackGenes(text) {
    if (!/^[A-Za-z]{48}$/.test(text || '')) return null;
    const out = {};
    GENE_KEYS.forEach((k, i) => { out[k] = text.slice(i * 12, i * 12 + 12); });
    return out;
}

// A notice's Market extras as one text Lua hands over (it lets only letters,
// digits, '=' and ';' through): "sex=f;dim=48;mate=<48 letters>;calf=61;strict=1".
// strict: CC listings with fertility above 0% only, and the ones whose
// calves fall under the floor hidden, not faded
export function formatTradeExtra({ sex = '', dimBelow = null, mates = [], floor = null, strict = false } = {}) {
    const parts = [];
    if (sex === 'm' || sex === 'f') parts.push(`sex=${sex}`);
    if (Number.isFinite(dimBelow) && dimBelow > 0) parts.push(`dim=${Math.round(dimBelow)}`);
    for (const m of (mates || []).map(packGenes).filter(Boolean).slice(0, MAX_MATES)) parts.push(`mate=${m}`);
    if (Number.isFinite(floor)) parts.push(`calf=${Math.round(floor)}`);
    if (strict) parts.push('strict=1');
    return parts.join(';');
}

export function parseTradeExtra(text) {
    const out = { sex: '', dimBelow: null, mates: [], floor: null, strict: false };
    for (const part of String(text || '').split(';')) {
        const [k, v] = part.split('=');
        if (k === 'sex' && (v === 'm' || v === 'f')) out.sex = v;
        if (k === 'dim' && /^\d+$/.test(v || '')) out.dimBelow = Number(v);
        if (k === 'mate' && unpackGenes(v)) out.mates.push(unpackGenes(v));
        if (k === 'calf' && /^\d+$/.test(v || '')) out.floor = Number(v);
        if (k === 'strict' && v === '1') out.strict = true;
    }
    return out;
}

// The game's own Market filters a strict hand-over sets (as the CC and
// Breeders presets send them): CC listings only, and no 0% fertility, which
// never breeds. Fertility and immunity minimums above that would hide good
// fathers: a calf's fertility and immunity come from how unlike its
// parents' strands are, not from either parent's own percent.
export const STRICT_MARKET_EVENTS = [['FilterCash', false], ['FilterCredits', true], ['FilterFertilityMin', 5]];
