// Browser-harness scenario: Find a mate with the player's stored adults
// (Franchise; kincore normalizeStored/withStored, kinmoves requestStoredAdults,
// kinplanner mateFinder). Runs on the in-park HUD page with the kin fixture,
// the snapshot's mode set to 'franchise', and a fake Lua side for
// PZ2QoL_KinStored -> PZ2QoL_KinStoredChunk (3 stored lionesses, one a
// half-sister of the chosen lion). Checks the counts line, the storage tags,
// that the relative sits in the related section, the "Storage too" switch,
// the error and offline states, one request per species, and the layout.
import { seedZooKin, settleStoredAsks } from './kin_fixture.mjs';
import { layoutFacts, layoutProblems } from './kin_planner.mjs';

export const name = 'stored';

const PLANNER = '/js/mods/pz2qol/kinplanner.js';

async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

const text = (page, sel) => page.evaluate(s => {
    const n = document.querySelector(s);
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '';
}, sel);

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
    const seeded = await seedZooKin(page);
    // the son (r2) in the Savannah, a lion; his father is r0
    const son = seeded.layout.find(l => l.hab === '9000' && l.n === 2);
    const father = seeded.layout.find(l => l.hab === '9000' && l.n === 0);
    if (!son || !father) throw new Error('kin stored: fixture has no lion family');
    facts.target = son.id;

    await page.evaluate(async ({ fatherGuid }) => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        const moves = await import('/js/mods/pz2qol/kinmoves.js');
        moves._clearStoredCache();
        const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
        snap.mode = 'franchise';
        snap.seq = 501;
        const STORED = {
            species: 'Lion',
            animals: [
                { id: 'sS1', guid: 'S1', name: 'Sasha', species: 'Lion', sex: 1, maturity: 2, par: [fatherGuid, 'gSX'], genes: { F: 'ABCDEFABCDEF', I: 'ABCDEFGHABCD', S: 'AAAAAABBBBBB', L: 'AABBCCDDEEFF' } },
                { id: 'sS2', guid: 'S2', name: 'Nala', species: 'Lion', sex: 1, maturity: 1, forSale: true, par: [], genes: { F: 'ABCDEFGHABCD', I: 'HGFEDCBAHGFE', S: 'AAAAAAAAAAAA', L: 'BBBBBBBBBBBB' } },
                { id: 'sS3', guid: 'S3', name: 'Dot', species: 'Lion', sex: 1, maturity: 6, par: [] },
            ],
            anc: { gSX: [] },
        };
        window.__kst = { active: true, mode: 'ok', asks: [] };
        if (engine.events) engine.events.PZ2QoL_KinStored = [];
        engine.on('PZ2QoL_KinStored', (reqId, species) => {
            const k = window.__kst;
            if (!k || !k.active) return;
            k.asks.push(String(species));
            if (k.mode === 'silent') return;
            const json = JSON.stringify(k.mode === 'error' ? { species, error: 'nostorage' } : STORED);
            const half = Math.ceil(json.length / 2);
            // two chunks, a little later, like Lua's next frames
            setTimeout(() => {
                engine.trigger('PZ2QoL_KinStoredChunk', reqId, 2, 2, json.slice(half));
                engine.trigger('PZ2QoL_KinStoredChunk', reqId, 1, 2, json.slice(0, half));
            }, 300);
        });
        kin.applyKinSnapshot(snap);
    }, { fatherGuid: 'g' + father.rowId });
    await settleStoredAsks(page, 'Lion');

    try {
        // 1. the mate finder asks once, shows "Checking", then the stored adults
        await page.evaluate(async ([url, id]) => (await import(url)).openKinPlanner({ animalId: id }), [PLANNER, son.id]);
        await page.waitForSelector('.PZ2QoL_kp:not(.hidden) .PZ2QoL_kpDet.mates', { timeout: 3000 });
        facts.checking = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateStore');
        if (!/Checking your Animal Storage/.test(facts.checking)) problems.push(`no "Checking" line while the answer is out: "${facts.checking}"`);
        await page.waitForFunction(() => /in your Animal Storage/.test((document.querySelector('.PZ2QoL_kp .PZ2QoL_kpMateStore') || {}).innerText || ''), null, { timeout: 4000 });
        await page.waitForTimeout(200);
        facts.storeLine = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateStore');
        facts.head = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateStoreRow');
        facts.rows = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_kp .PZ2QoL_kpMate')].map(n => ({
            stored: n.classList.contains('stored'),
            tier: [...n.classList].find(c => c.startsWith('tier_')),
            text: n.innerText.replace(/\s+/g, ' ').trim(),
        })));
        facts.storageTags = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate .PZ2QoL_kpTag.storage').count();
        facts.listedTags = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate .PZ2QoL_kpTag.listed').count();
        const stored = facts.rows.filter(r => r.stored);
        if (!/· 3 in your Animal Storage/.test(facts.storeLine)) problems.push(`stored count line: "${facts.storeLine}"`);
        if (!/Storage too/.test(facts.head)) problems.push(`no "Storage too" switch in the storage row: "${facts.head}"`);
        if (stored.length !== 3) problems.push(`${stored.length} stored rows, expected 3`);
        if (facts.storageTags !== 3) problems.push(`${facts.storageTags} storage tags, expected 3`);
        if (facts.listedTags !== 1) problems.push(`${facts.listedTags} "listed" tags, expected 1`);
        const sasha = facts.rows.find(r => /Sasha/.test(r.text));
        if (!sasha || sasha.tier !== 'tier_game' || !/half-sister/.test(sasha.text)) problems.push(`the stored half-sister is not in the related section: ${JSON.stringify(sasha)}`);
        if (stored.some(r => !/Animal Storage/.test(r.text))) problems.push('a stored row does not say Animal Storage');
        const ranks = { tier_none: 0, tier_distant: 1, tier_close: 2, tier_game: 3 };
        for (let i = 1; i < facts.rows.length; i++) {
            if (ranks[facts.rows[i].tier] < ranks[facts.rows[i - 1].tier]) problems.push('mates are not ranked safest first with stored ones mixed in');
        }

        // 2. a stored row opened: the hint, no Locate
        await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMate.stored .PZ2QoL_kpMateTop', { hasText: 'Nala' }));
        await page.waitForTimeout(300);
        facts.openStored = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMate.stored.open');
        facts.openLocate = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate.stored.open .PZ2QoL_kpAct', { hasText: 'Locate' }).count();
        if (!/Send it to the zoo from Animal Storage/.test(facts.openStored)) problems.push(`no storage hint on the opened row: "${facts.openStored.slice(0, 120)}"`);
        if (facts.openLocate) problems.push('a stored animal offers Locate');
        await ctx.shot(page, 'kst_1_stored_mates');
        facts.layout = await layoutFacts(page);
        layoutProblems('stored mates', facts.layout, problems);

        // 3. "Storage too" off hides them, on shows them again (from the cache)
        await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStoreRow .PZ2QoL_kpSwitch', { hasText: 'Storage too' }));
        await page.waitForTimeout(250);
        facts.offRows = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate.stored').count();
        facts.offLine = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStore').count();
        facts.offHead = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateHead .PZ2QoL_kpSubhead');
        if (facts.offRows || facts.offLine) problems.push(`switch off still shows stored animals (${facts.offRows} rows, ${facts.offLine} lines)`);
        if (!/in the zoo/i.test(facts.offHead)) problems.push(`switch off head: "${facts.offHead}"`);
        await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStoreRow .PZ2QoL_kpSwitch', { hasText: 'Storage too' }));
        await page.waitForTimeout(250);
        facts.onAgainRows = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate.stored').count();
        facts.asks = await page.evaluate(() => window.__kst.asks.slice());
        if (facts.onAgainRows !== 3) problems.push(`switch on again: ${facts.onAgainRows} stored rows`);
        // the Market's fresh-blood check (marketmates.js) asks about the zoo's other species too
        if (facts.asks.filter(sp => sp === 'Lion').length !== 1) problems.push(`stored adults asked ${JSON.stringify(facts.asks)}, expected once for Lion`);

        // 4. Lua says storage is not available: a quiet note, the zoo list as before
        await page.evaluate(async () => {
            window.__kst.mode = 'error';
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
        });
        await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStoreRow .PZ2QoL_kpSwitch', { hasText: 'Storage too' }));
        await page.waitForTimeout(150);
        await click(page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStoreRow .PZ2QoL_kpSwitch', { hasText: 'Storage too' }));
        await page.waitForFunction(() => /isn't available/.test((document.querySelector('.PZ2QoL_kp .PZ2QoL_kpMateStore') || {}).innerText || ''), null, { timeout: 4000 }).catch(() => {});
        facts.errorLine = await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateStore');
        facts.errorRows = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate.stored').count();
        facts.errorZooRows = await page.locator('.PZ2QoL_kp .PZ2QoL_kpMate:not(.stored)').count();
        await ctx.shot(page, 'kst_2_storage_unavailable');
        if (!/Animal Storage isn't available here/.test(facts.errorLine)) problems.push(`error note: "${facts.errorLine}"`);
        if (facts.errorRows) problems.push('stored rows shown after an error');
        if (!facts.errorZooRows) problems.push('the zoo candidates vanished with the storage error');

        // 5. an offline park: no switch, no storage line, nothing asked
        await page.evaluate(async () => {
            window.__kst.asks.length = 0;
            window.__kst.mode = 'ok';
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
            const kin = await import('/js/mods/pz2qol/kin.js');
            const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
            snap.mode = 'offline';
            snap.seq = 502;
            kin.applyKinSnapshot(snap);
        });
        await page.waitForTimeout(400);
        facts.offline = {
            switch: await page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStoreRow .PZ2QoL_kpSwitch', { hasText: 'Storage too' }).count(),
            line: await page.locator('.PZ2QoL_kp .PZ2QoL_kpMateStore').count(),
            asks: await page.evaluate(() => window.__kst.asks.length),
            head: await text(page, '.PZ2QoL_kp .PZ2QoL_kpMateHead .PZ2QoL_kpSubhead'),
        };
        if (facts.offline.switch || facts.offline.line || facts.offline.asks) problems.push(`offline park still offers storage: ${JSON.stringify(facts.offline)}`);
        if (!/in the zoo$/i.test(facts.offline.head)) problems.push(`offline head: "${facts.offline.head}"`);

        // 6. Compare Mates (B2): stored rows (id type 2) get badges against the
        //    chosen park lion once the stored adults are in
        await page.evaluate(async url => {
            (await import(url)).closeKinPlanner();
            const kin = await import('/js/mods/pz2qol/kin.js');
            const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
            snap.mode = 'franchise';
            snap.seq = 503;
            kin.applyKinSnapshot(snap);
            window.__kst.asks.length = 0;
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
        }, PLANNER);
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', -1));
        await page.waitForTimeout(400);
        const keys = await page.evaluate(async lists => {
            const DS = await import('/js/common/core/DataStore.js');
            const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
            const out = {};
            for (const list of ['mothers', 'fathers']) {
                const col = new DataStoreCollection(['compareMates', list]);
                await new Promise(r => setTimeout(r, 100));
                out[list] = [];
                col._source.forEach((ctx, i) => {
                    const a = lists[list][i] || { id: `animal_${900 + i}_7`, name: 'Listing ' + i, gender: list === 'mothers' ? 1 : 0 };
                    DS.setValue(ctx, 'id', a.id);
                    DS.setValue(ctx, 'name', a.name);
                    DS.setValue(ctx, 'gender', a.gender);
                    out[list].push({ key: ctx[ctx.length - 1], id: a.id });
                });
                col.dispose();
            }
            return out;
        }, {
            mothers: [{ id: 'animal_S1_2', name: 'Sasha', gender: 1 }, { id: 'animal_S2_2', name: 'Nala', gender: 1 }],
            fathers: [{ id: `animal_${son.id}_0`, name: 'Son', gender: 0 }],
        });
        await page.evaluate(() => engine.trigger('PopupAction_SetDataCompareMates', null));
        await page.waitForTimeout(250);
        await page.evaluate(d => engine.trigger('PopupAction_SetDataCompareMates', d), { mother: '', father: keys.fathers[0].key });
        await page.waitForTimeout(1500);
        facts.compare = await page.evaluate(() => [...document.querySelectorAll('.ParentDisplay_root.mother .AnimalListButton_root')].map(r => {
            const b = r.querySelector('.PZ2QoL_kmRel');
            const n = r.querySelector('.ParentListItem_leftChildren');
            return { name: n && n.childNodes[0] ? n.childNodes[0].textContent : null, rel: b ? b.textContent : null, sev: b ? (b.className.match(/sev_(\w+)/) || [])[1] : null };
        }));
        facts.compareAsks = await page.evaluate(() => window.__kst.asks.slice());
        await ctx.shot(page, 'kst_3_compare_mates');
        const sashaRow = facts.compare.find(r => r.name === 'Sasha');
        const nalaRow = facts.compare.find(r => r.name === 'Nala');
        if (!sashaRow) problems.push(`Compare Mates: no Sasha row: ${JSON.stringify(facts.compare)}`);
        else if (sashaRow.rel !== 'Half-sister' || sashaRow.sev !== 'risk') problems.push(`Compare Mates: stored half-sister badge ${sashaRow.rel}/${sashaRow.sev}`);
        if (nalaRow && nalaRow.rel) problems.push(`Compare Mates: the unrelated stored lioness got a badge: ${nalaRow.rel}`);
        if (facts.compareAsks.filter(sp => sp === 'Lion').length !== 1) problems.push(`Compare Mates asked for stored adults ${JSON.stringify(facts.compareAsks)}, expected once for Lion`);
        await page.evaluate(() => engine.trigger('PopupAction_SetDataCompareMates', null));
        await page.waitForTimeout(200);
    }
    finally {
        await page.evaluate(async url => {
            if (window.__kst) window.__kst.active = false;
            (await import(url)).closeKinPlanner();
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
            (await import('/js/mods/pz2qol/kin.js')).applyKinSnapshot(window.__kinFixture.snapshot);
        }, PLANNER);
    }
    if (problems.length) throw new Error('kin stored: ' + problems.join('; '));
    return facts;
}
