import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censusChanges, censusRows } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincensuscore.js';
import { Sex, TRADE, animal, juvenile, zoo } from './zoo.js';

const events = list => list.map(e => `${e.event} ${e.row.name}${e.from != null ? ` ${e.from}>${e.row.place}` : ''}`);

test('a row carries where the animal is, its stage, genes and parents by name', () => {
    const model = zoo([
        animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'),
        juvenile('Calf', Sex.Female, 'H1', { par: ['Mum', 'Dad'] }),
        animal('Waiting', Sex.Male, TRADE),
    ]);
    const rows = censusRows(model);
    const calf = rows.get('Calf');
    assert.equal(calf.place, 'H1');
    assert.equal(calf.stage, 'juvenile');
    assert.equal(calf.sex, 'f');
    assert.deepEqual(calf.parents.split(' ').sort(), ['Dad', 'Mum']);
    assert.match(calf.genes, /^F\d+ I\d+ S\d+ L\d+$/);
    assert.equal(rows.get('Waiting').place, 'trade centre');

    const paired = zoo([animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1')]);
    paired.animals.get('Mum').mates = ['Dad'];
    paired.animals.get('Dad').name = 'Big Dad';
    assert.equal(censusRows(paired).get('Mum').mates, 'Big Dad');
});

test('between two scans: moves, growing up, births, arrivals and departures', () => {
    const before = censusRows(zoo([
        animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'),
        juvenile('Calf', Sex.Female, 'H1', { par: ['Mum', 'Dad'] }),
        animal('Sold', Sex.Male, 'H2'),
    ]));
    const after = censusRows(zoo([
        animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2'),
        animal('Calf', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 7 }),
        juvenile('Baby', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 0.1 }),
        animal('Bought', Sex.Female, TRADE),
    ]));
    assert.deepEqual(events(censusChanges(before, after)).sort(), [
        'arrived Bought',
        'born Baby',
        'grew Calf',
        'left Sold',
        'moved Dad H1>H2',
    ]);
});

test('an animal at the trade centre is logged as it ages there, nowhere else', () => {
    const before = censusRows(zoo([animal('Waiting', Sex.Female, TRADE, { age: 3.9 }), animal('Home', Sex.Male, 'H1', { age: 5 })]));
    const after = censusRows(zoo([animal('Waiting', Sex.Female, TRADE, { age: 4.1 }), animal('Home', Sex.Male, 'H1', { age: 5.2 })]));
    const aged = censusChanges(before, after).filter(e => e.event === 'aged');
    assert.deepEqual(aged.map(e => `${e.row.name} ${e.from}>${e.row.age}`), ['Waiting 3.9>4.1']);
});
