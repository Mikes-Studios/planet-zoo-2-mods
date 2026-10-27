import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopPageTimers } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();
stopPageTimers();
const { insertAfterVNode } = await import('/js/mods/pz2qol/kinhooks.js');

const v = (nodeName, children = []) => ({ nodeName, attributes: {}, children });

test('a line goes in right after the game\'s row, the game\'s text and other children kept', () => {
    const counters = v('div');
    const title = v('div');
    const root = v('section', ['Animals', title, [counters, null], v('footer')]);
    const line = v('div');
    assert.equal(insertAfterVNode(root, counters, line), true);
    assert.deepEqual(root.children[2], [counters, line, null]);
    assert.equal(root.children[0], 'Animals');
    assert.equal(insertAfterVNode(root, v('div'), line), false, 'no row: nothing added');
});
