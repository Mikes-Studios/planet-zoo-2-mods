import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { installHudLauncher } = await import('/js/mods/pz2qol/hudlauncher.js');

const box = (left, top, width, height, classes = []) => ({
    box: { left, top, width, height },
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

// what the HUD always has on the page (pz2-source Tooltip.js, HelperTooltip.js): the tooltip layer,
// the helper tooltip's full-screen frame, and a shared tooltip marked tooltipHidden
const alwaysOnPage = [
    box(0, 0, 1920, 1080, ['TooltipContainer']),
    box(0, 0, 1920, 1080, ['HelperTooltip_root']),
    box(40, 500, 300, 80, ['Tooltip_root', 'tooltipHidden']),
];

test('the dock steps aside while a game tooltip shows over it, and comes back after', async () => {
    const tools = box(0, 600, 60, 300);
    let tips = [];
    const pageQuery = document.querySelector;
    const pageQueryAll = document.querySelectorAll;
    document.querySelector = s => (s === '.ToolsBar_root' ? tools : null);
    document.querySelectorAll = s => {
        const wanted = s.split(',').map(sel => sel.trim().slice(1));
        return alwaysOnPage.concat(tips).filter(n => n.classes.some(c => wanted.includes(c)));
    };
    try {
        installHudLauncher();
        const dock = find(document.body, 'PZ2QoL_dock');
        assert.ok(dock, 'the dock is on the page');
        dock.box = { left: 0, top: 450, width: 60, height: 150 };
        await sleep(300);
        assert.equal(dock.classList.contains('PZ2QoL_yield'), false, 'what the HUD always has on the page does not hide it');
        tips = [box(40, 500, 300, 80, ['Tooltip_root'])];
        await sleep(300);
        assert.equal(dock.classList.contains('PZ2QoL_yield'), true, 'a tooltip over the dock hides it');
        tips = [box(40, 500, 300, 80, ['HelperTooltip_tooltipContainer'])];
        await sleep(300);
        assert.equal(dock.classList.contains('PZ2QoL_yield'), true, 'a helper tooltip over the dock hides it');
        tips = [box(400, 100, 300, 80, ['Tooltip_root'])];
        await sleep(300);
        assert.equal(dock.classList.contains('PZ2QoL_yield'), false, 'a tooltip elsewhere does not');
    }
    finally {
        document.querySelector = pageQuery;
        document.querySelectorAll = pageQueryAll;
    }
});
