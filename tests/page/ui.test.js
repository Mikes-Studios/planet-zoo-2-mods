import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibilityWatch } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/ui.js';

test('a visibility watch fires once each time the node comes on screen', () => {
    const body = {};
    const node = { hidden: true, parentNode: body, classList: { contains: () => false }, getBoundingClientRect: () => ({ width: node.hidden ? 0 : 10, height: 10 }) };
    globalThis.document = { body, querySelector: () => node };
    const shown = [];
    const tick = visibilityWatch('.x', at => shown.push(at));
    assert.equal(tick(), 0);
    node.hidden = false;
    const since = tick();
    assert.ok(since > 0);
    assert.equal(tick(), since, 'still the same showing');
    node.hidden = true;
    assert.equal(tick(), 0);
    node.hidden = false;
    tick();
    assert.equal(shown.length, 2);
    delete globalThis.document;
});
