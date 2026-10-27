// Script profiler panel (profiler.js) on the park HUD page: the dock button
// opens it, Start/Stop reach Lua (PZ2QoL_ProfStart with the options, Stop),
// a Lua report (PZ2QoL_ProfData) fills the tiles, the frame strip and the
// table, a column head sorts, a group pill filters, Log snapshot asks Lua and
// shows the lines, Compact folds it, closing stops profiling. The page's own
// JS hooks time a handler while running.
import { dockButton } from './dock.mjs';
export const name = 'profiler';

function luaReport(on) {
    const rows = [
        ['Managers.AnimalManager:Advance', 'manager', 2.1, 3.4, 1, 3.4, 5.2, 6.0],
        ['Phase Advance: DarwinEnvironment', 'world', 0.2, 6.8, 1, 6.8, 9.5, 9.9],
        ['Components.UI.AnimalInfoPopup:Advance', 'ui', 1.3, 1.3, 1, 1.3, 2.2, 2.2],
        ['Editors.Select.SelectMode:Advance', 'mode', 0.6, 1.9, 1, 1.9, 2.5, 2.6],
        ['PZ2QoL.Kin:_StepScan', 'mod', 0.9, 0.9, 1, 0.9, 4.1, 4.1],
        ['PZ2QoL.Kin:_Tick', 'mod', 0.05, 0.95, 1, 0.95, 4.2, 4.2],
        ['Managers.GuestManager:Advance', 'manager', 0.4, 0.4, 1, 0.4, 0.6, 0.7],
        ['Components.Cameras.CameraModeManager:Advance', 'component', 0.25, 0.25, 1, 0.25, 0.5, 0.5],
        ['Managers.HeatMapManager:Advance', 'manager', 0.1, 1.05, 1, 1.05, 4.3, 4.3],
        ['StartScreen.Globe.GlobeMode:Advance', 'hub', 0.02, 0.02, 0.2, 0.1, 0.1, 0.1],
    ].map(([n, g, s, t, c, a, m, x]) => ({ n, g, s, t, c, a, m, x, k: Math.round(c * 120) }));
    const wall = [], lua = [];
    for (let i = 0; i < 120; i++) {
        const spike = i % 37 === 0;
        wall.push(spike ? 61.2 : 24 + (i % 5));
        lua.push(spike ? 14.1 : 5 + (i % 3) * 0.5);
    }
    return JSON.stringify({
        on, frames: 120, wallAvg: 26.4, wallMax: 61.2, luaAvg: 5.8, luaMax: 14.1, rows, active: 412,
        selfSum: 5.8, callsPerFrame: 840, groups: { manager: 2.6, world: 0.2, ui: 1.3, mode: 0.6, mod: 0.95, component: 0.25, hub: 0.02 },
        strip: { wall, lua }, deep: false, sampler: false, window: 120,
        caps: { debug: true, sethook: true, getinfo: true, gc: true, timer: 'diff', timerType: 'integer' },
        hooked: 1342, unhooked: 1, overheadUs: 0.85, envs: 3, heapKB: 183000, heapRate: 420, leaks: 0, note: '',
        samples: { total: 5000, rows: [{ n: 'managers.animalmanager.lua:120', k: 1200, p: 24 }, { n: 'pz2qol.kin.lua:880', k: 400, p: 8 }] },
    });
}

export async function hud(page, ctx) {
    const facts = {};
    const problems = [];
    try {
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 0));
        await page.waitForTimeout(600);
        await page.evaluate(() => {
            window.__pf = [];
            if (!window.__pfHooked) {
                window.__pfHooked = true;
                for (const n of ['PZ2QoL_ProfStart', 'PZ2QoL_ProfStop', 'PZ2QoL_ProfSnapshot', 'PZ2QoL_ProfReset', 'PZ2QoL_ProfHello']) {
                    engine.on(n, (...a) => window.__pf && window.__pf.push([n, ...a]));
                }
            }
        });
        // the dock's Script profiler button opens it (when the dock has room for it)
        const button = dockButton(page, 'Script profiler');
        facts.dockButtons = await page.locator('.PZ2QoL_dockBtn:not(.displayNone)').count();
        if (await button.isVisible()) await button.click();
        else await page.evaluate(() => window.PZ2QoL_profiler.open());
        await page.waitForTimeout(400);
        facts.open = await page.evaluate(() => !!document.querySelector('.PZ2QoL_pf:not(.hidden)'));
        if (!facts.open) problems.push('panel did not open');
        await ctx.shot(page, 'pf_1_open_off');
        facts.hello = await page.evaluate(() => window.__pf.some(e => e[0] === 'PZ2QoL_ProfHello'));
        if (!facts.hello) problems.push('no PZ2QoL_ProfHello on open');

        // Start: options reach Lua
        await page.locator('.PZ2QoL_pf .PZ2QoL_kpBtn.primary').click();
        await page.waitForTimeout(200);
        facts.start = await page.evaluate(() => window.__pf.find(e => e[0] === 'PZ2QoL_ProfStart'));
        if (!facts.start || !/"window":120/.test(facts.start[1] || '')) problems.push(`start sent ${JSON.stringify(facts.start)}`);

        // the page's own hooks time a handler registered after page start
        await page.evaluate(() => {
            engine.on('PZ2QoL_TestBusy', () => { const t = performance.now(); while (performance.now() - t < 3) { /* busy */ } });
            for (let i = 0; i < 5; i++) engine.trigger('PZ2QoL_TestBusy');
        });

        // a Lua report
        await page.evaluate(json => engine.trigger('PZ2QoL_ProfData', json), luaReport(true));
        await page.waitForTimeout(300);
        // again just before the read (the JS window is 120 page frames)
        await page.evaluate(() => { for (let i = 0; i < 5; i++) engine.trigger('PZ2QoL_TestBusy'); });
        await page.waitForTimeout(600);
        facts.tiles = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfTile')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
        facts.rows = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfRow:not(.head):not(.hidden) .PZ2QoL_pfName')].map(n => n.textContent));
        facts.status = await page.evaluate(() => document.querySelector('.PZ2QoL_pfStatus').textContent);
        facts.foot = await page.evaluate(() => document.querySelector('.PZ2QoL_pfFoot').textContent);
        facts.bars = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfBar')].filter(b => parseFloat(b.style.height) > 0).length);
        await ctx.shot(page, 'pf_2_running');
        if (!/26\.4 ms/.test(facts.tiles[0] || '') || !/38 fps/.test(facts.tiles[0] || '')) problems.push(`frame tile "${facts.tiles[0]}"`);
        if (!/5\.80 ms/.test(facts.tiles[1] || '') || !/22% of the frame/.test(facts.tiles[1] || '')) problems.push(`Lua tile "${facts.tiles[1]}"`);
        if (!/native engine/.test(facts.tiles[3] || '')) problems.push(`rest tile "${facts.tiles[3]}"`);
        if (facts.rows[0] !== 'Managers.AnimalManager:Advance') problems.push(`first row by self "${facts.rows[0]}"`);
        if (!facts.rows.some(r => /^on PZ2QoL_TestBusy/.test(r))) problems.push('the page JS handler is not in the table: ' + facts.rows.join(' | '));
        if (facts.bars < 100) problems.push(`${facts.bars} frame bars`);
        if (!/Running/.test(facts.status)) problems.push(`status "${facts.status}"`);
        if (!/0\.85 µs a timed call/.test(facts.foot)) problems.push(`footer "${facts.foot}"`);

        // sort by Total (click its head): the phase total leads
        await page.locator('.PZ2QoL_pfRow.head .PZ2QoL_pfCell', { hasText: 'Total ms' }).click();
        await page.waitForTimeout(200);
        facts.byTotal = await page.evaluate(() => document.querySelector('.PZ2QoL_pfRow:not(.head):not(.hidden) .PZ2QoL_pfName').textContent);
        if (facts.byTotal !== 'Phase Advance: DarwinEnvironment') problems.push(`sort by total: "${facts.byTotal}"`);
        // group pill: PZ2QoL (Lua) only
        await page.locator('.PZ2QoL_pfGroup', { hasText: 'PZ2QoL (Lua)' }).click();
        await page.waitForTimeout(200);
        facts.modRows = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfRow:not(.head):not(.hidden) .PZ2QoL_pfName')].map(n => n.textContent));
        await ctx.shot(page, 'pf_3_group_mod');
        if (facts.modRows.length !== 2 || !facts.modRows.every(r => /^PZ2QoL\.Kin/.test(r))) problems.push(`mod group rows ${JSON.stringify(facts.modRows)}`);
        // sampler tab
        await page.locator('.PZ2QoL_pfChip', { hasText: 'Sampler' }).click();
        await page.waitForTimeout(200);
        facts.samples = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfRow:not(.head):not(.hidden) .PZ2QoL_pfName')].map(n => n.textContent));
        if (facts.samples[0] !== 'managers.animalmanager.lua:120') problems.push(`sampler rows ${JSON.stringify(facts.samples)}`);
        await page.locator('.PZ2QoL_pfChip', { hasText: 'All' }).click();

        // snapshot
        await page.locator('.PZ2QoL_pf .PZ2QoL_kpBtn', { hasText: 'Log snapshot' }).click();
        await page.waitForTimeout(300);
        facts.snapSent = await page.evaluate(() => window.__pf.some(e => e[0] === 'PZ2QoL_ProfSnapshot'));
        facts.snap = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_pfSnapLine')].map(n => n.textContent));
        await ctx.shot(page, 'pf_4_snapshot');
        if (!facts.snapSent) problems.push('snapshot not asked of Lua');
        if (facts.snap.length < 5 || !/^frame 26\.4 ms/.test(facts.snap[0] || '')) problems.push(`snapshot lines ${JSON.stringify(facts.snap.slice(0, 2))}`);

        // compact
        await page.locator('.PZ2QoL_pf .PZ2QoL_kpBtn', { hasText: 'Compact' }).click();
        await page.waitForTimeout(250);
        facts.compactH = await page.evaluate(() => Math.round(document.querySelector('.PZ2QoL_pf').getBoundingClientRect().height));
        await ctx.shot(page, 'pf_5_compact');
        if (facts.compactH > 330) problems.push(`compact panel ${facts.compactH}px high`);
        await page.locator('.PZ2QoL_pf .PZ2QoL_kpBtn', { hasText: 'Compact' }).click();

        // layout: inside the view, nothing spills
        facts.box = await page.evaluate(() => {
            const r = document.querySelector('.PZ2QoL_pf').getBoundingClientRect();
            return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
        });
        if (facts.box.l < 0 || facts.box.r > facts.box.vw || facts.box.b > facts.box.vh) problems.push(`panel outside the view ${JSON.stringify(facts.box)}`);

        // close: stops profiling
        await page.locator('.PZ2QoL_pf .PZ2QoL_kpClose').click();
        await page.waitForTimeout(200);
        facts.stopSent = await page.evaluate(() => window.__pf.some(e => e[0] === 'PZ2QoL_ProfStop'));
        facts.closed = await page.evaluate(() => !document.querySelector('.PZ2QoL_pf:not(.hidden)'));
        if (!facts.stopSent) problems.push('closing did not stop profiling');
        if (!facts.closed) problems.push('panel still open');
    }
    finally {
        await page.evaluate(() => {
            window.__pf = null;
            if (window.PZ2QoL_profiler) window.PZ2QoL_profiler.close();
        }).catch(() => {});
    }
    facts.problems = problems;
    if (problems.length) throw new Error('script profiler: ' + problems.join('; '));
    return facts;
}
