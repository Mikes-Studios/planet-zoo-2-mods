// Kin ageing: animals about to turn elderly. Rehoming an elderly animal
// fails in game 1.0.5 (it throws errors), and in species infertile when
// elderly they can't be sold or released either (relocateanimalspopup.lua:
// bInfertileSell and bInfertile block both), so the warning comes while
// those are still open. Zoos only: a wildlife reserve's animals are wild.
// Pure, no game imports (Node tests).
import { speciesRules } from './speciesrules.js';
import { MARKET_ELDERLY_MARGIN_YEARS, isElderly, isNearlyElderly, normSpecies } from './scores.js';
import { cleanName } from './storagefetchcore.js';

// the market refuses an animal this close to elderly, and a year more leaves
// the time to sell it
export const ELDERLY_WARNING_YEARS = MARKET_ELDERLY_MARGIN_YEARS + 1;
// Selling ELDERLY_WARNING_YEARS early costs a breeder those years: worth it
// only where they are a tenth of its life or less. A shorter-lived species
// breeds to the end and lives out its life where it is (pastSelling).
export const EARLY_SALE_MIN_ELDERLY_AGE = 10 * ELDERLY_WARNING_YEARS;

// earlySale: the Kin setting Breeders to storage before elderly (off: none is)
export function sellsBeforeElderly(species, earlySale = true) {
    const rules = speciesRules(species);
    return earlySale !== false && !!rules && rules.elderlyAge >= EARLY_SALE_MIN_ELDERLY_AGE;
}

// Park animals within ELDERLY_WARNING_YEARS of the species' elderly age (animals.fdb
// ElderlyAge), not warned about yet (`warned`: keys already told). -> [{ animal, years, infertile }]
export function nearingElderly(model, warned) {
    const out = [];
    if (!model || model.reserve) return out;
    for (const a of model.animals ? model.animals.values() : []) {
        if (a.exhibit || a.juv || a.alive === false || typeof a.age !== 'number' || (a.lt !== 'habitat' && a.lt !== 'trade')) continue;
        const years = yearsToElderly(a.species, a.age);
        if (years == null || years <= 0 || years > ELDERLY_WARNING_YEARS || warned.has(a.guid || a.id)) continue;
        out.push({ animal: a, years, infertile: speciesRules(a.species).infertileWhenElderly });
    }
    return out;
}

// Years from `age` to the species' elderly age (0 or less: elderly already),
// null when the species' elderly age is unknown.
// The market takes no animal this close to elderly (scores.js), and the
// trade centre ages nothing: one waiting there would stay in storage for good.
export function pastSelling(a) {
    const years = yearsToElderly(a.species, a.age);
    return !!(a.fert && a.fert.elderly) || (years != null && years <= MARKET_ELDERLY_MARGIN_YEARS);
}

export function yearsToElderly(species, age) {
    const rules = speciesRules(species);
    return rules && rules.elderlyAge > 0 && typeof age === 'number' ? rules.elderlyAge - age : null;
}

export function elderlyWarningText({ animal, years, infertile }) {
    const months = Math.max(1, Math.round(years * 12));
    const after = infertile
        ? "then it can't breed, the game won't sell or release an infertile animal, and rehoming an elderly one fails"
        : 'then rehoming it fails (a game bug)';
    return `${animal.name} turns elderly in about ${months} month${months === 1 ? '' : 's'} of game time; ${after}. Sell it or release it to the wild before then if you don't want to keep it for good.`;
}

// The Storage window's ages (hub page), as Lua carries them to the park:
// [{ s: species, x: sex, n: name, p: [fertility, immunity, size, longevity] %, a: age }],
// and for a young one (maturity 0) or one too old to trade (elderly or nearly)
// also y: its species id and nm: its name as shown, o: 1 for an old one.
// rows: game.js readAnimal rows, names already plain (game.js locationName).
export function storedAgeEntries(rows) {
    const out = [];
    for (const r of rows || []) {
        const g = r.genes || {};
        const p = [g.fertility, g.immunity, g.size, g.longevity].map(v => (typeof v === 'number' ? Math.round(v <= 1.5 ? v * 100 : v) : null));
        if (typeof r.age !== 'number' || r.isShoal || p.includes(null)) continue;
        const e = { s: normSpecies(r.species), x: Number(r.gender) || 0, n: cleanName(r.name), p, a: r.age };
        const old = isElderly(r) || isNearlyElderly(r);
        if (Number(r.maturity) === 0 || old) Object.assign(e, { y: String(r.species || '').replace(/^\[|\]$/g, '').replace(/^Animal_/, ''), nm: String(r.name || '') }, old ? { o: 1 } : {});
        out.push(e);
    }
    return out;
}

// The age a Storage row gave a stored animal (kincore normalizeStored): the
// same species, sex and name, every gene within 2 points. null when none did.
export function storedAgeOf(entries, s, percents) {
    if (!entries || !percents) return null;
    const sp = normSpecies(s.species);
    const name = cleanName(s.name);
    const e = entries.find(x => x.s === sp && x.x === (Number(s.sex) || 0) && x.n === name && x.p.every((v, i) => Math.abs(v - percents[i]) <= 2));
    return e ? e.a : null;
}
