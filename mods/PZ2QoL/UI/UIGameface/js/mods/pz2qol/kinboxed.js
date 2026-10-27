// Boxed with no destination: a "Needs you" alert when an animal has sat in
// its transport box for a few seconds (setting boxedAfterS, default 10) with
// no transport job and outside any habitat. The game itself only warns after
// a long time. HUD page only; reads the kin scan (snapshot field `boxed`,
// the Animals list's bBoxed). The buttons are one click, one action: Locate
// (the camera), Find a habitat (ONE move, through the same code as "Find a
// habitat" from storage), Dismiss.
import { getKinSettings, locateAnimal, onKin, requestKinScan } from '/js/mods/pz2qol/kin.js';
import { boxedStep, waitedText } from '/js/mods/pz2qol/kinboxedcore.js';
import { kinToast } from '/js/mods/pz2qol/kinalerts.js';
import { sexSymbol } from '/js/mods/pz2qol/kinui.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { askFacts, askMove, isInSendRun } from '/js/mods/pz2qol/storagesend.js';
import { pickHabitat } from '/js/mods/pz2qol/storagesendcore.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';

const MAX_SINGLE = 3;          // more due at once: one summary toast
const state = new Map();       // animal id -> { first, alerted }
let wakeTimer = null;
const busy = new Set();        // Find a habitat in flight, per animal

function label(a) {
    return `${a.name || 'An animal'} ${sexSymbol(a.sex)} (${speciesName(a.species)})`;
}

// One click: where would "Find a habitat" put it, then ONE move there.
async function findHabitat(a) {
    if (busy.has(a.id)) return;
    busy.add(a.id);
    try {
        breadcrumb('kin_boxed_find');
        const facts = await askFacts(a.id);
        const pick = pickHabitat(facts);
        if (!pick.hab) {
            kinToast({ severity: 'future', level: 'action', kind: 'boxed', title: `No habitat for ${a.name || 'this animal'}`, text: `Find a habitat: ${pick.reason}.`, species: a.species });
            return;
        }
        const res = await askMove(a.id, pick.hab.id);
        if (res && res.ok) {
            kinToast({ severity: 'covered', level: 'heads', kind: 'boxed', answer: true, title: `${a.name || 'Animal'} is on its way`, text: `To ${pick.hab.name} (${pick.hab.why}).`, species: a.species });
        }
        else {
            kinToast({ severity: 'risk', level: 'action', kind: 'boxed', title: `${a.name || 'Animal'} was not moved`, text: `The game said no: ${(res && res.detail) || 'no answer'}.`, species: a.species });
        }
        requestKinScan('boxed_move', { force: true, delay: 1500 });
    }
    catch (e) {
        reportError('ui', 'Find a habitat failed', e);
    }
    finally {
        busy.delete(a.id);
    }
}

function alertOne(a, waitedMs) {
    breadcrumb('kin_boxed_' + String(a.lt || 'none').replace(/[^\w]/g, '_'));
    kinToast({
        severity: 'risk',
        level: 'action',
        kind: 'boxed',
        title: 'Boxed with no destination',
        text: `${label(a)} has waited in its box for at least ${waitedText(waitedMs)} with nowhere to go.`,
        species: a.species,
        actions: [
            { label: 'Locate', icon: 'IconLocation', primary: true, run: () => locateAnimal(a.id) },
            { label: 'Find a habitat', icon: 'IconHabitat', run: () => findHabitat(a) },
        ],
    });
}

function onModel(model) {
    const settings = getKinSettings();
    const found = boxedStep(model, settings, state, Date.now());
    const wake = found.wake;
    // arrivals a storage run is still working through: no alert, and their
    // wait starts afresh once the run is over
    const due = [];
    for (const d of found.due) {
        if (isInSendRun(d.animal.id)) state.delete(d.animal.id);
        else due.push(d);
    }
    if (due.length > MAX_SINGLE) {
        breadcrumb('kin_boxed_many');
        kinToast({
            severity: 'risk',
            level: 'action',
            kind: 'boxed',
            title: `${due.length} animals boxed with no destination`,
            text: due.slice(0, 3).map(d => label(d.animal)).join(', ') + ', …',
            actions: [{ label: `Locate ${due[0].animal.name || 'the first'}`, icon: 'IconLocation', primary: true, run: () => locateAnimal(due[0].animal.id) }],
        });
    }
    else {
        for (const d of due) alertOne(d.animal, d.waitedMs);
    }
    // look again once the next one is due (the background scan is slower)
    clearTimeout(wakeTimer);
    wakeTimer = null;
    if (wake != null) wakeTimer = setTimeout(() => requestKinScan('boxed', { force: true }), wake + 300);
}

// For the browser harness: forget what was alerted.
export function _resetBoxed() {
    state.clear();
    clearTimeout(wakeTimer);
    wakeTimer = null;
}

export function installBoxedAlerts() {
    if (!isHudPage()) return true;
    onKin((model, scope) => {
        if (scope && scope !== 'park') return;
        try {
            onModel(model);
        }
        catch (e) {
            reportError('mod', 'Boxed-animal alert failed', e, { silent: true });
        }
    });
    return true;
}
