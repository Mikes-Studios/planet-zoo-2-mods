// Kin in the in-park info panels:
//  - habitat panel, Animals tab: a line under the species' male/female
//    counts ("2 inbreeding risks · 1 close kin") and a DNA badge on every
//    animal row that could breed with a relative there;
//  - animal info panel: a kin line on the Overview card, and on the
//    Studbook / Social lists a badge on each relative it shares a habitat
//    (and a breeding risk) with.
// All of it is VNodes added to the game's own renders (kinhooks.js).
import { getKinSettings, markKinActive } from '/js/mods/pz2qol/kin.js';
import { visibleCounts, worstOf } from '/js/mods/pz2qol/kinplannercore.js';
import { partnerOf, relationWord, SEVERITY_INFO } from '/js/mods/pz2qol/kincore.js';
import { animalCardContent, habitatCardContent, pairRow, riskSummaryText, sexSymbol, visiblePairs } from '/js/mods/pz2qol/kinui.js';
import {
    appendVNode, badgeVNode, dsValue, findVNode, gameModule, hasClass, isHudPage, insertAfterVNode, kinSlot, lineVNode, patchRender, unwrap, unwrapUntil,
} from '/js/mods/pz2qol/kinhooks.js';
import { openKinPlanner } from '/js/mods/pz2qol/kinplanner.js';
import { h } from '/js/mods/pz2qol/ui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';

function openFor(animal) {
    openKinPlanner({ habitatId: animal.hab || undefined, animalId: animal.id });
}

function entityOfRowId(id) {
    // habitat rows: '123'; studbook / social rows: 'locateanimal:123'
    // ('123.0' from a float id reads as '123'; absent relatives have no id)
    const m = /^(?:locateanimal:)?(.+?)(?:\.0+)?$/.exec(String(id == null ? '' : id));
    return m && m[1] !== 'unknown' ? m[1] : null;
}

// ------------------------------------------------------- habitat panel

function speciesLine(model, habId, species) {
    const s = model.habitatSummaries.get(String(habId));
    if (!s) return null;
    const sp = species ? s.species.find(x => x.species === species) : null;
    const counts = visibleCounts(sp ? sp.counts : s.counts, getKinSettings().showCovered);
    const worst = worstOf(counts);
    const text = worst ? riskSummaryText(counts) : (sp ? `No related ${speciesName(species)} pairs` : 'No related breeding pairs');
    const build = pinned => habitatCardContent(model, habId, { pinned, species: sp ? species : null, openPlanner: () => openKinPlanner({ habitatId: String(habId), species: sp ? species : undefined }) });
    return lineVNode(worst, text, { build, extraClass: 'habitatPanel' });
}

function patchHabitatAnimals(HabitatAnimals) {
    if (!HabitatAnimals || !HabitatAnimals.prototype) return false;
    return patchRender(HabitatAnimals, 'habitatPanelSpecies', function (vnode, props, state) {
        const ctx = props && props.context;
        if (!Array.isArray(ctx) || ctx[1] !== 'habitatGateInfoPanel') return vnode;
        const habId = ctx[2];
        const species = state && state.viewedSpeciesId;
        const counters = findVNode(vnode, n => hasClass(n, 'HabitatAnimals_genderCountersContainer'));
        if (!counters) return vnode;
        insertAfterVNode(vnode, counters, kinSlot(model => {
            markKinActive();
            return speciesLine(model, habId, species);
        }));
        return vnode;
    });
}

// ----------------------------------------------------- animal rows

// A habitat panel row: the animal's own worst pair.
function habitatRowBadge(model, entity) {
    const a = model.animals.get(entity);
    if (!a) return null;
    const pairs = visiblePairs(model, a.id);
    if (!pairs.length) return null;
    return badgeVNode(pairs[0].severity, pairs.length, { compact: true, host: 'statusItem', title: '', build: pinned => animalCardContent(model, a, { pinned, openPlanner: openFor }) });
}

// A relative listed in an animal's Studbook / Social tab: the pair's badge
// when the two share a habitat and could breed.
function relativeRowBadge(model, focusEntity, relativeEntity) {
    const focus = model.animals.get(focusEntity);
    if (!focus) return null;
    const pair = visiblePairs(model, focus.id).find(p => partnerOf(p, focus.id).id === relativeEntity);
    if (!pair) return null;
    const other = partnerOf(pair, focus.id);
    const word = relationWord(model.ped.relation(focus.guid, other.guid), other.sex);
    const build = pinned => {
        const body = h('div.PZ2QoL_kinCardBody');
        body.appendChild(h('div.PZ2QoL_kinCardHead', null, h('div.PZ2QoL_kinCardIcon'),
            h('div.PZ2QoL_cardTitles', null,
                h('div.PZ2QoL_cardTitle', { text: `${focus.name} ${sexSymbol(focus.sex)} and ${other.name} ${sexSymbol(other.sex)}` }),
                h('div.PZ2QoL_cardSubtitle', { text: `${SEVERITY_INFO[pair.severity].label} · same habitat · ${word}` }))));
        body.appendChild(pairRow(model, pair, focus, { actions: pinned, detail: true }));
        return body;
    };
    return badgeVNode(pair.severity, 1, { compact: false, host: 'statusItem', title: '', build });
}

function patchStatusItem(AnimalStatusItem) {
    // Focusable(DataStoreComponent(class)) – the inner render builds the ListItem
    const Inner = unwrapUntil(AnimalStatusItem, c => /AnimalStatusItem_iconsContainer/.test(String(c.prototype.render))) || unwrap(unwrap(AnimalStatusItem));
    if (!Inner) return false;
    return patchRender(Inner, 'animalStatusRow', function (vnode, props, state) {
        const ctx = props && props.context;
        if (!Array.isArray(ctx) || ctx[0] !== 'infopanel') return vnode;
        const kind = ctx[1];
        let compute = null;
        const rowEntity = entityOfRowId(dsValue(ctx, 'id') ?? (state && state.id));
        if (!rowEntity) return vnode;
        if (kind === 'habitatGateInfoPanel' && ctx.indexOf('tab_habitatAnimals') >= 0) {
            compute = model => habitatRowBadge(model, rowEntity);
        }
        else if (kind === 'animalInfoPanel' && (ctx.indexOf('tab_animalStudbook') >= 0 || ctx.indexOf('tab_animalSocial') >= 0)) {
            const focus = String(ctx[2]);
            if (focus === rowEntity) return vnode;
            compute = model => relativeRowBadge(model, focus, rowEntity);
        }
        if (!compute) return vnode;
        const icons = vnode.attributes && vnode.attributes.rightInternalChildren;
        const host = icons && hasClass(icons, 'AnimalStatusItem_iconsContainer') ? icons : findVNode(vnode, n => hasClass(n, 'AnimalStatusItem_iconsContainer'));
        if (!host) return vnode;
        appendVNode(host, kinSlot(model => {
            markKinActive();
            return compute(model);
        }));
        return vnode;
    });
}

// ------------------------------------------------------- overview card

function overviewLine(model, entity) {
    const a = model.animals.get(entity);
    if (!a) return null;
    const pairs = visiblePairs(model, a.id);
    const build = pinned => animalCardContent(model, a, { pinned, openPlanner: openFor });
    if (!pairs.length) {
        return lineVNode(null, a.hab ? 'Kin: no relative to breed with here' : 'Kin: not in a habitat', { build, extraClass: 'overview' });
    }
    const p = pairs[0];
    const other = partnerOf(p, a.id);
    const word = relationWord(model.ped.relation(a.guid, other.guid), other.sex);
    const more = pairs.length > 1 ? ` · +${pairs.length - 1} more` : '';
    const bond = p.held ? `, ${p.held.by.name} bonded to ${p.held.mate.name}` : '';
    return lineVNode(p.severity, `${SEVERITY_INFO[p.severity].label}: ${other.name} ${sexSymbol(other.sex)} (${word})${p.mated ? ', mates now' : ''}${bond}${more}`, { build, extraClass: 'overview' });
}

function patchOverviewCard(AnimalOverviewCard) {
    const Inner = unwrapUntil(AnimalOverviewCard, c => /AnimalOverviewCard_hRow/.test(String(c.prototype.render))) || unwrap(AnimalOverviewCard);
    if (!Inner) return false;
    return patchRender(Inner, 'animalOverviewCard', function (vnode, props) {
        const ctx = props && props.context;
        if (!Array.isArray(ctx) || ctx[0] !== 'infopanel' || ctx[1] !== 'animalInfoPanel') return vnode;
        const entity = String(ctx[2]);
        appendVNode(vnode, kinSlot(model => {
            markKinActive();
            return overviewLine(model, entity);
        }));
        return vnode;
    });
}

// ------------------------------------------------------------- install

export function installKinPanels() {
    if (!isHudPage()) return true;
    (async () => {
        const results = [];
        const hab = await gameModule('/js/project/modules/InfoPanel/Components/Habitat/HabitatAnimals.js');
        results.push(['habitat panel species line', hab && patchHabitatAnimals(hab.HabitatAnimals)]);
        const status = await gameModule('/js/project/modules/InfoPanel/Components/Flex/Renderer/AnimalStatusItem.js');
        results.push(['animal row badges', status && patchStatusItem(status.AnimalStatusItem)]);
        const card = await gameModule('/js/project/modules/InfoPanel/Components/Animals/AnimalOverviewCard.js');
        results.push(['animal overview line', card && patchOverviewCard(card.AnimalOverviewCard)]);
        for (const [name, ok] of results) {
            if (!ok) reportError('mod', `Kin: ${name} not installed`, 'The game panel looked different than expected.', { silent: true });
        }
    })();
    return true;
}
