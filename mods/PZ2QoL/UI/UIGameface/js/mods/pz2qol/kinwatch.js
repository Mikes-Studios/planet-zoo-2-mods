// Kin watch: juveniles that live with a relative of the other sex
// (kinautocore calvesToWatch) are asked about once a second whether the
// game still blocks them as juveniles (PZ2QoL_KinGrown, the block on
// Release and Quick trade). The moment one lifts, the park is scanned at
// once, so Auto mode's kin trigger and the Kin alerts see the new adult
// within seconds instead of at the next 20 s scan. Nothing here moves an
// animal. HUD page only.
import { calvesToWatch } from '/js/mods/pz2qol/kinautocore.js';
import { getKinModel, onKin, requestKinScan } from '/js/mods/pz2qol/kin.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';

const WATCH_MS = 1000;
const ANSWER_TIMEOUT_MS = 3000;
// a scan asked for and not arrived: ask the game again after this
const RESCAN_WAIT_MS = 10000;

// watch: { ids (the calves watched), asking ({ id, timer } while an answer
// is due), rescanUntil, seq }, one per page (installKinWatch)
function onAnswer(watch, reqId, json) {
    if (!watch.asking || watch.asking.id !== String(reqId)) return;
    clearTimeout(watch.asking.timer);
    watch.asking = null;
    let grown = [];
    try {
        const v = JSON.parse(json) || {};
        grown = watch.ids.filter(id => v[id] === false);
    }
    catch (e) {
        return;
    }
    if (!grown.length) return;
    breadcrumb('kin_grown');
    dlog('watch', 'grown', { ids: grown.join(' ') });
    watch.rescanUntil = Date.now() + RESCAN_WAIT_MS;
    requestKinScan('grown', { force: true });
}

function ask(watch) {
    if (watch.asking || !watch.ids.length || Date.now() < watch.rescanUntil) return;
    const id = 'W' + (++watch.seq);
    watch.asking = {
        id,
        timer: setTimeout(() => {
            if (watch.asking && watch.asking.id === id) watch.asking = null;
        }, ANSWER_TIMEOUT_MS),
    };
    try {
        engine.trigger('PZ2QoL_KinGrown', id, watch.ids.join(','));
    }
    catch (e) {
        clearTimeout(watch.asking.timer);
        watch.asking = null;
        reportError('ui', 'Kin watch: the game could not be asked about growing animals. Reopen the park; if it stays, the mod\'s Lua part did not load.', e, { silent: true });
    }
}

export function installKinWatch() {
    if (!isHudPage()) return true;
    const watch = { ids: [], asking: null, rescanUntil: 0, seq: 0 };
    engine.on('PZ2QoL_KinGrownResult', (reqId, json) => onAnswer(watch, reqId, json));
    onKin(() => {
        const now = calvesToWatch(getKinModel());
        if (now.join(' ') !== watch.ids.join(' ')) dlog('watch', 'list', { count: now.length, ids: now.join(' ') });
        watch.ids = now;
        watch.rescanUntil = 0;
    });
    setInterval(() => ask(watch), WATCH_MS);
    return true;
}
