// "Find a habitat" (storagesend.js).
//  Frontend (Animal Storage): the button under the game's Send to Zoo, its
//  label and enable rules, Franchise enabled without a switch, and that
//  one click sends PZ2QoL_SendArm(count) and then the game's own
//  AnimalStorage_SendToZoo for exactly the selection.
//  HUD (park): Lua hands the animals over (PZ2QoL_SendArrived); a fake Lua
//  answers PZ2QoL_SendFacts / PZ2QoL_SendMove. Checks one move at a time,
//  each after the previous one was confirmed and a pause, the best habitat
//  (parent's, then the species'), skips (no habitat, refused) with the run
//  carrying on, the summary, Stop, and Franchise (the click is the go-ahead).

const STORAGE = ['hubAnimalsData', 'animalStorageData'];

export async function frontend(page, ctx) {
    const facts = {};
    const problems = [];
    await ctx.gotoMarketTab(page, 1);
    const keys = await page.evaluate(async () => {
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(['hubAnimalsData', 'animalStorageData', 'list']);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const out = col._source.slice(0, 3).map(c => c[c.length - 1]);
        col.dispose();
        return out;
    });
    await page.evaluate(({ keys, STORAGE }) => {
        // the dummy data may say Franchise: start from an offline hub
        window.__PZ2QOL_TEST_FRANCHISE = false;
        window.__ss = [];
        if (!window.__ssHooked) {
            window.__ssHooked = true;
            engine.on('PZ2QoL_SendArm', (n, online) => window.__ss.push(['arm', n, online]));
            engine.on('PZ2QoL_SendDisarm', () => window.__ss.push(['disarm']));
            engine.on('AnimalStorage_SendToZoo', ids => window.__ss.push(['send', Array.isArray(ids) ? ids.slice() : ids]));
        }
        import('/js/common/core/DataStore.js').then(DS => {
            for (const k of keys) {
                DS.setValue(STORAGE.concat(['list', k]), 'multiSelected', true);
                DS.setValue(STORAGE.concat(['list', k]), 'isMoving', false);
            }
            DS.setValue(STORAGE.concat(['actions']), 'sendToZooAllowed', true);
            DS.setValue(STORAGE, 'selectedAnimalIDs', keys);
        });
    }, { keys, STORAGE });
    await page.waitForTimeout(900);
    const readRow = () => page.evaluate(() => {
        const row = document.querySelector('.AnimalStorageInfoPanel_root .PZ2QoL_ssRow');
        if (!row) return null;
        const prev = row.previousElementSibling;
        const btn = row.firstElementChild;
        const r = row.getBoundingClientRect();
        return {
            text: row.innerText.replace(/\s+/g, ' ').trim(),
            afterSendRow: !!(prev && /SendToZoo/.test(prev.textContent)),
            disabled: !!(btn && (btn.className.includes('disabled') || btn.querySelector('.disabled'))),
            switchShown: !!row.querySelector('.PZ2QoL_ssSwitch'),
            box: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };
    });
    facts.offline = await readRow();
    await ctx.shot(page, 'ss_1_storage_button');
    if (!facts.offline) problems.push('no "Find a habitat" row in the storage info panel');
    else {
        if (!/Find a habitat \(3\)/.test(facts.offline.text)) problems.push(`button text "${facts.offline.text}"`);
        if (!facts.offline.afterSendRow) problems.push('row not right under Send to Zoo');
        if (facts.offline.disabled) problems.push('button disabled offline with a selection');
        if (facts.offline.switchShown) problems.push('Franchise switch shown outside Franchise');
    }

    // Franchise: works straight away, no switch (the click is the opt-in, 2026-10-16)
    await page.evaluate(async () => {
        window.__PZ2QOL_TEST_FRANCHISE = true;
        const DS = await import('/js/common/core/DataStore.js');
        const ids = DS.getValue(['hubAnimalsData', 'animalStorageData'], 'selectedAnimalIDs');
        DS.setValue(['hubAnimalsData', 'animalStorageData'], 'selectedAnimalIDs', ids.slice());
    });
    await page.waitForTimeout(700);
    facts.franchiseOn = await readRow();
    await ctx.shot(page, 'ss_2_storage_franchise');
    if (!facts.franchiseOn || facts.franchiseOn.disabled || facts.franchiseOn.switchShown) problems.push('Franchise: button should be enabled with no switch: ' + JSON.stringify(facts.franchiseOn));

    // one click: the arm, then the game's own Send to Zoo, nothing else
    await page.evaluate(() => { window.__ss = []; });
    await page.locator('.AnimalStorageInfoPanel_root .PZ2QoL_ssRow > *').first().click();
    await page.waitForTimeout(600);
    facts.events = await page.evaluate(() => window.__ss.slice());
    await ctx.shot(page, 'ss_3_storage_after_click');
    const ev = facts.events;
    if (!ev.length || ev[0][0] !== 'arm' || ev[0][1] !== 3 || ev[0][2] !== true) problems.push('first event should be the arm (3, online ok): ' + JSON.stringify(ev));
    const sends = ev.filter(e => e[0] === 'send');
    if (sends.length !== 1 || JSON.stringify(sends[0][1]) !== JSON.stringify(keys)) problems.push('exactly one Send to Zoo with the selection expected: ' + JSON.stringify(ev));
    if (ev.some(e => e[0] === 'disarm')) problems.push('our own send disarmed itself');
    // the game's own Send to Zoo pressed later disarms
    await page.evaluate(() => { window.__ss = []; window.__PZ2QOL_TEST_FRANCHISE = false; });
    await page.waitForTimeout(1100);
    await page.evaluate(k => engine.trigger('AnimalStorage_SendToZoo', k), keys);
    facts.vanillaSend = await page.evaluate(() => window.__ss.slice());
    if (!facts.vanillaSend.some(e => e[0] === 'disarm')) problems.push('the game\'s own Send to Zoo did not disarm');

    await page.evaluate(async ({ keys, STORAGE }) => {
        (await import('/js/mods/pz2qol/storagesend.js')).setSendAllowedOnline(false);
        window.__PZ2QOL_TEST_FRANCHISE = undefined;
        const DS = await import('/js/common/core/DataStore.js');
        for (const k of keys) {
            DS.setValue(STORAGE.concat(['list', k]), 'multiSelected', false);
            DS.setValue(STORAGE.concat(['list', k]), 'isMoving', false);
        }
        DS.setValue(STORAGE, 'selectedAnimalIDs', []);
    }, { keys, STORAGE });
    facts.problems = problems;
    if (problems.length) throw new Error('find a habitat (storage): ' + problems.join('; '));
    return facts;
}

// The fake zoo: habitats 500 (lions, the cub's parents), 501 (tigers), 502 (zebras)
const HABS = [
    { id: '500', name: 'Pride Rock', lions: 4, tigers: 0 },
    { id: '501', name: 'Tiger Ridge', lions: 0, tigers: 2 },
    { id: '502', name: 'Zebra Plains', lions: 0, tigers: 0 },
];
const ANIMALS = {
    101: { name: 'Kesi', species: 'Lion', parentHabs: ['500'] },
    102: { name: 'Raja', species: 'Tiger', parentHabs: [] },
    103: { name: 'Pip', species: 'Penguin', parentHabs: [] }, // no habitat accepts it
    104: { name: 'Tau', species: 'Lion', parentHabs: [], refuse: true },
    105: { name: 'Zuri', species: 'Lion', parentHabs: [] },
};

async function installFakeLua(page, mode) {
    await page.evaluate(({ HABS, ANIMALS, mode }) => {
        const st = window.__ssFake = { mode, moving: {}, moves: [], facts: 0, acks: [] };
        const factsOf = id => {
            const a = ANIMALS[id];
            if (!a) return { id, gone: true, mode: st.mode };
            return {
                id, name: a.name, species: a.species, alive: true, lt: 'other', moving: !!st.moving[id], assigned: '', busy: false, mode: st.mode,
                parentHabs: a.parentHabs,
                habitats: HABS.map(h => {
                    const ok = (a.species === 'Lion' && h.id === '500') || (a.species === 'Tiger' && h.id === '501') || (a.species === 'Lion' && h.id === '502');
                    return { id: h.id, name: h.name, ok, reach: ok ? true : undefined, total: h.lions + h.tigers, same: a.species === 'Lion' ? h.lions : a.species === 'Tiger' ? h.tigers : 0, crowded: false };
                }),
            };
        };
        if (!window.__ssFakeHooked) {
            window.__ssFakeHooked = true;
            engine.on('PZ2QoL_SendFacts', (req, id) => {
                const s = window.__ssFake;
                s.facts++;
                setTimeout(() => engine.trigger('PZ2QoL_SendFactsResult', req, JSON.stringify(s.factsOf(id))), 30);
            });
            engine.on('PZ2QoL_SendMove', (req, id, hab) => {
                const s = window.__ssFake;
                s.moves.push({ id, hab, t: Date.now(), movingBefore: Object.keys(s.moving).filter(k => s.moving[k] === 'pending') });
                const a = s.animals[id];
                const ok = !!a && !a.refuse;
                if (ok) {
                    // the keeper gets the job a little later (confirmation)
                    s.moving[id] = 'pending';
                    setTimeout(() => { s.moving[id] = true; }, 400);
                }
                setTimeout(() => engine.trigger('PZ2QoL_SendMoveResult', req, ok, ok ? '' : 'The game refused the move.'), 30);
            });
            engine.on('PZ2QoL_SendAck', seq => window.__ssFake.acks.push(seq));
        }
        st.factsOf = id => {
            const f = factsOf(id);
            if (f.moving === 'pending') f.moving = false;
            if (st.moving[id] === 'pending') f.moving = false;
            return f;
        };
        st.animals = ANIMALS;
    }, { HABS, ANIMALS, mode });
}

const cardText = page => page.evaluate(() => document.querySelector('.PZ2QoL_ssCard')?.innerText.replace(/\s+/g, ' ').trim() || null);

export async function hud(page, ctx) {
    const facts = {};
    const problems = [];
    await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 0));
    await page.waitForTimeout(500);
    await page.evaluate(async () => (await import('/js/mods/pz2qol/pace.js')).setPace('moves', 1));
    await installFakeLua(page, 'offline');

    // 1. a full run
    await page.evaluate(() => engine.trigger('PZ2QoL_SendArrived', 1, '101,102,103,104,105', 'habitat'));
    await page.waitForTimeout(1500);
    facts.midRun = await cardText(page);
    await ctx.shot(page, 'ss_4_park_running');
    if (!facts.midRun || !/Find a habitat/.test(facts.midRun) || !/Stop/.test(facts.midRun)) problems.push('no progress card with Stop: ' + facts.midRun);
    await page.waitForFunction(() => /Close/.test(document.querySelector('.PZ2QoL_ssCard')?.innerText || ''), null, { timeout: 30000 });
    facts.done = await cardText(page);
    facts.moves = await page.evaluate(() => window.__ssFake.moves.map(m => ({ id: m.id, hab: m.hab, t: m.t, pendingBefore: m.movingBefore })));
    facts.acks = await page.evaluate(() => window.__ssFake.acks.slice());
    await ctx.shot(page, 'ss_5_park_summary');
    const want = [['101', '500'], ['102', '501'], ['104', '500'], ['105', '500']];
    if (JSON.stringify(facts.moves.map(m => [m.id, m.hab])) !== JSON.stringify(want)) problems.push('moves: ' + JSON.stringify(facts.moves.map(m => [m.id, m.hab])) + ' want ' + JSON.stringify(want));
    for (let i = 1; i < facts.moves.length; i++) {
        const gap = facts.moves[i].t - facts.moves[i - 1].t;
        if (gap < 950) problems.push(`moves ${i - 1}->${i} only ${gap} ms apart`);
        if (facts.moves[i].pendingBefore.length) problems.push(`move ${i} sent while ${facts.moves[i].pendingBefore} was unconfirmed`);
    }
    if (!/Sent 3 of 5/.test(facts.done || '')) problems.push('summary: ' + facts.done);
    if (!/no habitat accepts Penguin/.test(facts.done || '')) problems.push('summary lacks the Penguin skip reason');
    if (!/refused/.test(facts.done || '')) problems.push('summary lacks the refusal');
    if (!/Pride Rock/.test(facts.done || '')) problems.push('summary lacks the habitats');
    if (!facts.acks.includes(1)) problems.push('arrival not acknowledged');
    facts.cardBox = await page.evaluate(() => { const r = document.querySelector('.PZ2QoL_ssCard').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
    if (facts.cardBox.l < 0 || facts.cardBox.t < 0 || facts.cardBox.l + facts.cardBox.w > 1920 || facts.cardBox.t + facts.cardBox.h > 1080) problems.push('card off screen: ' + JSON.stringify(facts.cardBox));
    await page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: 'Close' }).click();
    if (await page.locator('.PZ2QoL_ssCard').count()) problems.push('Close did not close the card');

    // 2. Stop: ends before the next animal
    await page.evaluate(() => { window.__ssFake.moves = []; window.__ssFake.moving = {}; });
    await page.evaluate(() => engine.trigger('PZ2QoL_SendArrived', 2, '101,102,105', 'habitat'));
    await page.waitForFunction(() => window.__ssFake.moves.length >= 1, null, { timeout: 10000 });
    await page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: 'Stop' }).click();
    await page.waitForFunction(() => /Close/.test(document.querySelector('.PZ2QoL_ssCard')?.innerText || ''), null, { timeout: 20000 });
    facts.stopped = { text: await cardText(page), moves: await page.evaluate(() => window.__ssFake.moves.length) };
    await ctx.shot(page, 'ss_6_park_stopped');
    if (facts.stopped.moves !== 1) problems.push(`Stop: ${facts.stopped.moves} moves sent (want 1)`);
    if (!/not tried \(stopped\)/.test(facts.stopped.text || '')) problems.push('Stop summary: ' + facts.stopped.text);
    await page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: 'Close' }).click();

    // 3. Franchise: the player's click is the go-ahead, the animal is placed
    await page.evaluate(() => { window.__ssFake.moves = []; window.__ssFake.moving = {}; window.__ssFake.mode = 'franchise'; });
    await page.evaluate(() => engine.trigger('PZ2QoL_SendArrived', 3, '101', 'habitat'));
    await page.waitForFunction(() => window.__ssFake.moves.length >= 1, null, { timeout: 10000 }).catch(() => {});
    facts.franchise = { text: await cardText(page), moves: await page.evaluate(() => window.__ssFake.moves.length) };
    await ctx.shot(page, 'ss_7_park_franchise');
    if (facts.franchise.moves !== 1) problems.push('Franchise: ' + JSON.stringify(facts.franchise));
    await page.locator('.PZ2QoL_ssCard .PZ2QoL_ssCardBtn', { hasText: 'Close' }).click().catch(() => {});
    await page.evaluate(async () => {
        window.__ssFake.mode = 'offline';
        (await import('/js/mods/pz2qol/pace.js')).setPace('moves', 0.5);
    });
    facts.problems = problems;
    if (problems.length) throw new Error('find a habitat (park): ' + problems.join('; '));
    return facts;
}
