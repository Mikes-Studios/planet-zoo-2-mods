// Breeding window, the pure part (breedwincore.js): what a park click picked,
// the species list and search, a species' habitats, the runnable moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    habitatRows, infoPanelTarget, matchesQuery, pickedHabitat, programmeSignature, runnableMoves, speciesChoices,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/breedwincore.js';
import { placeName } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { HABITAT_SPECIES } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/speciesrules.js';

function model() {
    const habitats = new Map([
        ['10', { id: '10', name: 'Savannah', kind: 'habitat' }],
        ['11', { id: '11', name: 'Plains', kind: 'habitat' }],
        ['12', { id: '12', name: 'Empty Hill', kind: 'habitat' }],
        ['20', { id: '20', name: 'Reptile House', kind: 'exhibit' }],
    ]);
    const animals = new Map();
    const add = (id, species, sex, hab, extra = {}) => animals.set(id, Object.assign({ id, name: 'A' + id, species, sex, hab, lt: hab ? 'habitat' : 'other', juv: false, alive: true }, extra));
    add('1', 'Lion', 0, '10');
    add('2', 'Lion', 1, '10');
    add('3', 'Lion', 1, '10', { juv: true });
    add('4', 'Zebra', 0, '10');
    add('5', 'Zebra', 1, '11');
    add('6', 'Zebra', 1, '11');
    add('7', 'Lion', 1, '', { lt: 'trade' });
    add('8', 'Gecko', 0, '20', { exhibit: true });
    add('9', 'Lion', 1, '11', { preg: true });
    return { habitats, animals, tradeCentre: { id: '501', name: 'Trade Centre' } };
}

test('infoPanelTarget reads the game\'s panel context', () => {
    assert.deepEqual(infoPanelTarget(['InfoPanels', 'habitatGateInfoPanel', 10]), { kind: 'habitat', id: '10' });
    assert.deepEqual(infoPanelTarget(['InfoPanels', 'animalInfoPanel', '123.0']), { kind: 'animal', id: '123' });
    assert.equal(infoPanelTarget(['InfoPanels', 'exhibitAnimalInfoPanel', '5']).kind, 'other');
    assert.equal(infoPanelTarget(['InfoPanels', 'guestInfoPanel', '5']).kind, 'other');
    assert.equal(infoPanelTarget(null).kind, 'other');
    assert.equal(infoPanelTarget(['x', 'habitatGateInfoPanel']).kind, 'other');
});

test('pickedHabitat: a habitat, an animal\'s habitat, or why not', () => {
    const m = model();
    assert.deepEqual(pickedHabitat(['P', 'habitatGateInfoPanel', '11'], m), { hab: '11', name: 'Plains', via: 'habitat' });
    const viaAnimal = pickedHabitat(['P', 'animalInfoPanel', '5'], m);
    assert.equal(viaAnimal.hab, '11');
    assert.equal(viaAnimal.via, 'animal');
    // a habitat the scan has not seen yet still counts (the game named it)
    assert.equal(pickedHabitat(['P', 'habitatGateInfoPanel', '99'], m).hab, '99');
    assert.match(pickedHabitat(['P', 'animalInfoPanel', '7'], m).error, /not in a habitat/);
    assert.match(pickedHabitat(['P', 'animalInfoPanel', '8'], m).error, /exhibit/);
    assert.match(pickedHabitat(['P', 'animalInfoPanel', '404'], m).error, /not known/);
    assert.match(pickedHabitat(['P', 'guestInfoPanel', '1'], m).error, /not a habitat/);
    assert.match(pickedHabitat(['P', 'habitatGateInfoPanel', '20'], m).error, /exhibit/);
});

// the window lists every habitat species of the game (the species table
// from its animals.fdb), so a species only in storage shows too
test('the catalogue: every habitat species the game has, each once', () => {
    assert.ok(HABITAT_SPECIES.length > 50);
    assert.ok(HABITAT_SPECIES.includes('Lion_African'));
    assert.equal(new Set(HABITAT_SPECIES).size, HABITAT_SPECIES.length);
});

test('matchesQuery: every word, name or id, case and underscores ignored', () => {
    assert.ok(matchesQuery('Warthog_Common', 'Common Warthog', 'wart'));
    assert.ok(matchesQuery('Warthog_Common', 'Common Warthog', 'common wart'));
    assert.ok(matchesQuery('Warthog_Common', 'Phacochère', 'warthog'));
    assert.ok(!matchesQuery('Lion', 'Lion', 'tig'));
    assert.ok(matchesQuery('Lion', 'Lion', '  '));
});

test('speciesChoices: zoo, storage, and the rest only while searching', () => {
    const zoo = [{ species: 'Zebra', animals: 3, males: 1, females: 2 }, { species: 'Lion', animals: 5, males: 1, females: 4 }];
    const stored = new Map([['Okapi', { m: 1, f: 2 }], ['Lion', { m: 0, f: 1 }], ['Tapir', { m: 0, f: 0 }]]);
    const catalogue = ['Lion', 'Zebra', 'Okapi', 'Tapir', 'Tiger', 'Lemur_Ringtailed'];
    const assigned = new Map([['Tiger', 2]]);
    const nameOf = s => s.replace(/_/g, ' ');
    const all = speciesChoices({ zoo, stored, catalogue, assigned, nameOf });
    assert.deepEqual(all.zoo.map(r => r.species), ['Lion', 'Zebra']);
    assert.equal(all.zoo[0].stored, 1);
    // stored and set-aside species that are not in the zoo
    assert.deepEqual(all.stored.map(r => r.species), ['Okapi', 'Tiger']);
    assert.deepEqual(all.other, []);
    const q = speciesChoices({ zoo, stored, catalogue, assigned, nameOf, query: 'tap' });
    assert.deepEqual(q.zoo, []);
    assert.deepEqual(q.other.map(r => r.species), ['Tapir']);
    const l = speciesChoices({ zoo, stored, catalogue, assigned, nameOf, query: 'l' });
    assert.deepEqual(l.zoo.map(r => r.species), ['Lion']);
    assert.deepEqual(l.other.map(r => r.species), ['Lemur_Ringtailed']);
    const capped = speciesChoices({ catalogue: ['A1', 'A2', 'A3'], query: 'a', otherMax: 2 });
    assert.equal(capped.other.length, 2);
    assert.equal(capped.more, 1);
});

test('habitatRows: set aside, living there, suitable', () => {
    const m = model();
    const assignments = new Map([['12', new Set(['Lion', 'Zebra'])], ['11', new Set(['Zebra'])]]);
    const dest = { bySpecies: { Lion: { 10: { ok: true }, 11: { ok: true }, 12: { ok: true }, 13: { ok: true }, 14: { ok: false, reason: 'Too cold' } } }, habitats: [{ id: '13', name: 'New Field' }] };
    const r = habitatRows(m, 'Lion', assignments, dest);
    assert.deepEqual(r.assigned.map(x => x.hab), ['12']);
    assert.deepEqual(r.assigned[0].shared, ['Zebra']);
    assert.deepEqual(r.living.map(x => x.hab), ['11', '10']);
    const sav = r.living.find(x => x.hab === '10');
    assert.deepEqual(sav.here, { m: 1, f: 1, young: 1 });
    assert.deepEqual(sav.others, ['Zebra']);
    assert.equal(sav.ok, true);
    // 13 is suitable and empty; 14 refused; 11 is set aside for zebras only but lions live there
    assert.deepEqual(r.suitable.map(x => [x.hab, x.name]), [['13', 'New Field']]);
    const none = habitatRows(m, 'Okapi', assignments, null);
    assert.deepEqual(none, { assigned: [], living: [], suitable: [] });
});

test('habitatRows: a habitat set aside for another species is not suggested', () => {
    const m = model();
    const assignments = new Map([['12', new Set(['Zebra'])]]);
    const dest = { bySpecies: { Lion: { 12: { ok: true } } } };
    assert.deepEqual(habitatRows(m, 'Lion', assignments, dest).suitable, []);
});

test('runnableMoves: pregnant, exhibit and unknown animals stay', () => {
    const m = model();
    const moves = [{ id: '1', to: '11' }, { id: '9', to: '10' }, { id: '7', to: '12' }, { id: '404', to: '10' }, { id: '8', to: '10' }];
    assert.deepEqual(runnableMoves(m, moves), [{ id: '1', to: '11' }, { id: '7', to: '12' }]);
});

test('programmeSignature follows the species and its habitats set aside only', () => {
    const m = model();
    const a1 = new Map([['12', new Set(['Lion'])]]);
    const s1 = programmeSignature(m, 'Lion', a1);
    assert.equal(programmeSignature(m, 'Lion', new Map([['12', new Set(['Lion'])], ['11', new Set(['Zebra'])]])), s1);
    assert.notEqual(programmeSignature(m, 'Lion', new Map()), s1);
    m.animals.get('4').hab = '12';
    assert.equal(programmeSignature(m, 'Lion', a1), s1);
    m.animals.get('1').hab = '12';
    assert.notEqual(programmeSignature(m, 'Lion', a1), s1);
});

test('place names (placeName, shared with the board and the planner)', () => {
    const m = model();
    assert.equal(placeName(m, 'trade', null), 'Trade Centre');
    assert.equal(placeName(m, '10', null), 'Savannah');
    assert.equal(placeName(m, '13', { habitats: [{ id: '13', name: 'New Field' }] }), 'New Field');
    assert.equal(placeName(m, '77', null), 'Habitat 77');
});
