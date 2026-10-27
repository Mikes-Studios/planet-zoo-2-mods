// Browser-harness scenario: growing-up notices (kinlife.js through
// kinalerts.js). Runs on the in-park HUD page with the kin fixture, then
// hands the page snapshots with young animals close to adulthood:
//   Lion (Savannah): the group is at the game's limit and a cub grows up
//     -> one "Needs you" toast naming the limit;
//   Tiger (Jungle): a contracepted cub with plenty of room -> no toast,
//     one note in the log;
//   Zebra (Arctic): a contracepted foal makes the group exactly full -> a
//     Heads-up, hidden while "Pop up for" is Needs you only, shown after.
// Checks the settings popover's controls too, then restores the fixture.
import { seedZooKin } from './kin_fixture.mjs';

export const name = 'lifealerts';

const ALERTS = '/js/mods/pz2qol/kinalerts.js';

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
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 7));
        await page.waitForSelector('.ManagementAnimals_root', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(1200);
    }
    await seedZooKin(page);
    await page.waitForTimeout(300);

    const toasts = () => page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_kinToast')].map(t => ({
        cls: t.className,
        text: t.innerText.replace(/\s+/g, ' ').trim(),
    })));
    const clearToasts = () => page.evaluate(() => document.querySelectorAll('.PZ2QoL_kinToast').forEach(n => n.remove()));

    // the snapshot builder: the fixture plus young animals and species facts
    await page.evaluate(() => {
        const base = window.__kinFixture.snapshot;
        const adultsIn = hab => base.animals.filter(a => a.hab === hab && !a.juv).length;
        window.__life = {
            build(extra, facts, seq) {
                const snap = JSON.parse(JSON.stringify(base));
                snap.seq = seq;
                snap.animals = snap.animals.concat(extra);
                snap.speciesFacts = facts;
                return snap;
            },
            young(id, name, hab, species, sex, over) {
                return Object.assign({
                    id, key: 'animal_' + id, guid: 'g' + id, name, species, sex, juv: true, contra: false, infertile: true, preg: false,
                    hab, loc: { 9000: 'Savannah Habitat', 9001: 'Jungle Habitat', 9002: 'Arctic Habitat' }[hab], par: [], mates: [],
                    age: 1.9, adultAge: 2, adultIn: 0.1,
                }, over || {});
            },
            adults: { lion: adultsIn('9000'), tiger: adultsIn('9001'), zebra: adultsIn('9002') },
        };
    });
    facts.adults = await page.evaluate(() => window.__life.adults);

    try {
        await page.evaluate(async url => {
            const kin = await import('/js/mods/pz2qol/kin.js');
            kin.setKinSettings({ alertLife: true, toastLevel: 'heads' });
            (await import(url))._resetLife();
        }, ALERTS);
        await clearToasts();

        // 1. Lion at its limit + a cub growing up; Tiger cub on contraception with room
        await page.evaluate(async () => {
            const L = window.__life;
            const kin = await import('/js/mods/pz2qol/kin.js');
            const facts = {
                Lion: { maturity: 3, infertility: 15, life: 20, social: { min: 1, max: L.adults.lion }, maturation: 'none' },
                Tiger: { maturity: 3, infertility: 15, life: 20, social: { min: 1, max: 40 }, maturation: 'none' },
                Zebra: { maturity: 3, infertility: 15, life: 20, social: { min: 1, max: 40 }, maturation: 'none' },
            };
            window.__life.facts = facts;
            kin.applyKinSnapshot(L.build([
                L.young('lifeLion1', 'Simba', '9000', 'Lion', 1, { contra: true }),
                L.young('lifeTiger1', 'Stripes', '9001', 'Tiger', 1, { contra: true }),
            ], facts, 701));
        });
        await page.waitForTimeout(400);
        facts.step1 = await toasts();
        facts.log1 = await page.evaluate(async url => (await import(url)).getLifeLog().map(e => ({ level: e.level, kind: e.kind, title: e.title, species: e.species })), ALERTS);
        await ctx.shot(page, 'kla_1_needs_you');
        const action = facts.step1.filter(t => /lvl_action/.test(t.cls));
        if (action.length !== 1) problems.push(`expected one Needs you toast, got ${action.length}: ${JSON.stringify(facts.step1)}`);
        else {
            if (!/Needs you/i.test(action[0].text)) problems.push(`no "Needs you" kicker: ${action[0].text}`);
            if (!/Simba grows up/.test(action[0].text) || !/the game allows \d+ here/.test(action[0].text)) problems.push(`the Needs you toast does not name the cub and the group limit: ${action[0].text}`);
            if (!/Dismiss/.test(action[0].text)) problems.push('no Dismiss button on the Needs you toast');
        }
        if (facts.step1.some(t => /Stripes/.test(t.text))) problems.push('the contracepted tiger cub with room popped up');
        const tigerLog = facts.log1.filter(e => e.species === 'Tiger');
        if (tigerLog.length !== 1 || tigerLog[0].level !== 'info') problems.push(`tiger cub: expected one note in the log, got ${JSON.stringify(tigerLog)}`);

        // 2. "Pop up for: Needs you" hides a heads-up (it still goes to the log)
        await clearToasts();
        await page.evaluate(async () => {
            const L = window.__life;
            const kin = await import('/js/mods/pz2qol/kin.js');
            kin.setKinSettings({ toastLevel: 'action' });
            L.facts.Zebra.social.max = L.adults.zebra + 1;
            kin.applyKinSnapshot(L.build([
                L.young('lifeLion1', 'Simba', '9000', 'Lion', 1, { contra: true }),
                L.young('lifeTiger1', 'Stripes', '9001', 'Tiger', 1, { contra: true }),
                L.young('lifeZebra1', 'Dash', '9002', 'Zebra', 1, { contra: true }),
            ], L.facts, 702));
        });
        await page.waitForTimeout(400);
        facts.step2 = await toasts();
        facts.log2 = await page.evaluate(async url => (await import(url)).getLifeLog().filter(e => e.species === 'Zebra').map(e => e.level), ALERTS);
        if (facts.step2.length) problems.push(`with Needs you only, a heads-up still popped up: ${JSON.stringify(facts.step2)}`);
        if (facts.log2.join() !== 'heads') problems.push(`the hidden heads-up is not in the log: ${facts.log2}`);

        // 3. Heads-up too: the next one pops up as a heads-up
        await page.evaluate(async () => {
            const L = window.__life;
            const kin = await import('/js/mods/pz2qol/kin.js');
            kin.setKinSettings({ toastLevel: 'heads' });
            L.facts.Zebra.social.max = L.adults.zebra + 2;
            kin.applyKinSnapshot(L.build([
                L.young('lifeLion1', 'Simba', '9000', 'Lion', 1, { contra: true }),
                L.young('lifeTiger1', 'Stripes', '9001', 'Tiger', 1, { contra: true }),
                L.young('lifeZebra1', 'Dash', '9002', 'Zebra', 1, { contra: true }),
                L.young('lifeZebra2', 'Dot', '9002', 'Zebra', 1, { contra: true }),
            ], L.facts, 703));
        });
        await page.waitForTimeout(400);
        facts.step3 = await toasts();
        await ctx.shot(page, 'kla_2_heads_up');
        const heads = facts.step3.filter(t => /lvl_heads/.test(t.cls));
        if (heads.length !== 1 || !/Dot grows up/.test(heads[0].text) || !/Heads-up/i.test(heads[0].text)) problems.push(`expected one Heads-up for Dot: ${JSON.stringify(facts.step3)}`);

        // 4. the settings popover offers both controls
        await page.evaluate(async () => (await import('/js/mods/pz2qol/kinplanner.js')).openKinPlanner({}));
        await page.waitForSelector('.PZ2QoL_kp:not(.hidden)', { timeout: 3000 });
        await page.locator('.PZ2QoL_kp .PZ2QoL_kpBtn', { hasText: 'Settings' }).first().click();
        await page.waitForTimeout(250);
        facts.popover = await page.evaluate(() => ({
            switches: [...document.querySelectorAll('.PZ2QoL_kpPopover.open .PZ2QoL_kpSwitchLabel')].map(n => n.innerText),
            levels: [...document.querySelectorAll('.PZ2QoL_kpPopover.open [data-setting="toastLevel"] [data-value]')].map(n => n.innerText + (n.classList.contains('on') ? '*' : '')),
        }));
        await ctx.shot(page, 'kla_3_settings');
        if (!facts.popover.switches.includes('Animals growing up')) problems.push(`no "Animals growing up" switch: ${facts.popover.switches}`);
        if (facts.popover.levels.join('|') !== 'Needs you|Heads-up too*') problems.push(`"Pop up for" choices: ${facts.popover.levels}`);
        await page.locator('.PZ2QoL_kpPopover.open [data-setting="toastLevel"] [data-value="action"]').first().click();
        await page.waitForTimeout(150);
        facts.levelAfterClick = await page.evaluate(async () => (await import('/js/mods/pz2qol/kin.js')).getKinSettings().toastLevel);
        if (facts.levelAfterClick !== 'action') problems.push(`clicking Needs you set toastLevel ${facts.levelAfterClick}`);
    }
    finally {
        await page.evaluate(async url => {
            const kin = await import('/js/mods/pz2qol/kin.js');
            kin.setKinSettings({ alertLife: true, toastLevel: 'heads' });
            try {
                (await import('/js/mods/pz2qol/kinplanner.js')).closeKinPlanner();
            }
            catch (e) {
                // not open
            }
            kin.applyKinSnapshot(window.__kinFixture.snapshot);
            (await import(url))._resetLife();
            document.querySelectorAll('.PZ2QoL_kinToast').forEach(n => n.remove());
        }, ALERTS);
    }
    if (problems.length) throw new Error('kin life alerts: ' + problems.join('; '));
    return facts;
}
