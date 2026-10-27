// Habitat assignments for the Species board: which habitats the player has
// set aside for which species ("these five habitats are for lemurs").
// Kept per zoo through userstore.js, which keeps them on this device in the
// game's player save (every zoo, Franchise included; Steam Cloud carries
// that save to the player's other PCs). Inside a zoo's data they are keyed
// by the park's name. Habitat entity ids change every time the zoo loads, so
// each assignment also keeps its habitat's name, some residents' GUIDs and
// the game's habitat id, and is matched to today's habitats by those
// (kinboardcore resolveAssignments). Saved keys are rewritten to today's ids
// once the zoo's data is read; an assignment whose habitat is not found is
// not shown (no ghost columns) and dropped after a few loads.
import { habitatPrints, printOf, resolveAssignments, rekeyAssignments, assignmentsFromSection, fullHabitatList } from '/js/mods/pz2qol/kinboardcore.js';
import { getUserData, setUserData, updateUserData, loadUserData, onUserData, userDataStatus, userDataReason, userDataEpoch } from '/js/mods/pz2qol/userstore.js';
import { breadcrumb } from '/js/mods/pz2qol/errors.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

const DATA_KEY = 'kinAssign';
const OLD_KEY = 'PZ2QoL.kin.assign.v1'; // earlier builds: localStorage only
const listeners = new Set();
const PAGE = Math.random().toString(36).slice(2, 8);
let rekeyPending = false;
let cache = null;

// this zoo load: an entity id saved under it still means the same habitat
function loadToken() {
    return PAGE + '.' + userDataEpoch();
}

function readAll() {
    const v = getUserData(DATA_KEY);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// once: what earlier builds kept in localStorage (this session only)
(function migrate() {
    try {
        const raw = window.localStorage && window.localStorage.getItem(OLD_KEY);
        if (!raw) return;
        const old = JSON.parse(raw);
        if (old && typeof old === 'object' && !getUserData(DATA_KEY)) setUserData(DATA_KEY, old);
        window.localStorage.removeItem(OLD_KEY);
    }
    catch (e) {
        // nothing to keep
    }
})();

function notify() {
    callAll(listeners);
}

// the zoo's data arrived (or could not be used): redraw with what it holds
onUserData(() => notify());
loadUserData();

// 'loading' | 'file' (kept on this device) | 'memory' (until the game closes)
export function assignmentStorage() {
    return userDataStatus();
}

// why 'memory': 'wait', 'noplayer', 'nopark'... ('' otherwise)
export function assignmentStorageReason() {
    return userDataReason();
}

export function parkKey(model) {
    return (model && model.park) || 'park';
}

function habitatName(model, habId) {
    const h = model && model.habitats.get(String(habId));
    return h && h.name ? h.name : '';
}

function sectionOf(all, key) {
    const v = all && all[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// Once the zoo's data is the truth: saved keys to today's habitat ids, with
// fresh fingerprints (names and residents change while the zoo runs).
function rekeyLater(model, prints, token) {
    if (rekeyPending) return;
    rekeyPending = true;
    setTimeout(() => {
        rekeyPending = false;
        if (assignmentStorage() !== 'file' || token !== loadToken()) return;
        const key = parkKey(model);
        const section = sectionOf(readAll(), key);
        // no full habitat list (older Lua, scan cut short): re-key, but never age entries out
        const countMisses = fullHabitatList(model);
        const next = rekeyAssignments(section, prints, token, { countMisses });
        if (JSON.stringify(next) === JSON.stringify(section)) return;
        breadcrumb('assign_rekey');
        // trace: was the game's habitat id kept across the load? (unproven)
        const { byHab, orphans } = resolveAssignments(section, prints, token);
        for (const [hab, k] of byHab) {
            if (k === hab) continue;
            const e = section[k];
            const p = prints.find(x => x.id === hab);
            breadcrumb(e.hid != null && p && p.hid != null ? (String(e.hid) === p.hid ? 'assign_hid_same' : 'assign_hid_diff') : 'assign_moved');
        }
        if (orphans.length) breadcrumb('assign_orphan');
        updateUserData(DATA_KEY, old => {
            const all = Object.assign({}, old && typeof old === 'object' && !Array.isArray(old) ? old : {});
            const park = rekeyAssignments(sectionOf(all, key), prints, token, { countMisses });
            if (Object.keys(park).length) all[key] = park;
            else delete all[key];
            return all;
        });
        notify();
    }, 0);
}

// habitat id -> Set(species) for this park, only habitats it has now
export function getAssignments(model) {
    const section = sectionOf(readAll(), parkKey(model));
    const token = loadToken();
    if (cache && cache.section === section && cache.model === model && cache.token === token) return cache.out;
    const prints = habitatPrints(model);
    const out = assignmentsFromSection(section, prints, token);
    cache = { section, model, token, out };
    if (prints.length && Object.keys(section).length) rekeyLater(model, prints, token);
    return out;
}

export function assignmentsOf(model, habId) {
    return Array.from(getAssignments(model).get(String(habId)) || []);
}

// Adds or removes one species from a habitat's assignment. Stored as "this
// species on (or off) for this habitat", so it can be applied again on top
// of the file when the file arrives after the click.
// The saved entry is found by its fingerprint, so this also works when it
// is replayed on the zoo's data read after the click.
export function toggleAssignment(model, habId, species, name) {
    const key = parkKey(model);
    const id = String(habId);
    const label = name || habitatName(model, id);
    const on = !(getAssignments(model).get(id) || new Set()).has(species);
    const token = loadToken();
    let prints = habitatPrints(model);
    let print = prints.find(p => p.id === id);
    if (!print) {
        // a habitat only the destinations know about (not scanned yet)
        print = { id, name: label, names: new Set(label ? [label.trim().toLowerCase()] : []), hid: null, guids: [] };
        prints = prints.concat([print]);
    }
    updateUserData(DATA_KEY, old => {
        const all = Object.assign({}, old && typeof old === 'object' && !Array.isArray(old) ? old : {});
        const park = rekeyAssignments(sectionOf(all, key), prints, token, { countMisses: false });
        const entry = Object.assign({ species: [] }, park[id] || printOf(print), { seen: token });
        const set = new Set(Array.isArray(entry.species) ? entry.species : []);
        if (on) set.add(species);
        else set.delete(species);
        entry.species = Array.from(set);
        if (!entry.name && label) entry.name = label;
        for (const f of Object.keys(entry)) if (entry[f] === undefined) delete entry[f];
        if (entry.species.length) park[id] = entry;
        else delete park[id];
        if (Object.keys(park).length) all[key] = park;
        else delete all[key];
        return all;
    });
    notify();
    return on;
}

export function onAssignments(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
