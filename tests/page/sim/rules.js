// The owner's breeding rules as checks on Auto mode's runs. STEP rules hold
// for every run (what it moves); SETTLED rules for the zoo once a run has
// nothing left to move (Auto mode runs again while it moves animals, as in
// the game). Each check returns the broken cases as text.
// "When possible" is judged here on its own terms (a free, unrelated breeder
// of the standard that could go there without breaking another pair or the
// game's limits), not by asking the planner, so a planner mistake shows.
import { AUTO_LIMITS, planAutoRun, relatedAdultPairs, storageAdditions, storageTrial, storageUpgrades, bestFreshBlood } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { mustHouse, simulatePlan } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { YOUNG_MARGIN, conceptionChance, isBreeder, longevityWeight, noFertility, planProgramme, relatedPair, weakBreeders, youngQuality } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { freshBloodNeeds } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinbloodline.js';
import { growthOf } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinlife.js';
import { ownGrades } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { ELDERLY_WARNING_YEARS, pastSelling, sellsBeforeElderly, yearsToElderly } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js';
import { Sex, TRADE } from '../zoo.js';

// the rules the tests hold
export const RULES = ['kin', 'kinLeft', 'solo', 'juveniles', 'untouchable', 'ageing', 'destinations', 'limits', 'pairs', 'housed', 'extras', 'needs', 'sell', 'settled', 'stored', 'flipflop', 'inbred'];

const other = sex => (sex === Sex.Male ? Sex.Female : Sex.Male);
const homeOf = a => a.hab || (a.lt === 'trade' ? TRADE : '');

// One species' run on the world's zoo as it stands.
export function runAuto(world, sp, model = world.model, view = world.viewOf(sp)) {
    return planAutoRun({ model, species: sp, info: world.infoOf(sp), assignments: world.assignments, settings: world.settings, view });
}

// What the checks need to know about the zoo before and after a run.
function facts(world, sp, run, before, view) {
    const after = simulatePlan(before, run.moves, null);
    const pinned = new Set(view.pinned);
    const leaving = new Set(view.leaving);
    for (const m of run.moves) if (m.leave) leaving.add(String(m.id));
    const useTrade = world.settings.trade !== false;
    const mine = m => Array.from(m.animals.values()).filter(a => a.species === sp && !a.exhibit && a.alive !== false);
    const startKin = new Set(((relatedAdultPairs(before).get(sp)) || []).flat());
    const adultsAt = (m, hab) => mine(m).filter(a => !a.juv && homeOf(a) === hab);
    const hasOtherSex = (m, a) => adultsAt(m, homeOf(a)).some(b => b.sex === other(a.sex));
    const locked = new Set(view.cooled.filter(id => {
        const a = before.animals.get(id);
        return a && !startKin.has(id) && !(a.juv && a.lt === 'trade') && !(a.lt === 'habitat' && !a.juv && !hasOtherSex(before, a));
    }));
    // one held at the trade centre (leaving, hands off, locked) never breeds here
    const held = a => a.lt === 'trade' && !mustHouse(a) && (pinned.has(a.id) || locked.has(a.id) || view.leaving.includes(a.id));
    // the breeding standard, as the planner judges it on the zoo before the run
    const able = mine(before).filter(a => isBreeder(a) && !noFertility(a) && !a.moving && (useTrade || a.lt !== 'trade') && !held(a));
    const assigned = world.assignments ? Array.from(world.assignments).filter(([, set]) => set.has(sp)).map(([h]) => h) : [];
    // a habitat set aside for the species keeps a breeder of each sex, weak or not
    const weak = weakBreeders(before, able, YOUNG_MARGIN, assigned.length);
    // the owner's standard: a 0% fertility gene never conceives
    const good = a => isBreeder(a) && !noFertility(a) && !weak.has(a.id);
    // a match: unrelated, and young can come of it (the planner's pair value above 0)
    const info = world.infoOf(sp);
    const match = (m, x, y) => !relatedPair(m, x, y) && youngQuality(x, y) * conceptionChance(x, y, info) * longevityWeight(x, y, info) > 0;
    // none set aside: where it lives, but not a habitat set aside for other
    // species only unless one of its breeders lives there (kinprogramme prepare)
    const othersOnly = h => world.assignments && world.assignments.has(h) && !world.assignments.get(h).has(sp);
    const breederIn = h => mine(before).some(a => a.hab === h && good(a));
    const allowed = new Set(assigned.length ? assigned : mine(before).map(a => a.hab).filter(h => h && (!othersOnly(h) || breederIn(h))));
    const rule = run.programme && run.programme.rule;
    // each habitat's room for adults of the species, as the plan measured it (null: no limit)
    const capacity = new Map(((run.programme && run.programme.groups) || []).map(g => [String(g.hab), g.capacity]));
    return { sp, before, after, run, view, pinned, leaving, locked, good, match, allowed, rule, capacity, useTrade, mine, adultsAt };
}

// within a year of elderly: Auto mode only ever sends it to the trade centre
function nearElderly(a) {
    const years = yearsToElderly(a.species, a.age);
    return years != null && years > 0 && years <= ELDERLY_WARNING_YEARS && sellsBeforeElderly(a.species);
}

// at the trade centre and elderly within a move's cooldown of the ageing
// step, with another breeder of its sex in a habitat: it stays there
function staysAway(f, a) {
    const years = yearsToElderly(a.species, a.age);
    if (a.lt !== 'trade' || years == null || years > ELDERLY_WARNING_YEARS + AUTO_LIMITS.cooldownYears || !sellsBeforeElderly(a.species)) return false;
    return f.mine(f.before).some(b => b.id !== a.id && b.sex === a.sex && b.lt === 'habitat' && isBreeder(b) && !noFertility(b));
}

// Auto mode may move `a` into a group (as the zoo stands after the run).
function free(f, a) {
    if (!a || a.juv || a.moving || a.preg || a.alive === false || a.exhibit || nearElderly(a) || staysAway(f, a)) return false;
    if (f.pinned.has(a.id) || f.locked.has(a.id)) return false;
    if (a.lt === 'trade') return f.useTrade && !f.leaving.has(a.id);
    return a.lt === 'habitat';
}

// An unrelated breeding pair of the standard at `hab`, leaving out `without`.
function hasPair(f, m, hab, without = new Set()) {
    const here = f.adultsAt(m, hab).filter(a => !without.has(a.id) && f.good(a));
    return here.some(x => x.sex === Sex.Male && here.some(y => y.sex === Sex.Female && f.match(m, x, y)));
}

// The game's most per sex at `hab` still holds with `add` there too, for
// each sex `add` brings (a habitat already over on the other sex takes it),
// and so does its room.
function fits(f, m, hab, add) {
    const r = f.rule;
    if (!r) return true;
    const cap = f.capacity.get(String(hab));
    if (cap != null && f.adultsAt(m, hab).length + add.filter(a => homeOf(a) !== hab).length > cap) return false;
    const coming = sex => add.filter(a => a.sex === sex && homeOf(a) !== hab).length;
    const count = sex => f.adultsAt(m, hab).filter(a => a.sex === sex && (r.capsFromGame || isBreeder(a))).length + coming(sex);
    const ok = (sex, max) => max == null || !coming(sex) || count(sex) <= max;
    return ok(Sex.Male, r.maxMales) && ok(Sex.Female, r.maxFemales);
}

// A juvenile growing up within Auto mode's growUpSoonYears: kin like an adult.
function growsUpSoon(a) {
    const g = growthOf(a);
    return !!(g && g.kind === 'adult' && g.years <= AUTO_LIMITS.growUpSoonYears);
}

// `list` can move to `hab`: free, allowed there, no relative of the other
// sex there (an adult, or a juvenile: the planner keeps adults from moving
// in beside one, juvenileKinCost), and every group they leave keeps its pair.
function canBring(f, m, hab, list) {
    if (!f.allowed.has(hab)) return false;
    const there = f.mine(m).filter(a => homeOf(a) === hab);
    for (const a of list) {
        // one already there must leave when a relative of the other sex grows up beside it (the planner's growUpSoonYears)
        if (homeOf(a) === hab) {
            if (there.some(b => b.juv && b.sex === other(a.sex) && growsUpSoon(b) && relatedPair(m, a, b))) return false;
            continue;
        }
        if (!free(f, a)) return false;
        if (there.some(b => b.sex === other(a.sex) && relatedPair(m, a, b))) return false;
    }
    const leaving = new Set(list.filter(a => homeOf(a) !== hab).map(a => a.id));
    for (const from of new Set(list.map(homeOf))) {
        if (from === hab || from === TRADE) continue;
        if (hasPair(f, m, from) && !hasPair(f, m, from, leaving)) return false;
    }
    return fits(f, m, hab, list);
}

// A pair that could be made at `hab`. -> [male, female] or null
function possiblePair(f, m, hab) {
    const cand = f.mine(m).filter(a => !a.juv && f.good(a));
    for (const x of cand.filter(a => a.sex === Sex.Male)) {
        for (const y of cand.filter(a => a.sex === Sex.Female)) {
            if (f.match(m, x, y) && canBring(f, m, hab, [x, y])) return [x, y];
        }
    }
    return null;
}

// A partner of `sex` that could join `hab`'s breeders. -> animal or null
function possiblePartner(f, m, hab, sex) {
    const mates = f.adultsAt(m, hab).filter(a => a.sex === other(sex) && f.good(a) && canBring(f, m, hab, [a]));
    return f.mine(m).find(a => !a.juv && a.sex === sex && f.good(a) && homeOf(a) !== hab
        && mates.some(b => f.match(m, a, b)) && canBring(f, m, hab, [a])) || null;
}

const name = a => (a ? a.id : '?');

export const STEP_RULES = {
    // never inbreed: the run makes no related adult pair the zoo did not have
    kin(f) {
        const keys = m => new Set(((relatedAdultPairs(m).get(f.sp)) || []).map(p => p.join('+')));
        const before = keys(f.before);
        return Array.from(keys(f.after)).filter(k => !before.has(k)).map(k => `related pair ${k} put together`);
    },
    // juveniles are never moved (one waiting at the trade centre goes back to a habitat)
    juveniles(f) {
        return f.run.moves.filter(mv => {
            const a = f.before.animals.get(String(mv.id));
            return a && a.juv && !(a.lt === 'trade' && mv.to !== TRADE);
        }).map(mv => `juvenile ${mv.id} moved to ${mv.to}`);
    },
    // pregnant, hands off, locked (without a reason to lift it) and leaving
    // animals stay; the golden rule takes a pregnant or young one waiting at
    // the trade centre into a habitat whatever it has
    untouchable(f) {
        const out = [];
        for (const mv of f.run.moves) {
            const a = f.before.animals.get(String(mv.id));
            if (!a || (mustHouse(a) && mv.to !== TRADE)) continue;
            if (a.preg) out.push(`pregnant ${a.id} moved`);
            if (f.pinned.has(a.id)) out.push(`hands-off ${a.id} moved`);
            // the ageing step goes past a move's cooldown: elderly, it can't be sold
            if (f.locked.has(a.id) && mv.stage !== 'ageing') out.push(`locked ${a.id} moved with no reason to lift the lock`);
            if (a.lt === 'trade' && !a.juv && f.view.leaving.includes(a.id)) out.push(`${a.id}, sent to the trade centre to leave, brought back`);
        }
        return out;
    },
    // a breeder near elderly goes to the trade centre to be sold (hands off, a
    // pregnancy, the species' last breeder of its sex and a full trade centre
    // keep it), and one at the trade centre is never brought back unless no
    // other breeder of its sex lives in a habitat (the species' last chance of young)
    ageing(f) {
        const near = nearElderly;
        const kept = new Set(((f.run.held) || []).map(h => String(h.id)));
        const out = [];
        for (const mv of f.run.moves) {
            const a = f.before.animals.get(String(mv.id));
            const otherOfSex = a && f.mine(f.before).some(b => b.id !== a.id && b.sex === a.sex && b.lt === 'habitat' && isBreeder(b) && !noFertility(b));
            if (a && !a.juv && a.lt === 'trade' && mv.to !== TRADE && near(a) && !mustHouse(a) && otherOfSex) out.push(`${a.id}, near elderly, brought back from the trade centre`);
        }
        for (const a of f.mine(f.after)) {
            // past selling it lives out its life where it is
            if (a.juv || a.lt !== 'habitat' || !near(a) || a.preg || pastSelling(a) || f.pinned.has(a.id) || kept.has(String(a.id))) continue;
            const others = f.mine(f.before).filter(b => b.id !== a.id && b.sex === a.sex && !b.juv && isBreeder(b) && !near(b));
            if (others.length) out.push(`${a.id}, near elderly, left in ${a.hab}`);
        }
        return out;
    },
    // animals go only to a habitat set aside for the species, or the trade centre
    destinations(f) {
        return f.run.moves.filter(mv => mv.to !== TRADE && !f.allowed.has(String(mv.to))).map(mv => `${mv.id} sent to ${mv.to}, not a habitat of the species`);
    },
    // the game's most per sex in a habitat is never newly broken (sandbox: none)
    limits(f) {
        const r = f.rule;
        if (!r || !r.capsFromGame) return [];
        const out = [];
        for (const hab of f.allowed) {
            for (const [sex, max] of [[Sex.Male, r.maxMales], [Sex.Female, r.maxFemales]]) {
                if (max == null) continue;
                const n = m => f.adultsAt(m, hab).filter(a => a.sex === sex).length;
                if (n(f.after) > max && n(f.after) > n(f.before)) out.push(`${hab}: ${n(f.after)} ${sex === Sex.Male ? 'males' : 'females'}, the most is ${max}`);
            }
        }
        return out;
    },
};

export const SETTLED_RULES = {
    // never inbreed: no related adult pair left living together while one of them could move
    // (a contracepted one does not breed while the player keeps it so)
    kinLeft(f) {
        const pair = ids => ids.map(id => f.after.animals.get(id));
        return ((relatedAdultPairs(f.after).get(f.sp)) || [])
            .filter(ids => pair(ids).every(a => !a.contra) && pair(ids).some(a => free(f, a)))
            .map(p => `related pair ${p.join('+')} left together though one could move`);
    },
    // every habitat of the species keeps a breeding pair while the zoo has one to give
    pairs(f) {
        const out = [];
        for (const hab of f.allowed) {
            if (hasPair(f, f.after, hab)) continue;
            const p = possiblePair(f, f.after, hab);
            if (p) out.push(`${hab} has no breeding pair though ${name(p[0])} and ${name(p[1])} could make one`);
        }
        return out;
    },
    // no breeder of the standard alone while a partner could come to it (one
    // that could join another group stays and asks: it adds no young there)
    solo(f) {
        const out = [];
        for (const a of f.mine(f.after)) {
            if (a.juv || a.lt !== 'habitat' || a.preg || a.contra || !f.good(a) || !canBring(f, f.after, homeOf(a), [a])) continue;
            const hab = homeOf(a);
            if (f.adultsAt(f.after, hab).some(b => b.sex === other(a.sex) && isBreeder(b) && f.match(f.after, a, b))) continue;
            // only the leader of its sex mates: beside another, a partner coming in goes to the leader
            const leads = f.rule && (a.sex === Sex.Male ? f.rule.leaderMale : f.rule.leaderFemale);
            if (leads && f.adultsAt(f.after, hab).some(b => b !== a && b.sex === a.sex && f.good(b))) continue;
            // one male per group of females (a harem, the sandbox's one sire): a male there holds the place
            const harem = f.rule && (f.rule.oneSire || (f.rule.m === 1 && f.rule.f > 1));
            if (harem && a.sex === Sex.Female && f.adultsAt(f.after, hab).some(b => b.sex === Sex.Male && f.good(b))) continue;
            const come = possiblePartner(f, f.after, hab, other(a.sex));
            if (come) out.push(`${a.id} alone in ${hab} though ${come.id} could join`);
        }
        return out;
    },
    // the golden rule: no pregnant or young animal waits at the trade centre
    // while a habitat of the species can take it (a pregnant one: no relative
    // of the other sex there, adult or young, and within the game's most per
    // sex; a young one goes home to its family)
    housed(f) {
        const out = [];
        for (const a of f.mine(f.after)) {
            if (!mustHouse(a)) continue;
            const could = Array.from(f.allowed).find(hab => a.juv
                || (!f.mine(f.after).some(b => b !== a && homeOf(b) === hab && b.sex === other(a.sex) && relatedPair(f.after, a, b)) && fits(f, f.after, hab, [a])));
            if (could) out.push(`${a.juv ? 'young' : 'pregnant'} ${a.id} waits at the trade centre though ${could} could take it`);
        }
        return out;
    },
    // a breeder of the standard waiting at the trade centre joins a habitat
    // whose male can take another female (a leader male, a harem under its
    // females per male, or mixed mating) and would breed with her
    extras(f) {
        const r = f.rule;
        if (!r) return [];
        const room = hab => {
            const at = f.adultsAt(f.after, hab);
            const males = at.filter(b => b.sex === Sex.Male && f.good(b)).length;
            if (r.leaderMale || r.m == null) return males > 0;
            return r.m === 1 && r.f > 1 && at.filter(b => b.sex === Sex.Female && f.good(b)).length < males * r.f;
        };
        const out = [];
        for (const a of f.mine(f.after)) {
            if (a.sex !== Sex.Female || a.lt !== 'trade' || !free(f, a) || !f.good(a)) continue;
            const hab = Array.from(f.allowed).find(h => room(h) && canBring(f, f.after, h, [a])
                && f.adultsAt(f.after, h).some(b => b.sex === Sex.Male && f.good(b) && f.match(f.after, a, b)));
            if (hab) out.push(`${a.id} waits at the trade centre though ${hab}'s male could breed with her`);
        }
        return out;
    },
    // a need asks only for what no animal in the zoo can give
    needs(f) {
        const out = [];
        for (const n of (f.run.programme && f.run.programme.needs) || []) {
            if (n.sex === 'pair') {
                const p = possiblePair(f, f.after, n.hab);
                if (p) out.push(`${n.hab} asks for a pair though ${name(p[0])} and ${name(p[1])} could go`);
                for (const sex of [Sex.Male, Sex.Female]) {
                    const spare = f.mine(f.after).find(a => !a.juv && a.sex === sex && f.good(a) && homeOf(a) !== n.hab && canBring(f, f.after, n.hab, [a]));
                    if (spare && !p) out.push(`${n.hab} asks for a pair though ${spare.id} could go: one sex is enough to ask for`);
                }
                continue;
            }
            const come = possiblePartner(f, f.after, n.hab, n.sex);
            if (come) out.push(`${n.hab} asks for a ${n.sex === Sex.Male ? 'male' : 'female'} though ${come.id} could go`);
        }
        return out;
    },
    // sell advice never names a juvenile, a pregnant animal, the last of its sex, or a pair's only partner
    sell(f) {
        const out = [];
        const list = (f.run.programme && f.run.programme.sellable) || [];
        for (const x of list) {
            const a = f.after.animals.get(String(x.id));
            if (!a) continue;
            if (a.juv || a.preg) out.push(`sell advice names ${a.juv ? 'juvenile' : 'pregnant'} ${a.id}`);
            const hab = homeOf(a);
            if (hab && hab !== TRADE && hasPair(f, f.after, hab) && !hasPair(f, f.after, hab, new Set([a.id]))) out.push(`sell advice names ${a.id}, the partner ${hab}'s pair needs`);
            const same = f.mine(f.after).filter(b => b !== a && !b.juv && b.sex === a.sex && f.good(b) && b.lt === 'habitat');
            // a 0% fertility gene is sell advice by the mod's own rule, even the last of its sex
            if (!same.length && f.good(a) && ownGrades(a.genes).fertility > 0) out.push(`sell advice names ${a.id}, the last good breeder of its sex`);
        }
        return out;
    },
};

// Stored-animal suggestions name an animal listed on the market only marked
// listed (Bring from storage cancels the listing); fresh blood never does.
export function storedRules(world, sp) {
    const stored = world.storedOf(sp);
    const listed = new Set(stored.animals.filter(s => s.forSale).map(s => s.guid));
    const out = [];
    for (const u of storageUpgrades(world.model, sp, stored, { assignments: world.assignments })) if (listed.has(String(u.guid)) !== !!u.listed) out.push(`storage upgrade marks ${u.name} wrongly as ${u.listed ? '' : 'not '}listed`);
    const trial = storageTrial(world.model, sp, stored);
    if (trial) {
        const plan = planProgramme(trial.model, sp, world.infoOf(sp), null, { assignments: world.assignments, options: { pinIds: trial.pinIds } });
        for (const x of storageAdditions(trial, plan)) {
            const s = stored.animals.find(a => a.guid === x.guid);
            if (s.juv) out.push(`storage addition names young ${x.name}`);
            if (!!s.forSale !== !!x.listed) out.push(`storage addition marks ${x.name} wrongly as ${x.listed ? '' : 'not '}listed`);
            // a relative past breeding is no risk (kincore relatedAdultPairs), nor a young one
            // until it grows up soon (the planner's growUpSoonYears: one of them moves then)
            const kin = Array.from(world.model.animals.values()).find(b => b.species === sp && b.hab === x.hab && b.sex === other(s.sex)
                && !(b.fert && b.fert.state === 'old') && (!b.juv || growsUpSoon(b)) && relatedPair(trial.model, trial.model.animals.get(s.id), b));
            if (kin) out.push(`storage addition puts ${x.name} beside ${kin.id}, a relative of the other sex`);
        }
    }
    for (const need of freshBloodNeeds(world.model, sp)) {
        const pick = bestFreshBlood(world.model, sp, stored, need);
        if (pick && listed.has(String(pick.guid))) out.push(`fresh blood names listed ${pick.name}`);
    }
    return out;
}

// One set of rules on one run. -> [{ rule, text }]
export function checkRun(world, sp, run, { model, view, rules, only = null }) {
    const f = facts(world, sp, run, model, view);
    const out = [];
    for (const [rule, check] of Object.entries(rules)) {
        if (only && !only.includes(rule)) continue;
        for (const text of check(f)) out.push({ rule, text });
    }
    return out;
}
