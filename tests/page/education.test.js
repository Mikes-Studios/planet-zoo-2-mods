import { test } from 'node:test';
import assert from 'node:assert/strict';
import { educationRows, fillSummary, missingCount } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/educationcore.js';

const NAMES = { species: id => id.replace('_', ' '), topic: s => s.replace(/^\[|\]$/g, '') };
const REPORT = {
    need: 5, spare: 1,
    species: [
        { id: 'Rhino_Black', placed: 2, missing: [{ i: 2, name: '[Diet]' }, { i: 3, name: '[Habitat]' }], locked: 2 },
        { id: 'Zebra', placed: 9, missing: [{ i: 7, name: '[Name Plate]' }], locked: 1 },
    ],
};

test('a species short of the game\'s count lists what it lacks, first', () => {
    const rows = educationRows(REPORT, NAMES);
    assert.equal(rows[0].id, 'Rhino_Black');
    assert.equal(rows[0].done, false);
    assert.equal(rows[0].text, 'Rhino Black: 5 topics needed, 2 placed · not placed: Diet, Habitat · 2 more after research');
});

test('a species at the game\'s count is covered; its other topics are not listed', () => {
    const zebra = educationRows(REPORT, NAMES)[1];
    assert.equal(zebra.done, true);
    assert.equal(zebra.text, 'Zebra: 5 topics needed, 9 placed');
    assert.equal(missingCount(REPORT), 1);
});

test('the fill note says what it set and what still needs a prop', () => {
    assert.equal(fillSummary({ assigned: [{}, {}], report: REPORT }), 'Set 2 props to a missing topic. Place more boards or speakers for the species still short.');
    assert.equal(fillSummary({ assigned: [], report: REPORT }), 'No prop could take a missing topic: place another board or speaker for each species still short.');
    assert.equal(fillSummary({ assigned: [{}], report: { need: 1, species: [{ id: 'Zebra', placed: 1, missing: [], locked: 0 }] } }), 'Set 1 prop to a missing topic.');
});
