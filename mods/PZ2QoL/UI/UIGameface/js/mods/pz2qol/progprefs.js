// The Breeding programme's choices, shared by the Species board, the
// Breeding window and Auto mode so all of them plan alike and share their
// results: the group make-up per species (kept per zoo, userstore.js), the
// "Fewer moves <-> Best genetics" slider (the player's default for every
// zoo, prefs.js), the Classic search budget, the key a plan is kept under,
// the habitats the game is asked about, and the make-up in words.
import { getPref, setPref } from '/js/mods/pz2qol/prefs.js';
import { getUserData, updateUserData } from '/js/mods/pz2qol/userstore.js';
import { PROGRAMME_DEFAULT_STEP, PROGRAMME_SEARCH, PROGRAMME_STEPS, RATIO_CHOICES, groupRule, ratioKey } from '/js/mods/pz2qol/kinprogramme.js';
import { TUNE_PREF, applyTuning, tuningKey } from '/js/mods/pz2qol/kinprogtune.js';

export const RATIO_STORE = 'kinRatio';
export const PROG_STEP_PREF = 'progStep';

// ------------------------------------------------------------ make-up

// The group make-up the player chose for a species ('auto': the game's).
export function ratioChoice(species) {
    const all = getUserData(RATIO_STORE);
    const v = all && typeof all === 'object' && !Array.isArray(all) ? all[species] : null;
    return RATIO_CHOICES.includes(v) ? v : 'auto';
}

// Kept per zoo; replayed on top of the zoo's data if that is read later.
export function setRatioChoice(species, choice) {
    updateUserData(RATIO_STORE, old => {
        const all = Object.assign({}, old && typeof old === 'object' && !Array.isArray(old) ? old : {});
        if (choice === 'auto') delete all[species];
        else all[species] = choice;
        return Object.keys(all).length ? all : undefined;
    });
}

// The make-up arrows: the next (dir 1) or previous (-1) choice.
export function stepRatioChoice(species, dir) {
    const i = RATIO_CHOICES.indexOf(ratioChoice(species));
    setRatioChoice(species, RATIO_CHOICES[(i + dir + RATIO_CHOICES.length) % RATIO_CHOICES.length]);
}

// Only the leader breeds (the game's rule for the species): the plan takes
// no make-up, so there is none to choose.
export function makeupFixed(rule) {
    return !!rule && rule.source === 'leader';
}

// The make-up a plan uses: the player's choice, or 'auto' where the game
// fixes it (a choice that changes nothing must not start a new search).
export function planRatio(species, info) {
    return makeupFixed(groupRule(info || {}, 'auto')) ? 'auto' : ratioChoice(species);
}

const ratioPart = v => (v === Infinity ? 'any' : String(v));

// '1♂ : 3♀', '1♂ : any ♀', 'mixed', 'leader ♂'
export function makeupShort(rule) {
    if (rule.leaderMale && rule.leaderFemale) return 'leader pair';
    if (rule.leaderMale) return 'leader ♂';
    if (rule.leaderFemale) return 'leader ♀';
    return ratioKey(rule) === 'mixed' ? 'mixed' : `${ratioPart(rule.m)}♂ : ${ratioPart(rule.f)}♀`;
}

// The make-up in words, for a panel's subtitle.
export function makeupWords(rule) {
    const key = ratioKey(rule);
    let w;
    if (rule.leaderMale && rule.leaderFemale) w = 'Only the leading pair breeds';
    else if (rule.leaderMale) w = 'Only the leading male breeds, with every female';
    else if (rule.leaderFemale) w = 'Only the leading female breeds, with every male';
    else if (key === 'mixed') w = rule.source === 'none' ? 'Unknown: mixed groups' : 'Mixed groups';
    else if (key === '1:*') w = 'Harem: one breeding male per habitat';
    else if (key === '*:1') w = 'One breeding female per habitat';
    else if (key === '1:1') w = 'Pairs: one partner each';
    else w = `Groups of ${ratioPart(rule.m)} ♂ to ${ratioPart(rule.f)} ♀`;
    const caps = [rule.maxMales != null ? `${rule.maxMales} ♂` : '', rule.maxFemales != null ? `${rule.maxFemales} ♀` : ''].filter(Boolean);
    return caps.length ? `${w}, at most ${caps.join(' and ')} per habitat` : w;
}

// Where an 'auto' make-up comes from (groupRule's source).
export const RATIO_SOURCE_WORDS = Object.freeze({
    leader: 'the game: only the leader breeds',
    yours: 'your choice',
    game: "the game's most per sex",
    groups: "the game's social groups",
    mating: 'the mating system',
    none: 'not known',
    sandbox: "your sandbox settings: with social groups off, one male per habitat (so every juvenile's father is known) and any number of females",
});

// ------------------------------------------------------------- slider

export function savedProgStep() {
    const v = getPref(PROG_STEP_PREF);
    return Number.isInteger(v) && v >= 0 && v < PROGRAMME_STEPS.length ? v : PROGRAMME_DEFAULT_STEP;
}

// The slider's last position is the player's default for every species and zoo.
export function saveProgStep(step) {
    setPref(PROG_STEP_PREF, step === PROGRAMME_DEFAULT_STEP ? undefined : step);
}

// ------------------------------------------------------------ the plan

// p: { species, step, useTrade, info (the game's facts) }. The key a plan
// and its deep results are kept under, with the fine tuning
// (kinprogtune.js; none: the key without it).
export function programmeKey(p) {
    const tk = tuningKey(getPref(TUNE_PREF));
    return `${p.step}|${p.useTrade !== false}|${planRatio(p.species, p.info)}${tk ? `|${tk}` : ''}`;
}

// The optimiser's options for p (both engines).
export function programmeOptions(p) {
    const st = PROGRAMME_STEPS[p.step];
    const o = { moveCost: st.cost, useTradeCentre: p.useTrade !== false, ratio: planRatio(p.species, p.info) };
    if (st.outsider != null) o.outsiderCost = st.outsider;
    return applyTuning(Object.assign(o, PROGRAMME_SEARCH), getPref(TUNE_PREF));
}

// The species' habitats the game should describe: where it lives (not
// exhibits), where it may go (dest: the destination check), and the ones
// set aside for it (assignments: Map habitat -> Set(species)).
export function programmeHabitats(model, species, dest, assignments) {
    const ids = new Set();
    for (const a of model && model.animals ? model.animals.values() : []) if (a.species === species && a.hab && !a.exhibit) ids.add(String(a.hab));
    const d = dest && dest.bySpecies && dest.bySpecies[species];
    if (d) for (const [id, v] of Object.entries(d)) if (v && v.ok) ids.add(String(id));
    for (const [hab, set] of assignments || []) if (set && set.has(species)) ids.add(String(hab));
    return Array.from(ids);
}
