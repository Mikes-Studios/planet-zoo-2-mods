// Fresh blood: calves growing up in a species' habitats that will find no
// unrelated partner of the other sex in the zoo once grown. Told while they
// are still young, so a partner can be brought or bought before they are
// ready to breed instead of after. Pure, no game imports (Node tests).
import { Sex, notYet } from './kincore.js';
import { YOUNG_MARGIN, canEverBreed, isBreeder, relatedPair, weakBreeders } from './kinprogramme.js';

const otherSex = sex => (sex === Sex.Male ? Sex.Female : sex === Sex.Female ? Sex.Male : null);

// -> [{ sex (the partner wanted), calves: [animal] }], one entry per sex wanted
export function freshBloodNeeds(model, species, { margin = YOUNG_MARGIN } = {}) {
    if (!model || !model.animals) return [];
    const herd = [];
    for (const a of model.animals.values()) {
        if (a.species === species && !a.exhibit && a.alive !== false && a.hab) herd.push(a);
    }
    if (herd.some(a => a.sex === Sex.Unisex)) return [];
    const adults = herd.filter(isBreeder);
    // an adult whose calves would fall well behind the best pair's is no partner the plan would use
    const weak = weakBreeders(model, adults, margin);
    // contracepted adults count: contraception can be lifted
    const partners = herd.filter(a => (notYet(a) || isBreeder(a) || a.contra) && canEverBreed(a) && !weak.has(a.id));
    const out = new Map();
    for (const c of herd) {
        const want = otherSex(c.sex);
        if (!notYet(c) || want == null) continue;
        if (partners.some(p => p.sex === want && !relatedPair(model, c, p))) continue;
        if (!out.has(want)) out.set(want, []);
        out.get(want).push(c);
    }
    return Array.from(out, ([sex, calves]) => ({ sex, calves }));
}
