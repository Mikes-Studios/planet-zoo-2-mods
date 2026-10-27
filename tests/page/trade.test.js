import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTradeExtra, parseTradeExtra } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/tradejumpcore.js';

test('the market hand-over carries the sex wanted and the dim line', () => {
    assert.equal(formatTradeExtra({ sex: 'f', dimBelow: 48 }), 'sex=f;dim=48');
    assert.equal(formatTradeExtra({}), '');
    assert.deepEqual(parseTradeExtra('sex=f;dim=48'), { sex: 'f', dimBelow: 48, mates: [], floor: null, strict: false });
    assert.deepEqual(parseTradeExtra('sex=x;dim=abc'), { sex: '', dimBelow: null, mates: [], floor: null, strict: false });
    assert.deepEqual(parseTradeExtra(''), { sex: '', dimBelow: null, mates: [], floor: null, strict: false });
});

test('a Market extra carries the mates\' genes and the calf floor', () => {
    const mate = { F: 'AAAAAAaaaaaa', I: 'AAAAAAAAAAAA', S: 'AAaaAAaaAAaa', L: 'aaaaaaaaaaaa' };
    const text = formatTradeExtra({ sex: 'm', dimBelow: 50, mates: [mate, { F: 'A.B' }], floor: 61 });
    assert.ok(/^[A-Za-z0-9=;]+$/.test(text), 'only what the Lua side lets through');
    const back = parseTradeExtra(text);
    assert.deepEqual(back.mates, [mate], 'a mate whose alleles are not single letters is left out');
    assert.equal(back.floor, 61);
    assert.equal(back.sex, 'm');
    assert.equal(back.dimBelow, 50);
});

test('a notice\'s strict Market hand-over survives the trip through Lua', () => {
    const text = formatTradeExtra({ sex: 'm', floor: 64, strict: true });
    assert.ok(/^[A-Za-z0-9=;]+$/.test(text));
    assert.equal(parseTradeExtra(text).strict, true);
    assert.equal(parseTradeExtra('sex=m').strict, false);
});
