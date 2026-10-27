import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSeen, SEEN_FIELDS } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

const seen = {
    key: 'k1', sel: ['k1'], allowed: true, reason: 'a|b',
    limits: { tradePriceMin: 100, tradePriceMax: 10000, tradePriceDefault: 14000, tradeDurationMin: 1, tradeDurationMax: 2, tradeDurationDefault: 3 },
    quick: {
        quickTradeAllowed: false, quickTradeDisallowedReason: 'r1', quickTradeValue: 'v1',
        quickReleaseAllowed: true, quickReleaseDisallowedReason: 'r2', quickReleaseValue: 'v2',
        rehomeAllowed: null, quickTradePrice: 50, quickReleasePrice: 60,
    },
    net: { connecting: true, loading: false }, releaseable: true, source: 'src x', page: 'hud',
};

// the report pz2qol.lister.lua ParseSeen was run on and read back field for field
const LUA_READ = 'v2|k1|k1|1|100,10000,14000,1,2,3|a%7Cb|0|r1|v1|1|r2|v2|-|50,60|1,0|1|src%20x|hud';

test('the page report carries its fields in the documented order, the page id last', () => {
    const text = encodeSeen(seen);
    assert.equal(text, LUA_READ);
    const fields = text.split('|');
    assert.equal(fields.length, SEEN_FIELDS.length);
    const at = name => fields[SEEN_FIELDS.indexOf(name)];
    assert.equal(at('key'), 'k1');
    assert.equal(at('reason'), 'a%7Cb');
    assert.equal(at('quickPrices'), '50,60');
    assert.equal(at('source'), 'src%20x');
    assert.equal(at('page'), 'hud');
});
