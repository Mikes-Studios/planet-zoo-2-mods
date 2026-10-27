// "Best to breed" in the Market lister: one Market check of every breeding
// target (breedtargets.js), SCAN_PAGES pages at most each, ranked by what a
// breeding female would earn at today's asking prices (marketscancore.js).
// Frontend page only.
import { BREED_TARGETS } from '/js/mods/pz2qol/breedtargets.js';
import { SCAN_PAGES, marketSpecies, rankTargets } from '/js/mods/pz2qol/marketscancore.js';
import { addListerSection, checkMarketForAll, getMarketCheck, getMultiMarketCheck, isMultiCheckBusy, stopMultiCheck } from '/js/mods/pz2qol/lister.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { fmtInt, h, icon } from '/js/mods/pz2qol/ui.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

const BUSY_STATES = ['starting', 'loading', 'reading'];

let scan = null; // { running } | { ranked, at, stopped } | { error }

export async function runScan() {
    if (isMultiCheckBusy() || (scan && scan.running)) return;
    scan = { running: true };
    dlog('scan', 'start', { species: BREED_TARGETS.length, pages: SCAN_PAGES });
    try {
        const reads = await checkMarketForAll(BREED_TARGETS.map(marketSpecies), { maxPages: SCAN_PAGES });
        if (!reads) {
            scan = { error: 'A listing is running: scan the market when it is done.' };
            return;
        }
        const byId = new Map();
        for (const t of BREED_TARGETS) if (reads.has(marketSpecies(t))) byId.set(t.id, reads.get(marketSpecies(t)));
        const ranked = rankTargets(BREED_TARGETS, byId);
        scan = { ranked, at: Date.now(), stopped: byId.size < BREED_TARGETS.length };
        for (const s of ranked) dlog('scan', 'species', { species: s.target.id, ok: s.ok, listed: s.count, approx: s.approx || undefined, price: s.price, perYear: s.perYear, share: s.share, value: s.value == null ? null : Math.round(s.value) });
    }
    catch (e) {
        scan = { error: `The scan stopped on an error in the mod (${e && e.message}). Try again; if it repeats, the debug log has the details.` };
        reportError('lister', 'Best to breed: the scan failed', e, { silent: true });
    }
}

function scanButton() {
    if (scan && scan.running) {
        return h('div.PZ2QoL_btn.negative', { onClick: () => stopMultiCheck(), title: 'Stops after the species being checked now and ranks the ones read' },
            icon('Icon_Close', 'white', 'sm'), h('span', { text: 'Stop scan' }));
    }
    const button = h('div.PZ2QoL_btn', {
        onClick: () => runScan(),
        title: `Checks the Market for ${BREED_TARGETS.length} long-lived, hard-to-breed species that reserves release and tells you which pays best to breed now (Conservation Credits, asking prices)`,
    }, icon('IconSearch', 'brown', 'sm'), h('span', { text: 'Best to breed' }));
    const check = getMarketCheck();
    if (isMultiCheckBusy() || (check && BUSY_STATES.includes(check.state))) button.classList.add('disabled');
    return button;
}

const perYearText = s => `${s.perYear < 1 ? s.perYear.toFixed(2) : s.perYear.toFixed(1)}`;

function headline(top) {
    if (top.value != null) {
        return [`Breed ${speciesName(marketSpecies(top.target))}`, `about ${fmtInt(top.value)} CC a year per breeding female: ${top.why}.`];
    }
    if (top.ok) return [`Nobody lists any of them`, `${speciesName(marketSpecies(top.target))} is the hardest to breed of those: ${top.why}. There is no price to judge by.`];
    return ['No species could be read', top.why];
}

function resultRow(s) {
    const listed = !s.ok ? 'not read' : `${s.approx ? '≈' : ''}${s.count} listed`;
    return h('div.PZ2QoL_tableRow', { title: s.why },
        h('div.PZ2QoL_tableName', { text: speciesName(marketSpecies(s.target)) }),
        h('div.PZ2QoL_scanCell', { text: listed }),
        h('div.PZ2QoL_scanCell', { text: s.price == null ? '–' : `${fmtInt(s.price)} CC`, title: 'Median asking price' }),
        h('div.PZ2QoL_scanCell', { text: `${perYearText(s)} juveniles`, title: 'Juveniles a breeding female has a year at best' }),
        h(`div.PZ2QoL_tablePrice${s.value == null ? '.conf_none' : ''}`, { text: s.value == null ? '–' : `${fmtInt(s.value)} CC`, title: 'CC a year per breeding female' }));
}

export function scanBlock() {
    if (!scan) return null;
    if (scan.running) {
        const all = getMultiMarketCheck();
        const check = getMarketCheck();
        const text = `${all && all.message ? all.message : 'Starting the scan…'}${check && check.message && BUSY_STATES.includes(check.state) ? ` ${check.message}` : ''}`;
        return h('div.PZ2QoL_col.PZ2QoL_scan', null, h('div.PZ2QoL_colLabel', { text: 'Best to breed' }), h('div.PZ2QoL_peekStatus.reading', { text }));
    }
    const close = h('div.PZ2QoL_scanClose', { title: 'Close', onClick: () => { scan = null; } }, icon('Icon_Close', 'brown', 'sm'));
    if (scan.error) {
        return h('div.PZ2QoL_col.PZ2QoL_scan', null, h('div.PZ2QoL_scanHead', null, h('div.PZ2QoL_colLabel', { text: 'Best to breed' }), close),
            h('div.PZ2QoL_peekStatus.failed', { text: scan.error }));
    }
    const [top] = scan.ranked;
    const [title, why] = headline(top);
    const open = scan.ranked.filter(s => s.ok && s.count === 0 && s !== top).map(s => speciesName(marketSpecies(s.target)));
    const time = new Date(scan.at).toTimeString().slice(0, 5);
    return h('div.PZ2QoL_col.PZ2QoL_scan', null,
        h('div.PZ2QoL_scanHead', null, h('div.PZ2QoL_colLabel', { text: `Best to breed · scanned ${time}${scan.stopped ? ' · stopped early' : ''}` }), close),
        h('div.PZ2QoL_scanPick', { text: title }),
        h('div.PZ2QoL_scanWhy', { text: why }),
        open.length ? h('div.PZ2QoL_scanWhy', { text: `None listed: ${open.join(', ')}. No competition, but no price to judge by.` }) : null,
        h('div.PZ2QoL_tableScroll', null, scan.ranked.map(resultRow)),
        h('div.PZ2QoL_scanNote', { text: "Asking prices, not sales: the Market shows no sales. Wanted: the animals every reserve's release groups take." }));
}

function signature() {
    if (!scan) return '';
    const all = getMultiMarketCheck();
    const check = getMarketCheck();
    return JSON.stringify([scan.running, scan.at, scan.error, all && all.message, check && check.message, isMultiCheckBusy()]);
}

export function installMarketScan() {
    addListerSection({ button: scanButton, block: scanBlock, signature });
}
