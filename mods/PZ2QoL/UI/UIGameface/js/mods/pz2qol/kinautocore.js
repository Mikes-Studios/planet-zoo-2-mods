// Auto mode, one species at a time: on the schedule the player chose on the
// Species board, Thin out (if chosen) and then the species' Breeding
// programme are worked out with the settings saved for it, and the moves
// run one at a time like the board's Execute (kinauto.js). Pure, no game
// imports (Node tests). Design: docs/DESIGN-autopilot.md section 16.
//
// Never moved by Auto mode: animals the player marked "hands off", animals
// the player moved by hand (for a while), pregnant females, animals on the
// move. Animals Auto mode sent to the trade centre stay there (the
// programme never brings them back), so Thin out and the programme can't
// trade an animal back and forth.
//
// Why it settles: on a zoo that does not change, the programme's plan only
// ever raises its own score (every move it keeps gains something), and
// Thin out only takes animals away. So runs stop finding work until
// something changes in the zoo (a birth, a death, the player).
import { TRADE, canMove, isPinned, moveText, mustHouse, simulatePlan } from './kinboardcore.js';
import { PROGRAMME_DEFAULT_STEP, PROGRAMME_SEARCH, PROGRAMME_STEPS, SELL_MARGIN, YOUNG_MARGIN, canEverBreed, isBreeder, kinPair, noFertility, ownGeneScore, planProgramme, adultBackMoves, relatedPair, weakBreeders, youngBackMoves } from './kinprogramme.js';
import { growthOf } from './kinlife.js';
import { FILL_STEPS, cullPlan } from './kincull.js';
import { Sex, bestOffspringScore, buildKinModel, calfScores, isCollective, ownGrades, withStored } from './kincore.js';
import { applyTuning } from './kinprogtune.js';
import { ELDERLY_WARNING_YEARS, nearingElderly, pastSelling, sellsBeforeElderly, storedAgeOf, yearsToElderly } from './kinageing.js';

// How often a species' run comes round, in months of the park's calendar
// (12 a year, 3 a season): game time, so it stops while the game is paused
// and runs faster at 2x and 5x.
export const EVERY_CHOICES = Object.freeze([1, 3, 6, 12]);

// One species' settings, as kept per zoo (kinautoledger.js).
export const SPECIES_DEFAULTS = Object.freeze({
    on: false,
    every: 3,                   // EVERY_CHOICES (months): a season
    step: PROGRAMME_DEFAULT_STEP, // PROGRAMME_STEPS: Fewest moves .. Best genetics
    trade: true,                // the programme may bring breeders from the trade centre
    thin: true,                 // then Thin out the habitats over their room
    fill: 'balanced',           // Thin out's fill level (FILL_STEPS)
});

export const AUTO_LIMITS = Object.freeze({
    manualYears: 2,             // how long an animal the player moved is remembered as moved by hand (years of the park's calendar)
    cooldownYears: 1,           // an animal Auto mode moved stays put this long: as births and
                                // ageing change the zoo, the programme's best layout shifts, and
                                // without this it would move some animals back and forth
    reversalYears: 1,           // a move back to where it left within this counts as a reversal
    reversalsToStop: 2,         // that many reversals in the window: Auto stops for the species
    settleMs: 60000,            // after a zoo loads: watch this long first
    scheduledGapMs: 60000,      // a species' scheduled runs at most this often in real time: at
                                // 20x the park's months pass twenty times faster; a birth, a young
                                // one growing up or an arrival at the trade centre still runs at once
    settleScans: 3,
    pauseAfterSkipsMs: 10 * 60 * 1000, // a run with this many refusals pauses the species
    skipsToPause: 3,
    growUpSoonYears: 0,         // the planner's look-ahead at juvenile kin: none, as the guard
                                // (guardChanges) covers one growing up beside a relative until
                                // the move parts them, and adults are not sent off for a young
                                // one who may leave the day it grows up
    juvenileKinCost: 0.02,      // moving an adult in beside a young relative of the other sex:
                                // a tie-breaker, as the guard covers the day it grows up
});

// A species' scheduled run is due: its next month on the park's calendar
// has come, and its last run is scheduledGapMs of real time behind it.
// s: the ledger's species settings ({ next, last: { real } }).
export function scheduledDue(s, months, now) {
    if ((s.next || 0) > months) return false;
    const last = s.last && s.last.real;
    return !last || now - last >= AUTO_LIMITS.scheduledGapMs;
}

// A kept settings object, checked (unknown values fall back to the defaults).
export function normalizeSpecies(raw) {
    const s = Object.assign({}, SPECIES_DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    s.on = raw.on === true || raw.on === 1;
    if (EVERY_CHOICES.includes(Number(raw.every))) s.every = Number(raw.every);
    if (Number.isInteger(raw.step) && raw.step >= 0 && raw.step < PROGRAMME_STEPS.length) s.step = raw.step;
    if (raw.trade === false || raw.trade === 0) s.trade = false;
    if (raw.thin === false || raw.thin === 0) s.thin = false;
    if (FILL_STEPS.some(f => f.id === raw.fill)) s.fill = raw.fill;
    return s;
}

// The programme's options for these settings (the board's programmeOptions
// with the same slider step, trade switch and make-up, and the player's
// fine tuning, kinprogtune.js).
// housing: the Kin setting that takes pregnant and past-selling animals from
// the trade centre into a habitat (off: they wait there); young always go back
export function programmeOptionsFor(settings, ratio = 'auto', pinIds = null, tune = null, housing = true) {
    const st = PROGRAMME_STEPS[settings.step] || PROGRAMME_STEPS[PROGRAMME_DEFAULT_STEP];
    const o = { moveCost: st.cost, useTradeCentre: settings.trade !== false, ratio: ratio || 'auto', growUpSoonYears: AUTO_LIMITS.growUpSoonYears, juvenileKinCost: AUTO_LIMITS.juvenileKinCost };
    if (st.outsider != null) o.outsiderCost = st.outsider;
    if (pinIds && pinIds.size) o.pinIds = pinIds;
    if (!housing) o.houseBack = false;
    return applyTuning(Object.assign(o, PROGRAMME_SEARCH), tune);
}

export function fillOf(settings) {
    const st = FILL_STEPS.find(x => x.id === settings.fill) || FILL_STEPS.find(x => x.id === SPECIES_DEFAULTS.fill);
    return st.fill;
}

const asSet = v => (v instanceof Set ? v : new Set(Array.isArray(v) ? v.map(String) : []));

function homeOf(a) {
    return a.hab || (a.lt === 'trade' ? TRADE : '');
}

// The ledger's view for this load, checked: { pinned, manual, leaving,
// recentFrom: Map(id -> Set(hab)), blocked: Set('id>to') }.
function viewOf(v) {
    const o = v || {};
    const recent = new Map();
    const src = o.recentFrom instanceof Map ? o.recentFrom : new Map(Object.entries(o.recentFrom || {}));
    for (const [k, s] of src) recent.set(String(k), asSet(s));
    return { pinned: asSet(o.pinned), manual: asSet(o.manual), cooled: asSet(o.cooled), leaving: asSet(o.leaving), recentFrom: recent, blocked: asSet(o.blocked) };
}

// The animals Auto mode leaves where they are (hands off, moved by Auto
// mode itself lately), and those the programme treats as fixed (also the
// ones it sent away, which stay away). The player's own moves hold nothing:
// Auto mode's best plan wins over them (hands off is the way to keep one).
// A recent move never keeps a related pair together or an adult with no
// adult of the other sex in its habitat (it can't breed there); only hands
// off does. Nothing keeps a pregnant or young animal at the trade centre
// (mustHouse); an adult past selling stays in its habitat.
export function locksOf(model, species, view) {
    const v = viewOf(view);
    const inKinPair = new Set((relatedAdultPairs(model).get(species) || []).flat());
    const adultsHere = Array.from(model.animals.values()).filter(a => a.species === species && !a.juv && !a.exhibit && a.alive !== false && a.lt === 'habitat' && a.hab);
    const partnerless = a => !a.juv && a.lt === 'habitat' && (a.sex === Sex.Male || a.sex === Sex.Female)
        && !adultsHere.some(b => b.hab === a.hab && b.sex === (a.sex === Sex.Male ? Sex.Female : Sex.Male));
    const locked = new Set();
    for (const a of model.animals.values()) {
        if (a.species !== species || mustHouse(a)) continue;
        if (v.pinned.has(a.id) || (v.cooled.has(a.id) && !inKinPair.has(a.id) && !partnerless(a))) locked.add(a.id);
    }
    const pins = new Set(locked);
    // past selling it lives out its life where it is: the programme plans
    // around it, and parts it from a relative by moving the relative, unless
    // the relative is the one that can't move (never inbreed)
    const pairs = relatedAdultPairs(model).get(species) || [];
    const heldRelative = a => pairs.some(p => p.includes(a.id) && p.some(id => id !== a.id && locked.has(id)));
    for (const a of adultsHere) if (pastSelling(a) && !heldRelative(a)) pins.add(a.id);
    for (const id of v.leaving) {
        const a = model.animals.get(id);
        if (a && a.species === species && homeOf(a) === TRADE && !mustHouse(a)) pins.add(id);
    }
    return { locked, pins, view: v };
}

// The breeders Auto mode parked at the trade centre for want of a place,
// weighed again once the herd has changed since (changedAt: park years of
// its last birth, arrival or young grown up): the cooldown is against moving
// them back and forth, not against the better place a new herd may have.
// Its way back is weighed afresh, not counted as a move back (reversal).
// view: ledgerView's. -> { cooled: view.cooled without them, freed: [id],
// recentFrom: view.recentFrom without them }
export function freeParked(model, species, view, changedAt) {
    const freed = [];
    for (const id of view.cooled) {
        const a = model.animals.get(id);
        const moved = view.movedAt && view.movedAt.get(id);
        if (!a || a.species !== species || a.lt !== 'trade' || a.juv || view.leaving.has(id) || !canEverBreed(a)) continue;
        if (changedAt != null && moved != null && moved < changedAt) freed.push(id);
    }
    const recentFrom = new Map(view.recentFrom || []);
    for (const id of freed) recentFrom.delete(id);
    return { cooled: new Set(Array.from(view.cooled).filter(id => !freed.includes(id))), freed, recentFrom };
}

// One run, in two halves around the Breeding programme (the runtime runs
// the programme's search in slices in between):
//
//   1. Thin out (if chosen) on the zoo as it is: adults over each
//      habitat's fill level go to the trade centre, the old and infertile
//      first. It comes first because the programme counts the adults that
//      don't breed as fixed room: with them still there it would send
//      breeders away instead.
//   2. The programme on the zoo as Thin out leaves it, with the animals
//      Auto mode must not move pinned (and the ones just sent away).
//
// input: { model, species, info, destinations, assignments, settings
//          (normalizeSpecies), ratio (the board's make-up choice), view
//          (kinautoledger ledgerView), tradeFree (places left at the trade
//          centre, null: unknown) }
// prepareAutoRun(input) -> { model (after Thin out), pins, ... } for the
// programme; finishAutoRun(input, prep, programmeResult) -> the run:
// { species, moves: [{ id, to, reason, stage: 'ageing'|'thin'|'programme', reversal,
//   leave (sent to the trade centre to leave: Thin out, a spare) }],
//   programme, thin, notes: [text], held: [{ id, why }] }
// planAutoRun(input) does all three at once (tests).
export function prepareAutoRun(input, hold = []) {
    const { model, species, info = null, destinations = null } = input;
    const settings = normalizeSpecies(Object.assign({}, input.settings, { on: true }));
    const out = { species, moves: [], programme: null, thin: null, notes: [], held: [] };
    const prep = { out, settings, model, pins: new Set(), locked: new Set(), view: viewOf(input.view), taken: new Set(), tradeLeft: Infinity };
    if (!model || !species) return prep;
    const { locked, pins, view } = locksOf(model, species, input.view);
    // kept where they are: their moves were held back (heldKinIds)
    for (const id of hold) {
        locked.add(String(id));
        pins.add(String(id));
    }
    Object.assign(prep, { locked, pins, view, tradeLeft: input.tradeFree == null ? Infinity : Math.max(0, input.tradeFree) });
    // ELDERLY_WARNING_YEARS from elderly they go to the trade centre to be sold,
    // first and past a move's cooldown, while the market still takes them:
    // elderly or nearly, it refuses one, nor can an infertile one be sold or released. Hands off or a pregnancy
    // (she goes once she has given birth) keeps one
    const leaving = new Set();
    // the species' last breeder of a sex in a habitat stays (keepLastBreeders),
    // and the programme then plans with it: a partner can still join it
    const othersOfSex = a => Array.from(model.animals.values()).some(b => b !== a && b.species === species && !b.exhibit && b.sex === a.sex
        && b.lt === 'habitat' && isBreeder(b) && !noFertility(b) && !leaving.has(b.id));
    // one at the trade centre stays there when it turns elderly within a
    // move's cooldown of the ageing step: brought into a group, it would leave
    // again before the cooldown ends. Not the only breeder of its sex (it is
    // the species' last chance of young), nor a pregnant or young one
    for (const a of model.animals.values()) {
        if (a.species !== species || a.lt !== 'trade' || a.juv || mustHouse(a) || !othersOfSex(a)) continue;
        const years = yearsToElderly(a.species, a.age);
        if (years == null || years > ELDERLY_WARNING_YEARS + AUTO_LIMITS.cooldownYears || !sellsBeforeElderly(species, input.earlySale)) continue;
        locked.add(a.id);
        pins.add(a.id);
    }
    for (const a of ageingLeavers(model, species, input.earlySale)) {
        if (a.lt !== 'habitat' || view.pinned.has(a.id)) continue;
        if (pastSelling(a)) {
            out.held.push({ id: a.id, why: PAST_SELLING });
            continue;
        }
        if (isBreeder(a) && !noFertility(a) && !othersOfSex(a)) {
            out.held.push({ id: a.id, why: 'the last breeder of its sex stays' });
            continue;
        }
        locked.delete(a.id);
        if (addMove(prep, a, TRADE, AGEING_REASON, 'ageing', true)) leaving.add(a.id);
    }
    if (settings.thin) {
        // animals Auto mode placed lately stay (Thin out does not undo the
        // programme's last runs), and so does what it must not touch
        const keepIds = new Set(locked);
        for (const id of view.recentFrom.keys()) keepIds.add(id);
        const c = cullPlan(model, species, info || {}, { options: { fill: fillOf(settings), ratio: input.ratio || 'auto', keepIds } });
        out.thin = c;
        if (c) for (const m of c.moves) addMove(prep, model.animals.get(String(m.id)), TRADE, `Thin out: ${m.reason}`, 'thin', true);
    }
    if (out.moves.length) {
        prep.model = simulatePlan(model, out.moves, destinations);
        for (const m of out.moves) prep.pins.add(m.id);
    }
    return prep;
}

const AGEING_REASON = 'nearly elderly: to be sold while the market still takes it';

// The species' adults within a year of turning elderly (kinageing.js),
// not pregnant. -> [animal]
export function ageingLeavers(model, species, earlySale = true) {
    if (!sellsBeforeElderly(species, earlySale)) return [];
    return nearingElderly(model, new Set()).map(w => w.animal).filter(a => a.species === species && !a.preg);
}

// A run's sell advice with the species' animals near elderly added (reason
// 'elderly'), in place of any keep advice for them. r: the programme's result.
export function withAgeingAdvice(r, model, species, earlySale = true) {
    const ids = new Set(((r && r.sellable) || []).map(x => String(x.id)));
    const extra = ageingLeavers(model, species, earlySale).filter(a => !ids.has(String(a.id))).map(a => ({ id: a.id, score: ownGeneScore(a), best: null, reason: 'elderly' }));
    if (!extra.length) return r;
    const gone = new Set(extra.map(x => String(x.id)));
    return Object.assign({}, r, { sellable: ((r && r.sellable) || []).concat(extra), keep: ((r && r.keep) || []).filter(x => !gone.has(String(x.id))) });
}

function addMove(prep, a, to, reason, stage, leave = false) {
    const { out, locked, taken, view } = prep;
    if (!a || !canMove(a) || (isPinned(a) && !mustHouse(a)) || locked.has(a.id) || taken.has(a.id)) return false;
    if (String(to) === homeOf(a)) return false;
    if (view.blocked.has(`${a.id}>${to}`)) {
        out.held.push({ id: a.id, why: 'the game refused this move recently' });
        return false;
    }
    if (to === TRADE) {
        if (prep.tradeLeft <= 0) {
            out.held.push({ id: a.id, why: 'the trade centre is full' });
            return false;
        }
        prep.tradeLeft--;
    }
    // a rule's move (one nearly elderly leaving, a pregnant or young one housed) is no back and forth
    const back = stage === 'ageing' || mustHouse(a) ? null : view.recentFrom.get(a.id);
    out.moves.push({ id: a.id, to: String(to), reason, stage, reversal: !!(back && back.has(String(to))), leave: leave && String(to) === TRADE });
    taken.add(a.id);
    return true;
}

// The programme's moves (made on prep.model) added to the run.
const WAITS_AT_TRADE = 'waits at the trade centre: Bring waiting animals into a habitat is off';

export function finishAutoRun(input, prep, programme) {
    const { out } = prep;
    out.programme = programme || null;
    const model = input.model;
    // a spare (weak, 0% fertility, past breeding, misfit) leaves; a breeder with no place this run waits for one
    for (const m of (programme && programme.moves) || []) {
        const a = model && model.animals.get(String(m.id));
        // Bring waiting animals into a habitat off: the pregnant and past-selling stay at the trade centre
        if (input.houseWaiting === false && a && homeOf(a) === TRADE && mustHouse(a) && !a.juv) {
            out.held.push({ id: a.id, why: WAITS_AT_TRADE });
            continue;
        }
        addMove(prep, a, m.to, m.reason || 'breeding programme', 'programme', !!m.spare);
    }
    // each move dropped here can leave another one unsafe, or the species
    // short of its last breeder: again until nothing changes
    for (let count = -1; model && count !== out.moves.length;) {
        count = out.moves.length;
        keepLastBreeders(input, out);
        keepPastSelling(input, out);
        const safe = movesKeepingKinApart(model, out.moves, input.destinations || null);
        for (const m of safe.dropped) out.held.push({ id: m.id, why: KIN_WAITS });
        out.moves = safe.moves;
    }
    if (out.held.some(x => x.why === 'the trade centre is full')) out.notes.push('The trade centre is full: some animals stay until there is room (sell or release the ones waiting there).');
    const idle = programme && programme.after ? programme.after.idle || 0 : 0;
    if (idle) out.notes.push(`${idle} breeder${idle === 1 ? ' has' : 's have'} no unrelated partner in the zoo: new animals from the market would let ${idle === 1 ? 'it' : 'them'} breed.`);
    return out;
}

// a -> staying put, it would live beside an adult relative of the other sex
// once the run's moves are made
function kinStaysAfter({ model, species }, out) {
    const endOf = b => {
        const m = out.moves.find(x => String(x.id) === b.id);
        return m ? String(m.to) : homeOf(b);
    };
    return a => Array.from(model.animals.values()).some(b => b !== a && b.species === species && !b.juv && b.alive !== false && endOf(b) === a.hab && kinPair(model, a, b));
}

// The programme sends breeders with no place in a group to the trade
// centre. In a species where everyone is related that would empty it, so
// Auto mode never sends away the last breeding male or female left in the
// habitats (the run's later trade moves are dropped first), unless staying
// would leave it with an adult relative of the other sex: never inbreed.
function keepLastBreeders(input, out) {
    const { model, species } = input;
    const kinStays = kinStaysAfter(input, out);
    const left = { [Sex.Male]: 0, [Sex.Female]: 0 };
    const goes = new Set(out.moves.filter(m => m.to === TRADE).map(m => m.id));
    const comes = new Set(out.moves.filter(m => m.to !== TRADE).map(m => m.id));
    for (const a of model.animals.values()) {
        if (a.species !== species || a.exhibit || !(a.sex in left) || !isBreeder(a) || noFertility(a)) continue;
        const inHab = a.hab ? !goes.has(a.id) : comes.has(a.id);
        if (inHab) left[a.sex]++;
    }
    for (let i = out.moves.length - 1; i >= 0; i--) {
        const m = out.moves[i];
        if (m.to !== TRADE) continue;
        const a = model.animals.get(m.id);
        if (!a || !a.hab || !(a.sex in left) || !isBreeder(a) || noFertility(a) || left[a.sex] > 0 || kinStays(a)) continue;
        out.moves.splice(i, 1);
        left[a.sex]++;
        out.held.push({ id: a.id, why: 'the last breeder of its sex stays' });
    }
}

const PAST_SELLING = 'too close to elderly to be sold: it lives out its life here';

// An animal past selling is never sent from its habitat to the trade
// centre, unless staying would leave it with an adult relative of the
// other sex: never inbreed.
function keepPastSelling(input, out) {
    const { model } = input;
    const kinStays = kinStaysAfter(input, out);
    for (let i = out.moves.length - 1; i >= 0; i--) {
        const m = out.moves[i];
        const a = m.to === TRADE ? model.animals.get(String(m.id)) : null;
        if (!a || !a.hab || !pastSelling(a) || kinStays(a)) continue;
        out.moves.splice(i, 1);
        out.held.push({ id: a.id, why: PAST_SELLING });
    }
}

const KIN_WAITS = 'it would live with a relative of the other sex while another move of the run waits';

// The moves of a run (or what is left of one) that can go ahead without
// the rest: a move that brings an adult in with an adult relative of the
// other sex, because the move that was to take one of them away is held,
// refused or dropped, is left out, the later arrival first, until the
// moves make no related pair the zoo does not have now.
// -> { moves (kept, in order), dropped }
export function movesKeepingKinApart(model, moves, destinations = null) {
    const keysOf = m => new Set(Array.from(relatedAdultPairs(m).values()).flat().map(p => p.join('+')));
    const before = keysOf(model);
    const kept = (moves || []).slice();
    const dropped = [];
    for (;;) {
        const fresh = Array.from(keysOf(simulatePlan(model, kept, destinations))).filter(k => !before.has(k));
        const arrivals = new Set(fresh.flatMap(k => k.split('+')));
        let last = -1;
        kept.forEach((m, i) => {
            if (m.to !== TRADE && arrivals.has(String(m.id))) last = i;
        });
        if (last < 0) return { moves: kept, dropped };
        dropped.push(kept.splice(last, 1)[0]);
    }
}

export function planAutoRun(input) {
    const solve = prep => planProgramme(prep.model, input.species, input.info || {}, input.destinations || null, {
        assignments: input.assignments || null,
        options: programmeOptionsFor(prep.settings, input.ratio || 'auto', prep.pins, input.tune || null, input.houseWaiting !== false),
    });
    const prep = prepareAutoRun(input);
    if (!input.model || !input.species) return prep.out;
    const run = finishAutoRun(input, prep, solve(prep));
    const hold = heldKinIds(input, run);
    if (!hold.length) return run;
    const again = prepareAutoRun(input, hold);
    const out = finishAutoRun(input, again, solve(again));
    // the first plan's reasons for holding a move back still hold (a refusal, a full trade centre)
    const told = new Set(out.held.map(x => x.id));
    for (const x of run.held) if (!told.has(x.id)) out.held.push(x);
    return out;
}

// Never inbreed: a move held back (the game refused it lately, the trade
// centre is full, a move that would put kin together) can leave a related
// pair together that the plan meant to split. The run is then planned again
// with the held animals kept where they are, so the other of the pair moves.
// -> the ids to keep where they are, or [] when no related pair is left
export function heldKinIds(input, run) {
    const held = run.held.map(x => String(x.id));
    if (!held.length) return [];
    const after = simulatePlan(input.model, run.moves, input.destinations || null);
    const stuck = new Set(held);
    const pairs = relatedAdultPairs(after).get(input.species) || [];
    return pairs.some(p => p.some(id => stuck.has(String(id)))) ? held : [];
}

// Never inbreed, not even in the half minute a keeper takes to come: a
// female living beside a relative of the other sex who can breed, or will
// within GUARD_YEARS (two siblings grown up the same second), is put on
// contraception by Auto mode, which is instant, until no such relative lives
// with her; she is taken off it once she is in a habitat without one. A
// pregnant one too (she could conceive again the moment she gives birth).
// Only the contraception Auto mode set itself (guarded: GUIDs) is ever taken
// off, and one on her way somewhere waits until she is there.
// -> { on: [animal], off: [animal] }
export const GUARD_YEARS = 0.5;

function breedsWithin(a, years) {
    if (!a || a.alive === false || a.exhibit || !canEverBreed(a)) return false;
    const g = growthOf(a);
    if (g) return g.years <= years;
    return !a.juv;
}

export function guardChanges(model, guarded = new Set()) {
    const out = { on: [], off: [] };
    if (!model) return out;
    const byHab = new Map();
    for (const a of model.animals.values()) {
        if (!a.hab || a.lt !== 'habitat' || a.exhibit || a.alive === false) continue;
        const key = `${a.hab}|${a.species}`;
        if (!byHab.has(key)) byHab.set(key, []);
        byHab.get(key).push(a);
    }
    const atRisk = f => breedsWithin(f, GUARD_YEARS) && (byHab.get(`${f.hab}|${f.species}`) || [])
        .some(m => m !== f && m.sex === Sex.Male && breedsWithin(m, GUARD_YEARS) && relatedPair(model, f, m));
    for (const f of model.animals.values()) {
        if (f.sex !== Sex.Female || f.exhibit || f.alive === false || f.moving) continue;
        const inHab = !!f.hab && f.lt === 'habitat';
        if (inHab && atRisk(f)) {
            if (!f.contra) out.on.push(f);
        }
        else if (inHab && f.contra && f.guid && guarded.has(String(f.guid))) out.off.push(f);
    }
    return out;
}

// The model as the planner sees it: a female on contraception Auto mode set
// against inbreeding is the breeder she is (the guard is lifted once she is
// apart from her relative), so the plan still parts the pair and places her
// where her young score best. guarded: GUIDs.
export function withGuardsLifted(model, guarded) {
    if (!model || !model.snapshot || !guarded || !guarded.size) return model;
    const lift = a => a.contra && a.guid && guarded.has(String(a.guid));
    if (!model.snapshot.animals.some(lift)) return model;
    const animals = model.snapshot.animals.map(a => (lift(a) ? Object.assign({}, a, { contra: false }) : a));
    return buildKinModel(Object.assign({}, model.snapshot, { animals }), Object.assign({}, model.opts || { closeKinship: model.closeKinship }, { ped: model.ped || null }));
}

// The sires breeding once the plan's moves are made, each with his young's
// average with the females of his group (kincore calfScores: a male's
// average). -> [{ a, avg, mates: [genes] }]
export function groupSires(model, species, moves, destinations = null) {
    const after = simulatePlan(model, moves, destinations);
    const adults = Array.from(after.animals.values()).filter(a => a.species === species && a.lt === 'habitat' && a.hab && isBreeder(a) && !noFertility(a));
    const out = [];
    for (const a of adults) {
        if (a.sex !== Sex.Male) continue;
        const mates = adults.filter(b => b.hab === a.hab && b.sex === Sex.Female).map(b => b.genes);
        const c = calfScores(a.genes, mates, true);
        if (c) out.push({ a, avg: c.score, mates });
    }
    return out;
}

// The standard a sire is held to: the best average young of any sire that
// bred in the last STANDARD_YEARS (prev: the ledger's std, [average, park
// years]), so a sire left as the last option still shows as the step down
// he is. -> { std, below: the sires more than `margin` under it, floor:
// the average a sire needs not to be one of them }
export const STANDARD_YEARS = 3;

export function sireStandard(prev, sires, clock, { margin = YOUNG_MARGIN } = {}) {
    const best = sires.reduce((m, s) => Math.max(m, s.avg), -Infinity);
    let std = prev && clock - prev[1] <= STANDARD_YEARS ? prev : null;
    if (best > -Infinity && (!std || best >= std[0])) std = [best, clock];
    const floor = std ? std[0] - margin : null;
    return { std, floor, below: std ? sires.filter(s => s.avg < floor) : [] };
}

// Clean up (the zoo-wide switch, the ledger's clean): the species' adults go
// to the trade centre to leave, the males first so no new pregnancy starts.
// A pregnant female waits in her habitat and goes once she has given birth,
// a young one once it has grown up; one of them waiting at the trade centre
// goes into a habitat first (the golden rule, mustHouse). Elderly animals
// (the game won't take them) and hands-off ones stay, named. With habs, only
// the animals in those habitats: the rest of the species is Auto mode's.
// input: as planAutoRun's, and habs (Set of habitat ids, none: the whole
// zoo). -> planAutoRun's run, with
// clean: { pregnant, young, elderly: [name], kept: [name], done }
export function cleanupRun(input) {
    const { model, species } = input;
    // emptying the zoo undoes no earlier move: no reversal guard
    const view = Object.assign(viewOf(input.view), { recentFrom: new Map() });
    const out = { species, moves: [], programme: null, thin: null, notes: [], held: [] };
    const clean = { pregnant: 0, young: 0, elderly: [], kept: [], done: false };
    out.clean = clean;
    if (!model || !species) return out;
    const habs = input.habs && input.habs.size ? input.habs : null;
    const mine = Array.from(model.animals.values()).filter(a => a.species === species && !a.exhibit && a.alive !== false && (!habs || habs.has(String(a.hab))));
    const prep = { out, locked: new Set(Array.from(view.pinned).filter(id => !mustHouse(model.animals.get(id)))), taken: new Set(), view, tradeLeft: input.tradeFree == null ? Infinity : Math.max(0, input.tradeFree) };
    const habitats = Array.from(new Set(mine.map(a => a.hab).filter(Boolean)));
    const endOf = a => (homeOf(a) === TRADE ? null : a.hab || null);
    const housing = adultBackMoves(model, mine, habitats, endOf, () => Infinity, null);
    const housed = new Map(housing.map(m => [String(m.id), m.to]));
    const endHoused = a => housed.get(String(a.id)) || endOf(a);
    for (const m of housing.concat(youngBackMoves(model, mine, habitats, endHoused))) addMove(prep, model.animals.get(String(m.id)), m.to, m.reason, 'clean');
    const adults = mine.filter(a => !a.juv && homeOf(a) !== TRADE).sort((x, y) => (x.sex === Sex.Male ? 0 : 1) - (y.sex === Sex.Male ? 0 : 1));
    for (const a of adults) {
        if (a.preg) clean.pregnant++;
        else if (view.leaving.has(a.id)) continue;
        else if (prep.locked.has(a.id)) clean.kept.push(a.name);
        else if ((a.fert && a.fert.state === 'old') || pastSelling(a)) clean.elderly.push(a.name);
        else addMove(prep, a, TRADE, 'Clean up: to the trade centre', 'clean', true);
    }
    clean.young = mine.filter(a => a.juv).length;
    clean.done = !out.moves.length && !clean.pregnant && !clean.young && !mine.some(mustHouse);
    return out;
}

// A breeding plan beside a habitat Clean up: the zoo without those habitats'
// animals (Clean up's to move), the habitats closed to the species and not
// set aside. -> { model, destinations, assignments }
export function withoutHabitats(model, destinations, assignments, habs) {
    if (!habs || !habs.size || !model || !model.snapshot) return { model, destinations, assignments };
    const animals = model.snapshot.animals.filter(a => !habs.has(String(a.hab)));
    const rebuilt = buildKinModel(Object.assign({}, model.snapshot, { animals }), Object.assign({}, model.opts || { closeKinship: model.closeKinship }, { ped: model.ped || null }));
    const closed = { ok: false, reason: 'Clean up is emptying this habitat.' };
    const bySpecies = {};
    for (const [sp, d] of Object.entries((destinations && destinations.bySpecies) || {})) {
        bySpecies[sp] = Object.assign({}, d);
        for (const h of habs) bySpecies[sp][h] = closed;
    }
    const kept = new Map(Array.from(assignments || new Map()).filter(([h]) => !habs.has(String(h))));
    return { model: rebuilt, destinations: Object.assign({}, destinations, { bySpecies }), assignments: kept };
}

// --------------------------------------------------------------- watching

// Per species: what a plan depends on, as one string. A ready plan is made
// again when this changes.
export function speciesFingerprints(model) {
    const out = new Map();
    if (!model) return out;
    const parts = new Map();
    for (const a of model.animals.values()) {
        if (!a.species || a.exhibit) continue;
        if (!parts.has(a.species)) parts.set(a.species, []);
        const f = a.fert ? a.fert.state : '';
        parts.get(a.species).push([a.guid || a.id, a.hab, a.lt, a.moving ? 1 : 0, a.juv ? 1 : 0, a.contra ? 1 : 0, a.infertile ? 1 : 0, a.preg ? 1 : 0, f, a.bond ? a.bond.mate : '', a.alive === false ? 0 : 1].join(':'));
    }
    for (const [sp, list] of parts) out.set(sp, list.sort().join('|'));
    return out;
}

// What changed that Auto mode did not do: the player (or the game) moved an
// animal. seen: { id: { hab, to } } (this load; to: where Auto mode sent
// it, kept while it is on the way, since a stay in quarantine can outlast
// the expected entry); expected: Map(id -> { to }) for Auto mode's own
// moves. -> { seen, moved: [id] }
export function observeChanges(seen, model, expected) {
    const next = {};
    const moved = [];
    const exp = expected instanceof Map ? expected : new Map();
    for (const a of model ? model.animals.values() : []) {
        if (a.exhibit) continue;
        const stable = !a.moving && (a.lt === 'habitat' || a.lt === 'trade');
        const here = homeOf(a);
        const was = seen && seen[a.id];
        if (!was) {
            next[a.id] = { hab: stable ? here : '' };
            continue;
        }
        const e = exp.get(a.id);
        const sentTo = e && e.to != null ? String(e.to) : was.to;
        const rec = { hab: was.hab };
        if (stable) {
            if (was.hab && here !== was.hab && here !== sentTo) moved.push(a.id);
            rec.hab = here;
        }
        else if (sentTo != null) rec.to = sentTo;
        next[a.id] = rec;
    }
    return { seen: next, moved };
}

// Adults in one habitat that must not live together (kinPair): a juvenile
// that grew up next to a relative, or a move made by hand. An animal on
// the move counts where it is only when stuck (ids in `stuck`: a transport
// that never finished).
// -> Map(species -> [[id, id], ...])
export function relatedAdultPairs(model, stuck = new Set()) {
    const counts = a => !a.exhibit && !a.juv && a.lt === 'habitat' && (!a.moving || stuck.has(String(a.id)));
    const pairs = new Map();
    for (const p of model ? model.pairs : []) {
        if (p.tier === 'distant' || !counts(p.a) || !counts(p.b) || !kinPair(model, p.a, p.b)) continue;
        if (!pairs.has(p.species)) pairs.set(p.species, []);
        pairs.get(p.species).push([p.a.id, p.b.id].sort());
    }
    return pairs;
}

// relatedAdultPairs per species as one sorted key, so a run is asked for
// once per new situation and not again while the plan can't change it (a
// pregnant mother stays put). -> Map(species -> key)
export function kinConflicts(model, stuck = new Set()) {
    const out = new Map();
    for (const [sp, pairs] of relatedAdultPairs(model, stuck)) out.set(sp, pairs.map(p => p.join('+')).sort().join(','));
    return out;
}

// What of a plan's notices was not told yet: each need (habitat and sex),
// each sellable animal and each elderly blocker once, so a plan that shifts
// or flips back and forth raises nothing it raised before. told: Set of
// keys, updated. r: { needs, sellable, retiredBlockers }. -> the untold
// parts, or null when there is nothing new.
export function freshNotices(told, r) {
    const fresh = (list, keyOf) => (list || []).filter(x => {
        const k = keyOf(x);
        if (told.has(k)) return false;
        told.add(k);
        return true;
    });
    const out = {
        needs: fresh(r && r.needs, n => `need|${n.hab}|${n.sex}`),
        sellable: fresh(r && r.sellable, x => `sell|${x.id}`),
        keep: fresh(r && r.keep, x => `keep|${x.id}`),
        blockers: fresh(r && r.retiredBlockers, b => `blocker|${b.id}|${b.hab}`),
    };
    return out.needs.length || out.sellable.length || out.keep.length || out.blockers.length ? out : null;
}

// Species set aside for a habitat that Auto mode never had a setting for:
// setting a habitat aside is the opt-in. A species the player turned off
// stays off; shoals and colonies are not Auto mode's (isCollective).
// assignments: Map habitat -> Set(species); ledgerSpecies: the ledger's sp.
export function speciesToSwitchOn(assignments, ledgerSpecies, isCollective = () => false) {
    const out = new Set();
    for (const [, set] of assignments || []) {
        for (const sp of set || []) if (!(ledgerSpecies && ledgerSpecies[sp]) && !isCollective(sp)) out.add(sp);
    }
    return Array.from(out).sort();
}

// An animal's gene grades in percent, in the order the Storage fetch
// matches them (storagefetchcore matchItems): fertility, immunity, size,
// longevity. null without all four.
export function genePercents(a) {
    const g = ownGrades(a && a.genes);
    const order = ['fertility', 'immunity', 'size', 'longevity'];
    return order.every(k => typeof g[k] === 'number') ? order.map(k => Math.round(g[k] * 100)) : null;
}

// The stored adults less the park's own animals: the game's storage list
// can still name an animal that has come to the zoo, under a GUID the park
// does not share, so it is told apart by species, sex, name and genes.
// -> a copy of `stored` with those left out
export function withoutParkAnimals(model, species, stored) {
    if (!stored || !stored.animals) return stored;
    const here = new Set();
    for (const a of model ? model.animals.values() : []) {
        const p = a.species === species ? storagePrint(a.sex, a.name, genePercents(a)) : null;
        if (p) here.add(p);
    }
    return Object.assign({}, stored, { animals: stored.animals.filter(s => !here.has(storagePrint(s.sex, s.name, genePercents(s)))) });
}

// One animal across the park and Animal Storage, whose GUIDs differ: sex,
// name and gene percents as one key (null without the genes).
function storagePrint(sex, name, percents) {
    return percents ? `${sex}|${String(name || '').toLowerCase()}|${percents.join('.')}` : null;
}

export function animalPrint(a) {
    return storagePrint(a.sex, a.name, genePercents(a));
}

// A stored animal within ELDERLY_WARNING_YEARS of elderly, never brought back. The park's
// read of storage has no age: the Storage window's (rowAges: kinageing
// storedAgeEntries, seen in the hub), else the age Auto mode last saw it at
// the trade centre with, where it no longer ages (ages: print -> [age, park years]).
export function ageingInStorage(s, ages, rowAges = null, earlySale = true) {
    const seen = ages && ages[animalPrint(s)];
    const age = storedAgeOf(rowAges, s, genePercents(s)) ?? (seen ? seen[0] : null);
    const years = age != null ? yearsToElderly(s.species, age) : null;
    return years != null && years <= ELDERLY_WARNING_YEARS && sellsBeforeElderly(s.species, earlySale);
}

export function withoutAgeing(stored, ages, rowAges = null, earlySale = true) {
    if (!stored || !stored.animals) return stored;
    return Object.assign({}, stored, { animals: stored.animals.filter(s => !ageingInStorage(s, ages, rowAges, earlySale)) });
}

// The breeders of a species in each habitat, after the plan (endOf(animal)
// -> its habitat then). -> Map(habitat -> [animal])
function breedersByHabitat(model, species, habs, endOf) {
    const groups = new Map(habs.map(h => [String(h), []]));
    for (const a of model.animals.values()) {
        if (a.species !== species || !isBreeder(a)) continue;
        const g = groups.get(String(endOf(a)));
        if (g) g.push(a);
    }
    return groups;
}

// Stored adults that may breed: not young, not listed on the market, with
// gene data. -> [{ s (the stored animal), score }]
function storedBreeders(stored) {
    const out = [];
    for (const s of (stored && stored.animals) || []) {
        if (s.juv || s.forSale || !isBreeder(s) || noFertility(s)) continue;
        const score = ownGeneScore(s);
        if (score != null) out.push({ s, score });
    }
    return out;
}

// The best young `a` could have with a breeder of the other sex in `group`
// (the game's offspring prediction), relatives left out; null if none.
function bestYoungWith(view, a, group) {
    const opposite = b => (a.sex === Sex.Male && b.sex === Sex.Female) || (a.sex === Sex.Female && b.sex === Sex.Male);
    return bestOffspringScore(a.genes, group.filter(b => opposite(b) && !kinPair(view, a, b)).map(b => b.genes));
}

// Stored adults whose young would beat those of an animal in a habitat set
// aside for the species: with that habitat's breeders of the other sex
// (none of them related), its best young score `margin` (the planner's
// YOUNG_MARGIN) or more over the young of the weakest breeder of its sex
// there. Each stored and each replaced animal once, the biggest gain first.
// A listed one is offered too, marked: Bring from storage cancels its listing.
// onSkip(stored, why) hears why each other stored adult is not offered.
// stored: kincore normalizeStored(); endOf(animal) -> its habitat after the plan.
// -> [{ guid, name, sex, genes, score, young, hab, replaces, replacesName, replacesYoung, listed }]
export function storageUpgrades(model, species, stored, { assignments, endOf = a => a.hab || null, margin = YOUNG_MARGIN, onSkip = () => {} } = {}) {
    if (!model || !stored || !stored.animals || !stored.animals.length) return [];
    const view = withStored(model, stored);
    const habs = [];
    for (const [hab, set] of assignments || []) if (set && set.has(species)) habs.push(String(hab));
    const groups = breedersByHabitat(model, species, habs, endOf);
    const options = [];
    for (const s of stored.animals) {
        if (s.juv) { onSkip(s, 'young'); continue; }
        if (!isBreeder(s)) { onSkip(s, 'cannot breed'); continue; }
        let related = 0, places = 0, bestGain = null;
        for (const [hab, group] of groups) {
            const same = group.filter(b => b.sex === s.sex);
            if (!same.length) continue;
            places++;
            if (group.some(b => kinPair(view, s, b))) { related++; continue; }
            const young = bestYoungWith(view, s, group);
            if (young == null) continue;
            const ranked = same.map(w => ({ w, y: bestYoungWith(view, w, group) ?? -1 })).sort((x, y) => x.y - y.y);
            const gain = young - ranked[0].y;
            if (bestGain == null || gain > bestGain) bestGain = gain;
            if (gain >= margin) options.push({ s, young, hab, weakest: ranked[0].w, weakYoung: ranked[0].y, gain });
        }
        if (!options.some(o => o.s === s)) {
            onSkip(s, !places ? 'no habitat breeds its sex' : related === places ? 'related to the breeders of the other sex'
                : bestGain == null ? 'no gene data to compare' : `its juveniles would be only ${bestGain} better`);
        }
    }
    options.sort((x, y) => y.gain - x.gain);
    const usedStored = new Set();
    const usedPark = new Set();
    const out = [];
    for (const o of options) {
        if (usedStored.has(o.s.guid) || usedPark.has(o.weakest.id)) continue;
        usedStored.add(o.s.guid);
        usedPark.add(o.weakest.id);
        out.push({
            guid: o.s.guid, name: o.s.name, sex: o.s.sex, genes: genePercents(o.s), score: ownGeneScore(o.s), young: o.young,
            hab: o.hab, replaces: o.weakest.id, replacesName: o.weakest.name, replacesYoung: o.weakYoung, listed: !!o.s.forSale,
        });
    }
    return out;
}

// The zoo for asking the programme which stored adults it would bring in:
// every park animal of the species held where it is (pinIds), and the
// stored adults that may breed (not young, no 0% fertility gene; a listed
// one too: Bring from storage cancels its listing) waiting at the trade centre. stored: without the park's own animals
// (withoutParkAnimals). -> { model, pinIds, ids } or null
export function storageTrial(model, species, stored) {
    if (!model || !stored || !stored.animals) return null;
    const waiting = stored.animals.filter(s => !s.juv && isBreeder(s) && !noFertility(s) && (s.sex === Sex.Male || s.sex === Sex.Female));
    if (!waiting.length) return null;
    const animals = new Map(model.animals);
    for (const s of waiting) animals.set(s.id, Object.assign({}, s, { species, lt: 'trade', loc: 'trade centre' }));
    const pinIds = Array.from(model.animals.values()).filter(a => a.species === species).map(a => String(a.id));
    return { model: Object.assign({}, withStored(model, stored), { animals }), pinIds, ids: new Set(waiting.map(s => s.id)) };
}

// The stored adults the programme brings into a habitat on a storageTrial
// zoo (result: its plan), each with its best young beside the breeders of
// the other sex it would live with, best young first.
// -> [{ guid, name, sex, genes, score, young, hab, listed }]
export function storageAdditions(trial, result) {
    if (!trial || !result) return [];
    const to = new Map((result.moves || []).map(m => [String(m.id), String(m.to)]));
    const endOf = a => to.get(String(a.id)) || a.hab || null;
    const out = [];
    for (const [id, hab] of to) {
        if (!trial.ids.has(id) || hab === TRADE) continue;
        const s = trial.model.animals.get(id);
        const group = Array.from(trial.model.animals.values()).filter(a => a !== s && a.species === s.species && !a.juv && isBreeder(a) && endOf(a) === hab);
        out.push({ guid: s.guid, name: s.name, sex: s.sex, genes: genePercents(s), score: ownGeneScore(s), young: bestYoungWith(trial.model, s, group), hab, listed: !!s.forSale });
    }
    return out.sort((x, y) => (y.young ?? -1) - (x.young ?? -1));
}

// One list of what to bring from storage for a species, each animal once:
// the programme's additions (it sees every habitat at once), then a pick
// for each need those leave open (needs[i].bring: picked from the stored
// animals the additions do not take), then the upgrades for a place no
// other one already fills. A need with no pick is left for the Market.
// -> { items: [{ role: 'join' | 'fill' | 'replace', guid, name, sex, genes,
//    young, hab, listed, replacesName?, replacesYoung? }], unfilled: [need] }
export function mergeStorageSuggestions({ additions = [], needs = [], upgrades = [] } = {}) {
    const items = [];
    const used = new Set();
    const fills = (hab, sex) => items.some(x => String(x.hab) === String(hab) && x.sex === sex);
    const add = (role, x, extra = {}) => {
        if (!x || !x.guid || used.has(x.guid)) return false;
        used.add(x.guid);
        items.push(Object.assign({ role, guid: x.guid, name: x.name, sex: x.sex, genes: x.genes, young: x.young ?? null, hab: x.hab, listed: !!x.listed }, extra));
        return true;
    };
    for (const x of additions) add('join', x);
    const unfilled = [];
    for (const n of needs) {
        const sexes = n.sex === 'pair' ? [Sex.Male, Sex.Female] : [n.sex];
        if (sexes.every(sex => fills(n.hab, sex))) continue;
        const picks = (n.bring || []).filter(b => !used.has(b.guid) && !fills(n.hab, b.sex));
        if (!picks.length) {
            unfilled.push(n);
            continue;
        }
        for (const b of picks) add('fill', Object.assign({}, b, { hab: n.hab }));
    }
    for (const u of upgrades) {
        if (!fills(u.hab, u.sex)) add('replace', u, { replacesName: u.replacesName, replacesYoung: u.replacesYoung });
    }
    return { items, unfilled };
}

// The stored animals that best fill a plan's needs (partnerNeeds: a habitat
// without a breeding male, female or pair): of the sex wanted, the best
// young with the habitat's breeders of the other sex, related to none of
// them; a pair, the best young with each other, unrelated. Each stored
// animal fills one need; gene score breaks ties.
// -> [[{ guid, young }, ...] per need] ([] when storage has no fitting one)
export function bestForNeeds(model, species, stored, needs, { endOf = a => a.hab || null } = {}) {
    const out = (needs || []).map(() => []);
    if (!model || !stored || !stored.animals || !stored.animals.length) return out;
    const view = withStored(model, stored);
    const groups = breedersByHabitat(model, species, (needs || []).map(n => n.hab), endOf);
    const pool = storedBreeders(stored).sort((x, y) => y.score - x.score);
    const used = new Set();
    const fits = (c, group) => !used.has(c.s.guid) && !group.some(b => kinPair(view, c.s, b));
    const better = (young, score, best) => !best || young > best.young || (young === best.young && score > best.score);
    (needs || []).forEach((n, i) => {
        const group = groups.get(String(n.hab)) || [];
        let best = null;
        if (n.sex !== 'pair') {
            for (const c of pool) {
                if (c.s.sex !== n.sex || !fits(c, group)) continue;
                const young = bestYoungWith(view, c.s, group) ?? -1;
                if (better(young, c.score, best)) best = { young, score: c.score, picks: [c] };
            }
        }
        else {
            for (const m of pool) {
                if (m.s.sex !== Sex.Male || !fits(m, group)) continue;
                for (const f of pool) {
                    if (f.s.sex !== Sex.Female || !fits(f, group) || kinPair(view, m.s, f.s)) continue;
                    const young = bestOffspringScore(m.s.genes, [f.s.genes]) ?? -1;
                    if (better(young, m.score + f.score, best)) best = { young, score: m.score + f.score, picks: [m, f] };
                }
            }
        }
        if (!best) return;
        for (const c of best.picks) used.add(c.s.guid);
        out[i] = best.picks.map(c => ({ guid: c.s.guid, young: best.young < 0 ? null : best.young }));
    });
    return out;
}

// The stored animal that best gives growing calves an unrelated partner
// (kinbloodline.js freshBloodNeeds): of the sex wanted, related to none of
// the calves, not weak against the park's breeders, and with the best
// average predicted young with them. need: { sex, calves }.
// -> { guid, name, sex, genes, score, young } | null
export function bestFreshBlood(model, species, stored, need, { margin = YOUNG_MARGIN } = {}) {
    if (!model || !need || !stored || !stored.animals || !stored.animals.length) return null;
    const view = withStored(model, stored);
    const adults = Array.from(model.animals.values()).filter(a => a.species === species && a.hab && isBreeder(a));
    let best = null;
    for (const { s } of storedBreeders(stored)) {
        if (s.sex !== need.sex || need.calves.some(c => relatedPair(view, s, c))) continue;
        if (weakBreeders(view, adults.concat([s]), margin).has(s.id)) continue;
        const scores = need.calves.map(c => bestOffspringScore(s.genes, [c.genes])).filter(v => v != null);
        const young = scores.length ? Math.round(scores.reduce((t, v) => t + v, 0) / scores.length) : null;
        if (young == null) continue;
        if (!best || young > best.young) best = { guid: s.guid, name: s.name, sex: s.sex, genes: genePercents(s), score: ownGeneScore(s), young };
    }
    return best;
}

// The Market's dim line for a needs notice: listings scoring under the best
// breeder of the sex wanted by SELL_MARGIN would be sell advice the day
// they arrive. A pair: the lower of the two. null without a breeder of
// that sex to compare with.
export function marketDimFor(model, species, sex) {
    const best = s => {
        let top = null;
        for (const a of model ? model.animals.values() : []) {
            if (a.species !== species || a.sex !== s || !isBreeder(a)) continue;
            const score = ownGeneScore(a);
            if (score != null && (top == null || score > top)) top = score;
        }
        return top;
    };
    const tops = (sex === 'pair' ? [Sex.Male, Sex.Female] : [sex]).map(best);
    if (tops.some(t => t == null)) return null;
    return Math.min(...tops) - SELL_MARGIN;
}

// For a need's Market button: the gene sets of the habitat's breeders of
// the other sex (the mates a listing's calves are predicted with), and the
// calf score under which a listing is dimmed: the weakest calves any of your
// breeders of the wanted sex gives now, so the dimmed ones would lower the
// average and the rest stay visible however poor the market is. A pair need,
// or no mate there, gives null (the Market then dims by own score).
// need: { hab, sex }; endOf(animal) -> its habitat after the plan.
// -> { mates: [genes], floor: number | null } | null
export function marketMatesFor(model, species, need, endOf = a => a.hab || null) {
    if (!model || !need || (need.sex !== Sex.Male && need.sex !== Sex.Female)) return null;
    const breeders = [];
    for (const a of model.animals.values()) if (a.species === species && a.genes && isBreeder(a)) breeders.push(a);
    const mates = breeders.filter(a => a.sex !== need.sex && a.sex !== Sex.Unisex && String(endOf(a)) === String(need.hab));
    if (!mates.length) return null;
    let floor = null;
    for (const a of breeders) {
        if (a.sex !== need.sex) continue;
        const young = bestYoungWith(model, a, breeders);
        if (young != null && (floor == null || young < floor)) floor = young;
    }
    return { mates: mates.map(a => a.genes), floor };
}

// What the Market needs to pick a species' best buy (marketmates.js, the
// hub's marketcalves.js), per sex of the listing: the gene sets of the
// breeders it would have young with, and the breeding standard, the calf
// score under which Auto mode counts a newcomer weak: the best pair's young
// less `margin`, judged on the park's breeders as the programme judges them
// (null without a pair). Its mates are your breeders of the other sex in a
// habitat; with none placed yet, any of yours (at the trade centre or stored,
// not listed), so a first purchase still guides the second.
// stored: kincore normalizeStored() without the park's own animals, or null.
// -> { m: { mates, floor }, f: { mates, floor }, unplaced: [{ x (sex), n (name), p (gene percents), c (score), b (best) }] } | null without breeders
export function marketMatesOfSpecies(model, species, stored = null, { margin = YOUNG_MARGIN } = {}) {
    if (!model) return null;
    const park = Array.from(model.animals.values()).filter(a => a.species === species && !a.exhibit && a.genes && isBreeder(a) && !noFertility(a));
    const kept = ((stored && stored.animals) || []).filter(s => s.genes && !s.juv && !s.forSale && isBreeder(s) && !noFertility(s));
    const all = park.concat(kept);
    if (!all.length) return null;
    const view = withStored(model, stored);
    let top = null;
    for (const a of park) {
        const young = bestYoungWith(view, a, park);
        if (young != null && (top == null || young > top)) top = young;
    }
    const floor = top == null ? null : top - margin;
    const placed = a => !!a.hab && a.lt !== 'trade';
    const side = sex => {
        const other = all.filter(a => a.sex !== sex && a.sex !== Sex.Unisex);
        return { mates: (other.some(placed) ? other.filter(placed) : other).map(a => a.genes), floor };
    };
    const m = side(Sex.Male), f = side(Sex.Female);
    // your animals not in a habitat, judged as a listing of their sex would be, for the Storage
    // window (matched to its rows by sex, name and gene percents, as sell advice is)
    const unplaced = [];
    for (const a of all) {
        if (placed(a) || (a.sex !== Sex.Male && a.sex !== Sex.Female)) continue;
        const c = calfScores(a.genes, (a.sex === Sex.Male ? m : f).mates, a.sex === Sex.Male);
        const p = genePercents(a);
        if (c && p) unplaced.push({ x: a.sex, n: a.name, p, c: c.score, b: c.best });
    }
    return { m, f, unplaced };
}

// Stored adults (not listed) the zoo's breeding would do without, by the
// plan's own rule: young `margin` or more under the best pair's with the
// zoo's breeders, or a 0% fertility gene. -> [{ s, score, best }]
export function storedSellAdvice(model, species, stored, { margin = YOUNG_MARGIN } = {}) {
    const candidates = ((withoutParkAnimals(model, species, stored) || {}).animals || []).filter(s => !s.juv && !s.forSale && isBreeder(s));
    if (!candidates.length) return [];
    const adults = Array.from(model.animals.values()).filter(a => a.species === species && a.hab && isBreeder(a) && !noFertility(a));
    const view = withStored(model, stored);
    const bestOf = new Map();
    for (const a of adults) {
        const score = ownGeneScore(a);
        if (score != null && score > (bestOf.get(a.sex) ?? -1)) bestOf.set(a.sex, score);
    }
    return candidates.filter(s => noFertility(s) || weakBreeders(view, adults.concat([s]), margin).has(s.id))
        .map(s => ({ s, score: ownGeneScore(s), best: bestOf.get(s.sex) ?? null }));
}

// The sell advice by GUID (the Storage window's "Sell advice" filter): a
// species' run replaces its entries with what it advises now, the plan's
// animals in the park (sellable: [{ id, score, best, reason }], and
// keep: the good ones to keep at the trade centre for later) and the stored
// adults storedSellAdvice finds (stored: the species' stored adults; null
// when unknown keeps its stored entries as they were), but for the ones the
// programme would bring in (wanted: guids), and the stored ones near elderly
// (ageingInStorage). Past maxChars of
// JSON (what the Lua side keeps) the oldest go.
// -> Map(guid -> { g, n (name), s (species), x (sex), p (genePercents), sc (score), b (best of its sex),
//    r (reason, advicecore), y (young it can father later) })
export function mergeSellAdvice(before, model, species, sellable, { keep = null, stored = null, wanted = null, ages = null, rowAges = null, earlySale = true, maxChars = Infinity } = {}) {
    const out = new Map(before || []);
    const inPark = new Set();
    for (const a of model ? model.animals.values() : []) if (a.species === species && a.guid) inPark.add(String(a.guid));
    for (const [g, e] of out) if (e.s === species && (stored || inPark.has(g))) out.delete(g);
    const advise = (a, x) => out.set(String(a.guid), { g: String(a.guid), n: a.name, s: species, x: a.sex, p: genePercents(a), sc: x.score, b: x.best ?? null, r: x.reason, y: x.young || 0 });
    for (const x of (sellable || []).concat(keep || [])) {
        const a = model && model.animals.get(String(x.id));
        if (a && a.guid) advise(a, x);
    }
    if (stored && model) {
        for (const { s, score, best } of storedSellAdvice(model, species, stored)) {
            if (s.guid && !(wanted && wanted.has(String(s.guid)))) advise(s, { score, best, reason: noFertility(s) ? 'nofert' : 'weak' });
        }
        for (const s of (withoutParkAnimals(model, species, stored).animals || [])) {
            if (s.guid && !s.juv && !s.forSale && ageingInStorage(s, ages, rowAges, earlySale)) advise(s, { score: ownGeneScore(s), best: null, reason: 'elderly' });
        }
    }
    let chars = JSON.stringify(Array.from(out.values())).length;
    for (const [g, e] of out) {
        if (chars <= maxChars) break;
        out.delete(g);
        chars -= JSON.stringify(e).length + 1;
    }
    return out;
}

// Animals waiting at the trade centre for a place, where they do not age:
// young (youngBackMoves takes them to a habitat) and arrivals such as an
// approved storage upgrade; not the ones sent there to leave (leaving: ids).
// Their species' run comes at once instead of at its next turn.
// -> Map(species -> sorted ids, as one key)
export function waitingAtTradeCentre(model, leaving = new Set()) {
    const bySpecies = new Map();
    for (const a of model ? model.animals.values() : []) {
        if (a.exhibit || a.moving || a.alive === false || a.lt !== 'trade') continue;
        if (!a.juv && leaving.has(String(a.id))) continue;
        if (!bySpecies.has(a.species)) bySpecies.set(a.species, []);
        bySpecies.get(a.species).push(String(a.id));
    }
    const out = new Map();
    for (const [sp, ids] of bySpecies) out.set(sp, ids.sort().join(' '));
    return out;
}

// Juveniles in a habitat with a relative of the other sex: the moment the
// game lets go of each one (kinwatch.js), kinConflicts has a pair. -> [id]
export function calvesToWatch(model) {
    const byPlace = new Map();
    for (const a of model ? model.animals.values() : []) {
        if (a.exhibit || a.alive === false || !a.hab || a.lt !== 'habitat' || isCollective(model, a.species)) continue;
        const k = `${a.species}|${a.hab}`;
        if (!byPlace.has(k)) byPlace.set(k, []);
        byPlace.get(k).push(a);
    }
    const out = [];
    for (const list of byPlace.values()) {
        for (const a of list) if (a.juv && !a.moving && list.some(b => kinPair(model, a, b))) out.push(a.id);
    }
    return out;
}

// ------------------------------------------------------------------ texts

export function sexMark(a) {
    return a && a.sex === Sex.Male ? '♂' : a && a.sex === Sex.Female ? '♀' : '';
}

export function actionText(model, x, destinations) {
    const a = model && model.animals.get(String(x.id));
    if (!a) return String(x.id);
    return moveText(model, x, destinations);
}

// The park's calendar as one number: months since the start of year 0
// (Year*12 + Month-1 + the part of the month gone). gate: PZ2QoL_AutoGate's
// answer. null when the game gave no date.
export function calendarMonths(gate) {
    if (!gate || typeof gate.year !== 'number' || typeof gate.month !== 'number') return null;
    const p = typeof gate.monthProp === 'number' ? Math.max(0, Math.min(1, gate.monthProp)) : 0;
    return gate.year * 12 + (gate.month - 1) + p;
}

// "1 month", "1 season", "2 seasons", "1 year"
export function everyWords(months) {
    if (months === 12) return '1 year';
    if (months % 3 === 0) return months === 3 ? '1 season' : `${months / 3} seasons`;
    return months === 1 ? '1 month' : `${months} months`;
}

export function everyText(months) {
    return months === 12 ? 'every year' : months === 3 ? 'every season' : `every ${everyWords(months)}`;
}

// Game time left, in months: "in 2 months", "in half a month", "now".
export function dueText(months) {
    if (!(months > 0.02)) return 'now';
    if (months < 0.75) return 'in under a month';
    const m = Math.round(months * 2) / 2;
    return `in ${m === 1 ? '1 month' : `${m} months`}`;
}

// The same in real time at the speed the game runs now ("about 4 min"), or
// '' while it is paused or not measured yet. rate: months per real ms.
export function realTimeText(months, rate) {
    if (!(months > 0) || !(rate > 0)) return '';
    const s = months / rate / 1000;
    if (s < 60) return 'under a minute';
    const m = Math.round(s / 60);
    return m < 90 ? `about ${m} min` : `about ${Math.round(m / 60 * 10) / 10} h`;
}
