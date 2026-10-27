// Zoo census in the detailed log (debug builds only): every animal once per
// zoo load (where it is, its stage, genes and family), then on each scan
// only what changed: moves between habitats, the trade centre and storage,
// births, growing up, arrivals, departures, pregnancies and contraception.
// Animal Storage the same way whenever the mod reads it. Read back from
// dbg\trace.log to check what the mod decided against what the zoo did.
// Release builds: nothing runs (isLogEnabled).
import { censusChanges, censusRows } from '/js/mods/pz2qol/kincensuscore.js';
import { getKinModel, getStorageKinModel, onKin } from '/js/mods/pz2qol/kin.js';
import { dlog, isLogEnabled } from '/js/mods/pz2qol/debuglog.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';

// a scan sharing fewer of its animals with the last one is another zoo: a full census
const SAME_ZOO_SHARE = 0.5;

function rowData(row) {
    return {
        name: row.name, species: row.species, sex: row.sex, age: row.age, stage: row.stage, place: row.place,
        genes: row.genes, score: row.score, parents: row.parents, mates: row.mates, preg: row.preg, contra: row.contra,
    };
}

function sameZoo(before, after) {
    if (!before || !before.size) return false;
    let shared = 0;
    for (const id of after.keys()) if (before.has(id)) shared++;
    return shared >= Math.min(before.size, after.size) * SAME_ZOO_SHARE;
}

// last: the page's previous census per scope ({ park, storage }: rows)
function record(last, scope, model) {
    const rows = censusRows(model);
    const before = last[scope];
    last[scope] = rows;
    if (!sameZoo(before, rows)) {
        dlog('census', `${scope}_full`, { animals: rows.size });
        for (const row of rows.values()) dlog('census', scope, rowData(row));
        return;
    }
    for (const e of censusChanges(before, rows)) {
        dlog('census', e.event, Object.assign({ scope, from: e.from }, rowData(e.row)));
    }
}

export function installKinCensus() {
    if (!isHudPage()) return true;
    const last = { park: null, storage: null };
    onKin((model, scope) => {
        if (!isLogEnabled()) return;
        if (scope === 'storage') record(last, 'storage', getStorageKinModel());
        else if (model && model.scope === 'park') record(last, 'park', getKinModel());
    });
    return true;
}
