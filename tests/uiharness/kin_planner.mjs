// Browser-harness scenario: the Kin planner (kinplanner.js).
// Runs on the in-park HUD page. Plants related families (kin_fixture.mjs),
// opens the planner, walks overview -> habitat matrix -> a risk square ->
// an animal's mate list, checks one-click actions, the open options, the
// empty states, that nothing leaves the 1920x1080 view, and Esc.
import { seedZooKin } from './kin_fixture.mjs';

export const name = 'planner';

const PLANNER = '/js/mods/pz2qol/kinplanner.js';

// A real click when possible; a DOM click when something else covers it
// (a toast from another feature, say).
async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

const open = (page, opts) => page.evaluate(async ([url, o]) => (await import(url)).openKinPlanner(o), [PLANNER, opts]);
const isOpen = page => page.evaluate(async url => (await import(url)).isKinPlannerOpen(), PLANNER);
const text = (page, sel) => page.evaluate(s => {
    const n = document.querySelector(s);
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '';
}, sel);

// Every element of the planner, clipped by its overflow:hidden ancestors,
// must lie inside the viewport; header items and the three columns must
// not overlap; matrix headers must line up with the squares.
export const layoutFacts = page => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const out = { outside: [], overlaps: [], textOverflow: [], misaligned: [] };
    const roots = [...document.querySelectorAll('.PZ2QoL_kp, .PZ2QoL_kpMini')].filter(r => r.getBoundingClientRect().width > 0);
    const clipped = el => {
        const r = el.getBoundingClientRect();
        let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                const q = n.getBoundingClientRect();
                x0 = Math.max(x0, q.left);
                y0 = Math.max(y0, q.top);
                x1 = Math.min(x1, q.right);
                y1 = Math.min(y1, q.bottom);
            }
        }
        return { x0, y0, x1, y1 };
    };
    for (const root of roots) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const c = clipped(el);
            if (c.x1 <= c.x0 || c.y1 <= c.y0) continue;
            if (c.x0 < -0.5 || c.y0 < -0.5 || c.x1 > vw + 0.5 || c.y1 > vh + 0.5) {
                out.outside.push(`${el.className} [${Math.round(c.x0)},${Math.round(c.y0)}..${Math.round(c.x1)},${Math.round(c.y1)}]`);
            }
        }
    }
    const rect = el => el.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const groups = [
        [...document.querySelectorAll('.PZ2QoL_kpHead > *')].filter(e => !e.classList.contains('PZ2QoL_kpFlex')),
        [...document.querySelectorAll('.PZ2QoL_kpBody > *')],
        [...document.querySelectorAll('.PZ2QoL_kpFoot > *')].filter(e => !e.classList.contains('PZ2QoL_kpFlex')),
        [...document.querySelectorAll('.PZ2QoL_kpMainHead > *')].filter(e => !e.classList.contains('PZ2QoL_kpFlex')),
    ];
    for (const g of groups) {
        for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
                if (rect(g[i]).width && rect(g[j]).width && hit(rect(g[i]), rect(g[j]))) out.overlaps.push(`${g[i].className} x ${g[j].className}`);
            }
        }
    }
    for (const el of document.querySelectorAll('.PZ2QoL_kpBtn, .PZ2QoL_kpTitle, .PZ2QoL_kpAct, .PZ2QoL_kpTab, .PZ2QoL_kinTag')) {
        if (el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1) out.textOverflow.push(`${el.className}: ${el.innerText.trim().slice(0, 40)}`);
    }
    const col = document.querySelector('.PZ2QoL_kpColHead');
    const row = document.querySelector('.PZ2QoL_kpRowHead');
    const cell = document.querySelector('.PZ2QoL_kpCell');
    if (col && row && cell) {
        const c = rect(col), r = rect(row), q = rect(cell);
        if (Math.abs(c.left - q.left) > 1 || Math.abs(c.width - q.width) > 1) out.misaligned.push(`column head ${c.left}/${c.width} vs square ${q.left}/${q.width}`);
        if (Math.abs(r.top - q.top) > 1 || Math.abs(r.height - q.height) > 1) out.misaligned.push(`row head ${r.top}/${r.height} vs square ${q.top}/${q.height}`);
    }
    const root = document.querySelector('.PZ2QoL_kp');
    out.panel = root ? (({ left, top, width, height }) => ({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }))(rect(root)) : null;
    return out;
});

export function layoutProblems(tag, l, problems) {
    if (l.outside.length) problems.push(`${tag}: ${l.outside.length} element(s) outside the view, e.g. ${l.outside.slice(0, 3).join('; ')}`);
    if (l.overlaps.length) problems.push(`${tag}: overlapping ${l.overlaps.slice(0, 3).join('; ')}`);
    if (l.textOverflow.length) problems.push(`${tag}: text overflows ${l.textOverflow.slice(0, 3).join('; ')}`);
    if (l.misaligned.length) problems.push(`${tag}: matrix headers misaligned: ${l.misaligned.join('; ')}`);
}

export async function hud(page, ctx) {
    const facts = ctx.facts || {};
    const problems = [];
    facts.problems = problems;

    // The Animals screen fills the zoo rows the fixture uses.
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
    const seeded = await seedZooKin(page);
    facts.fixtureAnimals = seeded.layout.length;
    await page.evaluate(() => {
        window.__kpEvents = [];
        for (const n of ['PZ2QoL_KinContracept', 'PZ2QoL_KinLocate', 'PZ2QoL_KinLocatePlace', 'PZ2QoL_KinHeatmap', 'ShowHeatmap', 'PZ2QoL_KinScan']) {
            engine.on(n, (...a) => window.__kpEvents.push([n, ...a]));
        }
    });
    const events = () => page.evaluate(() => window.__kpEvents.slice());
    const clearEvents = () => page.evaluate(() => { window.__kpEvents.length = 0; });

    // 1. overview
    facts.opened = await open(page, {});
    await page.waitForSelector('.PZ2QoL_kp:not(.hidden)', { timeout: 3000 });
    await page.waitForTimeout(500);
    await ctx.shot(page, 'kp_1_overview');
    facts.summary = await text(page, '.PZ2QoL_kpSummary');
    facts.sidebar = await page.locator('.PZ2QoL_kpHab .PZ2QoL_kpHabName').allInnerTexts();
    facts.overviewRows = await page.locator('.PZ2QoL_kpPairRow').count();
    facts.overviewRisk = await page.locator('.PZ2QoL_kpPairRow.sev_risk').count();
    facts.firstGroupSev = await page.evaluate(() => {
        const g = document.querySelector('.PZ2QoL_kpGroup');
        return g ? [...g.classList].find(c => c.startsWith('sev_')) : null;
    });
    facts.layoutOverview = await layoutFacts(page);
    layoutProblems('overview', facts.layoutOverview, problems);
    if (!facts.opened) problems.push('openKinPlanner returned false');
    for (const n of ['Savannah Habitat', 'Jungle Habitat', 'Arctic Habitat']) {
        if (!facts.sidebar.some(t => t.includes(n))) problems.push(`sidebar is missing ${n}`);
    }
    if (!/inbreeding risk/.test(facts.summary)) problems.push(`header summary has no risks: "${facts.summary}"`);
    if (!(facts.overviewRisk >= 3)) problems.push(`overview shows ${facts.overviewRisk} risk pairs, expected at least one per habitat`);
    if (facts.firstGroupSev !== 'sev_risk') problems.push(`first overview group is ${facts.firstGroupSev}, not a risk`);

    // 2. one habitat's matrix
    await click(page.locator('.PZ2QoL_kpHab', { hasText: 'Savannah Habitat' }));
    await page.waitForSelector('.PZ2QoL_kpMatrix', { timeout: 3000 });
    await page.waitForTimeout(400);
    await ctx.shot(page, 'kp_2_matrix');
    facts.matrix = await page.evaluate(() => {
        const count = s => document.querySelectorAll(s).length;
        return {
            title: (document.querySelector('.PZ2QoL_kp .PZ2QoL_kpMainTitle') || {}).innerText,
            rows: count('.PZ2QoL_kpRowHead'),
            cols: count('.PZ2QoL_kpColHead'),
            cells: count('.PZ2QoL_kpCell'),
            risk: count('.PZ2QoL_kpCell.sev_risk'),
            kin: count('.PZ2QoL_kpCell.sev_kin'),
            future: count('.PZ2QoL_kpCell.sev_future'),
            covered: count('.PZ2QoL_kpCell.sev_covered'),
            mated: count('.PZ2QoL_kpCell.mated'),
            youngHeads: count('.PZ2QoL_kpColHead.juv, .PZ2QoL_kpRowHead.juv'),
            words: [...document.querySelectorAll('.PZ2QoL_kpCellWord')].map(n => n.innerText),
        };
    });
    facts.layoutMatrix = await layoutFacts(page);
    layoutProblems('matrix', facts.layoutMatrix, problems);
    const m = facts.matrix;
    if (!/Savannah/.test(m.title || '')) problems.push(`habitat view title "${m.title}"`);
    if (!(m.rows > 0 && m.cols > 0 && m.cells === m.rows * m.cols)) problems.push(`matrix ${m.rows}x${m.cols} has ${m.cells} squares`);
    if (!(m.risk >= 2)) problems.push(`only ${m.risk} risk squares (siblings and father/daughter expected)`);
    if (!(m.kin >= 1)) problems.push('no close-kin square (the cousin)');
    if (!(m.covered >= 1)) problems.push('no covered square (the contracepted half-sister)');
    if (!(m.future >= 1)) problems.push('no future square (the juvenile daughter)');
    if (!(m.mated >= 1)) problems.push('the mated siblings are not marked');
    if (!(m.youngHeads >= 1)) problems.push('the juvenile is not marked young');
    if (!m.words.some(w => /sister|daughter/.test(w))) problems.push(`no relation words in the squares: ${m.words.join(', ')}`);

    // Include young off hides the juvenile, on brings it back
    await click(page.locator('.PZ2QoL_kpMainTools .PZ2QoL_kpSwitch'));
    await page.waitForTimeout(250);
    facts.colsWithoutYoung = await page.locator('.PZ2QoL_kpColHead').count();
    await click(page.locator('.PZ2QoL_kpMainTools .PZ2QoL_kpSwitch'));
    await page.waitForTimeout(250);
    if (!(facts.colsWithoutYoung < m.cols)) problems.push(`"Include young" off still shows ${facts.colsWithoutYoung} columns`);

    // "Show in park": one camera event for the habitat (with a sample animal), the planner shrinks
    await clearEvents();
    await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMainHead .PZ2QoL_kpAct', { hasText: 'Show in park' }));
    await page.waitForTimeout(300);
    facts.showPlace = {
        events: (await events()).filter(e => e[0] === 'PZ2QoL_KinLocatePlace'),
        mini: await page.locator('.PZ2QoL_kpMini:not(.hidden)').count(),
        miniText: await page.locator('.PZ2QoL_kpMini:not(.hidden)').count() ? await text(page, '.PZ2QoL_kpMini') : '',
    };
    if (facts.showPlace.events.length !== 1 || facts.showPlace.events[0][1] !== '9000' || !facts.showPlace.events[0][2]) problems.push(`Show in park sent ${JSON.stringify(facts.showPlace.events)} (expected one PZ2QoL_KinLocatePlace for 9000 with a sample animal)`);
    if (facts.showPlace.mini !== 1 || !/Savannah/.test(facts.showPlace.miniText)) problems.push('planner did not shrink after Show in park: ' + JSON.stringify(facts.showPlace));
    await ctx.shot(page, 'kp_2b_show_in_park');
    if (facts.showPlace.mini) {
        await click(page.locator('.PZ2QoL_kpMini .PZ2QoL_kpBtn', { hasText: 'Back' }));
        await page.waitForTimeout(300);
    }

    // 3. a risk square -> details and one-click actions
    await click(page.locator('.PZ2QoL_kpCell.sev_risk'));
    await page.waitForSelector('.PZ2QoL_kpDet.pair', { timeout: 3000 });
    await page.waitForTimeout(300);
    await ctx.shot(page, 'kp_3_pair');
    facts.pairDetail = await text(page, '.PZ2QoL_kpDet.pair');
    facts.selectedSquares = await page.locator('.PZ2QoL_kpCell.on').count();
    if (!/sibling|father|daughter|mother|son|brother|sister/i.test(facts.pairDetail)) problems.push(`pair details do not name the relation: "${facts.pairDetail.slice(0, 160)}"`);
    if (!/inbred/i.test(facts.pairDetail)) problems.push('pair details do not say the game counts it as inbred');
    if (!/Fertility/.test(facts.pairDetail)) problems.push('pair details have no expected-young genes');
    if (facts.selectedSquares !== 1) problems.push(`${facts.selectedSquares} squares marked selected`);
    await clearEvents();
    await click(page.locator('.PZ2QoL_kpDet.pair .PZ2QoL_kpAct', { hasText: /^Contraception/ }));
    await page.waitForTimeout(250);
    // a second click while the first is pending must not send again
    await click(page.locator('.PZ2QoL_kpDet.pair .PZ2QoL_kpAct', { hasText: /contraception…/ }));
    await page.waitForTimeout(250);
    facts.contraEvents = (await events()).filter(e => e[0] === 'PZ2QoL_KinContracept');
    facts.contraPendingLabel = await page.locator('.PZ2QoL_kpDet.pair .PZ2QoL_kpAct.disabled').count();
    if (facts.contraEvents.length !== 1 || facts.contraEvents[0][2] !== true) problems.push(`contraception click sent ${JSON.stringify(facts.contraEvents)} (expected exactly one, on)`);
    if (facts.contraPendingLabel !== 1) problems.push('contraception button shows no pending state');

    // Locate shrinks the planner to its bar; Back restores it
    await clearEvents();
    await click(page.locator('.PZ2QoL_kpDet.pair .PZ2QoL_kpAct', { hasText: 'Locate' }));
    await page.waitForTimeout(300);
    facts.locateEvents = (await events()).filter(e => e[0] === 'PZ2QoL_KinLocate').length;
    facts.miniShown = await page.locator('.PZ2QoL_kpMini:not(.hidden)').count();
    await ctx.shot(page, 'kp_3b_located');
    facts.layoutMini = await layoutFacts(page);
    layoutProblems('minimised', facts.layoutMini, problems);
    // Esc does not close it while minimised (the game uses Esc there)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    facts.openAfterEscMini = await isOpen(page);
    await click(page.locator('.PZ2QoL_kpMini .PZ2QoL_kpBtn', { hasText: 'Back' }));
    await page.waitForTimeout(300);
    facts.restored = await page.locator('.PZ2QoL_kp:not(.hidden) .PZ2QoL_kpDet.pair').count();
    if (facts.locateEvents !== 1) problems.push(`Locate sent ${facts.locateEvents} events`);
    if (facts.miniShown !== 1) problems.push('planner did not shrink after Locate');
    if (!facts.openAfterEscMini) problems.push('Esc closed the minimised planner');
    if (facts.restored !== 1) problems.push('Back did not restore the planner with the same pair');

    // the heat map button sends the game's overlay toggle and shrinks the planner
    await clearEvents();
    await click(page.locator('.PZ2QoL_kpBtn', { hasText: 'Breeding heat map' }));
    await page.waitForTimeout(250);
    facts.heatMini = await text(page, '.PZ2QoL_kpMini');
    await click(page.locator('.PZ2QoL_kpMini .PZ2QoL_kpBtn', { hasText: 'Turn heat map off' }));
    await page.waitForTimeout(250);
    // on the HUD kin.js opens the game's own heat map panel (ShowHeatmap); elsewhere it asks Lua
    facts.heatEvents = (await events()).filter(e => e[0] === 'PZ2QoL_KinHeatmap' || e[0] === 'ShowHeatmap');
    facts.heatRestored = await page.locator('.PZ2QoL_kp:not(.hidden)').count();
    const heatOn = e => (e[0] === 'ShowHeatmap' && e[1] >= 0) || (e[0] === 'PZ2QoL_KinHeatmap' && e[1] === true);
    const heatOff = e => (e[0] === 'ShowHeatmap' && e[1] === -1) || (e[0] === 'PZ2QoL_KinHeatmap' && e[1] === false);
    if (facts.heatEvents.length !== 2 || !heatOn(facts.heatEvents[0]) || !heatOff(facts.heatEvents[1])) problems.push(`heat map events ${JSON.stringify(facts.heatEvents)}`);
    if (!/heat map is on/.test(facts.heatMini)) problems.push(`no heat map bar: "${facts.heatMini}"`);
    if (facts.heatRestored !== 1) problems.push('planner did not come back after the heat map was turned off');

    // 4. an animal -> its mates, unrelated first
    await click(page.locator('.PZ2QoL_kpRowHead.sev_risk'));
    await page.waitForSelector('.PZ2QoL_kpDet.mates', { timeout: 3000 });
    await page.waitForTimeout(300);
    facts.mates = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_kpMate')].map(n => ({
        tier: [...n.classList].find(c => c.startsWith('tier_')),
        text: n.innerText.replace(/\s+/g, ' ').trim(),
    })));
    await click(page.locator('.PZ2QoL_kpMate .PZ2QoL_kpMateTop'));
    await page.waitForTimeout(300);
    await ctx.shot(page, 'kp_4_mates');
    facts.mateExpanded = await page.locator('.PZ2QoL_kpMate.open .PZ2QoL_kinOffspring').count();
    facts.layoutMates = await layoutFacts(page);
    layoutProblems('mates', facts.layoutMates, problems);
    if (!facts.mates.length) problems.push('no mate candidates listed');
    else {
        if (facts.mates[0].tier !== 'tier_none' || !/unrelated/.test(facts.mates[0].text)) problems.push(`first mate is not unrelated: ${JSON.stringify(facts.mates[0])}`);
        const ranks = { tier_none: 0, tier_distant: 1, tier_close: 2, tier_game: 3 };
        for (let i = 1; i < facts.mates.length; i++) {
            if (ranks[facts.mates[i].tier] < ranks[facts.mates[i - 1].tier]) problems.push('mates are not ranked safest first');
        }
        if (!facts.mates.some(x => x.tier === 'tier_game')) problems.push('related females are missing from the mate list');
    }
    if (facts.mateExpanded !== 1) problems.push('expanding a mate shows no expected-young genes');

    // 5. settings popover; Esc closes it first, then the planner
    await click(page.locator('.PZ2QoL_kpBtn', { hasText: 'Settings' }));
    await page.waitForTimeout(250);
    await ctx.shot(page, 'kp_5_settings');
    facts.settings = await page.evaluate(() => ({
        switches: [...document.querySelectorAll('.PZ2QoL_kpPopover.open .PZ2QoL_kpSwitchLabel')].map(n => n.innerText),
        thresholds: [...document.querySelectorAll('.PZ2QoL_kpPopover.open [data-setting="closeKinship"] .PZ2QoL_kpSegItem')].map(n => n.innerText + (n.classList.contains('on') ? '*' : '')),
    }));
    facts.layoutSettings = await layoutFacts(page);
    layoutProblems('settings', facts.layoutSettings, problems);
    // the popover ends inside the planner and the wheel reaches its last setting
    await page.locator('.PZ2QoL_kpPopover.open .PZ2QoL_kpViewport').hover();
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
    await page.waitForTimeout(150);
    facts.settingsFit = await page.evaluate(() => {
        const pop = document.querySelector('.PZ2QoL_kpPopover.open').getBoundingClientRect();
        const root = document.querySelector('.PZ2QoL_kp').getBoundingClientRect();
        const rows = document.querySelectorAll('.PZ2QoL_kpPopover.open .PZ2QoL_kpSwitch');
        const last = rows[rows.length - 1].getBoundingClientRect();
        return { popBottom: Math.round(pop.bottom), rootBottom: Math.round(root.bottom), lastBottom: Math.round(last.bottom), bar: !!document.querySelector('.PZ2QoL_kpPopover.open .PZ2QoL_kpBar.show') };
    });
    await ctx.shot(page, 'kp_5b_settings_end');
    if (facts.settingsFit.popBottom > facts.settingsFit.rootBottom) problems.push(`settings popover runs past the planner: ${JSON.stringify(facts.settingsFit)}`);
    if (facts.settingsFit.lastBottom > facts.settingsFit.popBottom) problems.push(`settings: the last setting is out of reach: ${JSON.stringify(facts.settingsFit)}`);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    // other features may add switches: check the ones this scenario knows are there
    for (const label of ['New inbreeding risks', 'Close kin too', 'Covered pairs', 'Pair bonds count as protection', "Species names in the game's language"]) {
        if (!facts.settings.switches.includes(label)) problems.push(`settings switch "${label}" missing: ${facts.settings.switches}`);
    }
    if (facts.settings.thresholds.join(' ') !== '1/8 1/16* 1/32') problems.push(`thresholds: ${facts.settings.thresholds}`);
    // boxed with no destination (kinboxed.js): switch, delay (10 s default), trade centre
    for (const label of ['Boxed with nowhere to go', 'Trade centre too']) {
        if (!facts.settings.switches.includes(label)) problems.push(`settings switch "${label}" missing: ${facts.settings.switches}`);
    }
    facts.settings.boxedAfter = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_kpPopover.open [data-setting="boxedAfterS"] .PZ2QoL_kpSegItem')].map(n => n.innerText + (n.classList.contains('on') ? '*' : '')));
    if (!facts.settings.boxedAfter.includes('10 s*')) problems.push(`boxed delay: ${facts.settings.boxedAfter}`);
    await click(page.locator('.PZ2QoL_kpPopover [data-setting="boxedAfterS"] [data-value="30"]'));
    await page.waitForTimeout(200);
    facts.settings.boxedAfterS = await page.evaluate(async () => (await import('/js/mods/pz2qol/kin.js')).getKinSettings().boxedAfterS);
    if (facts.settings.boxedAfterS !== 30) problems.push(`boxed delay click: ${facts.settings.boxedAfterS}`);
    await page.evaluate(async () => (await import('/js/mods/pz2qol/kin.js')).setKinSettings({ boxedAfterS: 10 }));
    await page.waitForTimeout(200);
    // covered pairs can be hidden from the counts, then shown again
    await click(page.locator('.PZ2QoL_kpPopover .PZ2QoL_kpSwitch', { hasText: 'Covered pairs' }));
    await page.waitForTimeout(250);
    facts.summaryNoCovered = await text(page, '.PZ2QoL_kpSummary');
    await click(page.locator('.PZ2QoL_kpPopover .PZ2QoL_kpSwitch', { hasText: 'Covered pairs' }));
    await page.waitForTimeout(250);
    if (/covered/.test(facts.summaryNoCovered)) problems.push(`"Covered pairs" off still counts them: ${facts.summaryNoCovered}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    facts.afterFirstEsc = { open: await isOpen(page), popover: await page.locator('.PZ2QoL_kpPopover.open').count() };
    if (!facts.afterFirstEsc.open || facts.afterFirstEsc.popover) problems.push(`first Esc should close only the settings: ${JSON.stringify(facts.afterFirstEsc)}`);

    // 6. open options: a pair key (alerts), an animal (kin cards)
    const target = await page.evaluate(async () => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        const model = kin.getKinModel();
        const p = model.pairs.find(x => x.severity === 'risk' && x.hab === '9001');
        return p ? { key: p.key, hab: p.hab, a: p.a.id, b: p.b.id } : null;
    });
    if (!target) problems.push('no risk pair in Jungle Habitat to open');
    else {
        await open(page, { habitatId: target.hab, animalId: target.a, pairKey: target.key });
        await page.waitForTimeout(300);
        facts.openPair = { title: await text(page, '.PZ2QoL_kp .PZ2QoL_kpMainTitle'), pair: await page.locator('.PZ2QoL_kpDet.pair').count(), on: await page.locator('.PZ2QoL_kpCell.on').count() };
        if (!/Jungle/.test(facts.openPair.title) || facts.openPair.pair !== 1 || facts.openPair.on !== 1) problems.push(`open with pairKey: ${JSON.stringify(facts.openPair)}`);
        await open(page, { animalId: target.b });
        await page.waitForTimeout(300);
        facts.openAnimal = { title: await text(page, '.PZ2QoL_kp .PZ2QoL_kpMainTitle'), mates: await page.locator('.PZ2QoL_kpDet.mates').count(), on: await page.locator('.PZ2QoL_kpColHead.on, .PZ2QoL_kpRowHead.on').count() };
        if (!/Jungle/.test(facts.openAnimal.title) || facts.openAnimal.mates !== 1 || facts.openAnimal.on !== 1) problems.push(`open with animalId: ${JSON.stringify(facts.openAnimal)}`);
    }

    // 6b. the species board and back: one big panel at a time
    await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpBtn', { hasText: 'Species board' }));
    await page.waitForTimeout(400);
    facts.toBoard = await page.evaluate(async () => ({
        board: (await import('/js/mods/pz2qol/kinboard.js')).isSpeciesBoardOpen(),
        planner: (await import('/js/mods/pz2qol/kinplanner.js')).isKinPlannerOpen(),
        species: (document.querySelector('.PZ2QoL_kbSpecies.on') || { getAttribute: () => null }).getAttribute('data-species'),
    }));
    await click(page.locator('.PZ2QoL_kb .PZ2QoL_kpBtn', { hasText: 'Kin planner' }));
    await page.waitForTimeout(400);
    facts.backFromBoard = await page.evaluate(async () => ({
        board: (await import('/js/mods/pz2qol/kinboard.js')).isSpeciesBoardOpen(),
        planner: (await import('/js/mods/pz2qol/kinplanner.js')).isKinPlannerOpen(),
    }));
    if (!facts.toBoard.board || facts.toBoard.planner || facts.toBoard.species !== 'Tiger') problems.push(`planner -> species board: ${JSON.stringify(facts.toBoard)}`);
    if (facts.backFromBoard.board || !facts.backFromBoard.planner) problems.push(`species board -> planner: ${JSON.stringify(facts.backFromBoard)}`);

    // 7. empty states: all clear, then Kin off; then the fixture again
    await page.evaluate(async () => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        kin.applyKinSnapshot({ v: 1, seq: 99, scope: 'park', habitats: [], animals: [], anc: {} });
    });
    await page.waitForTimeout(300);
    await ctx.shot(page, 'kp_6_all_clear');
    facts.allClear = await text(page, '.PZ2QoL_kpMain');
    if (!/All clear/.test(facts.allClear)) problems.push(`empty zoo shows "${facts.allClear.slice(0, 80)}"`);
    await page.evaluate(async () => (await import('/js/mods/pz2qol/kin.js')).setKinSettings({ enabled: false }));
    await page.waitForTimeout(300);
    await ctx.shot(page, 'kp_7_kin_off');
    facts.offState = await text(page, '.PZ2QoL_kpMain');
    if (!/Kin is off/.test(facts.offState)) problems.push(`Kin off shows "${facts.offState.slice(0, 80)}"`);
    facts.layoutEmpty = await layoutFacts(page);
    layoutProblems('empty', facts.layoutEmpty, problems);
    await page.evaluate(async () => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        kin.setKinSettings({ enabled: true });
        kin.applyKinSnapshot(window.__kinFixture.snapshot);
    });
    await page.waitForTimeout(300);
    facts.backToData = await page.locator('.PZ2QoL_kpHab').count();
    if (!(facts.backToData >= 4)) problems.push('planner did not refill after the data came back');

    // 8. Esc closes
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    facts.openAfterEsc = await isOpen(page);
    facts.visibleAfterEsc = await page.locator('.PZ2QoL_kp:not(.hidden)').count();
    if (facts.openAfterEsc || facts.visibleAfterEsc) problems.push('Esc did not close the planner');

    if (problems.length) throw new Error('kin planner: ' + problems.join('; '));
    return facts;
}
