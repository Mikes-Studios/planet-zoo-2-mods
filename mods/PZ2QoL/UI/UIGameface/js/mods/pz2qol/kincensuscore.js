// Zoo census for the detailed log (kincensus.js): one row per animal and
// what changed between two scans. Pure, no game imports (Node tests).
import { Sex, ownGrades } from './kincore.js';
import { ownGeneScore } from './kinprogramme.js';

const TRADE_PLACE = 'trade centre';
// a newcomer this young was born here, not brought in
const BORN_YEARS = 0.5;

function placeName(model, a) {
    if (a.hab) {
        const h = model.habitats && model.habitats.get(String(a.hab));
        return (h && h.name) || String(a.hab);
    }
    if (a.lt === 'trade') return TRADE_PLACE;
    return a.lt || 'storage';
}

function stageOf(a) {
    if (a.juv) return 'juvenile';
    return (a.fert && a.fert.state) || 'adult';
}

function genesText(genes) {
    const g = ownGrades(genes);
    const pct = v => (typeof v === 'number' ? Math.round(v * 100) : '-');
    return `F${pct(g.fertility)} I${pct(g.immunity)} S${pct(g.size)} L${pct(g.longevity)}`;
}

// Map id -> { id, name, species, sex (m|f|u), age, stage, place, genes,
// score, parents, mates, preg, contra } for every animal of the model.
export function censusRows(model) {
    const out = new Map();
    if (!model || !model.animals) return out;
    const nameOf = g => model.ped.nameOf(String(g)) || String(g);
    // mates are entity ids, parents are GUIDs
    const mateName = id => { const m = model.animals.get(String(id)); return m ? m.name : nameOf(id); };
    for (const a of model.animals.values()) {
        if (a.alive === false) continue;
        out.set(String(a.id), {
            id: String(a.id),
            name: a.name || String(a.id),
            species: a.species,
            sex: a.sex === Sex.Male ? 'm' : a.sex === Sex.Female ? 'f' : 'u',
            age: typeof a.age === 'number' ? a.age : null,
            stage: stageOf(a),
            place: a.exhibit ? `exhibit ${placeName(model, a)}` : placeName(model, a),
            genes: genesText(a.genes),
            score: ownGeneScore(a),
            parents: (a.par || []).map(nameOf).join(' '),
            mates: (a.mates || []).map(mateName).join(' '),
            preg: !!a.preg,
            contra: !!a.contra,
        });
    }
    return out;
}

// What changed from one census to the next: [{ event, row, from }].
// event: born | arrived | left | moved (from: the old place) | grew |
// pregnant | not_pregnant | contraception_on | contraception_off | aged
// (at the trade centre only: whether animals there grow older at all)
export function censusChanges(before, after) {
    const out = [];
    for (const [id, row] of after) {
        const old = before.get(id);
        if (!old) {
            out.push({ event: row.stage === 'juvenile' && row.age != null && row.age <= BORN_YEARS ? 'born' : 'arrived', row });
            continue;
        }
        if (old.place !== row.place) out.push({ event: 'moved', row, from: old.place });
        if (old.stage === 'juvenile' && row.stage !== 'juvenile') out.push({ event: 'grew', row });
        if (old.preg !== row.preg) out.push({ event: row.preg ? 'pregnant' : 'not_pregnant', row });
        if (old.contra !== row.contra) out.push({ event: row.contra ? 'contraception_on' : 'contraception_off', row });
        if (row.place === TRADE_PLACE && old.place === TRADE_PLACE && old.age !== row.age) out.push({ event: 'aged', row, from: old.age });
    }
    for (const [id, row] of before) if (!after.has(id)) out.push({ event: 'left', row });
    return out;
}
