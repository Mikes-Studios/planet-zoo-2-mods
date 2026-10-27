// Stored animals' ages, from the Storage window to Auto mode. The park's
// read of storage has no age, the Storage window's rows do: the hub page
// hands them to Lua whenever the list changes (PZ2QoL_StoredAgesSet), and
// the park page asks for them (PZ2QoL_StoredAgesGet), so Auto mode never
// suggests a stored animal near elderly and advises selling it.
import { isFrontendPage, isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { storageRows } from '/js/mods/pz2qol/lister.js';
import { locationName } from '/js/mods/pz2qol/game.js';
import { storedAgeEntries } from '/js/mods/pz2qol/kinageing.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

const SEND_EVERY_MS = 5000;
const ASK_EVERY_MS = 10000;

const S = { entries: [], listeners: new Set() };

// The ages the Storage window last showed (park page): kinageing storedAgeEntries.
export function storedRowAges() {
    return S.entries;
}

// fn(entries) each time the park page hears them
export function onStoredRows(fn) {
    S.listeners.add(fn);
    return () => S.listeners.delete(fn);
}

function trigger(event, ...args) {
    try {
        engine.trigger(event, ...args);
    }
    catch (e) {
        reportError('ui', 'Stored ages: the game could not be told. Reopen the hub; if it stays, the mod\'s Lua part did not load.', e, { silent: true });
    }
}

function installSender() {
    let sent = '';
    setInterval(() => {
        const rows = storageRows();
        if (!rows.length) return;
        const json = JSON.stringify(storedAgeEntries(rows.map(r => Object.assign({}, r, { name: locationName(r.name) }))));
        if (json === sent) return;
        sent = json;
        trigger('PZ2QoL_StoredAgesSet', json);
        breadcrumb('stored_ages_set');
    }, SEND_EVERY_MS);
}

function installAsker() {
    let seq = 0;
    engine.on('PZ2QoL_StoredAgesResult', (reqId, json) => {
        try {
            const list = JSON.parse(json || '[]');
            if (!Array.isArray(list)) return;
            S.entries = list;
            callAll(S.listeners, list);
        }
        catch (e) {
            reportError('ui', 'Stored ages: the list from the hub could not be read.', e, { silent: true });
        }
    });
    const ask = () => trigger('PZ2QoL_StoredAgesGet', 'G' + (++seq));
    ask();
    setInterval(ask, ASK_EVERY_MS);
}

export function installStoredAges() {
    if (isFrontendPage()) installSender();
    else if (isHudPage()) installAsker();
    return true;
}
