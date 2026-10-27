import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';
import { installFakeDocument } from './fakedom.js';

loadPages({ stubs: ['kinhooks.js'] });
const doc = installFakeDocument();
const { rangeSlider } = await import('/js/mods/pz2qol/rangeslider.js');

// a 0..100 slider 100 px wide: x is the value
function drag(start, pressX, moveX) {
    let range = start;
    const slider = rangeSlider({ bounds: () => [0, 100], get: () => range, set: (lo, hi) => { range = [lo, hi]; } });
    const track = slider.childNodes[0];
    track.box.width = 100;
    track.fire('mousedown', { clientX: pressX });
    doc.fire('mousemove', { clientX: moveX });
    doc.fire('mouseup');
    return range;
}

test('both knobs on one value drag apart either way', () => {
    assert.deepEqual(drag([100, 100], 100, 50), [50, 100]);
    assert.deepEqual(drag([0, 0], 0, 50), [0, 50]);
    assert.deepEqual(drag([40, 40], 40, 20), [20, 40]);
    assert.deepEqual(drag([40, 40], 40, 70), [40, 70]);
});

test('a press takes the nearer knob, or the side pressed', () => {
    assert.deepEqual(drag([20, 80], 30, 10), [10, 80]);
    assert.deepEqual(drag([20, 80], 70, 90), [20, 90]);
    assert.deepEqual(drag([40, 40], 10, 10), [10, 40]);
});
