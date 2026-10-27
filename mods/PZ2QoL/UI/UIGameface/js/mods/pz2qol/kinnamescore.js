// Picking a newborn's name (kinnames.js). Pure (Node tests).
import { NAME_GROUPS, nameGroupSetting } from './kinnamelist.js';
import { Sex } from './kincore.js';
import { randomSource } from './kinprogramme.js';

export function nameKey(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
}

const dealt = d => (d && d.n) || 0;

// The list a newborn draws from: 'f' or 'm' by its sex; without one, the
// list that gave fewer names so far. decks: { f, m } (dealName's decks).
export function listFor(sex, decks) {
    if (sex === Sex.Female) return 'f';
    if (sex === Sex.Male) return 'm';
    return dealt(decks.f) <= dealt(decks.m) ? 'f' : 'm';
}

// The name groups the player picked (settings: the Kin settings) -> [key]
export function chosenGroups(settings) {
    return NAME_GROUPS.filter(g => (settings || {})[nameGroupSetting(g.key)] !== false).map(g => g.key);
}

// The names of a list ('f' | 'm') in the chosen groups, in group order.
export function namesOf(list, groups) {
    const side = list === 'f' ? 'female' : 'male';
    return NAME_GROUPS.filter(g => groups.includes(g.key)).flatMap(g => g[side]);
}

// The names in a round's random order, the same for the same seed.
export function shuffled(names, seed) {
    const rnd = randomSource(seed);
    const out = names.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// The first name of `names` from position `from` on that no animal has
// (taken: a Set of nameKey), round from the end to the start again.
// -> { name, next (where the list stops now), wrapped (it went round) },
// or null when every name is taken
export function pickName(names, from, taken) {
    const start = Math.max(0, from || 0) % names.length;
    for (let k = 0; k < names.length; k++) {
        const i = (start + k) % names.length;
        if (!taken.has(nameKey(names[i]))) return { name: names[i], next: (i + 1) % names.length, wrapped: i < start };
    }
    return null;
}

// The next name of a list dealt in rounds: each round the list is shuffled
// and every name comes up once before the next round shuffles them again;
// a name an animal has is skipped. deck: { at, seed, n } (anything else
// starts a round); newSeed() -> a seed for a new round.
// -> { name, deck } or null when every name is taken
export function dealName(names, deck, taken, newSeed) {
    const d = deck && typeof deck === 'object' && deck.seed != null ? deck : { at: 0, seed: newSeed(), n: 0 };
    let seed = d.seed;
    let pick = pickName(shuffled(names, seed), d.at, taken);
    if (!pick) return null;
    if (pick.wrapped) {
        seed = newSeed();
        pick = pickName(shuffled(names, seed), 0, taken);
    }
    const roundOver = pick.next === 0;
    return { name: pick.name, deck: { at: pick.next, seed: roundOver ? newSeed() : seed, n: dealt(d) + 1 } };
}
