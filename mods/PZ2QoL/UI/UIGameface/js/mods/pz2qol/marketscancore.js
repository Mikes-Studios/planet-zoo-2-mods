// Which breeding target (breedtargets.js) pays best to breed for the Market
// as it stands, by what one scan of it read (marketscan.js): CC a breeding
// female earns a year = her calves a year x the median asking price x the
// share of buyers a new listing can expect beside the ones already there.
// Pure, so node tests can load it.
import { median } from './pricing.js';

// enough rows to price a species and count a busy market from the game's page count
export const SCAN_PAGES = 3;

// The species name the Market's filter and its rows use.
export function marketSpecies(target) {
    return `[Animal_${target.id}]`;
}

// At best: one litter per gap between births.
export function calvesPerYear(target) {
    return target.litter / target.interBirth;
}

// The animals players need from the Market to release it in every reserve.
export function demandOf(target) {
    return target.releaseAnimals * target.reserves;
}

// read: checkMarketFor's answer, { ok, total (rows read), pagesRead, pages (the game's count, null unknown) }
// -> { count, approx }: past the pages read, the rest are counted at the read pages' rate
export function listingCount(read) {
    const unread = read.pages != null && read.pagesRead > 0 && read.pagesRead < read.pages;
    return { count: unread ? Math.round(read.total / read.pagesRead * read.pages) : read.total, approx: unread };
}

const cc = n => Math.round(n).toLocaleString('en-US');
const years = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// One target with its scan. read: as listingCount takes, plus listings
// ([{ price, isCC }]) and message (why it failed), or null when not scanned.
// -> { target, ok, count, approx, price, perYear, share, value, firstSale, why }
export function scoreTarget(target, read) {
    const perYear = calvesPerYear(target);
    const firstSale = target.gestation + target.mature;
    const base = { target, ok: false, count: null, approx: false, price: null, perYear, share: null, value: null, firstSale };
    if (!read || !read.ok) return Object.assign(base, { why: read && read.message ? `not scanned: ${read.message}` : 'not scanned' });
    const { count, approx } = listingCount(read);
    const price = median((read.listings || []).filter(l => l.isCC && l.price > 0).map(l => l.price));
    const demand = demandOf(target);
    const share = demand / (demand + count);
    const value = price == null ? null : perYear * price * share;
    const supply = count === 0 ? 'none listed' : `${approx ? 'about ' : ''}${count} listed, asking about ${cc(price)} CC`;
    const why = `${supply}; ${demand} wanted across ${target.reserves} reserve${target.reserves === 1 ? '' : 's'}; a juvenile every ${years(target.interBirth)} years per female, sellable after ${years(firstSale)}`;
    return Object.assign(base, { ok: true, count, approx, price, share, value, why });
}

// Best first: priced by value, then the unlisted (no competition, no price),
// then the ones the scan could not read. reads: Map(target id -> read).
export function rankTargets(targets, reads) {
    const order = s => (s.value != null ? 0 : s.ok ? 1 : 2);
    return targets.map(t => scoreTarget(t, reads.get(t.id) || null))
        .sort((x, y) => order(x) - order(y) || (y.value ?? 0) - (x.value ?? 0) || x.target.breedingScore - y.target.breedingScore);
}
