import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { installBars } = await import('/js/mods/pz2qol/bars.js');

const box = (left, top, width, height, classes = []) => ({
    classes,
    className: classes.join(' '),
    classList: { contains: c => classes.includes(c) },
    parentNode: null,
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
});

function find(node, cls) {
    if (node.classList && node.classList.contains(cls)) return node;
    for (const child of node.childNodes || []) {
        const hit = find(child, cls);
        if (hit) return hit;
    }
    return null;
}

// the game's search suggestions (pz2-source InputField.js) open under the storage header, where our toolbar sits
test('the storage toolbar steps aside while the game search suggestions show over it', async () => {
    const header = box(0, 0, 1200, 100, ['AnimalMarketStorage_header']);
    let menus = [];
    const pageQuery = document.querySelector;
    const pageQueryAll = document.querySelectorAll;
    document.querySelector = s => (s === '.AnimalMarketStorage_header' ? header : null);
    document.querySelectorAll = s => {
        const wanted = s.split(',').map(sel => sel.trim().slice(1));
        return menus.filter(n => n.classes.some(c => wanted.includes(c)));
    };
    try {
        installBars();
        await sleep(300);
        const bar = find(document.body, 'storage');
        assert.ok(bar, 'the storage toolbar is on the page');
        bar.box = { left: 8, top: 106, width: 1184, height: 90 };
        await sleep(300);
        assert.equal(bar.classList.contains('PZ2QoL_yield'), false);
        menus = [box(100, 60, 400, 200, ['Container_root', 'InputField_resultsMenu'])];
        await sleep(300);
        assert.equal(bar.classList.contains('PZ2QoL_yield'), true, 'the suggestions over the toolbar hide it');
        menus = [];
        await sleep(300);
        assert.equal(bar.classList.contains('PZ2QoL_yield'), false, 'it comes back when they close');
    }
    finally {
        document.querySelector = pageQuery;
        document.querySelectorAll = pageQueryAll;
    }
});
