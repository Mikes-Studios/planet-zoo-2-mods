// "Bring to the trade centre" (storagefetch.js, storagesend.js trade runs).
//  HUD (park), Species board: the button in the pinned trade column with the
//  storage count and the trade centre's room (fake PZ2QoL_TradeCounts); one
//  click sends exactly one PZ2QoL_FetchStart (species + the park's own
//  animals as the exclude list) and closes the board; a full trade centre
//  disables it.
//  HUD, after the arrival: PZ2QoL_SendArrived(…, 'trade') runs one animal at
//  a time: one already in the trade centre (no request), moves with
//  "trade:arrival" and the run's seq, a refusal skipped; the summary and
//  "Open the game's Move screen for 1" (one PZ2QoL_SendOpenMove).
//  "Bring all" (fetchAllRow): a second, outlined button under the species
//  one sends PZ2QoL_FetchStart with species '*' and the whole park as the
//  exclude list; on the hub '*' ticks every species' rows (no species chip)
//  except the moving, listed and in-zoo ones, and one Send sends them all.
//  Frontend (Animal Storage): PZ2QoL_FetchPending fresh -> the species'
//  rows ticked (adults first, up to the room; moving and listed rows never),
//  a countdown, then exactly one PZ2QoL_SendArm(n, true, 'trade') and one
//  AnimalStorage_SendToZoo with the ticked keys. A later delivery (not
//  fresh) waits for Send. A selection changed during the countdown and
//  Cancel send nothing.
import { seedZooKin } from './kin_fixture.mjs';
import { layoutFacts, layoutProblems } from './kin_board.mjs';

export const name = 'storagefetch';

const BOARD = '/js/mods/pz2qol/kinboard.js';
const STORAGE = ['hubAnimalsData', 'animalStorageData'];

async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

const cardText = (page, sel = '.PZ2QoL_ssCard') => page.evaluate(s => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() || null, sel);

// ------------------------------------------------------------------ hub

export async function frontend(page, ctx) {
    const facts = {};
    const problems = [];
    facts.problems = problems;
    await ctx.gotoMarketTab(page, 1);
    // five Okapi rows: 2 adults, 1 young, 1 moving, 1 on the market; the rest lions
    const rows = await page.evaluate(async STORAGE => {
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const DS = await import('/js/common/core/DataStore.js');
        const col = new DataStoreCollection(STORAGE.concat('list'));
        for (let i = 0; i < 50 && col._source.length < 6; i++) await new Promise(r => setTimeout(r, 100));
        const ctxs = col._source.slice();
        col.dispose();
        const spec = [
            { name: 'Asha', maturity: 2, gender: 1 },
            { name: 'Bo', maturity: 3, gender: 0 },
            { name: 'Cleo', maturity: 0, gender: 1 },
            { name: 'Dot', maturity: 2, gender: 1, isMoving: true },
            { name: 'Eve', maturity: 2, gender: 1, auctionTimerSeconds: 3600 },
        ];
        const out = [];
        ctxs.forEach((c, i) => {
            const s = spec[i];
            DS.setValue(c, 'species', s ? '[Animal_Okapi]' : '[Animal_Lion]');
            DS.setValue(c, 'isShoal', false);
            DS.setValue(c, 'multiSelected', false);
            DS.setValue(c, 'isMoving', !!(s && s.isMoving));
            DS.setValue(c, 'auctionTimerSeconds', s && s.auctionTimerSeconds ? s.auctionTimerSeconds : 0);
            if (s) {
                DS.setValue(c, 'name', s.name);
                DS.setValue(c, 'maturity', s.maturity);
                DS.setValue(c, 'gender', s.gender);
            }
            // every row: the fake ticking below needs the lions too (Bring all)
            out.push({ key: c[c.length - 1], id: String(DS.getValue(c, 'id')), name: s ? s.name : String(DS.getValue(c, 'name')) });
        });
        DS.setValue(STORAGE, 'selectedAnimalIDs', []);
        DS.setValue(STORAGE.concat('actions'), 'sendToZooAllowed', true);
        // no game filters on (the desk's clear would ask Lua)
        for (const p of ['filterInputText']) DS.setValue(STORAGE.concat('filters'), p, '');
        return out;
    }, STORAGE);
    facts.rows = rows;
    const keyOf = n => rows.find(r => r.name === n).key;
    await page.evaluate(({ STORAGE, rows }) => {
        window.__sf = { events: [] };
        if (window.__sfHooked) return;
        window.__sfHooked = true;
        const rec = (...e) => window.__sf.events.push(e);
        import('/js/common/core/DataStore.js').then(DS => {
            const keyOfId = id => (rows.find(r => r.id === String(id)) || {}).key;
            // the native's ticking, as far as these rows need it
            engine.on('AnimalStorage_SelectAllToggled', on => {
                rec('selectAll', on);
                if (on === false) DS.setValue(STORAGE, 'selectedAnimalIDs', []);
            });
            engine.on('AnimalStorage_ItemCheckboxToggled', (id, on) => {
                rec('tick', String(id), on);
                const k = keyOfId(id);
                if (!k) return;
                const cur = (DS.getValue(STORAGE, 'selectedAnimalIDs') || []).filter(x => x !== k);
                if (on) cur.push(k);
                DS.setValue(STORAGE, 'selectedAnimalIDs', cur);
            });
        });
        engine.on('PZ2QoL_SendArm', (n, target) => rec('arm', n, target));
        engine.on('AnimalStorage_SendToZoo', ids => rec('send', Array.isArray(ids) ? ids.slice() : ids));
        engine.on('PZ2QoL_FetchAck', seq => rec('ack', seq));
        engine.on('PZ2QoL_DeskFilters', (req) => setTimeout(() => engine.trigger('PZ2QoL_DeskFiltersState', req, '{"ok":true,"cleared":true,"detail":""}'), 20));
    }, { STORAGE, rows });
    const events = () => page.evaluate(() => window.__sf.events.slice());
    const resetEvents = () => page.evaluate(() => { window.__sf.events = []; });
    const state = () => page.evaluate(async () => (await import('/js/mods/pz2qol/storagefetch.js'))._fetchState());

    try {
        // 1. fresh, room for 2: Asha and Bo ticked (adults first), countdown, one arm + one send
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 1, 'Okapi', 2, '', true));
        await page.waitForFunction(() => /Sending in/.test(document.querySelector('.PZ2QoL_sfCard')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        facts.countdown = await cardText(page, '.PZ2QoL_sfCard');
        await ctx.shot(page, 'sf_1_hub_countdown');
        if (!/Sending in/.test(facts.countdown || '')) problems.push('no countdown card: ' + facts.countdown);
        if (!/2 animals/.test(facts.countdown || '') || !/room for 2/.test(facts.countdown || '')) problems.push('card counts: ' + facts.countdown);
        if (!/Cleo stays/.test(facts.countdown || '')) problems.push('card does not name who stays: ' + facts.countdown);
        // the curtain covers Storage while the mod works there
        facts.curtain = await page.evaluate(() => {
            const c = document.querySelector('.PZ2QoL_sfCurtain');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, spinner: !!c.querySelector('.PZ2QoL_sfSpinner') };
        });
        if (!facts.curtain || facts.curtain.w < facts.curtain.vw - 2 || facts.curtain.h < facts.curtain.vh - 2) problems.push('no full-screen curtain: ' + JSON.stringify(facts.curtain));
        facts.sel1 = await page.evaluate(async S => (await import('/js/common/core/DataStore.js')).getValue(S, 'selectedAnimalIDs'), STORAGE);
        if (JSON.stringify((facts.sel1 || []).slice().sort()) !== JSON.stringify([keyOf('Asha'), keyOf('Bo')].sort())) problems.push('ticked ' + JSON.stringify(facts.sel1) + ' events ' + JSON.stringify(await events()));
        await page.waitForTimeout(3600);
        facts.ev1 = await events();
        const arms = facts.ev1.filter(e => e[0] === 'arm');
        const sends = facts.ev1.filter(e => e[0] === 'send');
        if (arms.length !== 1 || arms[0][1] !== 2 || arms[0][2] !== 'trade') problems.push('arm: ' + JSON.stringify(arms));
        if (sends.length !== 1 || JSON.stringify(sends[0][1].slice().sort()) !== JSON.stringify([keyOf('Asha'), keyOf('Bo')].sort())) problems.push('send: ' + JSON.stringify(sends));
        if (facts.ev1.findIndex(e => e[0] === 'arm') > facts.ev1.findIndex(e => e[0] === 'send')) problems.push('send before arm');
        if (!facts.ev1.some(e => e[0] === 'ack' && e[1] === 1)) problems.push('request 1 not acknowledged');
        if (facts.ev1.some(e => e[0] === 'tick' && (e[1] === rows.find(r => r.name === 'Dot').id || e[1] === rows.find(r => r.name === 'Eve').id))) problems.push('a moving or listed row was ticked');
        facts.sent = await cardText(page, '.PZ2QoL_sfCard');
        await ctx.shot(page, 'sf_2_hub_sent');
        if (!/Send to Zoo/.test(facts.sent || '')) problems.push('sent card: ' + facts.sent);
        // the hub page outlives the switch to the zoo: the curtain must go by itself
        await page.waitForTimeout(8600);
        if (await page.locator('.PZ2QoL_sfCurtain').count()) problems.push('the curtain stays after the send');

        // 2. a later delivery (not fresh), Bo already in the zoo: waits for Send, then Asha + Cleo
        await page.evaluate(async () => {
            // the zoo loads after a real send; here the page stays: start over
            (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch();
        });
        await resetEvents();
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 2, 'Okapi', -1, 'n:0:okapi:bo', false));
        await page.waitForFunction(() => /\bSend\b/.test(document.querySelector('.PZ2QoL_sfCard .PZ2QoL_ssButtons')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(3600);
        facts.stale = await cardText(page, '.PZ2QoL_sfCard');
        await ctx.shot(page, 'sf_3_hub_stale');
        facts.ev2 = await events();
        if (facts.ev2.some(e => e[0] === 'send')) problems.push('a not-fresh request sent without a click');
        if (!/already in this zoo/.test(facts.stale || '')) problems.push('stale card lacks the in-zoo line: ' + facts.stale);
        await click(page.locator('.PZ2QoL_sfCard .PZ2QoL_ssCardBtn', { hasText: /^Send$/ }));
        await page.waitForTimeout(500);
        facts.ev2b = await events();
        const s2 = facts.ev2b.filter(e => e[0] === 'send');
        if (s2.length !== 1 || JSON.stringify(s2[0][1].slice().sort()) !== JSON.stringify([keyOf('Asha'), keyOf('Cleo')].sort())) problems.push('stale send: ' + JSON.stringify(s2));

        // 3. selection changed during the countdown: nothing is sent
        await page.evaluate(async () => (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch());
        await resetEvents();
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 3, 'Okapi', 1, '', true));
        await page.waitForFunction(() => /Sending in/.test(document.querySelector('.PZ2QoL_sfCard')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        await page.evaluate(id => engine.trigger('AnimalStorage_ItemCheckboxToggled', id, true), rows.find(r => r.name === 'Cleo').id);
        await page.waitForTimeout(3800);
        facts.changed = await cardText(page, '.PZ2QoL_sfCard');
        facts.ev3 = await events();
        await ctx.shot(page, 'sf_4_hub_changed');
        if (facts.ev3.some(e => e[0] === 'send' || e[0] === 'arm')) problems.push('sent after the selection changed');
        if (!/selection changed/.test(facts.changed || '')) problems.push('changed card: ' + facts.changed);

        // 4. Cancel: nothing sent, acknowledged
        await page.evaluate(async () => (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch());
        await resetEvents();
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 4, 'Okapi', 5, '', true));
        await page.waitForFunction(() => /Sending in/.test(document.querySelector('.PZ2QoL_sfCard')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        await click(page.locator('.PZ2QoL_sfCard .PZ2QoL_ssCardBtn', { hasText: 'Cancel' }));
        await page.waitForTimeout(3500);
        facts.ev4 = await events();
        if (facts.ev4.some(e => e[0] === 'send' || e[0] === 'arm')) problems.push('sent after Cancel');
        if (!facts.ev4.some(e => e[0] === 'ack' && e[1] === 4)) problems.push('Cancel did not acknowledge');
        if (await page.locator('.PZ2QoL_sfCard').count()) problems.push('card still shown after Cancel');

        // 5. a new request right after a send runs (the first in-game run left
        //    the sent job in place and every later request waited behind it)
        await page.evaluate(async () => (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch());
        await resetEvents();
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 5, 'Okapi', 1, '', true));
        await page.waitForFunction(() => /Sending in/.test(document.querySelector('.PZ2QoL_sfCard')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        await click(page.locator('.PZ2QoL_sfCard .PZ2QoL_ssCardBtn', { hasText: 'Send now' }));
        await page.waitForTimeout(300);
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 6, 'Okapi', -1, '', false));
        await page.waitForFunction(() => /\bSend\b/.test(document.querySelector('.PZ2QoL_sfCard .PZ2QoL_ssButtons')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        facts.next = await state();
        if (!facts.next.job || facts.next.job.seq !== 6 || facts.next.job.phase !== 'ready') problems.push('a request after a send did not run: ' + JSON.stringify(facts.next));
        // Cancel takes the species chip off again
        await click(page.locator('.PZ2QoL_sfCard .PZ2QoL_ssCardBtn', { hasText: 'Cancel' }));
        await page.waitForTimeout(400);
        facts.chipAfter = await page.evaluate(async () => (await import('/js/mods/pz2qol/listfilter.js')).getStorageFilters().species);
        if (facts.chipAfter) problems.push('species chip left on: ' + facts.chipAfter);

        // 6. "Bring all": every species, Bo already in the zoo, no room cap
        await page.evaluate(async () => {
            (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch();
            // a chip left from an earlier species jump must not hide rows
            (await import('/js/mods/pz2qol/listfilter.js')).setStorageFilters({ species: 'Okapi' });
        });
        await resetEvents();
        facts.allExpected = await page.evaluate(async S => {
            const DS = await import('/js/common/core/DataStore.js');
            const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
            const col = new DataStoreCollection(S.concat('list'));
            await new Promise(r => setTimeout(r, 100));
            const keys = col._source.filter(c => !DS.getValue(c, 'isMoving') && !(DS.getValue(c, 'auctionTimerSeconds') > 0) && DS.getValue(c, 'name') !== 'Bo').map(c => c[c.length - 1]);
            col.dispose();
            return keys;
        }, STORAGE);
        await page.evaluate(() => engine.trigger('PZ2QoL_FetchPending', 7, '*', -1, 'n:0:okapi:bo', false));
        await page.waitForFunction(() => /\bSend\b/.test(document.querySelector('.PZ2QoL_sfCard .PZ2QoL_ssButtons')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
        facts.allCard = await cardText(page, '.PZ2QoL_sfCard');
        await ctx.shot(page, 'sf_9_hub_all');
        if (!/stored animals/.test(facts.allCard || '')) problems.push('all card title: ' + facts.allCard);
        facts.allChip = await page.evaluate(async () => (await import('/js/mods/pz2qol/listfilter.js')).getStorageFilters().species);
        if (facts.allChip) problems.push('Bring all left a species chip on: ' + facts.allChip);
        if (!/\bSend\b/.test(facts.allCard || '')) throw new Error('Bring all card has no Send: ' + facts.allCard + ' state ' + JSON.stringify(await state()));
        await click(page.locator('.PZ2QoL_sfCard .PZ2QoL_ssCardBtn', { hasText: /^Send$/ }));
        await page.waitForTimeout(500);
        facts.ev6 = await events();
        const s6 = facts.ev6.filter(e => e[0] === 'send');
        const a6 = facts.ev6.filter(e => e[0] === 'arm');
        if (s6.length !== 1 || JSON.stringify(s6[0][1].slice().sort()) !== JSON.stringify(facts.allExpected.slice().sort())) problems.push(`all send (${facts.allExpected.length} expected): ` + JSON.stringify(s6));
        if (a6.length !== 1 || a6[0][1] !== facts.allExpected.length || a6[0][2] !== 'trade') problems.push('all arm: ' + JSON.stringify(a6));
        facts.state = await state();
    }
    finally {
        await page.evaluate(async S => {
            (await import('/js/mods/pz2qol/storagefetch.js'))._resetFetch();
            (await import('/js/mods/pz2qol/listfilter.js')).resetStorageFilters();
            const DS = await import('/js/common/core/DataStore.js');
            DS.setValue(S, 'selectedAnimalIDs', []);
        }, STORAGE);
    }
    if (problems.length) throw new Error('bring to trade centre (storage): ' + problems.join('; '));
    return facts;
}

// ------------------------------------------------------------------ park

export async function hud(page, ctx) {
    const facts = {};
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
    await page.evaluate(async () => {
        (await import('/js/mods/pz2qol/kinboard.js')).closeSpeciesBoard();
        (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
        const DS = await import('/js/common/core/DataStore.js');
        DS.setValue(['park'], 'hasBuildingForAnimalStorage', true);
        DS.setValue(['ui', 'HUD'], 'hubDisabled', false);
        const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
        snap.mode = 'franchise';
        snap.seq = 801;
        snap.tradeCentre = { id: '501', name: 'Trade Centre' };
        snap.animals.push({
            id: '8121', key: 'animal_8121', guid: '81210042', name: 'Zawadi', species: 'Lion', sex: 1, juv: false, contra: false,
            infertile: false, preg: false, hab: '', loc: 'Trade Centre', lt: 'trade', par: [], mates: [],
        });
        for (const a of snap.animals) if (!a.lt) a.lt = a.hab ? 'habitat' : 'other';
        window.__sfSnap = snap;
        (await import('/js/mods/pz2qol/kin.js')).applyKinSnapshot(snap);
        window.__sfp = { active: true, tc: [3, 12], starts: [], counts: 0 };
        for (const ev of ['PZ2QoL_TradeCounts', 'PZ2QoL_FetchStart', 'PZ2QoL_KinStored']) if (engine.events) engine.events[ev] = [];
        engine.on('PZ2QoL_TradeCounts', (reqId, csv) => {
            const k = window.__sfp;
            if (!k || !k.active) return;
            k.counts++;
            const bySpecies = {};
            for (const sp of String(csv).split(',')) bySpecies[sp] = { m: 2, f: 3 };
            setTimeout(() => engine.trigger('PZ2QoL_TradeCountsResult', reqId, JSON.stringify({ ok: true, mode: 'franchise', tc: true, tcNow: k.tc[0], tcMax: k.tc[1], bySpecies })), 30);
        });
        engine.on('PZ2QoL_KinStored', (reqId, species) => {
            if (!window.__sfp || !window.__sfp.active) return;
            const json = JSON.stringify({ species, animals: [{ id: 'sS9', guid: 'S9', name: 'Stored Nine', species, sex: 1, maturity: 2, par: [] }], anc: {} });
            setTimeout(() => engine.trigger('PZ2QoL_KinStoredChunk', reqId, 1, 1, json), 50);
        });
        engine.on('PZ2QoL_FetchStart', (reqId, species, exclude) => {
            const k = window.__sfp;
            if (!k || !k.active) return;
            k.starts.push([String(species), String(exclude)]);
            setTimeout(() => engine.trigger('PZ2QoL_FetchStartResult', reqId, true, '', 9), 30);
        });
        (await import('/js/mods/pz2qol/tradejump.js')).requestStorageCounts(['Lion'], { force: true });
    });
    // an earlier scenario may still have a counts request open: ask until ours answers
    for (let i = 0; i < 20; i++) {
        const got = await page.evaluate(async () => {
            const tj = await import('/js/mods/pz2qol/tradejump.js');
            const c = tj.getStorageCounts('Lion');
            const tc = tj.getTradeCentreInfo();
            if (c && tc && tc.tcMax === 12) return true;
            tj.requestStorageCounts(['Lion'], { force: true });
            return false;
        });
        if (got) break;
        await page.waitForTimeout(300);
    }
    const sfp = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__sfp)));
    const fetchFacts = () => page.evaluate(() => {
        const row = document.querySelector('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbFetch');
        if (!row) return null;
        const btn = row.querySelector('.PZ2QoL_kbFetchBtn');
        const r = row.getBoundingClientRect();
        const col = row.closest('.PZ2QoL_kbCol').getBoundingClientRect();
        return {
            text: row.innerText.replace(/\s+/g, ' ').trim(),
            disabled: btn.classList.contains('disabled'),
            inside: r.left >= col.left - 1 && r.right <= col.right + 1,
            box: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };
    });

    try {
        // 1. the board: the button in the pinned trade column
        await page.evaluate(async url => (await import(url)).openSpeciesBoard({ species: 'Lion' }), BOARD);
        await page.waitForSelector('.PZ2QoL_kb:not(.hidden) .PZ2QoL_kbPinned .PZ2QoL_kbFetch', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(800);
        facts.button = await fetchFacts();
        await ctx.shot(page, 'sf_5_board_button');
        if (!facts.button) problems.push('no "Bring … to the trade centre" row in the pinned trade column');
        else {
            if (!/Bring Lion to the trade centre/.test(facts.button.text)) problems.push('button text: ' + facts.button.text);
            if (!/5 adults in storage/.test(facts.button.text) || !/storage, all zoos 3\/12/.test(facts.button.text)) problems.push('note: ' + facts.button.text);
            if (facts.button.disabled) problems.push('button disabled with room');
            if (!facts.button.inside) problems.push('button spills out of the column: ' + JSON.stringify(facts.button.box));
        }
        facts.layout = await layoutFacts(page);
        layoutProblems('fetch', facts.layout, problems);
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbFetchBtn'));
        await page.waitForTimeout(600);
        facts.starts = (await sfp()).starts;
        facts.closed = !(await page.evaluate(async url => (await import(url)).isSpeciesBoardOpen(), BOARD));
        if (facts.starts.length !== 1 || facts.starts[0][0] !== 'Lion') problems.push('FetchStart: ' + JSON.stringify(facts.starts));
        else if (!facts.starts[0][1].split(',').includes('g:81210042') || !facts.starts[0][1].split(',').includes('n:1:lion:zawadi')) problems.push('exclude list: ' + facts.starts[0][1]);
        if (!facts.closed) problems.push('the board did not close after the click');

        // 1b. "Bring all": the outlined button under it, species '*', the whole park excluded
        await page.evaluate(async url => (await import(url)).openSpeciesBoard({ species: 'Lion' }), BOARD);
        await page.waitForSelector('.PZ2QoL_kb:not(.hidden) .PZ2QoL_kbPinned .PZ2QoL_kbFetch.all', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(500);
        facts.allButton = await page.evaluate(() => {
            const row = document.querySelector('.PZ2QoL_kb .PZ2QoL_kbPinned .PZ2QoL_kbFetch.all');
            if (!row) return null;
            const r = row.getBoundingClientRect();
            const col = row.closest('.PZ2QoL_kbCol').getBoundingClientRect();
            return { text: row.innerText.replace(/\s+/g, ' ').trim(), disabled: row.querySelector('.PZ2QoL_kbFetchBtn').classList.contains('disabled'), inside: r.left >= col.left - 1 && r.right <= col.right + 1 };
        });
        await ctx.shot(page, 'sf_5b_board_all');
        if (!facts.allButton) problems.push('no "Bring all" row');
        else {
            if (!/Bring all stored animals to the trade centre/.test(facts.allButton.text) || !/Every species · Storage, all zoos 3\/12/.test(facts.allButton.text)) problems.push('all button: ' + facts.allButton.text);
            if (facts.allButton.disabled || !facts.allButton.inside) problems.push('all button state: ' + JSON.stringify(facts.allButton));
        }
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbFetchBtn.all'));
        await page.waitForTimeout(600);
        facts.allStarts = (await sfp()).starts;
        const allStart = facts.allStarts[1];
        // (the harness's dummy GUIDs are words; only the id-like ones go in the list)
        const parkGuids = await page.evaluate(() => window.__sfSnap.animals.filter(a => a.guid && /^[\w.-]+$/.test(a.guid)).map(a => 'g:' + a.guid));
        if (facts.allStarts.length !== 2 || !allStart || allStart[0] !== '*') problems.push('all FetchStart: ' + JSON.stringify(facts.allStarts));
        else {
            const miss = parkGuids.filter(g => !allStart[1].split(',').includes(g));
            if (miss.length) problems.push(`all exclude list misses ${miss.length} of ${parkGuids.length} park animals (${miss.slice(0, 3)}; list ${allStart[1].slice(0, 120)})`);
        }
        if (await page.evaluate(async url => (await import(url)).isSpeciesBoardOpen(), BOARD)) problems.push('the board did not close after Bring all');

        // 2. a full trade centre: disabled with the reason
        await page.evaluate(async () => {
            window.__sfp.tc = [12, 12];
            (await import('/js/mods/pz2qol/tradejump.js')).requestStorageCounts(['Lion'], { force: true });
        });
        await page.waitForTimeout(300);
        await page.evaluate(async url => (await import(url)).openSpeciesBoard({ species: 'Lion' }), BOARD);
        await page.waitForTimeout(900);
        facts.full = await fetchFacts();
        await ctx.shot(page, 'sf_6_board_full');
        if (!facts.full || !facts.full.disabled || !/full \(all zoos, 12\/12\)/.test(facts.full.text)) problems.push('full: ' + JSON.stringify(facts.full));
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbFetchBtn'));
        await page.waitForTimeout(300);
        facts.allFull = await page.evaluate(() => document.querySelector('.PZ2QoL_kb .PZ2QoL_kbFetchBtn.all')?.classList.contains('disabled'));
        if (facts.allFull !== true) problems.push('Bring all not disabled when full');
        if ((await sfp()).starts.length !== 2) problems.push('a disabled button sent FetchStart');
        await page.evaluate(async url => (await import(url)).closeSpeciesBoard(), BOARD);

        // 3. the arrivals: one already there, two sent, one refused -> Move screen button
        await page.evaluate(async () => (await import('/js/mods/pz2qol/pace.js')).setPace('moves', 1));
        await page.evaluate(() => {
            const A = { 201: { name: 'Asha', lt: 'trade' }, 202: { name: 'Bo' }, 203: { name: 'Cleo', refuse: true }, 204: { name: 'Dot', boxed: true } };
            const st = window.__sfa = { moves: [], opens: [], lt: {} };
            if (window.__sfaHooked) return;
            window.__sfaHooked = true;
            engine.on('PZ2QoL_SendFacts', (req, id) => {
                const s = window.__sfa;
                const a = A[id];
                const f = a ? { id, name: a.name, species: 'Okapi', alive: true, lt: s.lt[id] || a.lt || 'other', moving: false, boxed: !!a.boxed, busy: false, mode: 'franchise', tc: '501', tcNow: 3, tcMax: 12, habitats: [], parentHabs: [] } : { id, gone: true };
                setTimeout(() => engine.trigger('PZ2QoL_SendFactsResult', req, JSON.stringify(f)), 20);
            });
            engine.on('PZ2QoL_SendMove', (req, id, hab, seq) => {
                const s = window.__sfa;
                s.moves.push([String(id), String(hab), seq, Date.now()]);
                const ok = !A[id].refuse;
                if (ok) setTimeout(() => { s.lt[id] = 'trade'; }, 300);
                setTimeout(() => engine.trigger('PZ2QoL_SendMoveResult', req, ok, ok ? '' : 'The game refused to send it to the trade centre.'), 20);
            });
            engine.on('PZ2QoL_SendOpenMove', (req, ids) => {
                window.__sfa.opens.push(String(ids));
                setTimeout(() => engine.trigger('PZ2QoL_SendOpenMoveResult', req, true, ''), 20);
            });
        });
        await page.evaluate(() => engine.trigger('PZ2QoL_SendArrived', 31, '201,202,203,204', 'trade'));
        await page.waitForTimeout(1200);
        facts.running = await cardText(page);
        await ctx.shot(page, 'sf_7_park_running');
        if (!/Bring to trade centre/.test(facts.running || '') || !/Stop/.test(facts.running || '')) problems.push('no trade run card: ' + facts.running);
        await page.waitForFunction(() => /Close/.test(document.querySelector('.PZ2QoL_ssCard')?.innerText || ''), null, { timeout: 40000 });
        facts.done = await cardText(page);
        facts.moves = await page.evaluate(() => window.__sfa.moves.slice());
        await ctx.shot(page, 'sf_8_park_summary');
        if (JSON.stringify(facts.moves.map(m => m[0])) !== JSON.stringify(['202', '203', '204'])) problems.push('moves: ' + JSON.stringify(facts.moves));
        if (facts.moves.some(m => m[1] !== 'trade:arrival' || Number(m[2]) !== 31)) problems.push('move args: ' + JSON.stringify(facts.moves));
        for (let i = 1; i < facts.moves.length; i++) if (facts.moves[i][3] - facts.moves[i - 1][3] < 950) problems.push(`moves ${i - 1}->${i} too close`);
        if (!/3 of 4 in or on the way/.test(facts.done || '')) problems.push('summary: ' + facts.done);
        if (!/1 already waiting/.test(facts.done || '') || !/refused/.test(facts.done || '')) problems.push('summary lines: ' + facts.done);
        if (!/Open the game's Move screen for 1/.test(facts.done || '')) problems.push('no Move screen button: ' + facts.done);
        await click(page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: "Move screen" }));
        await page.waitForTimeout(500);
        facts.opens = await page.evaluate(() => window.__sfa.opens.slice());
        if (JSON.stringify(facts.opens) !== JSON.stringify(['203'])) problems.push('SendOpenMove: ' + JSON.stringify(facts.opens));
        if (await page.locator('.PZ2QoL_ssCard').count()) problems.push('card still open after the Move screen opened');
    }
    finally {
        await page.evaluate(async url => {
            if (window.__sfp) window.__sfp.active = false;
            (await import(url)).closeSpeciesBoard();
            (await import('/js/mods/pz2qol/kinmoves.js'))._clearStoredCache();
            (await import('/js/mods/pz2qol/kin.js')).applyKinSnapshot(window.__kinFixture.snapshot);
            (await import('/js/mods/pz2qol/pace.js')).setPace('moves', 0.5);
        }, BOARD);
        await page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: 'Close' }).click().catch(() => {});
    }
    if (problems.length) throw new Error('bring to trade centre (park): ' + problems.join('; '));
    return facts;
}
