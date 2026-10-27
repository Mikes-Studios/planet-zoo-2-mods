// Browser-harness scenario: the Breeding window (breedwin.js), the small
// Breeding programme window in the game's info panel spot.
// Uses the programme scenario's gazelles and Lua fakes. Walks: a game info
// panel shows a gazelle -> the launcher's Breeding programme button opens
// the window on the gazelle's habitat and closes the game's panel ->
// placement (top right, info panel size) -> Gazelle goes there, then its
// plan -> Habitats: pick in the park (a habitat's own panel, then an
// animal's panel) sets habitats aside and closes the game's panel each time;
// a non-habitat click is refused; Esc stops picking -> remove one ->
// Programme: numbers, Run (one move at a time through the fake Lua) ->
// Auto mode tab -> the species picker and search -> a game info panel the
// player opens takes the window's place.
import { seedZooKin } from './kin_fixture.mjs';
import { seedProgramme } from './kin_programme.mjs';
import { dockButton } from './dock.mjs';

export const name = 'breeding window';

const BW = '/js/mods/pz2qol/breedwin.js';

async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

// the game's info panel, as Lua drives it: context, then show; our close
// request is answered with a hide (what Lua does)
async function fakeInfoPanel(page) {
    await page.evaluate(() => {
        window.__bwClose = 0;
        if (window.__bwHooked) return;
        window.__bwHooked = true;
        engine.on('InfoPanel_UI_Close', () => {
            window.__bwClose++;
            setTimeout(() => engine.trigger('InfoPanel_Hide'), 30);
        });
    });
}

// A park click: the game opens its info panel for this context.
// (Only the mod listens in the harness: the game's own panel gets no real
// context, so InfoPanel_SetContext is sent to the mod's listeners only.)
async function parkClick(page, kind, id) {
    await page.evaluate(([kind, id]) => {
        const ctx = ['InfoPanels', kind, id];
        for (const fn of (engine.events && engine.events.InfoPanel_SetContext) || []) {
            try {
                (fn.code || fn).call(fn.context || null, ctx);
            }
            catch (e) {
                // the game's own listener without a real context
            }
        }
        engine.trigger('InfoPanel_Show');
    }, [kind, id]);
    await page.waitForTimeout(500);
}

const assigned = page => page.evaluate(async () => {
    const m = await import('/js/mods/pz2qol/kinassign.js');
    const kin = await import('/js/mods/pz2qol/kin.js');
    const out = {};
    for (const [hab, set] of m.getAssignments(kin.getKinModel())) out[hab] = Array.from(set).sort();
    return out;
});

export async function hud(page, ctx) {
    const facts = ctx.facts || {};
    const problems = [];
    facts.problems = problems;
    const onAnimals = await page.evaluate(() => {
        const r = document.querySelector('.ManagementAnimals_root');
        return !!r && r.getBoundingClientRect().width > 0;
    });
    if (!onAnimals) {
        await page.evaluate(() => engine.trigger('World_ShowHUD'));
        await page.waitForTimeout(800);
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 7 /* ManagementSectionID.Animals */));
        await page.waitForSelector('.ManagementAnimals_root', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(1200);
    }
    await seedZooKin(page);
    await seedProgramme(page);
    // the normal park view (the launcher shows with the tools column)
    await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 0));
    await page.waitForTimeout(800);
    await fakeInfoPanel(page);
    const win = page.locator('.PZ2QoL_bw');
    try {
        // 1. a gazelle's info panel is open; the launcher's Breeding button
        await parkClick(page, 'animalInfoPanel', '7001');
        const btnCount = await page.locator('.PZ2QoL_dockBtn').count();
        if (btnCount < 3) problems.push(`${btnCount} launcher buttons`);
        if (await page.locator('.PZ2QoL_dock').isVisible()) await click(dockButton(page, 'Breeding programme'));
        else await page.evaluate(async url => (await import(url)).openBreedingWindow({}), BW);
        await page.waitForSelector('.PZ2QoL_bw:not(.hidden)', { timeout: 4000 });
        await page.waitForTimeout(600);
        facts.open = await page.evaluate(() => {
            const n = document.querySelector('.PZ2QoL_bw');
            const r = n.getBoundingClientRect();
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            return {
                right: Math.round(window.innerWidth - r.right), top: Math.round(r.top / rem * 100) / 100, width: Math.round(r.width / rem * 100) / 100,
                bottom: Math.round((window.innerHeight - r.bottom) / rem * 100) / 100,
                title: document.querySelector('.PZ2QoL_bwSpeciesName')?.textContent, closes: window.__bwClose,
                gazelle: document.querySelector('.PZ2QoL_bwHab[data-species="Gazelle"]')?.className,
            };
        });
        await ctx.shot(page, 'bw_1_open');
        const o = facts.open;
        if (!/Gazelle Plains/.test(o.title || '')) problems.push(`opened on "${o.title}", not the info panel's gazelle's habitat`);
        if (!/living/.test(o.gazelle || '')) problems.push(`Gazelle not offered as living there: "${o.gazelle}"`);
        if (o.closes < 1) problems.push('the game\'s info panel was not closed when the window opened');
        if (Math.abs(o.right) > 1) problems.push(`not flush with the right edge (${o.right}px)`);
        if (Math.abs(o.top - 8.33) > 0.2 || Math.abs(o.width - 26.11) > 0.2 || Math.abs(o.bottom - 7.22) > 0.2) problems.push(`not in the info panel's place: ${JSON.stringify(o)}`);

        // 1b. Gazelle goes there, then its plan
        await click(page.locator('.PZ2QoL_bwHab[data-species="Gazelle"] .PZ2QoL_bwIconBtn.add'));
        await page.waitForTimeout(300);
        await click(page.locator('.PZ2QoL_bwHab[data-species="Gazelle"] .PZ2QoL_kpBtn', { hasText: 'Plan' }));
        await page.waitForTimeout(600);
        facts.plan = await page.evaluate(() => ({
            species: document.querySelector('.PZ2QoL_bwSpeciesName')?.textContent,
            tabs: [...document.querySelectorAll('.PZ2QoL_bwTab')].map(t => t.textContent),
        }));
        await ctx.shot(page, 'bw_1b_plan');
        if (!/Gazelle/.test(facts.plan.species || '') || /Plains/.test(facts.plan.species || '')) problems.push(`Plan opened "${facts.plan.species}", not Gazelle`);
        if (facts.plan.tabs.length !== 3) problems.push(`tabs: ${JSON.stringify(facts.plan.tabs)}`);

        // 2. Habitats: where they live, what the game allows
        await click(page.locator('.PZ2QoL_bwTab[data-tab="habitats"]'));
        await page.waitForTimeout(400);
        facts.habs = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_bwHab')].map(n => `${n.className.replace(/PZ2QoL_bwHab ?/, '')}:${n.getAttribute('data-hab')}`));
        await ctx.shot(page, 'bw_2_habitats');
        if (!facts.habs.includes('assigned:9010')) problems.push(`9010 (set aside in 1b) not listed as set aside: ${facts.habs}`);
        if (!facts.habs.includes('living:9011')) problems.push(`9011 not listed as "lives there now": ${facts.habs}`);
        if (!facts.habs.includes('suitable:9012')) problems.push(`9012 not suggested: ${facts.habs}`);

        // 3. pick in the park: a habitat's panel, an animal's panel, a guest
        await click(page.locator('.PZ2QoL_bwActions .PZ2QoL_kpBtn'));
        await page.waitForSelector('.PZ2QoL_bwPickBanner', { timeout: 2000 });
        await ctx.shot(page, 'bw_3_picking');
        const before = await page.evaluate(() => window.__bwClose);
        await parkClick(page, 'habitatGateInfoPanel', '9012');
        await parkClick(page, 'animalInfoPanel', '7006');
        await parkClick(page, 'guestInfoPanel', '123');
        facts.pickCloses = await page.evaluate(() => window.__bwClose) - before;
        facts.afterPick = await assigned(page);
        facts.pickNotice = await page.locator('.PZ2QoL_bwNotice').innerText().catch(() => '');
        facts.stillOpen = await win.isVisible();
        await ctx.shot(page, 'bw_4_picked');
        if (!(facts.afterPick['9012'] || []).includes('Gazelle')) problems.push(`habitat click did not set 9012 aside: ${JSON.stringify(facts.afterPick)}`);
        if (!(facts.afterPick['9011'] || []).includes('Gazelle')) problems.push(`animal click did not set its habitat (9011) aside: ${JSON.stringify(facts.afterPick)}`);
        if (facts.pickCloses < 3) problems.push(`the game's panel was closed ${facts.pickCloses} times for 3 clicks`);
        if (!facts.stillOpen) problems.push('the window closed while picking');
        if (!/not a habitat/i.test(facts.pickNotice)) problems.push(`no refusal for a guest click: "${facts.pickNotice}"`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        if (await page.locator('.PZ2QoL_bwPickBanner').count()) problems.push('Esc did not stop picking');
        if (!await win.isVisible()) problems.push('Esc while picking closed the window');

        // 4. remove one
        await click(page.locator('.PZ2QoL_bwHab.assigned[data-hab="9011"] .PZ2QoL_bwIconBtn.remove'));
        await page.waitForTimeout(300);
        facts.afterRemove = await assigned(page);
        if ((facts.afterRemove['9011'] || []).includes('Gazelle')) problems.push('× did not remove 9011');

        // 5. Programme: numbers and Run
        await click(page.locator('.PZ2QoL_bwTab[data-tab="programme"]'));
        await page.waitForSelector('.PZ2QoL_bwStats', { timeout: 12000 });
        await page.waitForFunction(() => !document.querySelector('.PZ2QoL_bwBusy'), null, { timeout: 12000 });
        await page.waitForTimeout(300);
        facts.prog = await page.evaluate(() => ({
            moves: +document.querySelector('.PZ2QoL_bwStats').getAttribute('data-moves'),
            rows: document.querySelectorAll('.PZ2QoL_bwMove').length,
            run: document.querySelector('.PZ2QoL_bwFoot')?.innerText,
            stats: [...document.querySelectorAll('.PZ2QoL_bwStat')].map(n => n.innerText.replace(/\s+/g, ' ')),
        }));
        await ctx.shot(page, 'bw_5_programme');
        if (!(facts.prog.moves >= 1) || facts.prog.rows < 1) problems.push(`programme: ${JSON.stringify(facts.prog)}`);
        if (!/Run \d+ move/.test(facts.prog.run || '')) problems.push(`run button: "${facts.prog.run}"`);
        await page.evaluate(() => { window.__kpg.moves = []; });
        await click(page.locator('.PZ2QoL_bwFoot .PZ2QoL_kpBtn'));
        await page.waitForTimeout(400);
        await ctx.shot(page, 'bw_6_running');
        await page.waitForFunction(() => !(window.__kpgMoves && window.__kpgMoves.getPlanRun().running), null, { timeout: 30000 });
        facts.ran = await page.evaluate(() => ({ moves: window.__kpg.moves.length, overlap: window.__kpg.overlap, owner: window.__kpgMoves.getPlanRun().owner }));
        await page.waitForTimeout(300);
        await ctx.shot(page, 'bw_7_ran');
        if (!facts.ran.moves) problems.push('Run sent no moves');
        if (facts.ran.overlap) problems.push('Run sent a move before the last one was confirmed');
        if (facts.ran.owner !== 'window') problems.push(`run owner ${facts.ran.owner}`);

        // 5b. More options: every option, a change re-plans and is kept, Deep, Reset
        await click(page.locator('.PZ2QoL_bwMore'));
        await page.waitForSelector('.PZ2QoL_bwOptions', { timeout: 3000 });
        await page.waitForTimeout(300);
        facts.options = await page.evaluate(() => ({
            sections: [...document.querySelectorAll('.PZ2QoL_bwOptions .PZ2QoL_bwSectionTitle')].map(n => n.textContent),
            rows: document.querySelectorAll('.PZ2QoL_bwOpt').length,
            spill: (() => {
                const r = document.querySelector('.PZ2QoL_bw').getBoundingClientRect();
                return [...document.querySelectorAll('.PZ2QoL_bwSegItem')].filter(b => { const x = b.getBoundingClientRect(); return x.width && x.right > r.right + 1; }).length;
            })(),
        }));
        await ctx.shot(page, 'bw_5b_options');
        for (const sname of ['Optimiser', 'This plan', 'Moves', 'Groups', 'Search']) if (!facts.options.sections.includes(sname)) problems.push(`options: no "${sname}" section (${facts.options.sections})`);
        if (facts.options.rows < 13) problems.push(`options: ${facts.options.rows} rows`);
        if (facts.options.spill) problems.push(`options: ${facts.options.spill} choices spill out of the window`);
        await click(page.locator('.PZ2QoL_bwSeg[data-structurePenalty] .PZ2QoL_bwSegItem[data-id="soft"], .PZ2QoL_bwSeg[data-structurepenalty] .PZ2QoL_bwSegItem[data-id="soft"]'));
        await page.waitForTimeout(300);
        facts.tune = await page.evaluate(async () => (await import('/js/mods/pz2qol/prefs.js')).getPref('progTune'));
        if (!facts.tune || facts.tune.structurePenalty !== 'soft') problems.push(`tuning not kept: ${JSON.stringify(facts.tune)}`);
        facts.toggleText = await page.locator('.PZ2QoL_bwMore').innerText();
        if (!/1 changed/.test(facts.toggleText)) problems.push(`toggle: "${facts.toggleText}"`);
        await click(page.locator('.PZ2QoL_bwSeg[data-engine] .PZ2QoL_bwSegItem[data-id="deep"]'));
        await page.waitForTimeout(300);
        facts.deepPresets = await page.locator('.PZ2QoL_bwSeg[data-preset] .PZ2QoL_bwSegItem').count();
        await click(page.locator('.PZ2QoL_bwSeg[data-preset] .PZ2QoL_bwSegItem[data-id="custom"]'));
        await page.waitForTimeout(300);
        facts.steppers = await page.locator('.PZ2QoL_bwStepper').count();
        await ctx.shot(page, 'bw_5c_options_deep');
        if (facts.deepPresets < 5) problems.push(`deep presets: ${facts.deepPresets}`);
        if (facts.steppers !== 5) problems.push(`custom deep steppers: ${facts.steppers}`);
        // back to the plan: re-planned with the tuning, Deep's line shown
        await click(page.locator('.PZ2QoL_bwOptions .PZ2QoL_kpBtn', { hasText: 'Done' }));
        await page.waitForSelector('.PZ2QoL_bwStats', { timeout: 12000 });
        await page.waitForTimeout(600);
        facts.deepLine = await page.locator('.PZ2QoL_bwDeep').innerText().catch(() => '');
        await ctx.shot(page, 'bw_5d_deep_line');
        if (!facts.deepLine) problems.push('no deep search line with the Deep optimiser');
        // reset: everything back, nothing kept
        await page.evaluate(async () => (await import('/js/mods/pz2qol/kinprogdeep.js')).stopDeep());
        await click(page.locator('.PZ2QoL_bwMore'));
        await page.waitForSelector('.PZ2QoL_bwOptions', { timeout: 3000 });
        await click(page.locator('.PZ2QoL_bwOptions .PZ2QoL_kpBtn', { hasText: 'Reset to defaults' }));
        await page.waitForTimeout(300);
        facts.afterReset = await page.evaluate(async () => {
            const prefs = await import('/js/mods/pz2qol/prefs.js');
            const deep = await import('/js/mods/pz2qol/kinprogdeep.js');
            return { tune: prefs.getPref('progTune') || null, engine: deep.getOptimiser().engine };
        });
        if (facts.afterReset.tune || facts.afterReset.engine !== 'classic') problems.push(`reset: ${JSON.stringify(facts.afterReset)}`);
        await click(page.locator('.PZ2QoL_bwOptions .PZ2QoL_kpBtn', { hasText: 'Done' }));
        await page.waitForSelector('.PZ2QoL_bwStats', { timeout: 12000 });
        await page.waitForFunction(() => !document.querySelector('.PZ2QoL_bwBusy'), null, { timeout: 12000 });

        // 6. Auto mode tab
        await click(page.locator('.PZ2QoL_bwTab[data-tab="auto"]'));
        await page.waitForSelector('.PZ2QoL_bw .PZ2QoL_kbAuto', { timeout: 5000 });
        await page.waitForTimeout(300);
        facts.auto = await page.evaluate(() => ({
            text: document.querySelector('.PZ2QoL_bw .PZ2QoL_kbAuto')?.innerText.slice(0, 200),
            closeBtn: [...document.querySelectorAll('.PZ2QoL_bw .PZ2QoL_kbAuto .PZ2QoL_kbProgHead .PZ2QoL_kpBtn')].some(b => b.textContent === 'Close'),
            overflow: (() => {
                const r = document.querySelector('.PZ2QoL_bw').getBoundingClientRect();
                return [...document.querySelectorAll('.PZ2QoL_bw .PZ2QoL_kbAuto .PZ2QoL_kpBtn')].filter(b => { const x = b.getBoundingClientRect(); return x.width && x.right > r.right + 1; }).length;
            })(),
        }));
        await ctx.shot(page, 'bw_8_auto');
        if (!/Auto mode/.test(facts.auto.text || '')) problems.push('no Auto mode panel');
        if (facts.auto.closeBtn) problems.push('the Auto panel shows the board\'s Close button');
        if (facts.auto.overflow) problems.push(`${facts.auto.overflow} Auto buttons spill out of the window`);

        // 7. the species picker and search
        await click(page.locator('.PZ2QoL_bwSpecies'));
        await page.waitForSelector('.PZ2QoL_bwPick', { timeout: 3000 });
        facts.picker = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_bwPick')].map(n => n.getAttribute('data-species')));
        await ctx.shot(page, 'bw_9_picker');
        await page.locator('.PZ2QoL_bwSearch').fill('lio');
        await page.waitForTimeout(500);
        facts.search = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_bwPick')].map(n => n.getAttribute('data-species')));
        await ctx.shot(page, 'bw_10_search');
        if (!facts.picker.includes('Gazelle') || !facts.picker.includes('Lion')) problems.push(`picker: ${facts.picker}`);
        // every species the game knows is searched: the zoo's own Lion first
        if (facts.search[0] !== 'Lion' || !facts.search.every(sp => /lio/i.test(sp))) problems.push(`search "lio": ${facts.search}`);
        await click(page.locator('.PZ2QoL_bwPick[data-species="Lion"]'));
        await page.waitForTimeout(400);
        facts.lion = await page.locator('.PZ2QoL_bwSpeciesName').innerText();
        if (!/Lion/.test(facts.lion)) problems.push(`picked Lion, shows "${facts.lion}"`);

        // 8. the player opens a game info panel: it takes the window's place
        await parkClick(page, 'animalInfoPanel', '7001');
        await page.waitForTimeout(400);
        facts.yielded = !(await page.evaluate(async url => (await import(url)).isBreedingWindowOpen(), BW));
        if (!facts.yielded) problems.push('the window stayed open when the game opened an info panel');
    }
    finally {
        await page.evaluate(async url => {
            (await import(url)).closeBreedingWindow();
            const m = await import('/js/mods/pz2qol/kinassign.js');
            const kin = await import('/js/mods/pz2qol/kin.js');
            const model = kin.getKinModel();
            for (const [hab, set] of m.getAssignments(model)) if (set.has('Gazelle')) m.toggleAssignment(model, hab, 'Gazelle');
            if (window.__kpg) window.__kpg.active = false;
            (await import('/js/mods/pz2qol/prefs.js')).setPref('progTune', undefined);
            const deep = await import('/js/mods/pz2qol/kinprogdeep.js');
            deep.stopDeep();
            deep.setOptimiser({ engine: 'classic', preset: 'standard' });
        }, BW).catch(() => {});
    }
    if (problems.length) throw new Error('breeding window: ' + problems.join('; '));
    return facts;
}
