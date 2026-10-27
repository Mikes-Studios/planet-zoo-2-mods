// Kin in Compare Mates (park and hub) and the Genealogy popup (park).
//
// Compare Mates:
//  - every candidate row gets a badge saying how it is related to the
//    animal already chosen on the other side ("Half-sister"), with a card
//    that explains the link, says whether the game itself flags the pair
//    and shows the expected young;
//  - the offspring box gets one line for the chosen pair, including the
//    relatives the game does not warn about (cousins, aunts...);
//  - in a Franchise park the game also lists the player's stored adults
//    (id type 2): they are matched through the stored adults of the
//    species (kinmoves requestStoredAdults), so they get badges too;
//  - an optional "Unrelated first" order for the candidate lists. It only
//    groups the game's own order (the game sorts by `sortField`; this keeps
//    that order inside each group), and is off by default.
// Genealogy:
//  - each relative's row says where it lives now ("Savannah Habitat",
//    "Not in the zoo") and, when it shares a habitat with the animal in
//    focus and could breed with it, carries that pair's kin badge;
//  - under the focus animal's header, a summary line when it has related
//    breeding partners.
// Everything is VNodes added to the game's own renders (kinhooks.js), so it
// survives re-renders; every patch turns itself off after repeated errors.
import { getKinModel, getKinSettings, getStorageKinModel, markKinActive, onKin } from '/js/mods/pz2qol/kin.js';
import { explainRelation, holdReason, kinTier, partnerOf, percent, relationWord, Sex, SEVERITY_INFO } from '/js/mods/pz2qol/kincore.js';
import { animalCardContent, offspringBlock, placeOf, riskSummaryText, sexClass, sexSymbol, visiblePairs } from '/js/mods/pz2qol/kinui.js';
import { worstOf } from '/js/mods/pz2qol/kinplannercore.js';
import {
    appendVNode, badgeVNode, cardHandlers, dsValue, findByClass, gameModule, h, hasClass, isFrontendPage, isHudPage,
    KinSlot, lineVNode, patchRender, unwrap, unwrapUntil,
} from '/js/mods/pz2qol/kinhooks.js';
import { refreshList, registerListFilter } from '/js/mods/pz2qol/listfilter.js';
import { childrenOf, contextKey, locationName } from '/js/mods/pz2qol/game.js';
import { h as dom, icon } from '/js/mods/pz2qol/ui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { cachedStoredAdults, isAskingStored, requestStoredAdults } from '/js/mods/pz2qol/kinmoves.js';
import { withStored } from '/js/mods/pz2qol/kincore.js';

const MOD_ALB = '/js/project/components/AnimalListButton.js';
const MOD_OFFSPRING = '/js/project/modules/PopupActions/Components/OffspringDisplay.js';
const MOD_PARENTS = '/js/project/modules/PopupActions/Components/ParentDisplay.js';
const MOD_GENEALOGY = '/js/project/modules/PopupActions/Components/GenealogyPopup.js';

// Compare Mates id types (CompareMatesUIUtils)
const ID_ENTITY = 0;
const ID_GUID = 2;
const ID_EXHIBIT_UID = 4;

// ------------------------------------------------------------ change events

// Fired when the Compare Mates pair or the Genealogy focus changes, so the
// slots that depend on them re-render even if the game's row does not.
const changeListeners = new Set();
function changed() {
    changeListeners.forEach(fn => {
        try {
            fn();
        }
        catch (e) {
            // a listener must not break the others
        }
    });
}
function onChange(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
}

// KinSlot that also follows the selection. Uses the park model, or the
// storage one in the hub (Compare Mates there lists stored animals).
class MatesSlot extends KinSlot {
    componentDidMount() {
        super.componentDidMount();
        this._offChange = onChange(() => this.setState({ sel: (this.state.sel || 0) + 1 }));
    }

    componentWillUnmount() {
        super.componentWillUnmount();
        if (this._offChange) this._offChange();
    }
}

// Keeps park data fresh while a kin surface is up (the hub has no park).
function active() {
    if (isHudPage()) markKinActive();
}

function anyModel() {
    return getKinModel() || getStorageKinModel();
}

function slot(compute) {
    return h(MatesSlot, { compute, storage: true, getModel: anyModel });
}

// ------------------------------------------------------------- pure helpers

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Lua writes whole numbers that went through a float as "123.0".
function cleanNumber(s) {
    return /^-?\d+\.0$/.test(s) ? s.slice(0, -2) : s;
}

// "animal_<nID>_<nIDType>" -> { nid: '123', type: 0 } (the Compare Mates row id)
export function parseMateId(s) {
    const m = /^animal_(.+)_(\d+)$/.exec(String(s == null ? '' : s));
    return m ? { nid: cleanNumber(m[1]), type: Number(m[2]) } : null;
}

// GUIDs reach the page as Lua strings in the kin data but as JS numbers in
// some DataStore rows (Genealogy ids), which lose digits past 2^53. Match
// exactly first, then by numeric value (both sides round the same way).
const numericIndex = new WeakMap();
const AMBIGUOUS = { ambiguous: true };
export function byGuidLoose(model, raw) {
    if (!model || raw == null || raw === '') return null;
    const s = cleanNumber(String(raw));
    const hit = model.byGuid.get(s);
    if (hit) return hit;
    const n = Number(s);
    if (!isFinite(n) || n === 0) return null;
    let index = numericIndex.get(model);
    if (!index) {
        // two GUIDs that round to the same JS number (past 2^53) are
        // ambiguous: match neither rather than the wrong animal
        index = new Map();
        for (const [g, a] of model.byGuid) {
            const k = Number(g);
            if (!isFinite(k) || k === 0) continue;
            index.set(k, index.has(k) && index.get(k) !== a ? AMBIGUOUS : a);
        }
        numericIndex.set(model, index);
    }
    const hitN = index.get(n);
    return hitN && hitN !== AMBIGUOUS ? hitN : null;
}

function findInModel(model, ref) {
    if (!model || !ref) return null;
    if (ref.type === ID_ENTITY) return model.animals.get(ref.nid) || null;
    if (ref.type === ID_GUID) return byGuidLoose(model, ref.nid);
    if (ref.type === ID_EXHIBIT_UID) return model.animals.get('x' + ref.nid) || null;
    return null;   // market listings and exchange animals have no lineage
}

const TIER_SEVERITY = { game: 'risk', close: 'kin', distant: 'distant' };

// Symmetric relations read "X and Y are half-siblings"; the others name
// each side ("father and daughter").
const SYMMETRIC = { sibling: true, cousin: true, distant: true };

export function pairPhrase(model, x, y) {
    const rel = model.ped.relation(x.guid, y.guid);
    if (!rel) return '';
    if (rel.code === 'sibling') return rel.full ? 'full siblings' : 'half-siblings';
    if (rel.code === 'cousin') return rel.full ? 'first cousins' : 'half cousins';
    if (rel.code === 'distant') return 'distant relatives';
    const back = model.ped.relation(y.guid, x.guid);
    return `${relationWord(back, x.sex)} and ${relationWord(rel, y.sex)}`;
}

// "Kito ♂ and Zuri ♀ are half-siblings" / "Zuri ♀ is Kito ♂'s mother"
export function pairSentence(model, x, y) {
    const rel = model.ped.relation(x.guid, y.guid);
    if (!rel) return `${x.name} ${sexSymbol(x.sex)} and ${y.name} ${sexSymbol(y.sex)} are not related as far as the game records`;
    if (SYMMETRIC[rel.code]) return `${x.name} ${sexSymbol(x.sex)} and ${y.name} ${sexSymbol(y.sex)} are ${pairPhrase(model, x, y)}`;
    return `${y.name} ${sexSymbol(y.sex)} is ${x.name} ${sexSymbol(x.sex)}'s ${relationWord(rel, y.sex)}`;
}

// ---------------------------------------------------------- Compare Mates

const mates = { mother: '', father: '' };

// The row id for a value the game gave us. Lua uses the same string for
// the row's key and its `id`; the harness only has numeric keys, whose
// `id` is the real one.
function rowId(list, value) {
    if (!value) return '';
    const id = dsValue(['compareMates', list, String(value)], 'id');
    return typeof id === 'string' && id ? id : String(value);
}

function selectedFor(list) {
    // candidates in the mothers list are compared with the chosen father
    return list === 'mothers' ? rowId('fathers', mates.father) : rowId('mothers', mates.mother);
}

// In a Franchise park Compare Mates also lists the player's stored adults
// (id type 2, not in the park model). They are found through the stored
// adults of the species (kinmoves requestStoredAdults: asked once, cached a
// minute); until the answer is in, such rows simply get no badge.
function storedView(model, species) {
    if (!model || !species || !isHudPage()) return null;
    const c = cachedStoredAdults(species);
    if (c) return c.error || !c.animals.length ? null : withStored(model, c);
    if (!isAskingStored(species)) {
        // not from inside a render: ask on the next tick
        setTimeout(() => {
            requestStoredAdults(species).then(v => {
                if (!v || v.error || !v.animals.length) return;
                changed();
                if (unrelatedFirst) refreshMateLists();
            }).catch(() => {});
        }, 0);
    }
    return null;
}

// How the candidate `candId` is related to the chosen `selId`, in the
// model (park, or storage in the hub) that knows both.
function matePair(selId, candId) {
    const s = parseMateId(selId);
    const c = parseMateId(candId);
    if (!s || !c) return null;
    const park = getKinModel();
    for (const found of [park, getStorageKinModel()]) {
        let model = found;
        let a = findInModel(model, s);
        let b = findInModel(model, c);
        // one side is a stored adult (type 2) the park does not know
        if (model && model === park && (a || b) && ((!a && s.type === ID_GUID) || (!b && c.type === ID_GUID))) {
            const view = storedView(model, (a || b).species);
            if (view) {
                model = view;
                a = a || findInModel(view, s);
                b = b || findInModel(view, c);
            }
        }
        if (!a || !b) continue;
        if (!a.guid || !b.guid) return { model, a, b, rel: null, unknown: true };
        const rel = model.ped.relation(a.guid, b.guid);
        const tier = kinTier(model, rel);
        // the same two in one habitat, kept apart by a pair bond: say so, as
        // the game's own monogamy lock in this popup does
        const same = (model.byAnimal.get(a.id) || []).find(q => partnerOf(q, a.id) === b);
        if (same && same.severity === 'held') return { model, a, b, rel, tier, severity: 'held', held: same.held, unheld: same.unheld };
        return { model, a, b, rel, tier, severity: tier ? TIER_SEVERITY[tier] : null };
    }
    return null;
}

function gameNote(tier) {
    if (tier === 'game') return 'The game flags this pair as inbred.';
    if (tier === 'close') return 'The game does NOT warn about this pair, but their young lose fertility and immunity all the same.';
    return 'Distantly related: the game does not count it, and the effect on the young is small.';
}

function pairCard(p, pinned) {
    const [m, f] = p.a.sex === Sex.Female ? [p.b, p.a] : [p.a, p.b];
    const body = dom('div.PZ2QoL_kinCardBody');
    const word = relationWord(p.rel, p.b.sex);
    body.appendChild(dom('div.PZ2QoL_kinCardHead', null, dom('div.PZ2QoL_kinCardIcon'),
        dom('div.PZ2QoL_cardTitles', null,
            dom('div.PZ2QoL_cardTitle', { text: `${p.b.name} ${sexSymbol(p.b.sex)} and ${p.a.name} ${sexSymbol(p.a.sex)}` }),
            dom('div.PZ2QoL_cardSubtitle', { text: `${cap(word)} · ${percent(p.rel.kinship)} kinship` }))));
    const info = SEVERITY_INFO[p.severity] || SEVERITY_INFO.distant;
    body.appendChild(dom(`div.PZ2QoL_kinPair.sev_${p.severity}`, null,
        dom('div.PZ2QoL_kinPairHead', null, dom(`div.PZ2QoL_kinTag.sev_${p.severity}`, { text: info.label }),
            dom(`span.PZ2QoL_kinName.${sexClass(p.b.sex)}`, { text: `${p.b.name} ${sexSymbol(p.b.sex)}` }),
            dom('div.PZ2QoL_kinFacts', { text: `${word} of ${p.a.name}` })),
        dom('div.PZ2QoL_kinWhy', { text: `${explainRelation(p.model, p.a, p.b)} ${gameNote(p.tier)}${p.held ? ` ${holdReason(p)}.` : ''}` }),
        offspringBlock(m, f)));
    if (!pinned) body.appendChild(dom('div.PZ2QoL_kinCardFoot', null, dom('div.PZ2QoL_kinHint', { text: 'Kin reads the family records the game keeps' })));
    return body;
}

// The badge on one candidate row.
function candidateBadge(list, candId) {
    const selId = selectedFor(list);
    if (!selId || !candId) return null;
    active();
    const p = matePair(selId, candId);
    if (!p || !p.rel || !p.severity) return null;
    const word = cap(relationWord(p.rel, p.b.sex));
    const title = `${p.b.name} is ${p.a.name}'s ${word.toLowerCase()} (${percent(p.rel.kinship)} kinship). ${p.tier === 'game' ? 'The game flags this pair.' : 'The game does not warn about this pair.'}`;
    return h('div', { className: 'PZ2QoL_kmHost' },
        h('div', Object.assign({ className: `PZ2QoL_kin PZ2QoL_kmRel sev_${p.severity}`, title }, cardHandlers(pinned => pairCard(p, pinned))),
            h('div', { className: 'PZ2QoL_kinIcon' }),
            h('div', { className: 'PZ2QoL_kinLabel' }, word)));
}

// The line under the offspring box for the chosen pair.
function offspringLine() {
    const mId = rowId('mothers', mates.mother);
    const fId = rowId('fathers', mates.father);
    if (!mId || !fId) return null;
    active();
    const p = matePair(fId, mId); // b = mother, what she is to the father
    if (!p || p.unknown) return null;
    let sev = 'none';
    let title = 'Not related as far as the game records';
    let sub = 'No shared parents or grandparents in the family records.';
    if (p.rel) {
        sev = p.severity || 'distant';
        title = `${cap(pairPhrase(p.model, p.a, p.b))} · ${percent(p.rel.kinship)} kinship`;
        sub = p.tier === 'game' ? 'The game flags this pair as inbred.'
            : p.tier === 'close' ? 'The game does NOT warn about this: their young lose fertility and immunity.'
                : 'Distant relatives: the game does not count it.';
        if (p.held) sub += ' A pair bond keeps them apart for now.';
    }
    const build = pinned => {
        if (p.rel) return pairCard(p, pinned);
        const body = dom('div.PZ2QoL_kinCardBody');
        body.appendChild(dom('div.PZ2QoL_kinOk', null, icon('Icon_Tick', 'brown', 'sm'), dom('span', { text: explainRelation(p.model, p.a, p.b) })));
        const [m, f] = p.a.sex === Sex.Female ? [p.a, p.b] : [p.b, p.a];
        const block = offspringBlock(m, f);
        if (block) body.appendChild(block);
        return body;
    };
    return h('div', { className: 'PZ2QoL_kmOffspringHost' },
        h('div', Object.assign({ className: `PZ2QoL_kmOffspring sev_${sev}` }, cardHandlers(build)),
            h('div', { className: 'PZ2QoL_kinIcon' }),
            h('div', { className: 'PZ2QoL_kmTexts' },
                h('div', { className: 'PZ2QoL_kmTitle' }, title),
                h('div', { className: 'PZ2QoL_kmSub' }, sub))));
}

// ------------------------------------------------------- Unrelated first

const SORT_KEY = 'PZ2QoL.kin.matesUnrelatedFirst';
let unrelatedFirst = false;
try {
    unrelatedFirst = window.localStorage && window.localStorage.getItem(SORT_KEY) === 'true';
}
catch (e) {
    // session only
}

const LISTS = ['mothers', 'fathers'];
const RANK = { none: 0, unknown: 1, distant: 2, close: 3, game: 4 };

function rankOf(list, ctx, selId) {
    const candId = rowId(list, ctx[ctx.length - 1]);
    const p = matePair(selId, candId);
    if (!p || p.unknown) return RANK.unknown;
    return p.tier ? RANK[p.tier] : RANK.none;
}

function refreshMateLists() {
    for (const list of LISTS) refreshList(contextKey(['compareMates', list]));
}

function setUnrelatedFirst(on) {
    unrelatedFirst = !!on;
    try {
        if (window.localStorage) window.localStorage.setItem(SORT_KEY, unrelatedFirst ? 'true' : 'false');
    }
    catch (e) {
        // session only
    }
    refreshMateLists();
    changed();
}

function registerSort() {
    for (const list of LISTS) {
        registerListFilter(contextKey(['compareMates', list]), {
            active: () => unrelatedFirst && getKinSettings().enabled && !!selectedFor(list) && !!anyModel(),
            // stable: the game's order is kept inside each group
            filter: source => {
                const selId = selectedFor(list);
                return source.map((ctx, i) => ({ ctx, i, r: rankOf(list, ctx, selId) }))
                    .sort((x, y) => x.r - y.r || x.i - y.i)
                    .map(x => x.ctx);
            },
        });
    }
}

function sortToggle(list) {
    if (!selectedFor(list)) return null;
    const on = unrelatedFirst;
    return h('div', {
        className: `PZ2QoL_kmSort${on ? ' on' : ''}`,
        title: on ? 'Back to the game\'s order' : 'Show unrelated animals first (the game\'s order is kept within each group)',
        onMouseDown: e => e.stopPropagation(),
        onClick: e => {
            e.stopPropagation();
            try {
                setUnrelatedFirst(!unrelatedFirst);
            }
            catch (err) {
                reportError('ui', 'Kin: sort failed', err, { silent: true });
            }
        },
    }, h('div', { className: 'PZ2QoL_kinIcon' }), h('span', null, 'Unrelated first'), h('div', { className: 'PZ2QoL_kmSwitch' }, h('div', { className: 'PZ2QoL_kmKnob' })));
}

// --------------------------------------------------------------- Genealogy

const genealogy = { focus: null, stack: [], infoEntity: null, ticked: new Set() };

function statusName() {
    return locationName(dsValue(['genealogy', 'animalStatus'], 'name')) || '';
}

function listIds(list) {
    try {
        return childrenOf(['genealogy', list, 'dataProvider']).map(ctx => String(dsValue(ctx, 'id') ?? '')).filter(g => g && g !== 'unknown');
    }
    catch (e) {
        return [];
    }
}

// The animal the popup is about: the one we tracked (info panel, list
// clicks, Back), checked against the name the popup shows; otherwise the
// animal with that name whose parents match the popup's parent rows.
export function genealogyFocus(model) {
    if (!model) return null;
    const name = statusName();
    const f = genealogy.focus;
    let a = f ? (f.guid ? byGuidLoose(model, f.guid) : model.animals.get(f.entity)) : null;
    if (a && name && a.name !== name) a = null;
    if (!a && name) {
        let list = [];
        for (const x of model.animals.values()) if (x.name === name) list.push(x);
        if (list.length > 1) {
            const parents = listIds('parents');
            const same = (p, q) => p === q || (isFinite(Number(p)) && Number(p) !== 0 && Number(p) === Number(q));
            if (parents.length) list = list.filter(x => parents.every(p => x.par.some(q => same(p, q))));
        }
        if (list.length === 1) a = list[0];
    }
    return a || null;
}

function relativeTags(model, guid) {
    if (!guid || guid === 'unknown') return null;
    active();
    const a = byGuidLoose(model, guid);
    const place = a ? (placeOf(model, a) || 'In the zoo') : 'Not in the zoo';
    let badge = null;
    const focus = a && genealogyFocus(model);
    if (focus && focus !== a) {
        const pair = visiblePairs(model, focus.id).find(p => partnerOf(p, focus.id) === a);
        if (pair) {
            const word = relationWord(model.ped.relation(focus.guid, a.guid), a.sex);
            badge = badgeVNode(pair.severity, 1, {
                title: `${SEVERITY_INFO[pair.severity].label}: ${a.name} is ${focus.name}'s ${word} and lives in the same habitat`,
                build: pinned => animalCardContent(model, focus, { pinned }),
            });
        }
    }
    return h('div', { className: 'PZ2QoL_kmGenTags' },
        h('div', { className: `PZ2QoL_kmPlace ${a ? 'in' : 'out'}`, title: a ? `${a.name} lives in ${place}` : 'Not in this zoo (sold, released, in storage, or no longer alive)' }, place),
        badge);
}

function genealogySummary(model) {
    const focus = genealogyFocus(model);
    if (!focus) return null;
    active();
    const pairs = visiblePairs(model, focus.id);
    if (!pairs.length) return null;
    const counts = { risk: 0, kin: 0, future: 0, held: 0, covered: 0 };
    for (const p of pairs) if (counts[p.severity] != null) counts[p.severity]++;
    const worst = worstOf(counts);
    if (!worst) return null;
    const place = placeOf(model, focus);
    const text = `${riskSummaryText(counts)}${place ? ' in ' + place : ''}`;
    return lineVNode(worst, text, { build: pinned => animalCardContent(model, focus, { pinned }), extraClass: 'PZ2QoL_kmGenLine' });
}

function onGenealogyEvent(name, a, b) {
    if (name === 'InfoPanel_SetContext') {
        if (Array.isArray(a) && /animal/i.test(String(a[1])) && a[2] != null) genealogy.infoEntity = String(a[2]);
        return;
    }
    if (name === 'InfoPanel_UI_Select') {
        if (/genealogy/i.test(String(a)) && genealogy.infoEntity) {
            genealogy.stack = [];
            genealogy.focus = { entity: genealogy.infoEntity };
            changed();
        }
        return;
    }
    if (name === 'Management_ItemCheckboxToggled') {
        const m = /^(?:animal_(\d+)|exhibit_animal_(\d+))$/.exec(String(a));
        if (!m) return;
        const id = m[1] || 'x' + m[2];
        if (b) genealogy.ticked.add(id);
        else genealogy.ticked.delete(id);
        return;
    }
    if (name === 'Management_SelectAllCheckboxToggled') {
        if (!b) genealogy.ticked.clear();
        return;
    }
    if (name === 'ManagementAnimals_FooterSelected') {
        if (/genealogy/i.test(String(a))) {
            genealogy.stack = [];
            genealogy.focus = genealogy.ticked.size === 1 ? { entity: Array.from(genealogy.ticked)[0] } : null;
            changed();
        }
        return;
    }
    if (name === 'Genealogy_UI_Select') {
        const id = String(a == null ? '' : a);
        if (!id || id === 'unknown' || /^(parents|siblings|mates|offspring)$/.test(id)) return;
        genealogy.stack.push(genealogy.focus);
        genealogy.focus = { guid: cleanNumber(id) };
        changed();
        return;
    }
    if (name === 'Genealogy_UI_Back') {
        if (genealogy.stack.length) genealogy.focus = genealogy.stack.pop();
        changed();
        return;
    }
    if (name === 'PopupAction_ShowGeneaologyPopup' || name === 'Genealogy_UI_Close') {
        if (name === 'Genealogy_UI_Close' || !a) {
            genealogy.stack = [];
        }
        changed();
    }
}

// ------------------------------------------------------------------ patches

function isCompareRow(ctx) {
    return Array.isArray(ctx) && ctx.length === 3 && ctx[0] === 'compareMates' && (ctx[1] === 'mothers' || ctx[1] === 'fathers');
}

function isGenealogyRow(ctx) {
    return Array.isArray(ctx) && ctx[0] === 'genealogy' && ctx[2] === 'dataProvider' && ctx.length === 4;
}

// AnimalListButton: Compare Mates candidates and Genealogy relatives.
function patchRows(AnimalListButton) {
    const Inner = unwrapUntil(AnimalListButton, c => /AnimalListButton_rightContent/.test(String(c.prototype.render))) || unwrap(AnimalListButton);
    if (!Inner) return false;
    return patchRender(Inner, 'matesRows', function (vnode, props, state, context) {
        const dsCtx = (context && context.dataStoreContext) || (this.context && this.context.dataStoreContext);
        const own = props && props.context;
        if (isCompareRow(dsCtx)) {
            const list = dsCtx[1];
            const candId = rowId(list, dsCtx[2]);
            // on the row root (position: relative), over the free end of the
            // name column: the column itself clips anything added to it
            if (!hasClass(vnode, 'AnimalListButton_root')) return vnode;
            appendVNode(vnode, slot(() => candidateBadge(list, candId)));
            return vnode;
        }
        const gctx = isGenealogyRow(own) ? own : isGenealogyRow(dsCtx) ? dsCtx : null;
        if (gctx && isHudPage()) {
            const guid = cleanNumber(String(dsValue(gctx, 'id') ?? (props && props.id) ?? ''));
            const host = findByClass(vnode, 'AnimalListButton_rightContent');
            if (!host) return vnode;
            appendVNode(host, h(MatesSlot, { compute: model => relativeTags(model, guid) }));
        }
        return vnode;
    });
}

function patchOffspring(OffspringDisplay) {
    if (!OffspringDisplay || !OffspringDisplay.prototype) return false;
    return patchRender(OffspringDisplay, 'matesOffspring', function (vnode, props) {
        if (!props || !props.hasBothParents || !hasClass(vnode, 'OffspringDisplay_root')) return vnode;
        // a zero-height host at the end: the line hangs below the box, in
        // the free space under it, so the game's own layout is unchanged
        appendVNode(vnode, slot(() => offspringLine()));
        return vnode;
    });
}

function patchParentDisplay(ParentDisplay) {
    const Inner = unwrapUntil(ParentDisplay, c => /ParentDisplay_selectionList/.test(String(c.prototype.render))) || unwrap(ParentDisplay);
    if (!Inner) return false;
    return patchRender(Inner, 'matesSort', function (vnode, props) {
        const list = props && props.gender === Sex.Male ? 'fathers' : props && props.gender === Sex.Female ? 'mothers' : null;
        if (!list) return vnode;
        const host = findByClass(vnode, 'ParentDisplay_selectionList');
        if (!host) return vnode;
        const kids = Array.isArray(host.children) ? host.children : host.children != null ? [host.children] : [];
        host.children = [slot(() => sortToggle(list))].concat(kids);
        return vnode;
    });
}

function patchGenealogy(GenealogyPopup) {
    const Inner = unwrapUntil(GenealogyPopup, c => /GenealogyPopup_left/.test(String(c.prototype.render))) || unwrap(GenealogyPopup);
    if (!Inner) return false;
    return patchRender(Inner, 'genealogyFocus', function (vnode) {
        const left = findByClass(vnode, 'GenealogyPopup_left');
        if (!left) return vnode;
        const kids = Array.isArray(left.children) ? left.children.slice() : [];
        const at = kids.findIndex(k => k && k.attributes && k.attributes.rootClassName === 'GenealogyPopup_statusItem');
        const line = h(MatesSlot, { compute: model => genealogySummary(model) });
        if (at >= 0) kids.splice(at + 1, 0, line);
        else kids.push(line);
        left.children = kids;
        return vnode;
    });
}

// ------------------------------------------------------------------ install

function listen(name, fn) {
    engine.on(name, (...args) => {
        try {
            fn(...args);
        }
        catch (e) {
            reportError('ui', `Kin: ${name} handler failed`, e, { silent: true });
        }
    });
}

function installEvents(hud) {
    listen('PopupAction_SetDataCompareMates', data => {
        mates.mother = data && data.mother ? String(data.mother) : '';
        mates.father = data && data.father ? String(data.father) : '';
        changed();
        if (unrelatedFirst) refreshMateLists();
    });
    listen('CompareMates_UI_SelectMother', id => {
        mates.mother = id ? String(id) : '';
        changed();
        if (unrelatedFirst) refreshMateLists();
    });
    listen('CompareMates_UI_SelectFather', id => {
        mates.father = id ? String(id) : '';
        changed();
        if (unrelatedFirst) refreshMateLists();
    });
    onKin(() => {
        if (unrelatedFirst && (mates.mother || mates.father)) refreshMateLists();
    });
    if (!hud) return;
    for (const name of ['InfoPanel_SetContext', 'InfoPanel_UI_Select', 'Management_ItemCheckboxToggled', 'Management_SelectAllCheckboxToggled',
        'ManagementAnimals_FooterSelected', 'Genealogy_UI_Select', 'Genealogy_UI_Back', 'Genealogy_UI_Close', 'PopupAction_ShowGeneaologyPopup']) {
        listen(name, (a, b) => onGenealogyEvent(name, a, b));
    }
    // Lua fills the popup a frame after a re-centre: follow the shown name
    gameModule('/js/common/core/DataStore.js').then(DS => {
        if (DS && DS.getPropertyListener) DS.getPropertyListener(['genealogy', 'animalStatus'], 'name', () => changed());
    }).catch(() => {});
}

let installed = false;

export function installKinMates() {
    if (installed) return true;
    const hud = isHudPage();
    const frontend = isFrontendPage();
    if (!hud && !frontend) return true;
    if (typeof engine === 'undefined') return false;
    installed = true;
    installEvents(hud);
    registerSort();
    (async () => {
        const missing = [];
        const alb = await gameModule(MOD_ALB);
        if (!patchRows(alb && alb.AnimalListButton)) missing.push('candidate rows');
        const off = await gameModule(MOD_OFFSPRING);
        if (!patchOffspring(off && off.OffspringDisplay)) missing.push('offspring box');
        const pd = await gameModule(MOD_PARENTS);
        if (!patchParentDisplay(pd && pd.ParentDisplay)) missing.push('sort');
        if (hud) {
            const gen = await gameModule(MOD_GENEALOGY);
            if (!patchGenealogy(gen && gen.GenealogyPopup)) missing.push('genealogy');
        }
        if (missing.length) reportError('mod', 'Kin in Compare Mates not installed', missing.join(', '), { silent: true });
    })().catch(e => reportError('mod', 'Kin in Compare Mates failed to start', e, { silent: true }));
    return true;
}

// for the harness
export function _matesState() {
    return { mates: Object.assign({}, mates), unrelatedFirst, focus: genealogy.focus, stack: genealogy.stack.length };
}
