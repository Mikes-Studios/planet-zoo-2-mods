// Kin alerts: a toast when a pair becomes an inbreeding risk (a youngster
// grows up next to its sibling, an animal moves in with its father,
// contraception is lifted...). The game's own warning only comes once the
// animals have mated; this one comes within a scan (~20 s) of the change.
// On the first scan of a park, one summary toast if there are risks already.
// Growing up (kinlife.js, switch alertLife): a notice when a young animal
// will grow up into a problem (group over the game's limit, pushed out of
// its group, an inbreeding risk), when it grew up, or when an adult was
// pushed out. Levels: Needs you and Heads-up pop up (toastLevel), notes go
// to the log only (getLifeLog); births never pop up.
// Display only; the buttons do what the game's own controls do, one click
// one action.
import { getKinAlertFilter, getKinModel, getKinSettings, locateAnimal, onKin, setContraception } from '/js/mods/pz2qol/kin.js';
import { newRisks, relationWord, SEVERITY_INFO, Sex, habitatsAtRisk, countsExcluding, riskHabitatsExcluding } from '/js/mods/pz2qol/kincore.js';
import { sexSymbol, placeOf } from '/js/mods/pz2qol/kinui.js';
import { openKinPlanner } from '/js/mods/pz2qol/kinplanner.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { h, icon, isGamePopupOpen, setClass } from '/js/mods/pz2qol/ui.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { runPlan } from '/js/mods/pz2qol/kinmoves.js';
import { TRADE, canMove } from '/js/mods/pz2qol/kinboardcore.js';
import { mutedSpecies, setMuted } from '/js/mods/pz2qol/kinmute.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { LEVELS, ageRate, createLifeState, describeEvent, lifeEvents, stableRate, DEFAULT_HORIZON } from '/js/mods/pz2qol/kinlife.js';
import { elderlyWarningText, nearingElderly } from '/js/mods/pz2qol/kinageing.js';
import { missed } from '/js/mods/pz2qol/missednotices.js';

const MAX_TOASTS = 3;

let root = null;
// the toast columns that hide while a game popup is open (installKinAlerts)
const toastRoots = new Set();
let previous = null;
let summaryShown = false;
// pair key -> last time it was a (watched) risk. A pair that drops out of
// one scan (an animal in transport, at the vet, a failed read) and comes
// back is not new; one that was safe for half an hour and is risky again is.
const seen = new Map();
const SEEN_MS = 30 * 60 * 1000;

function watchedNow(model, settings) {
    return model.pairs.filter(p => p.severity === 'risk' || (settings.alertKin && p.severity === 'kin'));
}

function remember(pairs, now) {
    for (const p of pairs) seen.set(p.key, now);
    if (seen.size > 5000) {
        for (const [k, t] of seen) if (now - t > SEEN_MS) seen.delete(k);
    }
}

// A toast column of another module that also stays out of the popups' way.
export function hideUnderGamePopups(node) {
    toastRoots.add(node);
}

function ensureRoot() {
    if (!root) {
        root = h('div.PZ2QoL_kinToasts');
        document.body.appendChild(root);
        hideUnderGamePopups(root);
    }
    return root;
}

// level: 'action' (Needs you: stronger look, 60 s, a Dismiss button) or
// 'heads' (Heads-up, 25 s); kinlife.js LEVELS
// onClose: called once when the toast goes (closed, timed out or pushed
// out by newer ones). The node gets update(title, text) and keep() (start
// its timer again) for the per-habitat risk toasts. One that went by
// itself (timed out, pushed out) waits among the missed notices.
function toast({ severity, level = 'heads', title, text, actions, onClose = null }) {
    dlog('notice', 'show', { level, title, text: String(text || '').slice(0, 300) });
    ensureRoot();
    // told again (Run now): the new one takes the old one's place, here and among the missed
    missed.drop(title);
    for (const old of Array.from(root.childNodes)) {
        if (old._title !== title) continue;
        root.removeChild(old);
        if (old._gone) old._gone('replaced');
    }
    while (root.childNodes.length >= MAX_TOASTS) {
        const old = root.firstChild;
        root.removeChild(old);
        if (old._gone) old._gone('pushed');
    }
    const own = actions || [];
    const ms = (LEVELS[level] && LEVELS[level].toastMs) || LEVELS.heads.toastMs;
    if (level === 'action') actions = (actions || []).concat([{ label: 'Dismiss', run: () => {} }]);
    let timer = null;
    let gone = false;
    const done = why => {
        if (gone) return;
        gone = true;
        if (why === 'timeout' || why === 'pushed') missed.add({ title: node._title, text: textEl.textContent, level, severity, actions: own });
        if (onClose) {
            try {
                onClose();
            }
            catch (e) {
                // the caller's business
            }
        }
    };
    const close = (why = 'player') => {
        clearTimeout(timer);
        setClass(node, 'leaving', true);
        done(why);
        setTimeout(() => node.parentNode && node.parentNode.removeChild(node), 250);
    };
    const buttons = (actions || []).map(a => h(`div.PZ2QoL_kinAction${a.primary ? '.primary' : ''}`, {
        onClick: () => {
            try {
                a.run();
            }
            catch (e) {
                reportError('ui', `"${a.label}" failed`, e);
            }
            if (a.closes !== false) close();
        },
    }, a.icon ? icon(a.icon, a.primary ? 'white' : 'brown', 'xs') : null, h('span', { text: a.label })));
    const titleEl = h('div.PZ2QoL_kinToastTitle', { text: title });
    const textEl = h('div.PZ2QoL_kinToastText', { text });
    const node = h(`div.PZ2QoL_kinToast.sev_${severity}.lvl_${level}`, null,
        h('div.PZ2QoL_kinToastStripe'),
        h('div.PZ2QoL_kinToastBody', null,
            LEVELS[level] && level !== 'info' ? h('div.PZ2QoL_kinToastKicker', { text: LEVELS[level].label }) : null,
            h('div.PZ2QoL_kinToastHead', null, h('div.PZ2QoL_kinCardIcon'), titleEl,
                h('div.PZ2QoL_kinToastClose', { title: 'Dismiss', onClick: () => close() }, icon('Icon_Close', 'brown', 'sm'))),
            textEl,
            buttons.length ? h('div.PZ2QoL_kinActions', null, buttons) : null));
    node._gone = done;
    node._title = title;
    node.update = (t, x) => {
        node._title = t;
        titleEl.textContent = t;
        textEl.textContent = x;
    };
    const timeout = () => close('timeout');
    node.keep = () => {
        clearTimeout(timer);
        timer = setTimeout(timeout, ms);
    };
    node.addEventListener('mouseenter', () => clearTimeout(timer));
    node.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        timer = setTimeout(timeout, ms / 2);
    });
    timer = setTimeout(timeout, ms);
    root.appendChild(node);
    breadcrumb('kin_alert');
    return node;
}

function pairText(model, p) {
    const word = relationWord(p.rel, p.b.sex);
    const place = placeOf(model, p.a) || 'A habitat';
    return `${place}: ${p.b.name} ${sexSymbol(p.b.sex)} is ${p.a.name} ${sexSymbol(p.a.sex)}'s ${word}${p.mated ? ', and they are mates now' : ''}.`;
}

function pairToast(model, p, onClose = null) {
    const female = p.b.sex === Sex.Female ? p.b : p.a.sex === Sex.Female ? p.a : p.b;
    const actions = [
        { label: 'Show', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({ habitatId: p.hab, animalId: p.a.id, pairKey: p.key }) },
    ];
    if (!female.contra) actions.push({ label: `Contraception for ${female.name}`, icon: 'Icon_Contracepted', run: () => setContraception(female.id, true) });
    // no more alerts for this species in this zoo (badges stay; kinmute.js)
    if (p.species) actions.push({ label: `Mute ${speciesName(p.species)}`, run: () => setMuted(p.species, true) });
    const label = p.severity === 'risk' ? 'inbreeding risk' : SEVERITY_INFO[p.severity].label.toLowerCase();
    // a risk (or a bond that ended) needs you; close kin is a heads-up
    const level = p.severity === 'risk' ? 'action' : 'heads';
    if (!toastAllowed(level)) {
        logNotice({ level, kind: 'pair', title: p.bondEnded ? `Bond ended: ${label}` : `New ${label}`, text: pairText(model, p), hab: p.hab, species: p.species });
        return null;
    }
    return toast({
        severity: p.severity,
        level,
        // a pair bond kept them apart until now (newRisks sets bondEnded)
        title: p.bondEnded ? `Bond ended: ${label}` : `New ${label}`,
        text: pairText(model, p) + (p.bondEnded ? ' The pair bond that kept them apart has ended.' : '')
            + (p.tier === 'game' ? '' : ' The game does not warn about this pair.'),
        actions,
        onClose,
    });
}

// One toast per habitat: new related pairs of a habitat that turn up
// together, or while its toast is still open, are counted in that toast
// instead of one toast each (developer, 2026-10-18).
const openByHab = new Map(); // hab -> { node, pairs: Map(key -> pair) }

function habitatKeyOf(p) {
    return String(p.hab || p.a.hab || 'none');
}

function habitatTitle(pairs) {
    const risks = pairs.filter(p => p.severity === 'risk').length;
    const n = pairs.length;
    if (risks === n) return `${n} inbreeding risks`;
    if (!risks) return `${n} related pairs`;
    return `${n} related pairs (${risks} inbreeding risk${risks === 1 ? '' : 's'})`;
}

function habitatText(model, pairs) {
    const place = placeOf(model, pairs[0].a) || 'A habitat';
    const list = pairs.slice(0, 3).map(p => {
        const word = relationWord(p.rel, p.b.sex);
        return `${p.a.name} ${sexSymbol(p.a.sex)} and ${p.b.name} ${sexSymbol(p.b.sex)} (${word})`;
    });
    const more = pairs.length > 3 ? `, and ${pairs.length - 3} more` : '';
    return `${place}: ${list.join('; ')}${more}.`;
}

// The new pairs of one habitat: a toast of its own, or counted in the one
// already open for that habitat.
function habitatPairs(model, hab, fresh) {
    const open = openByHab.get(hab);
    if (open && open.node.parentNode && !open.node.classList.contains('leaving')) {
        for (const p of fresh) open.pairs.set(p.key, p);
        const all = Array.from(open.pairs.values());
        // a single pair's toast becomes the habitat's (its buttons were for one pair)
        if (!open.grouped) {
            open.node.update && open.node.update('', '');
            const old = open.node;
            openByHab.delete(hab);
            old._gone = null;
            setClass(old, 'leaving', true);
            setTimeout(() => old.parentNode && old.parentNode.removeChild(old), 250);
            return groupToast(model, hab, all);
        }
        open.node.update(habitatTitle(all), habitatText(model, all));
        open.node.keep();
        breadcrumb('kin_alert_grouped');
        return;
    }
    if (fresh.length === 1) {
        const p = fresh[0];
        const node = pairToast(model, p, () => {
            if (openByHab.get(hab) && openByHab.get(hab).node === node) openByHab.delete(hab);
        });
        if (node) openByHab.set(hab, { node, pairs: new Map([[p.key, p]]), grouped: false });
        return;
    }
    groupToast(model, hab, fresh);
}

function groupToast(model, hab, pairs) {
    const level = pairs.some(p => p.severity === 'risk') ? 'action' : 'heads';
    if (!toastAllowed(level)) {
        for (const p of pairs) pairToast(model, p);
        return;
    }
    const species = new Set(pairs.map(p => p.species).filter(Boolean));
    const actions = [{ label: 'Show', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({ habitatId: pairs[0].hab, animalId: pairs[0].a.id, pairKey: pairs[0].key }) }];
    if (species.size === 1) {
        const sp = Array.from(species)[0];
        actions.push({ label: `Mute ${speciesName(sp)}`, run: () => setMuted(sp, true) });
    }
    const entry = { node: null, pairs: new Map(pairs.map(p => [p.key, p])), grouped: true };
    const node = toast({
        severity: level === 'action' ? 'risk' : pairs[0].severity,
        level,
        title: habitatTitle(pairs),
        text: habitatText(model, pairs),
        actions,
        onClose: () => {
            if (openByHab.get(hab) === entry) openByHab.delete(hab);
        },
    });
    entry.node = node;
    openByHab.set(hab, entry);
    breadcrumb('kin_alert_grouped');
}

function summaryToast(model, muted) {
    const habitats = muted && muted.size ? riskHabitatsExcluding(model, muted) : habitatsAtRisk(model).filter(h => h.counts.risk > 0);
    const n = muted && muted.size ? countsExcluding(model, muted).risk : model.counts.risk;
    toast({
        severity: 'risk',
        level: 'action',
        title: 'Kin check',
        text: `${n} related pair${n > 1 ? 's' : ''} could inbreed in ${habitats.length} habitat${habitats.length > 1 ? 's' : ''}${habitats.length ? ` (${habitats.slice(0, 3).map(h => h.name).join(', ')}${habitats.length > 3 ? ', …' : ''})` : ''}.`,
        actions: [{ label: 'Open kin planner', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({}) }],
    });
}

// Animals a year from turning elderly (kinageing.js): once per animal per
// game session, but for the species whose ones Auto mode sends to be sold
// itself (setElderlyHandled).
const elderlyWarned = new Set();
let elderlyHandled = () => false;
export function setElderlyHandled(fn) {
    elderlyHandled = fn;
}

function elderlyStep(model) {
    for (const w of nearingElderly(model, elderlyWarned)) {
        if (elderlyHandled(w.animal.species)) continue;
        elderlyWarned.add(w.animal.guid || w.animal.id);
        const atTrade = w.animal.lt === 'trade';
        // to the trade centre while the game still lets it go; selling,
        // listing or releasing it there stays the player's choice
        const actions = atTrade ? [] : [{ label: 'Send to the trade centre', icon: 'IconTrade', primary: true, run: () => sendElderlyToTrade(w.animal) }];
        actions.push({ label: 'Locate', icon: 'IconLocation', primary: atTrade, run: () => locateAnimal(w.animal.id) });
        toast({
            severity: 'future', level: 'action',
            title: `${speciesName(w.animal.species)}: ${w.animal.name} is nearly elderly`,
            text: `${elderlyWarningText(w)}${atTrade ? ' It is at the trade centre now.' : ''}`,
            actions,
        });
    }
}

// The click can come a minute after the toast, when the animal is somewhere
// else: whatever stops the move is said, never dropped.
function sendElderlyToTrade(animal) {
    const now = getKinModel();
    const a = now && now.animals.get(String(animal.id));
    const failed = text => toast({ severity: 'future', level: 'heads', title: `${animal.name} was not sent to the trade centre`, text });
    if (!a) return failed(`${animal.name} is no longer in this zoo.`);
    if (a.lt === 'trade') return failed(`${a.name} is already at the trade centre: sell, trade or release it from there.`);
    if (!canMove(a)) return failed(`${a.name} cannot be moved right now: ${a.moving ? 'it is already on the move' : 'it is not in a habitat'}. Find it with Locate and try again from the species board.`);
    runPlan([{ id: a.id, to: TRADE, byPlayer: true }]).then(r => {
        if (r && r.ok === false) failed(r.detail);
    }, e => reportError('mod', `Sending ${a.name} to the trade centre failed`, e, { silent: true }));
}

// Auto mode's run in flight (kin.js setKinAlertFilter; none while no
// species is on Auto): a pair it makes for a moment, a swap half done, is
// not news. Such a pair is held back (pair key -> pair) and told once the
// quiet is over if it is still there.
const heldBack = new Map();

function quietNow(p) {
    const filter = getKinAlertFilter();
    if (!filter) return false;
    try {
        return !!filter(p);
    }
    catch (e) {
        return false;
    }
}

// fresh: the scan's new pairs; watched: every watched pair now.
// -> the pairs to tell now
function afterQuiet(fresh, watched, muted) {
    const out = [];
    for (const p of fresh) {
        if (quietNow(p)) heldBack.set(p.key, p);
        else out.push(p);
    }
    const now = new Map(watched.map(p => [p.key, p]));
    for (const key of Array.from(heldBack.keys())) {
        const p = now.get(key);
        if (!p || muted.has(p.species)) heldBack.delete(key);
        else if (!quietNow(p)) {
            heldBack.delete(key);
            if (!out.some(x => x.key === key)) out.push(p);
        }
    }
    return out;
}

function onModel(model) {
    const settings = getKinSettings();
    try {
        if (!model || model.scope !== 'park') {
            if (!model) {
                previous = null;
                heldBack.clear();
            }
            return;
        }
        const now = Date.now();
        // muted species' pairs are still remembered (unmuting never floods)
        const muted = mutedSpecies();
        // growing up (kinlife.js): its own switch, independent of the risk alerts
        lifeStep(model, settings, now, muted);
        if (settings.elderlyAlert !== false) elderlyStep(model);
        const watched = watchedNow(model, settings);
        if (!settings.alerts) {
            remember(watched, now);
            return;
        }
        if (!previous) {
            remember(watched, now);
            if (!summaryShown && countsExcluding(model, muted).risk > 0) {
                summaryShown = true;
                summaryToast(model, muted);
            }
            return;
        }
        const fresh = afterQuiet(newRisks(previous, model, { includeKin: settings.alertKin, muted }).filter(p => {
            const t = seen.get(p.key);
            return t == null || now - t > SEEN_MS;
        }), watched, muted);
        remember(watched, now);
        const byHab = new Map();
        for (const p of fresh) {
            const k = habitatKeyOf(p);
            if (!byHab.has(k)) byHab.set(k, []);
            byHab.get(k).push(p);
        }
        if (byHab.size > MAX_TOASTS) {
            toast({
                severity: 'risk',
                level: 'action',
                title: `${fresh.length} new related pairs`,
                text: 'Several animals can now breed with a relative.',
                actions: [{ label: 'Open kin planner', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({}) }],
            });
        }
        else {
            for (const [hab, list] of byHab) habitatPairs(model, hab, list);
        }
    }
    catch (e) {
        reportError('mod', 'Kin alert failed', e, { silent: true });
    }
    finally {
        if (model && model.scope === 'park') {
            previous = model;
            previousTime = Date.now();
        }
    }
}

// --------------------------------------------------------- growing up

const LOG_MAX = 100;
const lifeLog = [];          // newest first: { time, level, kind, title, text, hab, species }
let lifeState = createLifeState();
let previousTime = 0;
const rates = [];            // game years per real minute, last few scans

// Pop up at this level? Needs you always; heads-ups unless the player chose
// "Needs you" only; notes never.
function toastAllowed(level) {
    if (level === 'action') return true;
    if (level === 'heads') return getKinSettings().toastLevel !== 'action';
    return false;
}

function logNotice(entry) {
    lifeLog.unshift(Object.assign({ time: Date.now() }, entry));
    if (lifeLog.length > LOG_MAX) lifeLog.length = LOG_MAX;
}

// The notices so far (newest first), popped up or not.
export function getLifeLog() {
    return lifeLog.slice();
}

function lifeToast(model, ev, d) {
    const first = ev.animals[0];
    const actions = [{ label: 'Show', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({ habitatId: ev.hab, animalId: first.id }) }];
    // only where contraception helps (an inbreeding risk, a full group), one animal per click
    for (const a of ev.contra.slice(0, 1)) {
        actions.push({ label: `Contraception for ${a.name}`, icon: 'Icon_Contracepted', run: () => setContraception(a.id, true) });
    }
    toast({ severity: ev.level === 'action' ? 'risk' : 'future', level: ev.level, title: d.title, text: d.text, actions });
}

function lifeStep(model, settings, now, muted) {
    try {
        if (previous && previousTime) {
            const r = ageRate(previous, model, now - previousTime);
            if (r != null) {
                rates.push(r);
                if (rates.length > 6) rates.shift();
            }
        }
        // computed even with the switch off, so turning it on never floods
        const events = lifeEvents(previous, model, { horizon: DEFAULT_HORIZON, state: lifeState, now })
            .filter(ev => !(muted && muted.has(ev.species)));
        if (!events.length || settings.alertLife === false) return;
        const rate = stableRate(rates);
        const described = events.map(ev => {
            const a = ev.animals[0];
            const d = describeEvent(ev, { place: placeOf(model, a) || '', species: speciesName(ev.species), rate });
            logNotice({ level: ev.level, kind: ev.kind, title: d.title, text: d.text, hab: ev.hab, species: ev.species });
            return { ev, d };
        });
        // first scan of a park: one summary, and only if something needs you
        if (!previous) {
            const need = described.filter(x => x.ev.level === 'action');
            if (need.length) {
                const n = need.reduce((s, x) => s + x.ev.animals.length, 0);
                toast({
                    severity: 'risk',
                    level: 'action',
                    title: 'Growing up soon',
                    text: `${n} young animal${n > 1 ? 's' : ''} will need you when ${n > 1 ? 'they grow' : 'it grows'} up: ${need.slice(0, 3).map(x => x.d.title).join('; ')}${need.length > 3 ? '; …' : ''}.`,
                    actions: [{ label: 'Open kin planner', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({}) }],
                });
            }
            return;
        }
        // births never pop up; the rest by level
        const pop = described.filter(x => x.ev.kind !== 'birth' && toastAllowed(x.ev.level));
        if (pop.length > MAX_TOASTS) {
            const worst = pop.some(x => x.ev.level === 'action') ? 'action' : 'heads';
            toast({
                severity: worst === 'action' ? 'risk' : 'future',
                level: worst,
                title: `${pop.length} growing-up notices`,
                text: pop.slice(0, 3).map(x => x.d.title).join('; ') + '; …',
                actions: [{ label: 'Open kin planner', icon: 'IconGenetics', primary: true, run: () => openKinPlanner({}) }],
            });
        }
        else {
            for (const x of pop) lifeToast(model, x.ev, x.d);
        }
    }
    catch (e) {
        reportError('mod', 'Kin growing-up notice failed', e, { silent: true });
    }
}

// For the browser harness: forget what was said (as on a fresh page).
export function _resetLife() {
    lifeState = createLifeState();
    lifeLog.length = 0;
    rates.length = 0;
}

// Other alert modules (kinboxed.js) post in the same toast column and log:
// { severity, level: 'action' | 'heads', title, text, actions, answer }. A
// level the player does not pop up (toastLevel) goes to the log only
// (-> null); answer (the reply to the player's own click) always pops up.
export function kinToast(opts) {
    const level = opts.level || 'heads';
    logNotice({ level, kind: opts.kind || 'other', title: opts.title, text: opts.text, hab: opts.hab, species: opts.species });
    return opts.answer || toastAllowed(level) ? toast(opts) : null;
}

// For the browser harness.
export function kinAlertCount() {
    return root ? root.childNodes.length : 0;
}

export function installKinAlerts() {
    if (!isHudPage()) return true;
    // stay out of the way of the game's popups (Compare Mates, Genealogy)
    setInterval(() => {
        const open = isGamePopupOpen();
        for (const node of toastRoots) {
            if (node.parentNode) setClass(node, 'underPopup', open);
            else toastRoots.delete(node);
        }
    }, 500);
    onKin((model, scope) => {
        if (scope && scope !== 'park') return;
        onModel(model);
    });
    return true;
}
