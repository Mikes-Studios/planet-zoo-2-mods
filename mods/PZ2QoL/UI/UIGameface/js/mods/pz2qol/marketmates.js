// The Market's picks need your breeders, which only the park page knows:
// after each park scan this page hands Lua every species' breeders (in a
// habitat, at the trade centre or stored) and breeding standard
// (kinautocore marketMatesOfSpecies), for the hub's marketcalves.js to read
// (PZ2QoL_MarketMatesSet). Park (HUD) page only.
import { isCollective } from '/js/mods/pz2qol/kincore.js';
import { getKinModel, onKin } from '/js/mods/pz2qol/kin.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { marketMatesOfSpecies, withoutParkAnimals } from '/js/mods/pz2qol/kinautocore.js';
import { requestStoredAdults } from '/js/mods/pz2qol/kinmoves.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

const EVERY_MS = 10000;

function speciesOf(model) {
    const out = new Set();
    for (const a of model.animals.values()) if (a.species && !a.exhibit && a.alive !== false) out.add(a.species);
    return Array.from(out).filter(sp => !isCollective(model, sp));
}

// Stored adults read in the park (Franchise only; the cache keeps it to one read a minute per species).
async function storedOf(model, species) {
    const s = withoutParkAnimals(model, species, await requestStoredAdults(species));
    return s && !s.error ? s : null;
}

export function installMarketMates() {
    if (!isHudPage()) return true;
    let last = '';
    let busy = false;
    let at = 0;
    const send = async model => {
        if (busy || !model || Date.now() - at < EVERY_MS) return;
        busy = true;
        at = Date.now();
        try {
            const out = {};
            for (const sp of speciesOf(model)) {
                const m = marketMatesOfSpecies(model, sp, await storedOf(model, sp));
                if (m) out[sp] = m;
            }
            const json = JSON.stringify(out);
            if (json === last) return;
            last = json;
            dlog('market', 'mates_set', { species: Object.keys(out).length, chars: json.length });
            engine.trigger('PZ2QoL_MarketMatesSet', json);
        }
        catch (e) {
            reportError('mod', 'Market picks: your breeders could not be handed to the Market', e, { silent: true });
        }
        finally {
            busy = false;
        }
    };
    onKin((model, scope) => {
        if (!scope || scope === 'park') send(model);
    });
    send(getKinModel());
    return true;
}
