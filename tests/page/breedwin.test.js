import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitatChoices, habitatRows, habitatSpeciesRows, staleDeepText } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/breedwincore.js';
import { Sex, animal, juvenile, zoo } from './zoo.js';

const MASAI = 'Giraffe_Masai';
const RETIC = 'Giraffe_Reticulated';
const ZEBRA = 'Zebra_Plains';
const OSTRICH = 'Ostrich_Common';

function savannah() {
    const model = zoo([
        animal('Kito', Sex.Male, 'H1', { species: MASAI }),
        animal('Nala', Sex.Female, 'H1', { species: MASAI }),
        juvenile('Tiny', Sex.Female, 'H1', { species: MASAI }),
        animal('Stripe', Sex.Male, 'H1', { species: ZEBRA }),
        animal('Remi', Sex.Male, 'H2', { species: RETIC }),
    ]);
    model.snapshot = { habs: [{ id: 'H1', name: 'Savannah' }, { id: 'H2', name: 'Acacia' }, { id: 'H3', name: 'Empty Plain' }] };
    return model;
}

const species = rows => rows.map(r => r.species);

test('every habitat is listed, empty ones too, with what is set aside and how many live there', () => {
    const rows = habitatChoices(savannah(), new Map([['H3', new Set([OSTRICH])]]));
    assert.deepEqual(rows.map(r => r.name), ['Acacia', 'Empty Plain', 'Savannah']);
    const plain = rows.find(r => r.hab === 'H3');
    assert.deepEqual(plain.species, [OSTRICH]);
    assert.equal(plain.animals, 0);
    assert.equal(rows.find(r => r.hab === 'H1').animals, 4);
});

test('a habitat lists its species: set aside first, then the ones living there, then the rest', () => {
    const model = savannah();
    const r = habitatSpeciesRows({
        habs: ['H1'],
        model,
        assignments: new Map([['H1', new Set([MASAI, OSTRICH])]]),
        zoo: [{ species: MASAI, animals: 3, males: 1, females: 2 }, { species: ZEBRA, animals: 1, males: 1, females: 0 }, { species: RETIC, animals: 1, males: 1, females: 0 }],
        stored: new Map([[OSTRICH, { m: 2, f: 3 }], [RETIC, { m: 0, f: 4 }]]),
    });
    assert.deepEqual(species(r.ticked), [MASAI, OSTRICH]);
    assert.deepEqual(r.ticked[0].here, { m: 1, f: 1, young: 1 });
    assert.equal(r.ticked[1].stored, 5);
    assert.deepEqual(species(r.living), [ZEBRA]);
    assert.deepEqual(species(r.yours), [RETIC]);
    assert.equal(r.yours[0].stored, 4);
});

test('with several habitats chosen, a species set aside in only some of them says so', () => {
    const r = habitatSpeciesRows({
        habs: ['H1', 'H3'],
        model: savannah(),
        assignments: new Map([['H1', new Set([MASAI, RETIC])], ['H3', new Set([MASAI])]]),
    });
    assert.deepEqual(species(r.ticked), [MASAI, RETIC]);
    assert.deepEqual(r.ticked.map(x => x.count), [2, 1]);
});

test('the search narrows the other species but never hides what is set aside or living there', () => {
    const r = habitatSpeciesRows({
        habs: ['H1'],
        model: savannah(),
        assignments: new Map([['H1', new Set([MASAI])]]),
        zoo: [{ species: RETIC, animals: 1, males: 1, females: 0 }],
        catalogue: [MASAI, RETIC, ZEBRA, OSTRICH, 'Lion'],
        query: 'ostr',
    });
    assert.deepEqual(species(r.ticked), [MASAI]);
    assert.deepEqual(species(r.living), [ZEBRA]);
    assert.deepEqual(species(r.yours), []);
    assert.deepEqual(species(r.other), [OSTRICH]);
});

test('the rest of the game\'s species only show while searching', () => {
    const r = habitatSpeciesRows({ habs: ['H3'], model: savannah(), assignments: new Map(), catalogue: [OSTRICH, 'Lion'] });
    assert.deepEqual(r.ticked, []);
    assert.deepEqual(r.living, []);
    assert.deepEqual(r.other, []);
});

test('a species\' habitats name the other species living there, in every row, the dead left out', () => {
    const model = zoo([
        animal('Kito', Sex.Male, 'H1', { species: MASAI }),
        animal('Stripe', Sex.Male, 'H1', { species: ZEBRA }),
        animal('Ozzy', Sex.Male, 'H2', { species: OSTRICH }),
        Object.assign(animal('Ghost', Sex.Female, 'H3', { species: RETIC }), { alive: false }),
        animal('Remi', Sex.Male, 'H3', { species: ZEBRA }),
    ]);
    const dest = { bySpecies: { [MASAI]: { H2: { ok: true }, H3: { ok: true } } } };
    const r = habitatRows(model, MASAI, new Map([['H3', new Set([MASAI])]]), dest);
    assert.deepEqual(r.living.map(x => [x.hab, x.others]), [['H1', [ZEBRA]]]);
    assert.deepEqual(r.assigned.map(x => [x.hab, x.others]), [['H3', [ZEBRA]]]);
    assert.deepEqual(r.suitable.map(x => [x.hab, x.others]), [['H2', [OSTRICH]]]);
});

test('a deep plan made before the breeders changed is flagged, so the window never runs it as it is', () => {
    const r = { moves: [{ id: 'A', to: 'H2' }, { id: 'B', to: 'H1' }] };
    assert.match(staleDeepText({ kind: 'deep', stale: true, r }), /breeders changed .*2 moves/);
    assert.equal(staleDeepText({ kind: 'deep', stale: false, r }), '');
    assert.equal(staleDeepText({ kind: 'classic', stale: false, r }), '');
    assert.equal(staleDeepText(null), '');
});
