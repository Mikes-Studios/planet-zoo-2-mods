// Muted species: no kin alerts (toasts) for them, per zoo. Badges, the
// planner and the Species board still show every pair; the board's species
// rail dims them and lists them last. Kept in the zoo's player-store data
// (userstore.js key 'kinMute' = { <species>: true }), like 'kinRatio'.
import { getUserData, updateUserData, onUserData } from '/js/mods/pz2qol/userstore.js';
import { breadcrumb } from '/js/mods/pz2qol/errors.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

const STORE = 'kinMute';
const listeners = new Set();

function notify() {
    callAll(listeners);
}

// the zoo's data arrived (another zoo, or the file after a click)
onUserData(() => notify());

export function mutedSpecies() {
    const v = getUserData(STORE);
    const out = new Set();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sp, on] of Object.entries(v)) if (on) out.add(sp);
    }
    return out;
}

export function isMuted(species) {
    if (!species) return false;
    const v = getUserData(STORE);
    return !!(v && typeof v === 'object' && v[species]);
}

// Idempotent ("on" or "off", never a toggle): replayed on top of the zoo's
// data if that is read after the click.
export function setMuted(species, on) {
    if (!species) return;
    updateUserData(STORE, old => {
        const all = Object.assign({}, old && typeof old === 'object' && !Array.isArray(old) ? old : {});
        if (on) all[species] = true;
        else delete all[species];
        return Object.keys(all).length ? all : undefined;
    });
    breadcrumb(on ? 'kin_mute_on' : 'kin_mute_off');
    notify();
}

export function onMuted(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
