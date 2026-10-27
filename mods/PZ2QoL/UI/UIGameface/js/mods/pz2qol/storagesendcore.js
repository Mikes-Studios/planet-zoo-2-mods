// "Find a habitat" (Animal Storage -> zoo): the pure parts, no DOM and no
// engine, so node tests can run them (tests/storagesend.test.js).
//
// What happens in game (storagesend.js, pz2qol.storagesend.lua):
//  1. Animal Storage: one click sends the selection to the zoo with the
//     game's own Send to Zoo event (one game action, as the game's button).
//  2. Back in the park the game would open its Move screen for all of them
//     at once (one destination for every animal). The mod takes those
//     animals instead and places them ONE at a time: for each it asks the
//     game which habitats it allows (facts), picks the best (rankHabitats),
//     sends the game's own Move for that one animal, waits until the game
//     confirms it (a keeper has the transport job), pauses, then the next.
//     A failure is skipped and the run carries on; only Stop ends it.
import { SKIP_TEXT, skipText } from './storagefetchcore.js';

// Why a habitat was chosen, best first.
export const TIER = Object.freeze({ own: 0, parent: 1, species: 2, any: 3 });
export const TIER_TEXT = Object.freeze({
    0: 'its own habitat',
    1: 'with a parent',
    2: 'with its species',
    3: 'a suitable habitat',
});

const CONFIRM_TIMEOUT_MS = 12000;
const CONFIRM_POLL_MS = 600;
const BUSY_WAIT_MS = 10000;
const BUSY_POLL_MS = 500;
export const ERROR_PAUSE_MS = 8000; // after a refused or unconfirmed move online

export function sendButtonLabel(n) {
    return n > 1 ? `Find a habitat (${n})` : 'Find a habitat';
}

// "12,13, 14" -> ['12', '13', '14'] (numeric ids only, no duplicates)
export function parseIdList(s) {
    const out = [];
    for (const part of String(s == null ? '' : s).split(',')) {
        const id = part.trim();
        if (/^\d+$/.test(id) && !out.includes(id)) out.push(id);
    }
    return out;
}

// Why the button can't start a run now ('' when it can).
export function blockedReason({ count = 0, sendAllowed = true, moving = false } = {}) {
    if (!count) return 'Select the animals first (tick them, or use select all).';
    if (moving) return 'The game is already sending these animals.';
    if (!sendAllowed) return "The game can't send this selection to the zoo right now.";
    return '';
}

// The habitats this animal may go to, best first:
//   its own (assigned) habitat, a habitat where a parent lives, one that
//   already holds its species (the biggest group first), then any other
//   habitat the game allows (the least crowded first).
// Only habitats the game allows (ok) and a keeper can reach (reach !== false).
export function rankHabitats(facts) {
    if (!facts || !Array.isArray(facts.habitats)) return [];
    const own = facts.assigned ? String(facts.assigned) : '';
    const parents = new Set((facts.parentHabs || []).map(String));
    const out = [];
    for (const hab of facts.habitats) {
        if (!hab || !hab.ok || hab.reach === false) continue;
        const id = String(hab.id);
        const same = Number(hab.same) || 0;
        const tier = id === own ? TIER.own : parents.has(id) ? TIER.parent : same > 0 ? TIER.species : TIER.any;
        out.push({ id, name: hab.name || `Habitat ${id}`, tier, why: TIER_TEXT[tier], same, total: Number(hab.total) || 0, crowded: hab.crowded === true });
    }
    out.sort((a, b) => a.tier - b.tier
        || (a.crowded - b.crowded)
        || (a.tier === TIER.species ? b.same - a.same : 0)
        || a.total - b.total
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}

// Why an animal is not sent anywhere ('' when it can be).
export function skipReason(facts) {
    if (!facts) return SKIP_TEXT.noanswer;
    if (facts.error) return skipText(facts.error);
    if (facts.gone) return SKIP_TEXT.gone;
    if (facts.alive === false) return SKIP_TEXT.dead;
    if (facts.moving) return SKIP_TEXT.moving;
    if (facts.lt === 'habitat' && facts.assigned) return 'already in a habitat';
    const habs = Array.isArray(facts.habitats) ? facts.habitats : [];
    if (!habs.length) return 'this zoo has no finished habitat';
    if (!habs.some(hb => hb && hb.ok)) return `no habitat accepts ${facts.speciesName || facts.species || 'this species'}`;
    if (!rankHabitats(facts).length) return 'no keeper can reach a suitable habitat';
    return '';
}

export function pickHabitat(facts) {
    const reason = skipReason(facts);
    if (reason) return { hab: null, reason };
    return { hab: rankHabitats(facts)[0], reason: '' };
}

// Is the move confirmed by the game? (a transport job, or already there)
export function moveConfirmed(facts, habId) {
    if (!facts || facts.error) return false;
    if (facts.moving) return true;
    return facts.lt === 'habitat' && String(facts.assigned) === String(habId);
}

// The end of a run: { total, sent, skipped, reasons: [{ text, n }], habitats: [{ name, n }] }
export function summarize(log, total = null) {
    const reasons = new Map();
    const habs = new Map();
    let sent = 0;
    for (const e of log || []) {
        if (e.ok) {
            sent++;
            habs.set(e.habitat, (habs.get(e.habitat) || 0) + 1);
        }
        else {
            reasons.set(e.reason, (reasons.get(e.reason) || 0) + 1);
        }
    }
    const byCount = m => Array.from(m, ([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
    return {
        total: total == null ? (log || []).length : total,
        sent,
        skipped: (log || []).length - sent,
        reasons: byCount(reasons).map(x => ({ text: x.k, n: x.n })),
        habitats: byCount(habs).map(x => ({ name: x.k, n: x.n })),
    };
}

export function summaryText(s) {
    const parts = [`Sent ${s.sent} of ${s.total} to a habitat`];
    if (s.skipped) parts.push(`skipped ${s.skipped}`);
    if (s.total > s.sent + s.skipped) parts.push(`${s.total - s.sent - s.skipped} not tried (stopped)`);
    return parts.join(' · ');
}

// The run. deps:
//   facts(id)            -> Promise<facts|null>  (the game's facts for one animal)
//   status(id)           -> the same without habitats, for the polls (default: facts)
//   move(id, habId)      -> Promise<{ ok, detail }> (ONE move, the game's own)
//   sleep(ms)            -> Promise (should end early on Stop)
//   paceMs()             -> pause after each move (the player's 'moves' pace)
//   online               -> true in a Franchise (or unknown-mode) zoo
//   isStopped()          -> the player pressed Stop
//   onUpdate(state)      -> progress
// Returns the final state.
export async function runPlacement(ids, deps) {
    const d = Object.assign({ online: false, isStopped: () => false, onUpdate: () => {}, paceMs: () => 1500, now: () => Date.now() }, deps);
    const status = d.status || d.facts;
    const state = { running: true, total: ids.length, index: 0, current: null, log: [], finished: false, stopped: false };
    const update = patch => {
        Object.assign(state, patch);
        try {
            d.onUpdate(Object.assign({}, state, { log: state.log.slice() }));
        }
        catch (e) {
            // progress display must never stop the run
        }
    };
    const skip = (id, f, reason) => {
        state.log.push({ id, name: f && f.name || '', species: f && f.species || '', ok: false, reason });
    };
    update({});
    for (let i = 0; i < ids.length; i++) {
        if (d.isStopped()) {
            state.stopped = true;
            break;
        }
        const id = String(ids[i]);
        update({ index: i + 1, current: { id, name: '', habitat: '' } });
        let f = await d.facts(id);
        let pick = pickHabitat(f);
        if (!pick.hab) {
            // nothing was sent to the game: no pause needed
            skip(id, f, pick.reason);
            update({});
            continue;
        }
        // the game is still busy with a server request: wait for it first
        const busySince = d.now();
        let waited = false;
        while (f && f.busy && d.now() - busySince < BUSY_WAIT_MS && !d.isStopped()) {
            await d.sleep(BUSY_POLL_MS);
            f = await status(id);
            waited = true;
        }
        if (d.isStopped()) {
            state.stopped = true;
            break;
        }
        // the habitats may have changed while the game was busy
        if (waited) f = await d.facts(id);
        pick = pickHabitat(f);
        if (!pick.hab) {
            skip(id, f, pick.reason);
            update({});
            continue;
        }
        const hab = pick.hab;
        update({ current: { id, name: f.name || '', species: f.species || '', habitat: hab.name, why: hab.why } });
        let r;
        try {
            r = await d.move(id, hab.id);
        }
        catch (e) {
            r = { ok: false, detail: String(e && e.message || e) };
        }
        if (!r || !r.ok) {
            skip(id, f, `refused: ${(r && r.detail) || 'the game refused the move'}`);
            update({});
            await d.sleep(d.online ? Math.max(ERROR_PAUSE_MS, d.paceMs()) : d.paceMs());
            continue;
        }
        // wait for the game to confirm (a keeper has the job, or it is there)
        const since = d.now();
        let ok = false;
        for (;;) {
            if (moveConfirmed(await status(id), hab.id)) {
                ok = true;
                break;
            }
            // after Stop the sleep returns at once: one last look, then out
            if (d.isStopped() || d.now() - since >= CONFIRM_TIMEOUT_MS) break;
            await d.sleep(CONFIRM_POLL_MS);
        }
        if (!ok && d.isStopped()) {
            skip(id, f, SKIP_TEXT.stopped);
            update({});
            break;
        }
        if (!ok) {
            skip(id, f, SKIP_TEXT.unconfirmed);
            update({});
            await d.sleep(d.online ? Math.max(ERROR_PAUSE_MS, d.paceMs()) : d.paceMs());
            continue;
        }
        state.log.push({ id, name: f.name || '', species: f.species || '', ok: true, habitat: hab.name, why: hab.why });
        update({});
        await d.sleep(d.paceMs());
    }
    if (d.isStopped()) state.stopped = true;
    update({ running: false, finished: true, current: null });
    return Object.assign({}, state, { log: state.log.slice() });
}
