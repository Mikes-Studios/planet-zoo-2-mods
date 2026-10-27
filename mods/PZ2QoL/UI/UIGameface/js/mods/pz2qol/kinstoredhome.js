// Animals in Animal Storage that belong in a habitat (park HUD). Nothing
// ages in storage: a calf there (born to a mother sent away pregnant) never
// grows up, and one too old to trade (the server refuses it within three
// years of elderly) never leaves. For a species of this park the mod moves
// (on Auto, or every one while Clean up empties the zoo), the ones the Storage window
// lists (storedages.js) get one notice per species, kind and zoo load, with
// one Bring from storage for all of them; at the trade centre Auto mode
// houses them (youngBackMoves, adultBackMoves). Storage is shared by every
// Franchise zoo: another zoo's animals are not this one's to bring. The Kin
// setting Animals to bring out of storage switches the notices off.
import { getKinModel, getKinSettings } from '/js/mods/pz2qol/kin.js';
import { autoManages } from '/js/mods/pz2qol/kinauto.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { kinToast } from '/js/mods/pz2qol/kinalerts.js';
import { onStoredRows } from '/js/mods/pz2qol/storedages.js';
import { bringFromStorage } from '/js/mods/pz2qol/storagefetch.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';

function inPark(model, species) {
    for (const a of model ? model.animals.values() : []) if (a.species === species) return true;
    return false;
}

const KINDS = {
    young: {
        kind: 'storedYoung',
        what: (n, first) => (n === 1 ? `${first || 'a young one'} is young` : `${n} young`),
        why: n => `can't grow up there, since nothing ages in storage. Bring ${n === 1 ? 'it' : 'them'} out: at the trade centre ${n === 1 ? 'it goes' : 'they go'} to a habitat to grow up (Auto mode places them for its species).`,
    },
    old: {
        kind: 'storedOld',
        what: (n, first) => (n === 1 ? `${first || 'one'} is too old to trade` : `${n} too old to trade`),
        why: n => `can't be sold, released or quick traded this close to elderly, and nothing ages in storage, so ${n === 1 ? 'it stays' : 'they stay'} there for good. Bring ${n === 1 ? 'it' : 'them'} out: at the trade centre Auto mode puts ${n === 1 ? 'it' : 'them'} in a habitat to live out ${n === 1 ? 'its life' : 'their lives'}.`,
    },
};

function tell(species, way, animals) {
    const names = animals.map(e => e.nm).filter(Boolean);
    const k = KINDS[way];
    const n = animals.length;
    kinToast({
        severity: 'risk', level: 'action', kind: k.kind, species,
        title: `${speciesName(species)}: ${k.what(n, names[0])} in Animal Storage`,
        text: `${n === 1 ? 'It' : `${names.join(', ')}: they`} ${k.why(n)}`,
        actions: [{
            label: 'Bring from storage', icon: 'IconTrade', primary: true,
            run: () => bringFromStorage(getKinModel(), species, { match: animals.map(e => ({ sex: e.x, name: e.nm, genes: e.p })) }),
        }],
    });
}

export function installStoredHome() {
    if (!isHudPage()) return true;
    const told = new Set();
    onStoredRows(entries => {
        if ((getKinSettings() || {}).storedHomeAlert === false) return;
        const model = getKinModel();
        const found = new Map();
        for (const e of entries) {
            if (!e.y || !autoManages(e.y) || !inPark(model, e.y)) continue;
            const key = `${e.s}|${e.x}|${e.n}|${(e.p || []).join('.')}`;
            if (told.has(key)) continue;
            told.add(key);
            const group = `${e.y}|${e.o ? 'old' : 'young'}`;
            if (!found.has(group)) found.set(group, []);
            found.get(group).push(e);
        }
        for (const [group, animals] of found) {
            const [species, way] = group.split('|');
            tell(species, way, animals);
        }
    });
    return true;
}
