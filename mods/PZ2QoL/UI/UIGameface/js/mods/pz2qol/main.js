// PZ2QoL UI entry. Loaded by PZ2QoLFrontend.html after the game's own
// Frontend.js, so it shares the game's module instances.
import { loadCSS } from '/js/common/util/CSSUtil.js';
import { breadcrumb, installErrorCapture, reportError, setErrorBanner } from '/js/mods/pz2qol/errors.js';
import { installDebugLog } from '/js/mods/pz2qol/debuglog.js';
import { installListFilter, installSelectAllGuard } from '/js/mods/pz2qol/listfilter.js';
import { installBadges } from '/js/mods/pz2qol/badges.js';
import { installBars } from '/js/mods/pz2qol/bars.js';
import { installPriceBook } from '/js/mods/pz2qol/pricebook.js';
import { installLister } from '/js/mods/pz2qol/lister.js';
import { installMarketScan } from '/js/mods/pz2qol/marketscan.js';
import { installZoo } from '/js/mods/pz2qol/zoo.js';
import { getKinSettings, installKin, onKinSettings } from '/js/mods/pz2qol/kin.js';
import { installKinZoo } from '/js/mods/pz2qol/kinzoo.js';
import { installKinPanels } from '/js/mods/pz2qol/kinhabitat.js';
import { installKinMates } from '/js/mods/pz2qol/kinmates.js';
import { installKinStorage } from '/js/mods/pz2qol/kinstorage.js';
import { installKinPlanner } from '/js/mods/pz2qol/kinplanner.js';
import { installKinAlerts } from '/js/mods/pz2qol/kinalerts.js';
import { installMissedNotices } from '/js/mods/pz2qol/missednotices.js';
import { installKinWatch } from '/js/mods/pz2qol/kinwatch.js';
import { installKinCensus } from '/js/mods/pz2qol/kincensus.js';
import { installSellAdvice } from '/js/mods/pz2qol/selladvice.js';
import { installStoredAges } from '/js/mods/pz2qol/storedages.js';
import { installKinNames } from '/js/mods/pz2qol/kinnames.js';
import { installStoredHome } from '/js/mods/pz2qol/kinstoredhome.js';
import { installEducation } from '/js/mods/pz2qol/education.js';
import { installKinBirth } from '/js/mods/pz2qol/kinbirth.js';
import { installMarketCalves } from '/js/mods/pz2qol/marketcalves.js';
import { installMarketMates } from '/js/mods/pz2qol/marketmates.js';
import { installBoxedAlerts } from '/js/mods/pz2qol/kinboxed.js';
import { installBoxRelease } from '/js/mods/pz2qol/boxrelease.js';
import { installQuarantineAlerts } from '/js/mods/pz2qol/kinquarantine.js';
import { installHudLauncher } from '/js/mods/pz2qol/hudlauncher.js';
import { installStorageSend } from '/js/mods/pz2qol/storagesend.js';
import { installTradeJump } from '/js/mods/pz2qol/tradejump.js';
import { installStorageFetch } from '/js/mods/pz2qol/storagefetch.js';
import { installProfiler } from '/js/mods/pz2qol/profiler.js';

export const VERSION = '3.2.1';

// Debug builds: tell Lua how far the page got (written to dbg/trace.log).
const trace = breadcrumb;
trace('main_start');

function step(name, fn) {
    trace('step_' + name.replace(/[^A-Za-z]/g, ''));
    try {
        const ok = fn();
        if (ok === false) {
            reportError('mod', `${name} not installed`, 'The game UI did not look as expected; this feature is off.', { silent: true });
        }
    }
    catch (e) {
        reportError('mod', `${name} failed to start`, e);
    }
}

step('Error capture', installErrorCapture);
// debug builds: the detailed log (dbg/trace.log); a no-op otherwise
step('Debug log', installDebugLog);
// script profiler: its JS hooks go in before the features register their
// event handlers (they only time while the player has it running)
step('Script profiler', installProfiler);
step('Styles', () => {
    loadCSS('mods/pz2qol');
    loadCSS('mods/pz2qol_kin');
    loadCSS('mods/pz2qol_kinplanner');
    loadCSS('mods/pz2qol_kinmates');
    loadCSS('mods/pz2qol_hud');
    loadCSS('mods/pz2qol_autopilot');
    loadCSS('mods/pz2qol_profiler');
});
step('Storage filters', installListFilter);
step('Select-all guard', installSelectAllGuard);
step('Score badges', installBadges);
step('Toolbars', installBars);
step('Price book', installPriceBook);
step('Market lister', installLister);
step('Best to breed', installMarketScan);
step('Zoo animal filters', installZoo);
// Kin: relatedness and inbreeding risk
step('Kin data', installKin);
step('Error banner setting', () => {
    setErrorBanner(getKinSettings().errorBanner);
    onKinSettings(s => setErrorBanner(s.errorBanner));
});
step('Kin in zoo management', installKinZoo);
step('Kin in info panels', installKinPanels);
step('Kin in Compare Mates and Genealogy', installKinMates);
step('Kin in Animal Storage', installKinStorage);
step('Sell advice in Animal Storage', installSellAdvice);
step('Stored ages for Auto mode', installStoredAges);
step('Juveniles of Market listings', installMarketCalves);
step('Your breeders for the Market picks', installMarketMates);
step('Kin planner', installKinPlanner);
step('Kin alerts', installKinAlerts);
step('Missed notices', installMissedNotices);
step('Kin watch', installKinWatch);
step('Unique names for newborns', installKinNames);
step('Young and old animals in storage', installStoredHome);
step('Education topics', installEducation);
step('Overdue births', installKinBirth);
step('Zoo census (debug log)', installKinCensus);
step('Boxed animal alerts', installBoxedAlerts);
step('Stuck aquarium animals', installBoxRelease);
step('Quarantine notices', installQuarantineAlerts);
// in the park: one-click Species board and the autosave control
step('Park launcher', installHudLauncher);
step('Find a habitat', installStorageSend);
// Species board / Kin planner -> the hub's Animal Storage or Market for one species
step('Trade shortcuts', installTradeJump);
step('Bring to the trade centre', installStorageFetch);
// Species board: loaded on its own, so a missing or broken board never
// stops the rest of the mod
step('Species board', () => {
    import('/js/mods/pz2qol/kinboard.js')
        .then(m => {
            loadCSS('mods/pz2qol_kinboard');
            if (m.installSpeciesBoard() === false) reportError('mod', 'Species board not installed', 'The game UI did not look as expected.', { silent: true });
        })
        .catch(e => reportError('mod', 'Species board failed to start', e));
});
// Breeding window (park HUD): the Breeding programme in a small window in
// the info panel's place; its own module, loaded on its own
step('Breeding window', () => {
    import('/js/mods/pz2qol/breedwin.js')
        .then(m => {
            loadCSS('mods/pz2qol_kinboard');
            loadCSS('mods/pz2qol_breedwin');
            if (m.installBreedingWindow() === false) reportError('mod', 'Breeding window not installed', 'The game UI did not look as expected.', { silent: true });
        })
        .catch(e => reportError('mod', 'Breeding window failed to start', e, { silent: true }));
});
// Auto mode (per species, on the Species board): its own module, so a
// broken Auto mode never stops the board or the rest of the mod
step('Auto mode', () => {
    import('/js/mods/pz2qol/kinautoui.js')
        .then(m => m.installAutopilotUI())
        .catch(e => reportError('mod', 'Auto mode failed to start', e, { silent: true }));
});
// Market desk: list many storage animals at once (its own module, so a
// broken desk never stops the rest of the mod)
step('Market desk', () => {
    import('/js/mods/pz2qol/marketdesk.js')
        .then(m => {
            loadCSS('mods/pz2qol_marketdesk');
            if (m.installMarketDesk() === false) reportError('mod', 'Market desk not installed', 'The game UI did not look as expected.', { silent: true });
        })
        .catch(e => reportError('mod', 'Market desk failed to start', e));
});
document.body.classList.add('PZ2QoL');
console.log(`[PZ2QoL] UI v${VERSION} loaded`);
trace('main_done');
setTimeout(() => trace('tick_1s'), 1000);
setTimeout(() => trace('tick_10s'), 10000);
// proves the page was alive up to the last line before a crash
setInterval(() => trace('heartbeat'), 10000);
