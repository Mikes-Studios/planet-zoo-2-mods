// Park launcher (hudlauncher.js): the three round buttons docked above the
// game's tools column. Checks: placed right above .ToolsBar_root and clear of
// the alert column, the autosave badge from Lua's state, the autosave card
// (interval choice and Save now reach Lua, Esc closes), one click opens and a
// second closes the Species board, and the launcher hides with the column.
import { dockButton } from './dock.mjs';
const STATE = { minutes: 5, minMinutes: 2, available: true, inPark: true, armed: true, pending: false, elapsed: 130, retryIn: 0, sinceSave: 130, lastKind: 'mod', lastError: '' };

export async function hud(page, ctx) {
    const facts = {};
    const problems = [];
    try {
        // the normal park view: no management screen (ManagementSectionID.None)
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 0));
        await page.waitForTimeout(800);
        await page.evaluate(state => {
            window.__as = [];
            if (!window.__asHooked) {
                window.__asHooked = true;
                engine.on('PZ2QoL_AutosaveSet', n => window.__as && window.__as.push(['set', n]));
                engine.on('PZ2QoL_AutosaveNow', () => window.__as && window.__as.push(['now']));
            }
            engine.trigger('PZ2QoL_AutosaveState', JSON.stringify(state));
        }, STATE);
        await page.waitForTimeout(600);
        facts.place = await page.evaluate(() => {
            const box = e => e ? (r => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }))(e.getBoundingClientRect()) : null;
            const d = document.querySelector('.PZ2QoL_dock');
            return {
                dock: box(d), shown: !!d && getComputedStyle(d).display !== 'none',
                tools: box(document.querySelector('.ToolsBar_root')),
                alerts: box(document.querySelector('.NotificationsModule_buttons')),
                buttons: document.querySelectorAll('.PZ2QoL_dockBtn:not(.displayNone)').length,
                badge: document.querySelector('.PZ2QoL_dockBadge')?.textContent,
            };
        });
        await ctx.shot(page, 'kl_1_launcher');
        const p = facts.place;
        if (!p.tools) {
            facts.note = 'tools column not rendered in this harness state; placement not checked';
        }
        else {
            if (!p.shown || !p.dock) problems.push('launcher not shown on the normal park view');
            else {
                if (Math.abs(p.dock.l - p.tools.l) > 2) problems.push(`launcher not aligned with the tools column: ${p.dock.l} vs ${p.tools.l}`);
                if (p.dock.b > p.tools.t || p.tools.t - p.dock.b > 12) problems.push(`launcher not right above the tools column: bottom ${p.dock.b}, column top ${p.tools.t}`);
                if (p.alerts && p.dock.t < p.alerts.b) problems.push(`launcher overlaps the alert buttons: top ${p.dock.t}, alerts end ${p.alerts.b}`);
                // Settings, Autosave, Species board, Breeding programme, and the Script profiler in a debug build
                if (p.buttons !== 5 && p.buttons !== 4) problems.push(`${p.buttons} launcher buttons`);
            }
        }
        if (p.badge !== '5m') problems.push(`autosave badge "${p.badge}"`);

        // autosave card
        await dockButton(page, 'Autosave').click();
        await page.waitForTimeout(300);
        facts.card = await page.evaluate(() => document.querySelector('.PZ2QoL_asCard')?.innerText || '');
        await ctx.shot(page, 'kl_2_autosave_card');
        if (!/Autosave every 5 min/.test(facts.card) || !/Next save in 2 min/.test(facts.card)) problems.push(`autosave card: "${facts.card}"`);
        await page.locator('.PZ2QoL_asCard .PZ2QoL_segItem', { hasText: '2 min' }).click();
        await page.locator('.PZ2QoL_asCard .PZ2QoL_asNow').click();
        await page.waitForTimeout(200);
        facts.sent = await page.evaluate(() => window.__as);
        if (JSON.stringify(facts.sent) !== JSON.stringify([['set', 2], ['now']])) problems.push(`card sent ${JSON.stringify(facts.sent)}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        if (await page.locator('.PZ2QoL_asCard').count()) problems.push('Esc did not close the autosave card');

        // one click: Species board, second click closes it
        const open = () => page.evaluate(async () => (await import('/js/mods/pz2qol/kinboard.js')).isSpeciesBoardOpen());
        await dockButton(page, 'Species board').click();
        await page.waitForTimeout(1200);
        facts.boardOpen = await open();
        await ctx.shot(page, 'kl_3_board');
        await dockButton(page, 'Species board').click({ force: true });
        await page.waitForTimeout(500);
        facts.boardAfterSecond = await open();
        if (!facts.boardOpen) problems.push('the launcher did not open the Species board');
        if (facts.boardAfterSecond) problems.push('a second click did not close the Species board');

        // hidden with the tools column (management screen, photo mode ...)
        if (p.tools) {
            await page.evaluate(() => document.querySelector('.ToolsBar_root').classList.add('hidden'));
            await page.waitForTimeout(400);
            facts.hiddenWithTools = await page.evaluate(() => getComputedStyle(document.querySelector('.PZ2QoL_dock')).display);
            await page.evaluate(() => document.querySelector('.ToolsBar_root').classList.remove('hidden'));
            if (facts.hiddenWithTools !== 'none') problems.push('the launcher stays when the tools column hides');
        }
    }
    finally {
        await page.evaluate(async () => {
            window.__as = null;
            (await import('/js/mods/pz2qol/kinboard.js')).closeSpeciesBoard();
        }).catch(() => {});
    }
    facts.problems = problems;
    if (problems.length) throw new Error('park launcher: ' + problems.join('; '));
    return facts;
}
