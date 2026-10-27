import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _configureForTests, _flushForTests, _resetForTests, dlog, setLogState } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/debuglog.js';

test('the lines kept before Lua answered all go out, in order, without using up the rate', () => {
    const sent = [];
    let now = 1000000;
    _resetForTests();
    _configureForTests({ now: () => now, send: text => sent.push(...text.split('\n')) });
    for (let i = 1; i <= 500; i++) dlog('ui', 'early', { i });
    setLogState('on');
    _flushForTests();
    const numbers = sent.map(line => Number((/ i=(\d+)/.exec(line) || [])[1]));
    assert.deepEqual(numbers, Array.from({ length: 500 }, (_, i) => i + 1));
    now += 500;
    dlog('ui', 'live');
    _flushForTests();
    assert.match(sent.at(-1), / ui live$/);
    assert.ok(!sent.some(line => line.includes('log dropped')));
});
