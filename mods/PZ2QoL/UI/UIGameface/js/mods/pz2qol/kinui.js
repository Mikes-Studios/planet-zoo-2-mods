// Shared Kin widgets: the DNA badge, the kin card (hover to peek, click to
// pin, with one-click actions), pair lines and offspring gene ranges.
// Plain DOM in the mod's own elements, like the rest of PZ2QoL.
import {
    SEVERITY_INFO, Sex, animalPairs, partnerOf, explainRelation, relationWord, percent, predictOffspring,
    offspringScore, habitatSummary, canLocate,
    fertilityText, holdReason,
} from '/js/mods/pz2qol/kincore.js';
import { getKinSettings, locateAnimal, setContraception } from '/js/mods/pz2qol/kin.js';
import { clear, h, icon, setClass, visibleBox } from '/js/mods/pz2qol/ui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { besideAnchor } from '/js/mods/pz2qol/placement.js';
import { remPx } from '/js/mods/pz2qol/kinpanel.js';
import { visibleCounts, worstOf } from '/js/mods/pz2qol/kinplannercore.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';

export function sexSymbol(sex) {
    return sex === Sex.Male ? '♂' : sex === Sex.Female ? '♀' : '⚥';
}

export function sexClass(sex) {
    return sex === Sex.Male ? 'male' : sex === Sex.Female ? 'female' : 'unisex';
}

// "Savannah Habitat" or "Reptile House"; '' when outside one.
export function placeOf(model, a) {
    if (!a.hab) return a.loc || '';
    const h = model && model.habitats.get(a.hab);
    return (h && h.name) || a.loc || '';
}

// Severities shown on badges, after the player's settings.
export function visiblePairs(model, id) {
    const s = getKinSettings();
    return animalPairs(model, id).filter(p => s.showCovered || p.severity !== 'covered');
}

// ------------------------------------------------------------------ badge

// A small DNA pill: severity colour, count of related partners.
export function kinBadge(severity, count, { compact = false, extraClass = '' } = {}) {
    const info = SEVERITY_INFO[severity] || SEVERITY_INFO.distant;
    const node = h(`div.PZ2QoL_kin.sev_${severity}${compact ? '.compact' : ''}${extraClass ? '.' + extraClass : ''}`, null,
        h('div.PZ2QoL_kinIcon'),
        !compact && h('div.PZ2QoL_kinLabel', { text: info.short }),
        count > 1 && h('div.PZ2QoL_kinCount', { text: String(count) }));
    node.__severity = severity;
    return node;
}

// ------------------------------------------------------------- gene bars

// One predicted offspring gene: the min..max range and the expected value.
export function geneRange(label, range, iconName) {
    if (!range) return null;
    const pct = v => `${Math.round(v * 100)}%`;
    const tier = range.mean >= 0.75 ? 'great' : range.mean >= 0.5 ? 'good' : range.mean >= 0.34 ? 'fair' : 'poor';
    return h('div.PZ2QoL_kinGene', null,
        iconName ? icon(iconName, 'brown', 'xs') : null,
        h('div.PZ2QoL_kinGeneLabel', { text: label }),
        h('div.PZ2QoL_kinGeneTrack', null,
            h('div.PZ2QoL_kinGeneSpan', { style: { left: pct(range.min), width: `${Math.max(2, Math.round((range.max - range.min) * 100))}%` } }),
            h(`div.PZ2QoL_kinGeneMean.tier_${tier}`, { style: { left: `calc(${pct(range.mean)} - 0.2rem)` } })),
        h('div.PZ2QoL_kinGeneValue', { text: range.min === range.max ? pct(range.mean) : `${pct(range.min)}–${pct(range.max)}` }));
}

export function offspringBlock(a, b, { title = 'Expected young' } = {}) {
    const pred = predictOffspring(a.genes, b.genes);
    if (!pred) return null;
    return h('div.PZ2QoL_kinOffspring', null,
        h('div.PZ2QoL_kinSubhead', { text: `${title} (game's gene model)` }),
        geneRange('Fertility', pred.fertility, 'IconFertility'),
        geneRange('Immunity', pred.immunity, 'IconImmunity'),
        geneRange('Size', pred.size, 'IconSize'),
        geneRange('Longevity', pred.longevity, 'IconLongevity'));
}

// ------------------------------------------------------------- pair line

function nameTag(a) {
    return h(`span.PZ2QoL_kinName.${sexClass(a.sex)}`, { text: `${a.name} ${sexSymbol(a.sex)}` });
}

export function severityTag(severity) {
    const info = SEVERITY_INFO[severity] || SEVERITY_INFO.distant;
    return h(`div.PZ2QoL_kinTag.sev_${severity}`, { text: info.label });
}

function contraButton(a, onDone) {
    const on = !!a.contra;
    return h(`div.PZ2QoL_kinAction${on ? '' : '.primary'}`, {
        title: on ? `Stop contraception for ${a.name}` : `Give ${a.name} contraception (the game's own toggle)`,
        onClick: () => {
            setContraception(a.id, !on);
            if (onDone) onDone();
        },
    }, icon('Icon_Contracepted', on ? 'brown' : 'white', 'xs'), h('span', { text: on ? `Stop contraception ${sexSymbol(a.sex)}` : `Contraception ${sexSymbol(a.sex)}` }));
}

function locateButton(a, onDone) {
    if (!canLocate(a)) return null;
    return h('div.PZ2QoL_kinAction', {
        title: `Move the camera to ${a.name} and open its info panel`,
        onClick: () => {
            locateAnimal(a.id);
            if (onDone) onDone();
        },
    }, icon('IconLocation', 'brown', 'xs'), h('span', { text: `Locate ${a.name}` }));
}

// 'juvenile' | 'adult' | 'elderly' (the game's age groups)
export function ageWord(a) {
    if (a.juv) return 'juvenile';
    return a.ageQ === 3 || (a.fert && a.fert.elderly) ? 'elderly' : 'adult';
}

// One related partner of `self`: who, how, how bad, and what to do.
export function pairRow(model, pair, self, { actions = false, detail = true, onAction } = {}) {
    const other = partnerOf(pair, self.id);
    const word = relationWord(model.ped.relation(self.guid, other.guid), other.sex);
    const facts = [word, `${percent(pair.kinship)} kinship`];
    if (pair.mated) facts.push('mates now');
    if (pair.severity === 'covered' && pair.cover) facts.push(pair.cover);
    if (pair.held) facts.push(`${pair.held.by.name} bonded to ${pair.held.mate.name}`);
    if (!self.hab || self.hab !== other.hab) facts.push(placeOf(model, other));
    const row = h(`div.PZ2QoL_kinPair.sev_${pair.severity}`, null,
        h('div.PZ2QoL_kinPairHead', null, severityTag(pair.severity), nameTag(other), h('div.PZ2QoL_kinFacts', { text: facts.filter(Boolean).join(' · ') })),
        detail && h('div.PZ2QoL_kinWhy', { text: explainRelation(model, self, other) + (pair.tier === 'game' ? '' : ' The game does not warn about this pair.')
            + (pair.held ? ` ${holdReason(pair)}.` : '') }),
        detail && offspringBlock(pair.a, pair.b),
        actions && h('div.PZ2QoL_kinActions', null,
            other.sex === Sex.Female || self.sex === Sex.Female ? contraButton(self.sex === Sex.Female ? self : other, onAction) : contraButton(other, onAction),
            locateButton(other, onAction)));
    return row;
}

// --------------------------------------------------------------- kin card

// Everything about one animal's relatives in its habitat.
export function animalCardContent(model, animal, { pinned = false, onAction, openPlanner } = {}) {
    const pairs = visiblePairs(model, animal.id);
    const place = placeOf(model, animal);
    const body = h('div.PZ2QoL_kinCardBody');
    body.appendChild(h('div.PZ2QoL_kinCardHead', null,
        h('div.PZ2QoL_kinCardIcon'),
        h('div.PZ2QoL_cardTitles', null,
            h('div.PZ2QoL_cardTitle', { text: `${animal.name} ${sexSymbol(animal.sex)}` }),
            h('div.PZ2QoL_cardSubtitle', { text: [place, ageWord(animal), fertilityText(animal), animal.contra ? 'on contraception' : ''].filter(Boolean).join(' · ') }))));
    if (!pairs.length) {
        body.appendChild(h('div.PZ2QoL_kinOk', null, icon('Icon_Tick', 'brown', 'sm'),
            h('span', { text: animal.hab ? 'No relatives it could breed with in this habitat.' : 'Not in a habitat, so no breeding risk here.' })));
    }
    else {
        // Gameface does not scroll overflow boxes by itself: keep the card
        // short; the planner has the full list
        const shown = pinned ? pairs.slice(0, 2) : pairs.slice(0, 3);
        for (const p of shown) body.appendChild(pairRow(model, p, animal, { actions: pinned, detail: pinned || shown.length == 1, onAction }));
        if (shown.length < pairs.length) {
            body.appendChild(h('div.PZ2QoL_kinMore', { text: `+${pairs.length - shown.length} more related ${pairs.length - shown.length > 1 ? 'animals' : 'animal'} · ${pinned ? 'all of them are in the kin planner' : 'click for actions'}` }));
        }
    }
    const foot = h('div.PZ2QoL_kinCardFoot');
    if (!pinned) foot.appendChild(h('div.PZ2QoL_kinHint', { text: pairs.length ? 'Click the badge for actions' : '' }));
    if (pinned && openPlanner) {
        foot.appendChild(h('div.PZ2QoL_kinAction.primary', { onClick: () => openPlanner(animal) }, icon('IconGenetics', 'white', 'xs'), h('span', { text: 'Open kin planner' })));
    }
    if (pinned && !animal.exhibit) {
        foot.appendChild(h('div.PZ2QoL_kinAction', {
            title: 'Plan moves for this species: every habitat side by side',
            onClick: () => {
                hideKinCard();
                import('/js/mods/pz2qol/kinboard.js').then(m => m.openSpeciesBoard({ species: animal.species, animalId: animal.id }))
                    .catch(e => reportError('ui', 'Species board could not open', e));
            },
        }, icon('IconAnimals', 'brown', 'xs'), h('span', { text: 'Plan moves' })));
    }
    body.appendChild(foot);
    return body;
}

// ------------------------------------------------------- floating card

const ANCHOR_CHECK_MS = 300;

let card = null;
let cardOwner = null;
let pinned = false;
let watch = 0;

function ensureCard() {
    if (card) return card;
    card = h('div.PZ2QoL_kinCard.hidden');
    card.addEventListener('click', e => e.stopPropagation());
    card.addEventListener('mousedown', e => e.stopPropagation());
    document.body.appendChild(card);
    // capture phase: the game's own elements stop mousedown from bubbling
    document.addEventListener('mousedown', e => {
        if (!cardOwner) return;
        for (let n = e.target; n; n = n.parentNode) {
            if (n === card || n === cardOwner) return;
        }
        hideKinCard();
    }, true);
    return card;
}

// With an anchor, only hides the card if it belongs to that anchor.
export function hideKinCard(anchor) {
    if (!card) return;
    if (anchor && cardOwner !== anchor) return;
    setClass(card, 'hidden', true);
    setClass(card, 'pinned', false);
    pinned = false;
    cardOwner = null;
    clearInterval(watch);
    watch = 0;
}

// The card was display: none a moment ago; Gameface may still measure it as
// 0 x 0 (guess), so its CSS width (25rem) is the floor (placement.js).
function place(anchor) {
    if (!card || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const de = document.documentElement || {};
    const vw = window.innerWidth || de.clientWidth || 1920;
    const vh = window.innerHeight || de.clientHeight || 1080;
    const cr = card.getBoundingClientRect();
    const rem = remPx();
    const at = besideAnchor(r, { w: cr.width, h: cr.height }, { vw, vh }, { gap: 8, minW: 25 * rem, minH: 10 * rem });
    card.style.left = `${at.left}px`;
    card.style.top = `${at.top}px`;
}

// again once the new content is laid out (only if the card still belongs to it)
function placeAfterLayout(anchor) {
    for (const ms of [0, 60]) {
        setTimeout(() => {
            if (card && cardOwner === anchor) place(anchor);
        }, ms);
    }
}

// anchor null: is any card pinned?
export function isKinCardPinnedTo(anchor) {
    return pinned && (anchor == null || cardOwner === anchor);
}

export function showKinCard(anchor, build, asPinned, fromHover) {
    if (fromHover && pinned) return;
    ensureCard();
    try {
        clear(card);
        card.appendChild(build(asPinned));
    }
    catch (e) {
        reportError('ui', 'Kin card failed', e, { silent: true });
        return;
    }
    cardOwner = anchor;
    pinned = !!asPinned;
    setClass(card, 'pinned', pinned);
    setClass(card, 'hidden', false);
    place(anchor);
    placeAfterLayout(anchor);
    // the game can close the panel under the anchor without a mouseout
    if (!watch) watch = setInterval(() => {
        if (cardOwner && !visibleBox(cardOwner)) hideKinCard();
    }, ANCHOR_CHECK_MS);
}

// Hover peeks, click pins (with actions). build(pinned) returns the content.
export function attachKinCard(anchor, build) {
    const inside = t => {
        for (let n = t; n; n = n.parentNode) if (n === anchor) return true;
        return false;
    };
    anchor.addEventListener('mouseover', e => {
        if (pinned || inside(e.relatedTarget)) return;
        showKinCard(anchor, build, false);
    });
    anchor.addEventListener('mouseout', e => {
        if (inside(e.relatedTarget)) return;
        if (!pinned && cardOwner === anchor) hideKinCard();
    });
    anchor.addEventListener('mousedown', e => e.stopPropagation());
    anchor.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        if (pinned && cardOwner === anchor) return hideKinCard();
        showKinCard(anchor, build, true);
    });
    return anchor;
}

// --------------------------------------------------------- habitat line

// "⚠ 2 inbreeding risks · 1 close kin" for a habitat (or one species in it).
// counts: the ones the player sees (kinplannercore visibleCounts).
export function riskSummaryText(counts) {
    const parts = [];
    if (counts.risk) parts.push(`${counts.risk} inbreeding risk${counts.risk > 1 ? 's' : ''}`);
    if (counts.kin) parts.push(`${counts.kin} close kin`);
    if (counts.future) parts.push(`${counts.future} later`);
    if (counts.held) parts.push(`${counts.held} bonded elsewhere`);
    if (counts.covered) parts.push(`${counts.covered} covered`);
    return parts.join(' · ');
}

export { offspringScore };

// ---------------------------------------------------------- habitat card

// One habitat: its related pairs per species, worst first.
export function habitatCardContent(model, habId, { pinned = false, openPlanner, species = null } = {}) {
    const s = habitatSummary(model, habId);
    const body = h('div.PZ2QoL_kinCardBody');
    const name = s ? s.name : 'Habitat';
    const counts = visibleCounts(s ? (species ? (s.species.find(x => x.species === species) || {}).counts : s.counts) : null, getKinSettings().showCovered);
    body.appendChild(h('div.PZ2QoL_kinCardHead', null,
        h('div.PZ2QoL_kinCardIcon'),
        h('div.PZ2QoL_cardTitles', null,
            h('div.PZ2QoL_cardTitle', { text: species ? `${name} · ${speciesName(species)}` : name }),
            h('div.PZ2QoL_cardSubtitle', { text: worstOf(counts) ? riskSummaryText(counts) : 'No related breeding pairs' }))));
    const showCovered = getKinSettings().showCovered;
    const pairs = [];
    for (const sp of (s ? s.species : [])) {
        if (species && sp.species !== species) continue;
        for (const p of sp.pairs) if (showCovered || p.severity !== 'covered') pairs.push(p);
    }
    if (!pairs.length) {
        body.appendChild(h('div.PZ2QoL_kinOk', null, icon('Icon_Tick', 'brown', 'sm'), h('span', { text: 'No animals here could breed with a relative.' })));
    }
    const limit = pinned ? 12 : 5;
    for (const p of pairs.slice(0, limit)) {
        const word = relationWord(p.rel, p.b.sex);
        body.appendChild(h(`div.PZ2QoL_kinPair.sev_${p.severity}.compact`, null,
            h('div.PZ2QoL_kinPairHead', null,
                severityTag(p.severity),
                nameTag(p.a), h('span.PZ2QoL_kinDash', { text: '–' }), nameTag(p.b),
                h('div.PZ2QoL_kinFacts', { text: [species ? '' : speciesName(p.species), `${word}`, percent(p.kinship), p.mated ? 'mates now' : ''].filter(Boolean).join(' · ') }))));
    }
    if (pairs.length > limit) body.appendChild(h('div.PZ2QoL_kinMore', { text: `+${pairs.length - limit} more` }));
    const foot = h('div.PZ2QoL_kinCardFoot');
    if (!pinned) foot.appendChild(h('div.PZ2QoL_kinHint', { text: 'Click for the kin planner' }));
    else if (openPlanner) foot.appendChild(h('div.PZ2QoL_kinAction.primary', { onClick: () => openPlanner() }, icon('IconGenetics', 'white', 'xs'), h('span', { text: 'Open in kin planner' })));
    body.appendChild(foot);
    return body;
}
