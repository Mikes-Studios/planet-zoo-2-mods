// Passed quarantine: a "Needs you" notice when an animal the mod sent to a
// quarantine on its way to the trade centre (sick or injured: the market
// refuses it; kinmoves.js moveAnimal, setting quarantineSick) has passed.
// One click sends it on (one action, the player's click: Franchise rules).
// HUD page only; reads the kin scan (snapshot fields lt, qReady).
import { getKinSettings, locateAnimal, onKin } from '/js/mods/pz2qol/kin.js';
import { kinToast } from '/js/mods/pz2qol/kinalerts.js';
import { moveAnimal, quarantinedForTrade } from '/js/mods/pz2qol/kinmoves.js';
import { TRADE } from '/js/mods/pz2qol/kinboardcore.js';
import { sexSymbol } from '/js/mods/pz2qol/kinui.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';

const alerted = new Set();     // animal ids told about (once each)

function label(a) {
    return `${a.name || 'An animal'} ${sexSymbol(a.sex)} (${speciesName(a.species)})`;
}

async function sendOn(a) {
    breadcrumb('kin_quarantine_send');
    const r = await moveAnimal(a.id, TRADE, { direct: true });
    if (r && r.ok) {
        quarantinedForTrade().delete(String(a.id));
        kinToast({ severity: 'covered', level: 'heads', kind: 'quarantine', answer: true, title: `${a.name || 'Animal'} is on its way to the trade centre`, text: 'It passed quarantine.', species: a.species });
        return;
    }
    // not sent: a click on Try again, or the next scan's Passed quarantine notice once this one goes
    let retried = false;
    kinToast({
        severity: 'risk',
        level: 'action',
        kind: 'quarantine',
        title: `${a.name || 'Animal'} was not sent`,
        text: `The game said no: ${(r && r.detail) || 'no answer'}. It is still in quarantine: try again in a moment.`,
        species: a.species,
        actions: [{
            label: 'Try again', icon: 'IconTradeCentre', primary: true,
            run: () => {
                retried = true;
                sendOn(a);
            },
        }],
        onClose: () => {
            if (!retried) alerted.delete(a.id);
        },
    });
}

// The animals waiting for the player: passed, not yet told.
export function passedQuarantine(model, ids) {
    const out = [];
    if (!model) return out;
    for (const id of ids) {
        const a = model.animals.get(String(id));
        if (a && a.lt === 'quarantine' && a.qReady) out.push(a);
    }
    return out;
}

function onModel(model) {
    if (getKinSettings().quarantineSick === false) return;
    const ids = quarantinedForTrade();
    // gone from the zoo (sent on by hand, or died): forget it
    for (const id of Array.from(ids)) if (!model.animals.has(String(id))) ids.delete(id);
    for (const a of passedQuarantine(model, ids)) {
        if (alerted.has(a.id)) continue;
        alerted.add(a.id);
        breadcrumb('kin_quarantine_ready');
        kinToast({
            severity: 'covered',
            level: 'action',
            kind: 'quarantine',
            title: 'Passed quarantine',
            text: `${label(a)} is treated and ready to go on to the trade centre.`,
            species: a.species,
            actions: [
                { label: 'Send to trade centre', icon: 'IconTradeCentre', primary: true, run: () => sendOn(a) },
                { label: 'Locate', icon: 'IconLocation', run: () => locateAnimal(a.id) },
            ],
        });
    }
}

// For the browser harness.
export function _resetQuarantine() {
    alerted.clear();
}

export function installQuarantineAlerts() {
    if (!isHudPage()) return true;
    onKin((model, scope) => {
        if (scope && scope !== 'park') return;
        try {
            onModel(model);
        }
        catch (e) {
            reportError('mod', 'Quarantine notice failed', e, { silent: true });
        }
    });
    return true;
}
