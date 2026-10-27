// Kin in the hub's Animal Storage.
//
//  - Keeps the Lua side asked for the lineage of the stored animals
//    (requestStorageKin) and hands kin.js the rows' names, sexes and ages
//    (setStorageRows) whenever the storage list changes.
//  - Each stored animal with a close relative in storage (same species)
//    gets a DNA badge "Related N", with a card listing the relatives.
//  - The storage toolbar's "Related" chip (bars.js) filters to those
//    animals, through the predicate added here (listfilter.js).
//  - The storage info panel warns, above Send to Zoo, when the selected
//    animals include a related breeding pair. It never blocks or changes
//    what the game sends.
// In the hub the park is not loaded, so storage animals are only compared
// with each other.
import { getStorageKinModel, onKin, onKinState, requestStorageKin, setStorageRows } from '/js/mods/pz2qol/kin.js';
import { compatibleSexes, coverReason, explainRelation, kinTier, pairSeverity, percent, relationWord, relativesOf, severityRank, Sex, SEVERITY_INFO } from '/js/mods/pz2qol/kincore.js';
import { offspringBlock, sexClass, sexSymbol } from '/js/mods/pz2qol/kinui.js';
import {
    appendVNode, cardHandlers, dsValue, findByClass, findVNode, gameModule, h, isFrontendPage, kinSlot, patchRender, unwrapUntil,
} from '/js/mods/pz2qol/kinhooks.js';
import { addStorageFilter, getListSource, getStorageFilters, refreshList } from '/js/mods/pz2qol/listfilter.js';
import { childrenOf, get, locationName, STORAGE_LIST, STORAGE_LIST_KEY } from '/js/mods/pz2qol/game.js';
import { pairPhrase, pairSentence } from '/js/mods/pz2qol/kinmates.js';
import { h as dom, visibleBox } from '/js/mods/pz2qol/ui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

const MOD_ROWS = '/js/project/modules/AnimalMarket/Components/MarketAnimalListItem.js';
const MOD_PANEL = '/js/project/modules/AnimalMarket/Components/AnimalStorageInfoPanel.js';
const POLL_MS = 1000;
const RETRY_MS = 6000;

// ------------------------------------------------------------- rows -> kin

// "[Animal_Lion]" -> "Lion"
export function speciesKey(raw) {
    const s = String(raw == null ? '' : raw);
    const m = /^\[Animal_(.+)\]$/.exec(s);
    return m ? m[1] : s;
}

export function storageRowOf(ctx) {
    const id = get(ctx, 'id');
    // shoals and colonies breed as one group: Kin leaves them out
    if (id == null || id === '' || get(ctx, 'isShoal')) return null;
    return {
        id: String(id),
        name: locationName(get(ctx, 'name')) || '?',
        species: speciesKey(get(ctx, 'species')),
        sex: typeof get(ctx, 'gender') === 'number' ? get(ctx, 'gender') : Sex.Unisex,
        juv: get(ctx, 'maturity') === 0,
        maturity: typeof get(ctx, 'maturity') === 'number' ? get(ctx, 'maturity') : undefined,
        preg: !!get(ctx, 'isPregnant'),
    };
}

let lastSig = '';
let lastIds = '';
let lastAsk = 0;
let retryAt = 0;

function poll() {
    if (!visibleBox(document.querySelector('.AnimalMarketStorage_header'))) return;
    const rows = childrenOf(STORAGE_LIST).map(storageRowOf).filter(Boolean);
    if (!rows.length) return;
    const ids = rows.map(r => r.id).sort().join(',');
    const sig = rows.map(r => [r.id, r.name, r.species, r.sex, r.maturity].join(':')).join('|');
    const now = Date.now();
    // ask again when the answer never came, or Lua said storage was not
    // ready yet ('nostorage'), at most every RETRY_MS
    const due = retryAt > 0 && now >= retryAt;
    const stale = !getStorageKinModel() && now - lastAsk > RETRY_MS;
    if (sig === lastSig && !due && !stale) return;
    retryAt = 0;
    setStorageRows(rows);
    // same animals with new names or ages: ask again so the model has them
    requestStorageKin(rows.map(r => r.id), { force: due || stale || (ids === lastIds && sig !== lastSig) });
    lastSig = sig;
    lastIds = ids;
    lastAsk = now;
}

// ------------------------------------------------------------- relatives

// Close relatives of one stored animal among the stored animals of its
// species, each with what it would mean if the two were housed together.
export function storageRelatives(model, id) {
    const self = model && model.animals.get(String(id));
    if (!self) return [];
    const pool = [];
    for (const a of model.animals.values()) if (a !== self && a.species === self.species) pool.push(a);
    return relativesOf(model, self.id, pool)
        .filter(r => r.tier !== 'distant')
        .map(r => {
            const breeding = compatibleSexes(self, r.animal) && !(self.sex === Sex.Unisex && r.animal.sex === Sex.Unisex);
            const severity = breeding ? pairSeverity(self, r.animal, r.tier) : 'covered';
            return Object.assign({ breeding, severity }, r);
        })
        .sort((p, q) => severityRank(q.severity) - severityRank(p.severity) || q.kinship - p.kinship);
}

// Row ids of the stored animals with at least one close relative in storage.
let relatedIds = null;
let removePredicate = null;

function recomputeRelated() {
    const model = getStorageKinModel();
    if (!model) {
        relatedIds = null;
        if (removePredicate) removePredicate();
        removePredicate = null;
        return;
    }
    const ids = new Set();
    for (const a of model.animals.values()) {
        if (storageRelatives(model, a.id).length) ids.add(a.id);
    }
    relatedIds = ids;
    if (!removePredicate) removePredicate = addStorageFilter('related', a => !!relatedIds && relatedIds.has(String(a.id)));
}

// ------------------------------------------------------------- row badge

function tagText(r) {
    if (!r.breeding) return 'Same sex';
    return (SEVERITY_INFO[r.severity] || SEVERITY_INFO.distant).label;
}

function why(model, self, r) {
    if (!r.breeding) return `${explainRelation(model, self, r.animal)} Same sex, so no breeding risk between these two.`;
    if (r.severity === 'covered') return `${explainRelation(model, self, r.animal)} ${coverReason(self, r.animal)}, so no breeding risk between these two.`;
    const tail = r.tier === 'game'
        ? 'The game counts this pair as inbred: they would inbreed if housed together.'
        : 'The game does not warn about this pair, but their young would lose fertility and immunity.';
    return `${explainRelation(model, self, r.animal)} ${tail}${r.severity === 'future' ? ' One of them is still young.' : ''}`;
}

function rowCard(model, self, rels, pinned) {
    const body = dom('div.PZ2QoL_kinCardBody');
    body.appendChild(dom('div.PZ2QoL_kinCardHead', null, dom('div.PZ2QoL_kinCardIcon'),
        dom('div.PZ2QoL_cardTitles', null,
            dom('div.PZ2QoL_cardTitle', { text: `${self.name} ${sexSymbol(self.sex)}` }),
            dom('div.PZ2QoL_cardSubtitle', { text: `Related to ${rels.length} stored animal${rels.length > 1 ? 's' : ''} of its species` }))));
    const shown = pinned ? rels : rels.slice(0, 4);
    for (const r of shown) {
        const word = relationWord(r.rel, r.animal.sex);
        body.appendChild(dom(`div.PZ2QoL_kinPair.sev_${r.severity}`, null,
            dom('div.PZ2QoL_kinPairHead', null, dom(`div.PZ2QoL_kinTag.sev_${r.severity}`, { text: tagText(r) }),
                dom(`span.PZ2QoL_kinName.${sexClass(r.animal.sex)}`, { text: `${r.animal.name} ${sexSymbol(r.animal.sex)}` }),
                dom('div.PZ2QoL_kinFacts', { text: `${word} · ${percent(r.kinship)} kinship` })),
            (pinned || shown.length === 1) && dom('div.PZ2QoL_kinWhy', { text: why(model, self, r) })));
    }
    if (shown.length < rels.length) body.appendChild(dom('div.PZ2QoL_kinMore', { text: `+${rels.length - shown.length} more · click for all` }));
    const first = rels.find(r => r.breeding);
    if (pinned && first) {
        const [m, f] = self.sex === Sex.Female ? [first.animal, self] : [self, first.animal];
        const block = offspringBlock(m, f, { title: `Young of ${self.name} and ${first.animal.name}` });
        if (block) body.appendChild(block);
    }
    if (!pinned) body.appendChild(dom('div.PZ2QoL_kinCardFoot', null, dom('div.PZ2QoL_kinHint', { text: 'Click the badge to keep this open' })));
    return body;
}

function rowBadge(model, rowId) {
    const self = model.animals.get(String(rowId));
    if (!self) return null;
    const rels = storageRelatives(model, self.id);
    if (!rels.length) return null;
    const sev = rels[0].severity;
    const breeding = rels.filter(r => r.breeding).length;
    const title = `Related to ${rels.length} stored animal${rels.length > 1 ? 's' : ''} (same species)${breeding ? `, ${breeding} of the other sex` : ''}`;
    return h('div', { className: 'PZ2QoL_kinHost marketRow PZ2QoL_ksHost' },
        h('div', Object.assign({ className: `PZ2QoL_kin PZ2QoL_ksRow sev_${sev}`, title }, cardHandlers(pinned => rowCard(model, self, rels, pinned))),
            h('div', { className: 'PZ2QoL_kinIcon' }),
            h('div', { className: 'PZ2QoL_kinLabel' }, 'Related'),
            rels.length > 1 ? h('div', { className: 'PZ2QoL_kinCount' }, String(rels.length)) : null));
}

function isStorageRow(ctx) {
    return Array.isArray(ctx) && ctx.length === 4 && ctx[0] === STORAGE_LIST[0] && ctx[1] === STORAGE_LIST[1] && ctx[2] === STORAGE_LIST[2];
}

function patchRows(mod) {
    const Outer = mod && typeof mod.MarketAnimalStorageListItem === 'function' ? (mod.MarketAnimalStorageListItem({}) || {}).nodeName : null;
    const Inner = unwrapUntil(Outer, c => Object.prototype.hasOwnProperty.call(c.prototype, 'onContextChanged') && /MarketAnimalListItem_root/.test(String(c.prototype.render)));
    if (!Inner) return false;
    return patchRender(Inner, 'storageRows', function (vnode, props) {
        const ctx = props && props.context;
        if (!isStorageRow(ctx)) return vnode;
        const root = findByClass(vnode, 'MarketAnimalListItem_root');
        if (!root) return vnode;
        const id = dsValue(ctx, 'id');
        if (id == null) return vnode;
        appendVNode(root, kinSlot(model => rowBadge(model, id), { storage: true, getModel: getStorageKinModel }));
        return vnode;
    });
}

// --------------------------------------------------------- info panel

// Selected and ticked rows (list keys), as row ids.
function selectedRowIds(keys) {
    const out = new Set();
    for (const key of keys || []) {
        const id = dsValue(STORAGE_LIST.concat(String(key)), 'id');
        if (id != null) out.add(String(id));
    }
    return Array.from(out);
}

export function relatedBreedingPairs(model, ids) {
    const list = ids.map(id => model.animals.get(String(id))).filter(a => a && a.guid);
    const out = [];
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (a.species !== b.species || !compatibleSexes(a, b)) continue;
            const rel = model.ped.relation(a.guid, b.guid);
            const tier = kinTier(model, rel);
            if (!tier || tier === 'distant') continue;
            const severity = pairSeverity(a, b, tier);
            // too old, infertile or one ages out first: no risk to warn about
            if (severity === 'covered') continue;
            const [m, f] = a.sex === Sex.Female ? [b, a] : [a, b];
            out.push({ a: m, b: f, rel, tier, severity, kinship: rel.kinship });
        }
    }
    return out.sort((p, q) => severityRank(q.severity) - severityRank(p.severity) || q.kinship - p.kinship);
}

function pairTail(p) {
    if (p.severity === 'future') return 'they would inbreed once both are grown';
    if (p.tier === 'game') return 'they would inbreed if housed together';
    return 'the game won\'t warn, but their young would lose fertility and immunity';
}

function selectionCard(model, pairs, pinned) {
    const body = dom('div.PZ2QoL_kinCardBody');
    body.appendChild(dom('div.PZ2QoL_kinCardHead', null, dom('div.PZ2QoL_kinCardIcon'),
        dom('div.PZ2QoL_cardTitles', null,
            dom('div.PZ2QoL_cardTitle', { text: `${pairs.length} related pair${pairs.length > 1 ? 's' : ''} in the selection` }),
            dom('div.PZ2QoL_cardSubtitle', { text: 'Sending them to the same habitat lets them breed' }))));
    for (const p of pinned ? pairs : pairs.slice(0, 4)) {
        body.appendChild(dom(`div.PZ2QoL_kinPair.sev_${p.severity}`, null,
            dom('div.PZ2QoL_kinPairHead', null, dom(`div.PZ2QoL_kinTag.sev_${p.severity}`, { text: SEVERITY_INFO[p.severity].label }),
                dom(`span.PZ2QoL_kinName.${sexClass(p.a.sex)}`, { text: `${p.a.name} ${sexSymbol(p.a.sex)}` }),
                dom(`span.PZ2QoL_kinName.${sexClass(p.b.sex)}`, { text: `${p.b.name} ${sexSymbol(p.b.sex)}` }),
                dom('div.PZ2QoL_kinFacts', { text: `${pairPhrase(model, p.a, p.b)} · ${percent(p.kinship)}` })),
            dom('div.PZ2QoL_kinWhy', { text: `${explainRelation(model, p.a, p.b)} ${p.tier === 'game' ? 'The game counts this pair as inbred.' : 'The game does not warn about this pair.'}` }),
            pinned && offspringBlock(p.a, p.b)));
    }
    if (!pinned && pairs.length > 4) body.appendChild(dom('div.PZ2QoL_kinMore', { text: `+${pairs.length - 4} more · click for all` }));
    body.appendChild(dom('div.PZ2QoL_kinCardFoot', null, dom('div.PZ2QoL_kinHint', { text: 'Only a warning: Send to Zoo works as usual' })));
    return body;
}

function selectionWarning(model, keys) {
    const ids = selectedRowIds(keys);
    if (ids.length < 2) return null;
    const pairs = relatedBreedingPairs(model, ids);
    if (!pairs.length) return null;
    const p = pairs[0];
    const more = pairs.length - 1;
    return h('div', Object.assign({ className: `PZ2QoL_ksWarn sev_${p.severity}` }, cardHandlers(pinned => selectionCard(model, pairs, pinned))),
        h('div', { className: 'PZ2QoL_kinIcon' }),
        h('div', { className: 'PZ2QoL_kmTexts' },
            h('div', { className: 'PZ2QoL_ksWarnTitle' }, `${pairSentence(model, p.a, p.b)} — ${pairTail(p)}`),
            more > 0 ? h('div', { className: 'PZ2QoL_kmSub' }, `+${more} more related pair${more > 1 ? 's' : ''} in the selection`) : null));
}

const SEND_LABEL = '[AnimalExchange_SendToZoo]';

// Where the Send to Zoo row sits in the actions array: { arr, index }.
function findSendRow(arr, depth = 0) {
    if (!Array.isArray(arr) || depth > 4) return null;
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (Array.isArray(item)) {
            const hit = findSendRow(item, depth + 1);
            if (hit) return hit;
        }
        else if (item && typeof item === 'object' && findVNode(item, v => v.attributes && v.attributes.label === SEND_LABEL, 4)) {
            return { arr, index: i };
        }
    }
    return null;
}

const panelPatch = { failures: 0, off: false };

function wrapActions(inst) {
    const original = inst.onGetActionsContent;
    if (typeof original !== 'function' || original.__pz2qolKin) return;
    const wrapped = function (state) {
        const out = original.apply(this, arguments);
        if (panelPatch.off) return out;
        try {
            const hit = findSendRow(out);
            if (hit) {
                const keys = state && state.selectedAnimalIDs ? state.selectedAnimalIDs.slice() : [];
                hit.arr.splice(hit.index, 0, kinSlot(model => selectionWarning(model, keys), { storage: true, getModel: getStorageKinModel }));
            }
            panelPatch.failures = 0;
        }
        catch (e) {
            if (++panelPatch.failures >= 3) {
                panelPatch.off = true;
                reportError('mod', 'Kin: storage panel warning turned off', e, { silent: true });
            }
        }
        return out;
    };
    wrapped.__pz2qolKin = true;
    inst.onGetActionsContent = wrapped;
}

function patchPanel(mod) {
    const Panel = mod && mod.AnimalStorageInfoPanel;
    // Focusable(class): the actions come from an instance arrow field, so
    // wrap it per instance as the panel mounts
    const Inner = unwrapUntil(Panel, c => /onGetActionsContent/.test(Function.prototype.toString.call(c)) && c !== Panel);
    if (!Inner || !Inner.prototype) return false;
    if (Inner.prototype.__pz2qolKinPanel) return true;
    const mount = Inner.prototype.componentWillMount;
    Inner.prototype.componentWillMount = function (...args) {
        const ret = mount ? mount.apply(this, args) : undefined;
        try {
            wrapActions(this);
        }
        catch (e) {
            reportError('mod', 'Kin: storage panel hook failed', e, { silent: true });
        }
        return ret;
    };
    Inner.prototype.__pz2qolKinPanel = true;
    return true;
}

// ------------------------------------------------------------------ install

let installed = false;

export function installKinStorage() {
    if (installed || !isFrontendPage()) return true;
    if (typeof engine === 'undefined') return false;
    installed = true;
    onKin((m, scope) => {
        if (scope !== 'storage') return;
        try {
            recomputeRelated();
            if (getStorageFilters().related) {
                // rows the new data hides must not stay ticked for Sell / Release
                for (const ctx of getListSource(STORAGE_LIST_KEY)) {
                    const id = get(ctx, 'id');
                    if (id != undefined && relatedIds && !relatedIds.has(String(id)) && get(ctx, 'multiSelected')) {
                        engine.trigger('AnimalStorage_ItemCheckboxToggled', id, false);
                    }
                }
                refreshList(STORAGE_LIST_KEY);
            }
        }
        catch (e) {
            reportError('ui', 'Kin: storage update failed', e, { silent: true });
        }
    });
    onKinState(st => {
        // the storage mode was not ready yet: ask again on the next poll
        if (st && st.state === 'nostorage') retryAt = Date.now() + RETRY_MS;
    });
    setInterval(() => {
        try {
            poll();
        }
        catch (e) {
            reportError('ui', 'Kin: storage poll failed', e, { silent: true });
        }
    }, POLL_MS);
    (async () => {
        const missing = [];
        if (!patchRows(await gameModule(MOD_ROWS))) missing.push('rows');
        if (!patchPanel(await gameModule(MOD_PANEL))) missing.push('info panel');
        if (missing.length) reportError('mod', 'Kin in Animal Storage not installed', missing.join(', '), { silent: true });
    })().catch(e => reportError('mod', 'Kin in Animal Storage failed to start', e, { silent: true }));
    return true;
}

// for the harness
export function _storageState() {
    return { related: relatedIds ? Array.from(relatedIds) : null, lastIds };
}
