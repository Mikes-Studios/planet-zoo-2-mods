import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages();
const { CPU_STEPS, estimateSeconds } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogdeep.js');

test('the Deep estimate follows the effort and the CPU use, measured or not', () => {
    const settings = effort => ({ starts: 4, effort, limitMin: 0 });
    // a start measured at effort 1 and full CPU took a second
    assert.equal(estimateSeconds(50, settings(1), 1000, CPU_STEPS.full), 4);
    assert.equal(estimateSeconds(50, settings(2), 1000, CPU_STEPS.full), 8);
    assert.equal(estimateSeconds(50, settings(1), 1000, CPU_STEPS.gentle), 16);
    assert.equal(estimateSeconds(50, settings(2), null, CPU_STEPS.full), 2 * estimateSeconds(50, settings(1), null, CPU_STEPS.full));
});
