// Kin life: notices about animals growing up, for the Kin alerts
// (kinalerts.js). Pure, no game imports, so it runs under Node tests.
//
// Notification only: nothing here acts. Each notice gets a level from what
// growing up will actually do:
//   action ("Needs you"): the group goes over the game's limit, the
//          youngster will be pushed out of its group (maturation), it could
//          inbreed with a relative, or an adult was pushed out;
//   heads  ("Heads-up"): the group will be exactly full, or a youngster not
//          on contraception joins a full group with a fertile partner;
//   info   (no pop-up, the log only): births, and growing up that changes
//          nothing.
// The data comes from the Lua scan (kincore normalizeSnapshot): a
// juvenile's adultIn / adultAge, an adult's `out`, and per species
// speciesFacts.social { min, max } and .maturation. Whatever is missing is
// skipped; with nothing to judge by, a notice stays info.
import { Sex, compatibleSexes, fertileNow, kinTier, notYet, overcrowdingOn, relationWord } from './kincore.js';

export const LEVELS = {
    action: { rank: 3, label: 'Needs you', toastMs: 60000 },
    heads: { rank: 2, label: 'Heads-up', toastMs: 25000 },
    info: { rank: 1, label: 'Note', toastMs: 0 },
};
export const DEFAULT_HORIZON = 0.5;     // game years: "grows up soon"
const BIRTH_FRACTION = 0.1;             // of the adult age: younger is a birth
const BIRTH_YEARS = 0.3;                // without an adult age
const WATCH_SCANS = 3;                  // scans after growing up that watch for `out`
const GONE_MS = 30 * 60 * 1000;         // a gone animal's notices are forgotten
// what was said about an animal: growing up and becoming able to breed apart
const KINDS = ['birth', 'soon', 'soonBreed', 'adult', 'breed', 'out'];

export function levelRank(l) {
    return (LEVELS[l] || {}).rank || 0;
}

function worse(a, b) {
    return levelRank(b) > levelRank(a) ? b : a;
}

function keyOf(a) {
    return a.guid || 'e' + a.id;
}

// When an animal next grows: { kind: 'adult', years } for a juvenile (from
// the game's adult age, else the species' breeding age), { kind: 'breed',
// years } for an adult not yet able to breed, or null.
export function growthOf(a) {
    if (!a || a.exhibit) return null;
    if (a.juv) {
        if (typeof a.adultIn === 'number') return { kind: 'adult', years: Math.max(0, a.adultIn), source: 'adultAge' };
        if (typeof a.adultAge === 'number' && typeof a.age === 'number') return { kind: 'adult', years: Math.max(0, a.adultAge - a.age), source: 'adultAge' };
        const y = a.fert && a.fert.yearsToMature;
        if (typeof y === 'number') return { kind: 'adult', years: Math.max(0, y), source: 'maturity' };
        return null;
    }
    if (a.fert && a.fert.state === 'young' && typeof a.fert.yearsToMature === 'number') {
        return { kind: 'breed', years: Math.max(0, a.fert.yearsToMature), source: 'maturity' };
    }
    return null;
}

// The adults of a species in a habitat, from the scan (the game counts
// every non-juvenile; shoals and colonies are not in model.groups).
export function habitatAdults(model, habId, species) {
    const bySpecies = model && model.groups && model.groups.get(String(habId));
    const list = (bySpecies && bySpecies.get(species)) || [];
    return list.filter(a => !a.juv && a.alive !== false);
}

const MATURATION_TEXT = {
    males: 'its group drives out grown males',
    females: 'its group drives out grown females',
    all: 'grown animals of this species live alone',
};

// What growing up will do to (phase 'soon') or did to (phase 'now') this
// animal's group. `growing`: every youngster of the same habitat and
// species growing up within the horizon (they all count for the group size).
// -> { level, reasons: [{ code, level, text, contra?, partner? }], skipped: [code] }
export function assessGrowUp(model, a, { growing = null, phase = 'soon', kind = 'adult' } = {}) {
    const facts = (model.speciesFacts || {})[a.species] || {};
    const reasons = [];
    const skipped = [];
    let level = 'info';
    const add = (lvl, code, text, extra) => {
        reasons.push(Object.assign({ code, level: lvl, text }, extra || {}));
        level = worse(level, lvl);
    };
    const adults = habitatAdults(model, a.hab, a.species);
    const others = adults.filter(x => x !== a);
    const soon = phase === 'soon';
    // a) the group size against the game's limit (none with overcrowding off)
    const crowding = overcrowdingOn(model);
    const social = crowding && facts.social && typeof facts.social.max === 'number' ? facts.social : null;
    let atLimit = false;
    if (crowding && !social) skipped.push('social');
    else if (social) {
        const joining = soon && kind === 'adult' ? (growing || [a]).filter(x => x.juv).length : 0;
        const total = adults.length + joining;
        atLimit = total >= social.max;
        if (kind === 'adult') {
            if (total > social.max) add('action', 'group', `The group ${soon ? 'will have' : 'now has'} ${total} adults; the game allows ${social.max} here.`);
            else if (total === social.max) add('heads', 'groupFull', `The group ${soon ? 'will be' : 'is now'} at its limit (${social.max} adults).`);
        }
    }
    // b) maturation: the group drives out grown young (contraception does not help)
    if (kind === 'adult') {
        const mat = facts.maturation;
        if (!mat) skipped.push('maturation');
        else if (mat !== 'none' && others.length > 0) {
            const hit = mat === 'all' || (mat === 'males' && a.sex === Sex.Male) || (mat === 'females' && a.sex === Sex.Female);
            if (hit) add('action', 'maturation', `${a.name} ${soon ? 'will likely be' : 'may be'} pushed out of the group: ${MATURATION_TEXT[mat]}.`);
        }
    }
    // c) a relative it could breed with once grown (a 'future' pair)
    if (soon) {
        const pairs = ((model.byAnimal && model.byAnimal.get(a.id)) || []).filter(p => p.severity === 'future');
        const mine = pairs.filter(p => {
            const other = p.a === a ? p.b : p.a;
            return notYet(a) || !notYet(other);
        });
        if (mine.length) {
            const other = mine[0].a === a ? mine[0].b : mine[0].a;
            const rel = a.guid && other.guid && model.ped ? model.ped.relation(a.guid, other.guid) : null;
            const word = rel ? relationWord(rel, other.sex) : 'relative';
            const more = mine.length > 1 ? ` (and ${mine.length - 1} more relative${mine.length > 2 ? 's' : ''})` : '';
            add('action', 'kin', `${other.name} is ${a.name}'s ${word}${more}: they could inbreed once ${a.name} can breed.`, { contra: a, partner: other });
        }
    }
    // e) not on contraception, the group is full, and an unrelated fertile partner is there
    if (social && atLimit && !a.contra && !reasons.some(r => r.code === 'kin')) {
        const partner = others.find(x => {
            if (!compatibleSexes(a, x) || x.contra || !fertileNow(x)) return false;
            const rel = a.guid && x.guid && model.ped ? model.ped.relation(a.guid, x.guid) : null;
            return !rel || kinTier(model, rel) === 'distant';
        });
        if (partner) add('heads', 'breedFull', `${a.name} is not on contraception and the group is full: young from ${a.name} and ${partner.name} would overcrowd it.`, { contra: a, partner });
    }
    return { level, reasons, skipped };
}

// ------------------------------------------------------------- events

// The memory of one page: what was already said (once per animal), the
// animals that just grew up (watched for being pushed out), and when each
// animal was last seen.
export function createLifeState() {
    return { notified: new Map(), watch: new Map(), lastSeen: new Map() };
}

// The notices between two scans, grouped per habitat, species and kind:
// [{ kind: 'birth'|'soon'|'adult'|'out', level, hab, species, animals,
//    reasons, contra: [animal], years, settle }], worst first.
// With no previous scan (a park just loaded, or the zoo changed) it only
// remembers what is coming ("settle": soon notices flagged settle, no
// births, no grown-up or pushed-out notices).
export function lifeEvents(prev, next, { horizon = DEFAULT_HORIZON, state = createLifeState(), now = Date.now() } = {}) {
    if (!next || !next.animals) return [];
    const settle = !prev;
    const said = (kind, a) => state.notified.has(`${kind}:${keyOf(a)}`);
    const say = (kind, a) => state.notified.set(`${kind}:${keyOf(a)}`, now);
    for (const a of next.animals.values()) state.lastSeen.set(keyOf(a), now);
    for (const [k, t] of state.lastSeen) {
        if (now - t <= GONE_MS) continue;
        state.lastSeen.delete(k);
        state.watch.delete(k);
        for (const kind of KINDS) state.notified.delete(`${kind}:${k}`);
    }
    const before = new Map();
    if (prev && prev.animals) for (const a of prev.animals.values()) before.set(keyOf(a), a);
    const groups = new Map();
    const push = (kind, a, level, reasons, extra = {}) => {
        const gk = `${kind}|${a.hab}|${a.species}`;
        let g = groups.get(gk);
        if (!g) groups.set(gk, g = { kind, level: 'info', hab: a.hab, species: a.species, animals: [], reasons: [], contra: [], years: null, settle });
        g.animals.push(a);
        g.level = worse(g.level, level);
        for (const r of reasons) {
            if (!g.reasons.some(x => x.code === r.code && x.text === r.text)) g.reasons.push(r);
            if (r.contra && !r.contra.contra && !g.contra.includes(r.contra)) g.contra.push(r.contra);
        }
        if (typeof extra.years === 'number') g.years = g.years == null ? extra.years : Math.min(g.years, extra.years);
    };
    for (const [, bySpecies] of next.groups || []) {
        for (const [, list] of bySpecies) {
            // 1. births: a juvenile new to the zoo and very young (older ones arrived)
            if (!settle) {
                for (const a of list) {
                    if (!a.juv || before.has(keyOf(a)) || said('birth', a) || typeof a.age !== 'number') continue;
                    const limit = typeof a.adultAge === 'number' ? Math.max(a.adultAge * BIRTH_FRACTION, 0.05) : BIRTH_YEARS;
                    if (a.age < limit) {
                        say('birth', a);
                        push('birth', a, 'info', []);
                    }
                }
            }
            // 2. grows up soon (within the horizon)
            const growing = [];
            const growth = new Map();
            for (const a of list) {
                const g = growthOf(a);
                if (g && g.years <= horizon) {
                    growing.push(a);
                    growth.set(a, g);
                }
            }
            for (const a of growing) {
                const g = growth.get(a);
                const key = g.kind === 'breed' ? 'soonBreed' : 'soon';
                if (said(key, a)) continue;
                say(key, a);
                const r = assessGrowUp(next, a, { growing, phase: 'soon', kind: g.kind });
                push('soon', a, r.level, r.reasons, { years: g.years });
            }
            if (settle) continue;
            // 3. grew up since the last scan: the same checks with today's counts
            for (const a of list) {
                const p = before.get(keyOf(a));
                if (!p || a.juv) continue;
                const kind = p.juv ? 'adult' : (p.fert && p.fert.state === 'young' && fertileNow(a)) ? 'breed' : null;
                if (!kind || said(kind, a)) continue;
                say(kind, a);
                if (kind === 'adult') state.watch.set(keyOf(a), WATCH_SCANS + 1);
                const r = assessGrowUp(next, a, { phase: 'now', kind });
                push('adult', a, r.level, r.reasons);
            }
            // 4. pushed out of the group: right after growing up (any reason),
            //    or a newly rejected adult (too many adults, sex ratio)
            for (const a of list) {
                if (a.juv || !a.out || said('out', a)) continue;
                const watched = (state.watch.get(keyOf(a)) || 0) > 0;
                const p = before.get(keyOf(a));
                const fresh = (a.out === 'pop' || a.out === 'sex') && (!p || p.out !== a.out);
                if (!watched && !fresh) continue;
                say('out', a);
                push('out', a, 'action', [{ code: 'out_' + a.out, level: 'action', text: outText(next, a) }]);
            }
        }
    }
    if (!settle) {
        for (const [k, n] of state.watch) {
            if (n <= 1) state.watch.delete(k);
            else state.watch.set(k, n - 1);
        }
    }
    return Array.from(groups.values()).sort((x, y) => levelRank(y.level) - levelRank(x.level));
}

function outText(model, a) {
    const facts = (model.speciesFacts || {})[a.species] || {};
    switch (a.out) {
        case 'pop': return `${a.name} was pushed out of the group: too many adults for the habitat.`;
        case 'mat': return `${a.name} was pushed out of the group: ${MATURATION_TEXT[facts.maturation] || 'grown young leave the group'} (maturation).`;
        case 'sex': return `${a.name} was pushed out of the group: too many of one sex.`;
        default: return `${a.name} is an outsider in the group now.`;
    }
}

// ------------------------------------------------------------- timing

// Game years per real minute: the median age change of the animals in both
// scans. null when it cannot be told (fewer than 3 animals, paused game).
export function ageRate(prev, next, dtMs) {
    if (!prev || !next || !(dtMs > 0)) return null;
    const before = new Map();
    for (const a of prev.animals.values()) if (typeof a.age === 'number') before.set(keyOf(a), a.age);
    const rates = [];
    for (const a of next.animals.values()) {
        const b = before.get(keyOf(a));
        if (typeof a.age === 'number' && typeof b === 'number') rates.push((a.age - b) / (dtMs / 60000));
    }
    if (rates.length < 3) return null;
    rates.sort((x, y) => x - y);
    const m = rates.length % 2 ? rates[(rates.length - 1) / 2] : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
    return m > 0 ? m : null;
}

// A steady rate from the last few samples (within 30 % of each other), or null.
export function stableRate(samples) {
    const list = (samples || []).filter(r => typeof r === 'number' && r > 0).slice(-4);
    if (list.length < 3) return null;
    const lo = Math.min(...list), hi = Math.max(...list);
    if (hi > lo * 1.3) return null;
    const s = list.slice().sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// "in about 4 min" (with a steady rate) or "in about 0.3 years".
export function whenText(years, rate) {
    if (typeof years !== 'number') return 'soon';
    if (years <= 0.01) return 'any moment now';
    if (rate > 0) {
        const min = years / rate;
        if (min < 1) return 'within a minute';
        return `in about ${Math.round(min)} min`;
    }
    return `in about ${years < 1 ? years.toFixed(1) : Math.round(years)} year${years >= 0.95 && years < 1.5 ? '' : 's'}`;
}

// Title and text for one notice. opts: { place, species (display name), rate }
export function describeEvent(ev, { place = '', species = '', rate = null } = {}) {
    const n = ev.animals.length;
    const one = ev.animals[0];
    const where = [place, species].filter(Boolean).join(' · ');
    let what;
    switch (ev.kind) {
        case 'birth':
            what = n === 1 ? `${one.name} was born` : `${n} young were born`;
            break;
        case 'soon': {
            const breed = ev.animals.every(a => !a.juv);
            const when = whenText(ev.years, rate);
            what = n === 1 ? `${one.name} ${breed ? 'can breed' : 'grows up'} ${when}` : `${n} young ${breed ? 'can breed' : 'grow up'} soon (the first ${when})`;
            break;
        }
        case 'adult':
            what = n === 1 ? `${one.name} has grown up` : `${n} young have grown up`;
            break;
        default:
            what = n === 1 ? `${one.name} was pushed out of the group` : `${n} animals were pushed out of the group`;
    }
    let text = ev.reasons.map(r => r.text).join(' ');
    if (!text && (ev.kind === 'soon' || ev.kind === 'adult')) text = 'Nothing to do as far as Kin can tell.';
    return { title: where ? `${where}: ${what}` : what, text };
}
