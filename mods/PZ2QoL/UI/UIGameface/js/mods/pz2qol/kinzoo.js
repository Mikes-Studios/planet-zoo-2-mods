// Kin in zoo management (in-park HUD):
//  - Animals list: a DNA badge on every animal that could breed with a
//    relative in its habitat (hover: who and how; click: actions);
//  - Habitats list: a badge with the habitat's related pairs.
// The toolbar's Kin filter, sort and buttons live in zoo.js; this module
// gives it the per-animal data (zooKinInfo).
import { getKinModel, getKinSettings, markKinActive } from '/js/mods/pz2qol/kin.js';
import { animalPairs, habitatSummary, kinClusters } from '/js/mods/pz2qol/kincore.js';
import { animalCardContent, habitatCardContent, visiblePairs } from '/js/mods/pz2qol/kinui.js';
import { visibleCounts, worstOf } from '/js/mods/pz2qol/kinplannercore.js';
import { badgeVNode, findVNode, hasClass, appendVNode, h, kinSlot, gameModule, isHudPage, patchRender, unwrap, unwrapUntil, dsValue } from '/js/mods/pz2qol/kinhooks.js';
import { openKinPlanner } from '/js/mods/pz2qol/kinplanner.js';

// ------------------------------------------------------- data for zoo.js

let clusterCache = { model: null, clusters: new Map() };

function clustersOf(model) {
    if (clusterCache.model !== model) clusterCache = { model, clusters: kinClusters(model) };
    return clusterCache.clusters;
}

// { kinSeverity, kinCluster } for a zoo row id ('animal_12', 'exhibit_animal_7').
export function zooKinInfo(rowId) {
    const model = getKinModel();
    if (!model || rowId == null) return { kinSeverity: null, kinCluster: null };
    const a = model.byKey.get(String(rowId));
    if (!a) return { kinSeverity: null, kinCluster: null };
    const pairs = visiblePairs(model, a.id);
    return { kinSeverity: pairs.length ? pairs[0].severity : null, kinCluster: clustersOf(model).get(a.id) ?? null };
}

// Animals with a pair of each severity, for the toolbar's counts.
export function zooKinCounts() {
    const model = getKinModel();
    const out = { risk: 0, any: 0, pairs: model ? model.counts : null };
    if (!model) return out;
    for (const a of model.animals.values()) {
        const p = animalPairs(model, a.id);
        if (!p.length) continue;
        if (p[0].severity === 'risk') out.risk++;
        // pairs kept apart (contraception..., a pair bond) are not problems now
        if (p[0].severity !== 'covered' && p[0].severity !== 'held') out.any++;
    }
    return out;
}

// --------------------------------------------------------------- planner

function openFor(animal) {
    openKinPlanner({ habitatId: animal.hab || undefined, animalId: animal.id });
}

// ------------------------------------------------------------- row badge

function animalBadge(model, rowId, host) {
    const a = model.byKey.get(String(rowId));
    if (!a) return null;
    const pairs = visiblePairs(model, a.id);
    if (!pairs.length) return null;
    const build = pinned => animalCardContent(model, a, { pinned, openPlanner: openFor });
    return badgeVNode(pairs[0].severity, pairs.length, { compact: true, host, build, title: '' });
}

function patchAnimalList(AnimalListItem) {
    // DataStoreComponent.decorate(class _AnimalListItem)
    const Inner = unwrapUntil(AnimalListItem, c => /AnimalListItem_root/.test(String(c.prototype.render))) || unwrap(AnimalListItem);
    if (!Inner) return false;
    return patchRender(Inner, 'zooAnimalRow', function (vnode, props, state) {
        const rowId = state && state.id;
        if (rowId == null) return vnode;
        const species = findVNode(vnode, n => hasClass(n, 'AnimalListItem_container') && hasClass(n, 'species'));
        if (!species) return vnode;
        appendVNode(species, kinSlot(model => {
            markKinActive();
            return animalBadge(model, rowId, 'inline zoo');
        }));
        return vnode;
    });
}

// --------------------------------------------------------- habitats tab

function habitatBadge(model, rowId) {
    const m = /^habitat_(.+)$/.exec(String(rowId || ''));
    if (!m) return null;
    const s = habitatSummary(model, m[1]);
    if (!s) return null;
    const counts = visibleCounts(s.counts, getKinSettings().showCovered);
    const worst = worstOf(counts);
    if (!worst) return null;
    const n = counts.risk + counts.kin + counts.future + counts.held + counts.covered;
    const build = pinned => habitatCardContent(model, m[1], { pinned, openPlanner: () => openKinPlanner({ habitatId: m[1] }) });
    return badgeVNode(worst, n, { host: 'inline habitats', build, title: '' });
}

function patchHabitatList(HabitatListItem) {
    // Focusable.decorateEx(DataStoreComponent.decorate(class))
    const Inner = unwrapUntil(HabitatListItem, c => /HabitatListItem_container/.test(String(c.prototype.render))) || unwrap(unwrap(HabitatListItem));
    if (!Inner) return false;
    return patchRender(Inner, 'zooHabitatRow', function (vnode, props, state) {
        const rowId = (state && state.id) || dsValue(props && props.context, 'id');
        if (rowId == null) return vnode;
        const animals = findVNode(vnode, n => hasClass(n, 'HabitatListItem_container') && hasClass(n, 'animals'));
        if (!animals) return vnode;
        appendVNode(animals, kinSlot(model => {
            markKinActive();
            return habitatBadge(model, rowId);
        }));
        return vnode;
    });
}

// ----------------------------------------------------------------- install

export function installKinZoo() {
    if (!isHudPage()) return true;
    (async () => {
        const list = await gameModule('/js/project/modules/Management/Components/Animals/AnimalListItem.js');
        if (list && !patchAnimalList(list.AnimalListItem)) {
            const { reportError } = await import('/js/mods/pz2qol/errors.js');
            reportError('mod', 'Kin badges in the Animals list not installed', 'The game list row looked different than expected.', { silent: true });
        }
        const hab = await gameModule('/js/project/modules/Management/Components/Animals/HabitatListItem.js');
        if (hab && !patchHabitatList(hab.HabitatListItem)) {
            const { reportError } = await import('/js/mods/pz2qol/errors.js');
            reportError('mod', 'Kin badges in the Habitats list not installed', 'The game list row looked different than expected.', { silent: true });
        }
    })();
    return true;
}

export { h };
