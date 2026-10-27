// Sell advice in the Storage window (hub page): the animals the park's
// breeding programme advises letting go (kinauto noteSellAdvice: well
// below the best of their sex, better ones breeding in their place; stored
// adults by the same rule, kinautocore storedSellAdvice). Lua
// holds the list between the park and hub pages (PZ2QoL_SellAdviceGet).
// Franchise Storage rows carry no animal GUID, so a row is matched by
// species, sex, name and all four gene grades (storagefetchcore
// rowMatches): animals with the same name stay apart. The Storage bar's
// "Sell advice" chip filters on it; what to do with them (sell, list,
// release) stays the player's choice. A good breeder the programme keeps
// for later (advicecore) is not in the filter: adviceFor tags its row.
// Frontend page only.
import { addStorageFilter, getStorageFilters, refreshList, setStorageFilters } from '/js/mods/pz2qol/listfilter.js';
import { isFrontendPage } from '/js/mods/pz2qol/kinhooks.js';
import { cleanName, rowMatches } from '/js/mods/pz2qol/storagefetchcore.js';
import { normSpecies } from '/js/mods/pz2qol/scores.js';
import { locationName, STORAGE_LIST_KEY } from '/js/mods/pz2qol/game.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { adviceKeeps } from '/js/mods/pz2qol/advicecore.js';

const ASK_MS = 10000;

// Lua's answer -> [{ species, sex, name, genes, reason, young, keep }]
function parseAdvice(json) {
    try {
        return (JSON.parse(json || '[]') || []).filter(e => Array.isArray(e.p) && e.p.length === 4)
            .map(e => ({ species: normSpecies(e.s), sex: Number(e.x) || 0, name: cleanName(e.n), genes: e.p, reason: String(e.r || 'weak'), young: Number(e.y) || 0, keep: adviceKeeps(e.r) }));
    }
    catch (e) {
        return [];
    }
}

const S = { wanted: [] };

// The advice on a Storage row (readAnimal): { keep, reason, young } or null.
export function adviceFor(a) {
    const row = { sex: a.gender, name: locationName(a.name) || '', genes: a.genes };
    const sp = normSpecies(a.species);
    return S.wanted.find(w => w.species === sp && rowMatches(row, w)) || null;
}

export function installSellAdvice() {
    if (!isFrontendPage()) return true;
    let wantedText = '[]';
    let removePredicate = null;
    let seq = 0;

    // a Storage row the advice says to sell
    const advised = a => {
        const w = adviceFor(a);
        return !!w && !w.keep;
    };

    function take(next) {
        const text = JSON.stringify(next);
        if (text === wantedText) return;
        S.wanted = next;
        wantedText = text;
        const selling = next.some(w => !w.keep);
        if (selling && !removePredicate) removePredicate = addStorageFilter('sellAdvice', advised);
        else if (!selling && removePredicate) {
            removePredicate();
            removePredicate = null;
        }
        if (!getStorageFilters().sellAdvice) return;
        // nothing left to advise: the chip goes off rather than lit over the whole list
        if (!selling) setStorageFilters({ sellAdvice: false });
        else refreshList(STORAGE_LIST_KEY);
    }

    function onAnswer(reqId, json) {
        breadcrumb('sell_advice');
        take(parseAdvice(json));
    }

    function ask() {
        try {
            engine.trigger('PZ2QoL_SellAdviceGet', 'A' + (++seq));
        }
        catch (e) {
            reportError('ui', 'Sell advice: the game could not be asked. Reopen the hub; if it stays, the mod\'s Lua part did not load.', e, { silent: true });
        }
    }

    engine.on('PZ2QoL_SellAdviceResult', onAnswer);
    ask();
    setInterval(ask, ASK_MS);
    return true;
}
