// Calves a Market listing would give (hub page). A needs notice's Market
// button hands over the species, the habitat's breeders of the other sex and
// a calf floor (kinautocore marketMatesFor, through tradejump); each
// listing's alleles come from Lua (PZ2QoL_MarketGenes, the source of the
// hub's own Compare Mates). The badge shows the calf score and dims a listing
// under the floor. The hand-over lasts until the Market closes, the list
// shows another species or the player picks a Dim step. Without one, a
// listing is judged against your breeders of the species as the park page
// handed them to Lua (marketmates.js, PZ2QoL_MarketMatesGet): every
// breeder of the other sex, and Auto mode's breeding standard as the floor.
// A strict hand-over (a notice's Market) hides the listings under its floor
// instead, until the player asks to see them.
// Frontend page only.
import { calfScores } from '/js/mods/pz2qol/kincore.js';
import { locationName, MARKET_LIST_KEY, readAnimal } from '/js/mods/pz2qol/game.js';
import { refreshList, registerListFilter } from '/js/mods/pz2qol/listfilter.js';
import { cleanName, rowMatches } from '/js/mods/pz2qol/storagefetchcore.js';
import { isFrontendPage } from '/js/mods/pz2qol/kinhooks.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { normSpecies } from '/js/mods/pz2qol/scores.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

const ASK_MS = 500;
const ASK_MAX = 60;           // ids per request (Kin.nMarketGenesMax)
// a listing Lua could not read, or whose answer never came, is asked again after this
const RETRY_MS = 5000;
// rows of the last query can stay on screen until the list's next answer
const OTHER_SPECIES_MS = 2000;
// how often the park's hand-over of your breeders is read again
const RELAY_MS = 3000;

function sexOf(a) {
    return Number(a.gender) === 0 ? 'm' : Number(a.gender) === 1 ? 'f' : '';
}

// A listing as itself. A Market row's id and its list key are both places
// that move with the sort and the page, so a listing is known by what it is;
// the game is still asked by the key it sits at now.
export function listingId(a) {
    const g = a.genes || {};
    return [normSpecies(a.species), sexOf(a), a.name, a.price, g.fertility, g.immunity, g.size, g.longevity].join('|');
}

// One page's hand-over and the listing genes read for it. now: the clock.
export function createMarketCalves({ now = () => Date.now() } = {}) {
    let target = null;            // { species, sex: 'm' | 'f', mates: [genes], floor, strict }
    const genesById = new Map();  // listingId -> genes Lua read
    const askedAt = new Map();    // listingId -> when it was asked, or came back unread
    const loggedIds = new Set();  // listings whose calves are in the trace
    const keyNow = new Map();     // list key -> the listing last seen at it
    const queue = new Map();      // list key -> listing to ask for
    const pending = new Map();    // list key -> the listing it was asked for
    const listeners = new Set();
    let seq = 0;
    let otherSpeciesSince = 0;
    let relay = {};               // species -> { m: { mates, floor }, f: { mates, floor } } (listing sex)
    let relayJson = '';
    let shown = { standard: null, others: true }; // how the rows on screen fade (shownFading); none yet: by the Dim below step
    let showWeak = false;         // the player asked to see what a strict hand-over hides
    let hidden = 0;               // listings the strict hand-over hides on this page

    function setMarketMates(next) {
        const had = target;
        otherSpeciesSince = 0;
        target = next && next.mates && next.mates.length ? Object.assign({}, next, { species: normSpecies(next.species), strict: !!next.strict }) : null;
        showWeak = false;
        hidden = 0;
        dlog('market', 'calves', target ? { species: target.species, sex: target.sex, mates: target.mates.length, floor: target.floor, strict: target.strict } : { off: true });
        if (!had && !target) return;
        callAll(listeners);
        refreshList(MARKET_LIST_KEY);
    }

    function strictOn() {
        return !!(target && target.strict && target.floor != null);
    }

    // a strict hand-over's listing under its floor: by a male's average over
    // the females (in a harem he fathers every litter), a
    // female's best male; not while its genes are still read
    function hides(a) {
        if (!strictOn() || matesFor(a) !== target) return false;
        const c = calvesOf(a);
        return c != null && c.score < target.floor;
    }

    // the Market rows (contexts) a strict hand-over leaves on screen
    function strictRows(source) {
        const kept = source.filter(ctx => !hides(readAnimal(ctx)));
        if (source.length - kept.length !== hidden) {
            hidden = source.length - kept.length;
            // told after the list's render, which this runs inside
            Promise.resolve().then(() => callAll(listeners));
        }
        return kept;
    }

    // { on, floor, hidden, showWeak }: what a strict hand-over hides now
    function strictState() {
        return { on: strictOn(), floor: target ? target.floor : null, hidden, showWeak };
    }

    function setShowWeak(on) {
        showWeak = !!on;
        callAll(listeners);
        refreshList(MARKET_LIST_KEY);
    }

    function clearMarketMates() {
        if (target) setMarketMates(null);
    }

    // a row faded by your breeding standard: its calves can be judged
    // against breeders of yours and a standard is known (a pair of yours)
    function judgedByStandard(a) {
        return floorFor(a) != null;
    }

    // How the rows on screen fade: { standard: the floor (one species), 'mixed'
    // (several) or null, others: some rows can't be judged by calves and fade
    // by the player's Dim below step }
    function shownFading() {
        return shown;
    }

    function noteShown(animals) {
        const floors = new Set(animals.filter(judgedByStandard).map(floorFor));
        const next = { standard: floors.size === 1 ? [...floors][0] : floors.size ? 'mixed' : null, others: animals.some(a => !judgedByStandard(a)) };
        if (next.standard === shown.standard && next.others === shown.others) return;
        shown = next;
        callAll(listeners);
    }

    // the Market rows on screen (readAnimal): none of the handed-over species
    // for a while means the player moved the game's species filter on
    function noteMarketRows(animals) {
        if (animals.length) noteShown(animals);
        if (!target || !target.species || !animals.length) return;
        if (animals.some(a => normSpecies(a.species) === target.species)) {
            otherSpeciesSince = 0;
            return;
        }
        if (!otherSpeciesSince) otherSpeciesSince = now();
        else if (now() - otherSpeciesSince >= OTHER_SPECIES_MS) clearMarketMates();
    }

    // the mates and floor a Market row (readAnimal) is judged by: the
    // notice's hand-over for its species and sex, else your breeders of the
    // other sex from the park; null when neither knows any
    function matesFor(a) {
        if (!a || a.key == null) return null;
        const sp = normSpecies(a.species);
        if (target && (!target.species || sp === target.species) && (!target.sex || sexOf(a) === target.sex)) return target;
        const r = relay[sp] && relay[sp][sexOf(a)];
        return r && r.mates && r.mates.length ? r : null;
    }

    // a row's floor: under it the calves would not meet your standard
    function floorFor(a) {
        const m = matesFor(a);
        return m ? m.floor : null;
    }

    function knowsMates(a) {
        return !!matesFor(a);
    }

    // a Market row (readAnimal) -> { score, best } of its calves with the
    // mates; null without mates for it, or while its genes are not in (yet).
    // score: a male's average over the females (in a harem he fathers every
    // litter, so he has to suit them all), a female's best
    // male (she joins the pride whose male suits her); best: its best young,
    // the one Auto mode's standard is judged on. The game is asked by the
    // list key, as its own Compare Mates does (the row's id is its place on
    // the page: the game answers it with blank genes)
    function calvesOf(a) {
        const m = matesFor(a);
        if (!m) return null;
        const id = listingId(a);
        keyNow.set(String(a.key), id);
        const genes = genesById.get(id);
        if (!genes) {
            const at = askedAt.get(id);
            if (at == null || now() - at >= RETRY_MS) queue.set(String(a.key), id);
            return null;
        }
        const c = calfScores(genes, m.mates, sexOf(a) === 'm');
        // each listing's genes and calves once, so a wrong score can be checked from the trace
        if (c && !loggedIds.has(id)) {
            loggedIds.add(id);
            dlog('market', 'calf', { name: a.name, sex: sexOf(a), F: genes.F, I: genes.I, S: genes.S, L: genes.L, mates: c.mates, score: c.score, best: c.best });
        }
        return c;
    }

    // one of your animals on the Storage window (readAnimal) -> its calves as
    // the park judged them (kinautocore marketMatesOfSpecies unplaced, a
    // listing's rule), matched by sex, name and gene percents as sell advice
    // is: { score, best } or null
    function yoursCalvesFor(a) {
        const r = a && relay[normSpecies(a.species)];
        if (!r || !Array.isArray(r.unplaced)) return null;
        const row = { sex: a.gender, name: locationName(a.name) || '', genes: a.genes };
        const hit = r.unplaced.find(e => rowMatches(row, { sex: e.x, name: cleanName(e.n), genes: e.p }));
        return hit ? { score: hit.c, best: hit.b } : null;
    }

    function calvesFor(a) {
        const c = calvesOf(a);
        return c ? c.score : null;
    }

    function bestCalvesFor(a) {
        const c = calvesOf(a);
        return c ? c.best : null;
    }

    function ask() {
        if (!queue.size) return;
        const asked = Array.from(queue).slice(0, ASK_MAX);
        const at = now();
        for (const [key, id] of asked) {
            queue.delete(key);
            askedAt.set(id, at);
            pending.set(key, id);
        }
        try {
            engine.trigger('PZ2QoL_MarketGenes', 'G' + (++seq), asked.map(([key]) => key).join(','));
        }
        catch (e) {
            reportError('ui', 'Market juveniles: the game could not be asked for listing genes. Reopen the hub; if it stays, the mod\'s Lua part did not load.', e, { silent: true });
        }
    }

    function onAnswer(reqId, json) {
        let got = {};
        try {
            got = JSON.parse(json || '{}') || {};
        }
        catch (e) {
            got = {};
        }
        let read = 0, moved = 0;
        const at = now();
        for (const [key, genes] of Object.entries(got)) {
            const id = pending.get(key);
            pending.delete(key);
            if (!id) continue;
            // the list was sorted or paged meanwhile: another listing sits at the key, so it is asked again
            if (keyNow.get(key) !== id) {
                askedAt.delete(id);
                moved++;
                continue;
            }
            if (genes) {
                genesById.set(id, genes);
                askedAt.delete(id);
                read++;
            }
            else askedAt.set(id, at);
        }
        dlog('market', 'genes', { asked: Object.keys(got).length, read, moved });
        if (read && strictOn()) refreshList(MARKET_LIST_KEY);
    }

    function onRelay(reqId, json) {
        if (typeof json !== 'string' || json === relayJson) return;
        let got = {};
        try {
            got = JSON.parse(json) || {};
        }
        catch (e) {
            return;
        }
        relayJson = json;
        relay = {};
        for (const [sp, v] of Object.entries(got)) relay[normSpecies(sp)] = v;
        dlog('market', 'mates_read', { species: Object.keys(relay).length });
        callAll(listeners);
    }

    function askRelay() {
        try {
            engine.trigger('PZ2QoL_MarketMatesGet', 'M' + (++seq));
        }
        catch (e) {
            reportError('ui', "Market picks: the game could not be asked for your breeders. Reopen the hub; if it stays, the mod's Lua part did not load.", e, { silent: true });
        }
    }

    function onMarketMatesChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function installMarketCalves() {
        if (!isFrontendPage()) return true;
        engine.on('PZ2QoL_MarketGenesResult', onAnswer);
        engine.on('PZ2QoL_MarketMatesResult', onRelay);
        registerListFilter(MARKET_LIST_KEY, { active: () => strictOn() && !showWeak, filter: strictRows });
        setInterval(ask, ASK_MS);
        askRelay();
        setInterval(askRelay, RELAY_MS);
        return true;
    }

    return { setMarketMates, clearMarketMates, noteMarketRows, calvesFor, bestCalvesFor, floorFor, knowsMates, judgedByStandard, shownFading, yoursCalvesFor, onMarketMatesChange, installMarketCalves, ask, onAnswer, onRelay, strictRows, strictState, setShowWeak, strictWeak: hides };
}

export const { setMarketMates, clearMarketMates, noteMarketRows, calvesFor, bestCalvesFor, floorFor, knowsMates, judgedByStandard, shownFading, yoursCalvesFor, onMarketMatesChange, installMarketCalves, strictState, setShowWeak, strictWeak } = createMarketCalves();
