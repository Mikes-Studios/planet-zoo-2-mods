// Unique names for newborns (park HUD). The game names a calf from a short
// list per species, so names repeat across a zoo; each newborn instead gets
// a name from kinnamelist.js that no animal in the park or Animal Storage
// has, in random order: each list is shuffled and dealt in rounds, every
// name once before it comes round again. The deck is kept per zoo
// (userstore). Animals already named keep their names.
import { getKinSettings, onKin } from '/js/mods/pz2qol/kin.js';
import { isCollective } from '/js/mods/pz2qol/kincore.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { getUserData, setUserData, userDataEpoch, userDataStatus } from '/js/mods/pz2qol/userstore.js';
import { storedRowAges } from '/js/mods/pz2qol/storedages.js';
import { chosenGroups, dealName, listFor, nameKey, namesOf } from '/js/mods/pz2qol/kinnamescore.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

const DATA_KEY = 'kinNames';
// a calf this young when the scan first lists it was born since the last scan (game years)
const NEWBORN_YEARS = 0.25;
const SEED_RANGE = 4294967296;
// a scan sharing fewer of its animals with the last one is another zoo
const SAME_ZOO_SHARE = 0.5;

function sameZoo(seen, model) {
    let shared = 0;
    for (const id of model.animals.keys()) if (seen.has(id)) shared++;
    return shared >= Math.min(seen.size, model.animals.size) * SAME_ZOO_SHARE;
}

// born in the park: a parent lives here (a calf brought from Animal Storage
// at age 0 was born there, and keeps the name the player knows it by)
function bornHere(a, model) {
    return (a.par || []).some(g => model.byGuid && model.byGuid.has(g));
}

function takenNames(model, given) {
    const taken = new Set(given);
    for (const a of model.animals.values()) taken.add(nameKey(a.name));
    for (const e of storedRowAges()) taken.add(nameKey(e.n));
    return taken;
}

function rename(a, taken, given, groups) {
    const decks = Object.assign({}, getUserData(DATA_KEY));
    const list = listFor(a.sex, decks);
    // a deck dealt from other groups starts a new round
    const g = groups.join(',');
    const deck = decks[list] && decks[list].g === g ? decks[list] : null;
    const pick = dealName(namesOf(list, groups), deck, taken, () => Math.floor(Math.random() * SEED_RANGE));
    if (!pick) return;
    setUserData(DATA_KEY, Object.assign(decks, { [list]: Object.assign(pick.deck, { g }) }));
    taken.add(nameKey(pick.name));
    given.add(nameKey(pick.name));
    try {
        engine.trigger('PZ2QoL_KinRename', String(a.id), pick.name);
        dlog('kin', 'rename', { species: a.species, from: a.name, to: pick.name });
    }
    catch (e) {
        reportError('ui', 'A newborn could not be renamed: the mod\'s Lua part did not answer.', e, { silent: true });
    }
}

export function installKinNames() {
    if (!isHudPage()) return true;
    // this zoo load's animals (null until the first scan) and the names asked for
    let seen = null;
    let epoch = -1;
    const given = new Set();
    onKin(model => {
        if (!model || !model.animals || userDataStatus() !== 'file') return;
        if (!seen || epoch !== userDataEpoch() || !sameZoo(seen, model)) {
            seen = new Set(model.animals.keys());
            epoch = userDataEpoch();
            given.clear();
            return;
        }
        const settings = getKinSettings() || {};
        const groups = chosenGroups(settings);
        const on = settings.uniqueNames !== false && groups.length > 0;
        let taken = null;
        for (const a of model.animals.values()) {
            if (seen.has(a.id)) continue;
            seen.add(a.id);
            if (!on || !a.juv || a.alive === false || !(a.age < NEWBORN_YEARS) || isCollective(model, a.species) || !bornHere(a, model)) continue;
            taken = taken || takenNames(model, given);
            rename(a, taken, given, groups);
        }
    });
    return true;
}
