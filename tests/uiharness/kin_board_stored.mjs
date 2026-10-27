// Browser-harness scenario: the Species board's pinned trade column with the
// player's stored adults (Franchise; kinboardcore storedCards, kinboard
// storedGroup, kinmoves requestStoredAdults). Runs on the in-park HUD page
// with the kin fixture in a Franchise zoo plus one lion in the trade centre
// (an in-park entity), and a fake Lua side for PZ2QoL_KinStored ->
// PZ2QoL_KinStoredChunk (gated by window.__kbs.active): 5 stored adults, one
// of them the same animal as the in-park trade lion (same guid), one a
// daughter of the Savannah's father. Checks 1 in-park card + 4 stored cards,
// the "1 here · +4 in storage" head, the adults-only note, no inbreeding badge
// on stored cards (only a relation line),
// hover relatives, that a stored card can't be dragged or selected, one ask
// per open (Rescan asks again), the "N more" cap with 10 adults, the offline
// note, the Storage shortcut (one PZ2QoL_TradeOpen, the board closes), and
// the layout within 1920x1080.
import { seedZooKin, settleStoredAsks } from './kin_fixture.mjs';
import { layoutFacts, layoutProblems } from './kin_board.mjs';

export const name = 'board_stored';

const BOARD = '/js/mods/pz2qol/kinboard.js';

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

const pinnedFacts = page => page.evaluate(() => {
    const col = document.querySelector('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbCol');
    if (!col) return null;
    const cards = [...col.querySelectorAll('.PZ2QoL_kbCard:not(.ghost)')];
    const shown = el => !!el && el.getBoundingClientRect().height > 0;
    return {
        park: cards.filter(c => !c.classList.contains('stored')).map(c => c.getAttribute('data-id')),
        stored: cards.filter(c => c.classList.contains('stored')).map(c => ({
            id: c.getAttribute('data-id'),
            sev: c.getAttribute('data-sev'),
            text: c.innerText.replace(/\s+/g, ' ').trim(),
            badge: !!c.querySelector('.PZ2QoL_kin'),
            btn: !!c.querySelector('.PZ2QoL_kbStoredBtn'),
            shown: shown(c),
        })),
        counts: (col.querySelector('.PZ2QoL_kbColCounts') || {}).innerText || '',
        head: (col.querySelector('.PZ2QoL_kbStoredHead') || {}).innerText || '',
        note: [...col.querySelectorAll('.PZ2QoL_kbStoredNote')].map(n => n.innerText.trim()).join(' | '),
        more: (col.querySelector('.PZ2QoL_kbStoredMore') || {}).innerText || '',
    };
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
    const seeded = await seedZooKin(page);
    const father = seeded.layout.find(l => l.hab === '9000' && l.n === 0);
    if (!father) throw new Error('kin board stored: fixture has no lion father');
    facts.father = father.id;

    await page.evaluate(async ({ fatherGuid }) => {
        const board = await import('/js/mods/pz2qol/kinboard.js');
        board.closeSpeciesBoard();
        const kin = await import('/js/mods/pz2qol/kin.js');
        const moves = await import('/js/mods/pz2qol/kinmoves.js');
        moves._clearStoredCache();
        const DS = await import('/js/common/core/DataStore.js');
        DS.setValue(['park'], 'hasBuildingForAnimalStorage', true);
        DS.setValue(['ui', 'HUD'], 'hubDisabled', false);
        const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
        snap.mode = 'franchise';
        snap.seq = 701;
        snap.tradeCentre = { id: '501', name: 'Trade Centre' };
        snap.animals.push({
            id: '8121', key: 'animal_8121', guid: 'gx8121', name: 'Zawadi', species: 'Lion', sex: 1, juv: false, contra: false,
            infertile: false, preg: false, hab: '', loc: 'Trade Centre', lt: 'trade', par: [], mates: [],
        });
        for (const a of snap.animals) if (!a.lt) a.lt = a.hab ? 'habitat' : 'other';
        window.__kbsSnap = snap;
        kin.applyKinSnapshot(snap);
        const adult = (n, guid, name, sex, extra = {}) => Object.assign({ id: 's' + guid, guid, name, species: 'Lion', sex, maturity: 2, par: [] }, extra);
        const FIVE = {
            species: 'Lion',
            animals: [
                adult(1, 'gx8121', 'Zawadi', 1),                                        // the in-park trade lion again
                adult(2, 'S1', 'Sasha', 1, { par: [fatherGuid, 'gSX'] }),              // daughter of the Savannah father
                adult(3, 'S2', 'Nala', 1, { forSale: true }),
                adult(4, 'S3', 'Baraka', 0),
                adult(5, 'S4', 'Dot', 1, { maturity: 6 }),
            ],
            anc: { gSX: [] },
        };
        const TEN = { species: 'Lion', anc: {}, animals: Array.from({ length: 10 }, (_, i) => adult(i, 'M' + i, 'Stored ' + (i + 1), i % 2)) };
        window.__kbs = { active: true, mode: 'five', asks: [], opens: [] };
        if (engine.events) engine.events.PZ2QoL_KinStored = [];
        engine.on('PZ2QoL_KinStored', (reqId, species) => {
            const k = window.__kbs;
            if (!k || !k.active) return;
            k.asks.push(String(species));
            const json = JSON.stringify(k.mode === 'ten' ? TEN : FIVE);
            const half = Math.ceil(json.length / 2);
            setTimeout(() => {
                engine.trigger('PZ2QoL_KinStoredChunk', reqId, 1, 2, json.slice(0, half));
                engine.trigger('PZ2QoL_KinStoredChunk', reqId, 2, 2, json.slice(half));
            }, 250);
        });
        if (engine.events) engine.events.PZ2QoL_TradeOpen = [];
        engine.on('PZ2QoL_TradeOpen', (reqId, kind, species) => {
            const k = window.__kbs;
            if (!k || !k.active) return;
            k.opens.push([String(kind), String(species)]);
            engine.trigger('PZ2QoL_TradeOpenResult', reqId, true, '');
        });
    }, { fatherGuid: 'g' + father.rowId });
    await settleStoredAsks(page, 'Lion');
    const kbs = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__kbs)));
    // the board's asks: the Market's fresh-blood check (marketmates.js) asks about the zoo's other species too
    const lionAsks = async () => (await kbs()).asks.filter(sp => sp === 'Lion');

    try {
        // 1. open on Lion: 1 in-park card, then 4 stored cards (Zawadi's record skipped)
        await page.evaluate(async url => (await import(url)).openSpeciesBoard({ species: 'Lion' }), BOARD);
        await page.waitForSelector('.PZ2QoL_kb:not(.hidden) .PZ2QoL_kbPinned', { timeout: 4000 });
        await page.waitForFunction(() => document.querySelectorAll('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbCard.stored').length > 0, null, { timeout: 4000 });
        await page.waitForTimeout(300);
        facts.first = await pinnedFacts(page);
        const f = facts.first;
        if (!f) problems.push('no pinned trade column');
        else {
            if (f.park.join() !== '8121') problems.push(`in-park trade cards ${JSON.stringify(f.park)}, expected [8121]`);
            if (f.stored.length !== 4) problems.push(`${f.stored.length} stored cards, expected 4`);
            if (f.stored.some(s => s.id === 'sgx8121')) problems.push('the stored record of the in-park trade lion is listed twice');
            if (f.counts.trim() !== '1 here · +4 in storage') problems.push(`trade head counts "${f.counts}"`);
            if (!/In Animal Storage \(adults\)/i.test(f.head)) problems.push(`stored group head "${f.head}"`);
            if (!/young/i.test(f.note)) problems.push(`no adults-only note: "${f.note}"`);
            const sasha = f.stored.find(s => /Sasha/.test(s.text));
            // stored animals can't breed: no inbreeding badge or stripe, only the relation line
            if (!sasha || sasha.sev !== 'none' || sasha.badge || !/daughter|father/i.test(sasha.text)) problems.push(`Sasha's relation line (no badge): ${JSON.stringify(sasha)}`);
            const nala = f.stored.find(s => /Nala/.test(s.text));
            if (!nala || nala.badge || !/listed/.test(nala.text)) problems.push(`Nala (unrelated, listed): ${JSON.stringify(nala)}`);
            if (f.stored.some(s => !s.btn)) problems.push('a stored card has no Storage button');
            if (f.stored.some(s => !/in storage/.test(s.text))) problems.push('a stored card lacks the "in storage" tag');
            if (f.stored[0] && !/Sasha/.test(f.stored[0].text)) problems.push('stored cards are not worst first');
        }
        facts.asksOpen = await lionAsks();
        if (facts.asksOpen.length !== 1) problems.push(`stored adults asked ${JSON.stringify(facts.asksOpen)} on open, expected once for Lion`);
        await ctx.shot(page, 'kbs_1_trade_stored');
        facts.layout = await layoutFacts(page);
        layoutProblems('stored', facts.layout, problems);

        // 2. hover Sasha: her father lights up in the Savannah column
        await page.locator('.PZ2QoL_kb .PZ2QoL_kbCard.stored', { hasText: 'Sasha' }).first().hover();
        await page.waitForTimeout(200);
        facts.hover = await page.evaluate(id => {
            const c = document.querySelector(`.PZ2QoL_kb .PZ2QoL_kbCard[data-id="${id}"]`);
            return c ? { hot: c.classList.contains('relHot'), label: (c.querySelector('.PZ2QoL_kbRelLabel') || {}).innerText || '' } : null;
        }, father.id);
        if (!facts.hover || !facts.hover.hot) problems.push(`hovering the stored daughter does not light up her father: ${JSON.stringify(facts.hover)}`);
        await ctx.shot(page, 'kbs_2_hover');
        await page.mouse.move(5, 5);

        // 3. not draggable, not selectable: a drag onto a habitat plans nothing
        const from = page.locator('.PZ2QoL_kb .PZ2QoL_kbCard.stored', { hasText: 'Baraka' }).first();
        const to = page.locator('.PZ2QoL_kb .PZ2QoL_kbColRow .PZ2QoL_kbCol').first();
        const a = await from.boundingBox(), b = await to.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2 - 20, a.y + a.height / 2 + 5, { steps: 3 });
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
        facts.ghostDuringDrag = await page.locator('.PZ2QoL_kbDrag').count();
        await page.mouse.up();
        await page.waitForTimeout(250);
        facts.planAfterDrag = await page.evaluate(() => document.querySelectorAll('.PZ2QoL_kbMove').length);
        if (facts.ghostDuringDrag) problems.push('dragging a stored card shows a drag ghost');
        if (facts.planAfterDrag) problems.push(`dragging a stored card planned ${facts.planAfterDrag} move(s)`);
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbCard.stored .PZ2QoL_kbCardName', { hasText: 'Nala' }));
        await page.waitForTimeout(200);
        facts.selectedAfterClick = await page.locator('.PZ2QoL_kb .PZ2QoL_kbCard.stored.selected').count();
        facts.clickNotice = await text(page, '.PZ2QoL_kb .PZ2QoL_kbNotice');
        if (facts.selectedAfterClick) problems.push('a stored card can be selected');

        // 4. a new snapshot re-renders without asking again; Rescan asks once more
        await page.evaluate(async () => {
            const kin = await import('/js/mods/pz2qol/kin.js');
            window.__kbsSnap.seq++;
            kin.applyKinSnapshot(JSON.parse(JSON.stringify(window.__kbsSnap)));
        });
        await page.waitForTimeout(400);
        facts.asksAfterScan = (await lionAsks()).length;
        if (facts.asksAfterScan !== 1) problems.push(`a park scan asked for stored adults again (${facts.asksAfterScan} asks)`);
        await page.evaluate(() => { window.__kbs.mode = 'ten'; });
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kpHead .PZ2QoL_kpBtn', { hasText: 'Rescan' }));
        await page.waitForFunction(() => document.querySelectorAll('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbCard.stored').length === 6, null, { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        facts.asksAfterRescan = (await lionAsks()).length;
        facts.ten = await pinnedFacts(page);
        if (facts.asksAfterRescan !== 2) problems.push(`Rescan: ${facts.asksAfterRescan} asks, expected 2`);
        if (!facts.ten || facts.ten.stored.length !== 6 || !/4 more/.test(facts.ten.more)) problems.push(`10 stored: ${facts.ten && facts.ten.stored.length} cards, more "${facts.ten && facts.ten.more}" (expected 6 and "4 more")`);
        if (facts.ten && facts.ten.counts.trim() !== '1 here · +10 in storage') problems.push(`10 stored head "${facts.ten.counts}"`);
        await ctx.shot(page, 'kbs_3_capped');
        facts.layoutCapped = await layoutFacts(page);
        layoutProblems('stored capped', facts.layoutCapped, problems);
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbStoredMore'));
        await page.waitForTimeout(250);
        facts.all = await pinnedFacts(page);
        if (!facts.all || facts.all.stored.length !== 10 || !/Show fewer/.test(facts.all.more)) problems.push(`"4 more" clicked: ${facts.all && facts.all.stored.length} cards, "${facts.all && facts.all.more}"`);
        // the column body scrolls: the last card sits below the column's bottom edge
        facts.scrolls = await page.evaluate(() => {
            const vp = document.querySelector('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kpScroll.kbColBody > .PZ2QoL_kpViewport');
            return vp ? { sh: vp.scrollHeight, h: Math.round(vp.getBoundingClientRect().height) } : null;
        });
        if (!facts.scrolls || facts.scrolls.sh <= facts.scrolls.h) problems.push(`the trade column body does not scroll with 10 stored: ${JSON.stringify(facts.scrolls)}`);
        await ctx.shot(page, 'kbs_4_all');
        facts.layoutAll = await layoutFacts(page);
        layoutProblems('stored all', facts.layoutAll, problems);
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbStoredMore'));
        await page.waitForTimeout(200);

        // 5. an offline park: no stored cards, the faint note, nothing asked
        const before = (await lionAsks()).length;
        await page.evaluate(async () => {
            const kin = await import('/js/mods/pz2qol/kin.js');
            const snap = JSON.parse(JSON.stringify(window.__kbsSnap));
            snap.mode = 'offline';
            snap.seq = 790;
            kin.applyKinSnapshot(snap);
        });
        await page.waitForTimeout(400);
        facts.offline = await pinnedFacts(page);
        facts.offlineAsks = (await lionAsks()).length - before;
        if (!facts.offline || facts.offline.stored.length || !/Franchise/.test(facts.offline.note) || facts.offlineAsks) problems.push(`offline: ${JSON.stringify(facts.offline)}, ${facts.offlineAsks} asks`);
        if (facts.offline && facts.offline.counts.includes('storage')) problems.push(`offline head still counts storage: "${facts.offline.counts}"`);

        // 6. back in Franchise: the Storage shortcut sends one TradeOpen and closes the board
        await page.evaluate(async () => {
            const kin = await import('/js/mods/pz2qol/kin.js');
            window.__kbsSnap.seq = 791;
            kin.applyKinSnapshot(JSON.parse(JSON.stringify(window.__kbsSnap)));
        });
        await page.waitForFunction(() => document.querySelectorAll('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbCard.stored').length > 0, null, { timeout: 4000 }).catch(() => {});
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbCard.stored .PZ2QoL_kbStoredBtn'));
        await page.waitForTimeout(400);
        facts.opens = (await kbs()).opens;
        facts.closedAfterStorage = !(await page.evaluate(async url => (await import(url)).isSpeciesBoardOpen(), BOARD));
        if (JSON.stringify(facts.opens) !== JSON.stringify([['storage', 'Lion']])) problems.push(`Storage on a stored card sent ${JSON.stringify(facts.opens)}`);
        if (!facts.closedAfterStorage) problems.push('the board did not close after the Storage shortcut');
    }
    finally {
        await page.evaluate(async url => {
            if (window.__kbs) window.__kbs.active = false;
            (await import(url)).closeSpeciesBoard();
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
            (await import('/js/mods/pz2qol/kin.js')).applyKinSnapshot(window.__kinFixture.snapshot);
        }, BOARD);
    }
    if (problems.length) throw new Error('kin board stored: ' + problems.join('; '));
    return facts;
}
