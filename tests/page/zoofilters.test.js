import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyZooFilters, DEFAULT_ZOO_FILTERS } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const byKin = Object.assign({}, DEFAULT_ZOO_FILTERS, { sort: 'kin' });
const names = animals => applyZooFilters(animals, byKin).map(a => a.name).join(' ');

test('the kin sort keeps the game\'s order for animals without kin', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ name: 'a' + i, kinSeverity: null, kinCluster: null }));
    assert.equal(names(twelve), twelve.map(a => a.name).join(' '));
});

test("the kin sort puts the worst first, then keeps relatives together in the game's order", () => {
    const zoo = [
        { name: 'none0', kinSeverity: null, kinCluster: null },
        { name: 'cov1', kinSeverity: null, kinCluster: 7 },
        { name: 'none2', kinSeverity: null, kinCluster: null },
        { name: 'risk3', kinSeverity: 'risk', kinCluster: 9 },
        { name: 'cov4', kinSeverity: null, kinCluster: 7 },
        { name: 'risk5', kinSeverity: 'risk', kinCluster: 9 },
    ];
    assert.equal(names(zoo), 'risk3 risk5 none0 cov1 cov4 none2');
    assert.equal(names([zoo[1], zoo[4], zoo[3], zoo[5]]), 'risk3 risk5 cov1 cov4');
});
