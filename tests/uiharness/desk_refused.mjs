// Browser-harness scenario: the Market desk's "When the server refuses a
// listing: Leave it / Quick trade it / Quick release it" (developer,
// 2026-10-18), through a fake Lua engine that refuses chosen animals'
// listings and, when the job asks for it (onrefused=...), quick-trades them
// in the same run like pz2qol.lister.lua. Checks: the option and its
// player-wide pref (deskRefused), the permanence said up front (the note
// above List and the List button), the job header, the run card and
// summary ("quick-traded 2 after refusal"), Quick release's first-run cap
// (refusedmax=1), Leave it sends no option, layout. Screenshots mqr_*.

export const name = 'market desk refused listings';

async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

const layout = page => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const out = { outside: [], overlaps: [], textOverflow: [] };
    const root = document.querySelector('.PZ2QoL_md');
    if (!root || !root.getBoundingClientRect().width) return out;
    for (const el of [root, ...root.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                const q = n.getBoundingClientRect();
                x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom);
            }
        }
        if (x1 <= x0 || y1 <= y0) continue;
        if (x0 < -0.5 || y0 < -0.5 || x1 > vw + 0.5 || y1 > vh + 0.5) out.outside.push(String(el.className));
    }
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const g = [...document.querySelectorAll('.PZ2QoL_mdSide > *')].filter(e => e.getBoundingClientRect().width);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (hit(g[i].getBoundingClientRect(), g[j].getBoundingClientRect())) out.overlaps.push(`${g[i].className} x ${g[j].className}`);
    for (const el of root.querySelectorAll('.PZ2QoL_mdSide .PZ2QoL_kpBtn, .PZ2QoL_mdSide .PZ2QoL_mdSegItem')) {
        if (el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1) out.textOverflow.push(`${el.className}: ${el.innerText.trim().slice(0, 40)}`);
    }
    return out;
});

function layoutProblems(tag, l, problems) {
    if (l.outside.length) problems.push(`${tag}: ${l.outside.length} element(s) outside the view, e.g. ${l.outside.slice(0, 3).join('; ')}`);
    if (l.overlaps.length) problems.push(`${tag}: overlapping ${l.overlaps.slice(0, 3).join('; ')}`);
    if (l.textOverflow.length) problems.push(`${tag}: text overflows ${l.textOverflow.slice(0, 3).join('; ')}`);
}

async function installFakeEngine(page) {
    await page.evaluate(async () => {
        const DS = await import('/js/common/core/DataStore.js');
        const LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
        const DATA = ['hubAnimalsData', 'animalStorageData'];
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(LIST);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const keysNow = () => col._source.map(c => c[c.length - 1]);
        for (const k of ['__md', '__mdf', '__mq', '__mqt']) if (window[k]) window[k].active = false;
        const f = window.__mqr = { active: true, jobs: [], stepMs: 80, runSeq: 500, refuseIdx: new Set([0, 1]), events: [], peeks: 0 };
        const guidOf = key => {
            const id = DS.getValue(LIST.concat(key), 'id');
            return id == undefined ? null : String(900000000000000000n + BigInt(String(id).replace(/\D/g, '') || 0));
        };
        window.__mqrGuid = guidOf;
        window.__PZ2QOL_TEST_PEEK_GAP_MS = 50;
        engine.__harness = true;
        if (!window.__mqrHooks) {
            window.__mqrHooks = true;
            for (const ev of ['AnimalStorage_AddToMarket', 'AnimalStorage_QuickTrade_Cash', 'AnimalStorage_QuickTrade_Credits']) {
                engine.on(ev, () => { if (window.__mqr) window.__mqr.events.push(ev); });
            }
            // the market check (Lua's MarketPeek): one page per species
            engine.on('PZ2QoL_MarketPeek', () => {
                if (!window.__mqr || !window.__mqr.active) return;
                window.__mqr.peeks++;
                DS.setValue(['hubAnimalsData', 'animalMarketData'], 'pages', 1);
                DS.setValue(['hubAnimalsData', 'animalMarketData'], 'pageIndex', 0);
                setTimeout(() => engine.trigger('PZ2QoL_MarketPeekState', 'loading', ''), 20);
                setTimeout(() => engine.trigger('PZ2QoL_MarketPeekState', 'ready', ''), 80);
            });
            engine.on('PZ2QoL_MarketPeekRelease', () => {
                if (!window.__mqr || !window.__mqr.active) return;
                setTimeout(() => engine.trigger('PZ2QoL_MarketPeekState', 'done', 'ok'), 30);
            });
        }
        engine.on('PZ2QoL_ListerHello', req => {
            if (!f.active) return;
            const rows = document.querySelectorAll('.MarketAnimalListItem_root').length;
            setTimeout(() => engine.trigger('PZ2QoL_ListerCaps', req, JSON.stringify({ ok: true, missing: [], storage: true, online: true, rows: Math.max(1, rows), running: !!f.running, version: 1, check: true })), 20);
        });
        engine.on('PZ2QoL_ListerResolve', (req, csv) => {
            if (!f.active) return;
            const ids = {}, rows = {}, failed = [];
            for (const k of String(csv).split(',')) {
                const g = guidOf(k);
                if (!g) {
                    failed.push(k);
                    continue;
                }
                ids[k] = g;
                const at = p => DS.getValue(LIST.concat(k), p);
                rows[k] = { name: at('name'), species: at('species'), gender: at('gender') };
            }
            setTimeout(() => engine.trigger('PZ2QoL_ListerIds', req, JSON.stringify({ ids, rows, failed })), 20);
        });
        engine.on('PZ2QoL_ListerStart', (req, text) => {
            if (!f.active) return;
            const lines = String(text).split('\n');
            const head = lines[0];
            const opts = Object.fromEntries((head.match(/\w+=\w+/g) || []).map(x => x.split('=')));
            const items = lines.slice(1).map(l => {
                const [guid, key, price] = l.split(' ');
                return { guid, key, price };
            });
            f.jobs.push({ req, head, items, opts });
            f.running = true;
            f.runSeq++;
            const st = { run: f.runSeq, req, mode: 'list', onRefused: opts.onrefused || null, phase: 'running', total: items.length, index: 0, step: 'server', waited: 0, paceMs: +head.split(' ')[1], message: '',
                results: items.map(i => ({ guid: i.guid, status: 'pending', kind: '', price: null, hours: null, capped: null, usedDefault: false, detail: '' })) };
            const send = () => engine.trigger('PZ2QoL_ListerState', JSON.stringify(st));
            let i = 0;
            let quickDone = 0;
            const tick = () => {
                if (i >= items.length) {
                    st.phase = 'done';
                    st.step = '';
                    f.running = false;
                    DS.setValue(DATA, 'selectedAnimalIDs', []);
                    send();
                    return;
                }
                st.index = i;
                st.results[i].status = 'working';
                st.step = 'confirm';
                send();
                setTimeout(() => {
                    const r = st.results[i];
                    const it = items[i];
                    if (f.refuseIdx.has(i)) {
                        const max = opts.refusedmax != undefined ? +opts.refusedmax : Infinity;
                        if (opts.onrefused && quickDone < max) {
                            quickDone++;
                            Object.assign(r, { status: opts.onrefused === 'release' ? 'released' : 'traded', afterRefused: true, price: opts.onrefused === 'release' ? 60 : 900 });
                            const key = keysNow().find(k => guidOf(k) === it.guid);
                            if (key) DS.deleteContext(LIST.concat(key));
                        }
                        else Object.assign(r, { status: 'refused', kind: 'refused', detail: 'Refused by the server (Unknown).' });
                    }
                    else {
                        Object.assign(r, { status: 'listed', price: +it.price || 500, hours: 12 });
                        const key = keysNow().find(k => guidOf(k) === it.guid);
                        if (key) DS.setValue(LIST.concat(key), 'auctionTimerSeconds', 12 * 3600);
                    }
                    i++;
                    st.step = 'pause';
                    send();
                    setTimeout(tick, f.stepMs);
                }, f.stepMs);
            };
            setTimeout(tick, 30);
        });
    });
}

export async function frontend(page, ctx) {
    const facts = ctx.facts || {};
    const problems = [];
    facts.problems = problems;
    await ctx.gotoMarketTab(page, 1);
    facts.setup = await page.evaluate(async () => {
        window.__PZ2QOL_TEST_FRANCHISE = true;
        const prefs = await import('/js/mods/pz2qol/prefs.js');
        prefs.setPref('deskRefused', undefined);
        prefs.setPref('quickAccepted', undefined);
        const DS = await import('/js/common/core/DataStore.js');
        const LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(LIST);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const keys = col._source.map(c => c[c.length - 1]);
        col.dispose();
        const sp = DS.getValue(LIST.concat(keys[0]), 'species');
        keys.forEach((k, i) => {
            if (i < 6) DS.setValue(LIST.concat(k), 'species', sp);
            for (const [p, v] of [['isMoving', false], ['isPregnant', false], ['isShoal', false], ['auctionTimerSeconds', -1], ['maturity', 2], ['storageTag', 0]]) DS.setValue(LIST.concat(k), p, v);
            DS.setValue(LIST.concat(k), 'source', '[AnimalExchange_Source_Description:Value=|Simmons Zoo|]');
        });
        DS.setValue(['hubAnimalsData', 'animalStorageData'], 'selectedAnimalIDs', []);
        DS.setValue(['hubAnimalsData', 'animalStorageData'], 'animalsInStorage', keys.length);
        return { species: sp };
    });
    await installFakeEngine(page);
    const side = () => page.evaluate(() => {
        const s = document.querySelector('.PZ2QoL_mdSide');
        return {
            label: ((s.querySelector('.PZ2QoL_mdSeg.refused') || {}).title || ''),
            options: [...s.querySelectorAll('.PZ2QoL_mdSeg.refused .PZ2QoL_mdSegItem')].map(n => [n.getAttribute('data-value'), n.innerText, n.classList.contains('on')]),
            note: (s.querySelector('.PZ2QoL_mdRefusedNote') || {}).innerText || '',
            list: ((s.querySelector('.PZ2QoL_kpBtn.primary') || {}).innerText || '').trim(),
            listDisabled: !!s.querySelector('.PZ2QoL_kpBtn.primary.disabled'),
            card: (s.querySelector('.PZ2QoL_mdRun') || {}).innerText || '',
            lines: [...s.querySelectorAll('.PZ2QoL_mdRun .PZ2QoL_mdRunLine')].map(n => n.innerText),
        };
    });
    const opt = v => page.locator(`.PZ2QoL_mdSide .PZ2QoL_mdSeg.refused .PZ2QoL_mdSegItem[data-value="${v}"]`);
    const tickAll = async () => {
        await click(page.locator('.PZ2QoL_mdTools .PZ2QoL_kpBtn', { hasText: 'Untick shown' }));
        await page.waitForTimeout(150);
        await click(page.locator('.PZ2QoL_mdTools .PZ2QoL_kpBtn', { hasText: 'Tick all shown' }));
        await page.waitForTimeout(250);
    };
    const checkPrices = async () => {
        const b = page.locator('.PZ2QoL_mdPriceCheck .PZ2QoL_kpBtn', { hasText: /^Check market prices/ });
        if (await b.count()) {
            await click(b);
            await page.waitForSelector('.PZ2QoL_mdSide .PZ2QoL_kpBtn.primary:not(.disabled)', { timeout: 15000 }).catch(() => {});
        }
    };
    try {
        await page.evaluate(async () => (await import('/js/mods/pz2qol/kinpanel.js')).panelApi('desk').open());
        await page.waitForSelector('.PZ2QoL_md:not(.hidden) .PZ2QoL_mdRow[data-id^="g"]', { timeout: 8000 });
        await page.waitForTimeout(800);
        await click(page.locator(`.PZ2QoL_mdSpecies[data-species="${facts.setup.species.replace(/"/g, '\\"')}"]`));
        await page.waitForTimeout(400);
        await tickAll();
        await checkPrices();
        await page.waitForTimeout(300);

        // 1. Leave it by default: no note, the List button as before
        facts.leave = await side();
        if (!/^When the server refuses a listing: Leave it, Quick trade, Quick release/.test(facts.leave.label) || JSON.stringify(facts.leave.options.map(o => o[0])) !== '["leave","quicktrade","release"]' || !facts.leave.options[0][2]) problems.push(`the option: ${JSON.stringify(facts.leave)}`);
        if (facts.leave.note || !/^List \d+ animals?$/.test(facts.leave.list)) problems.push(`Leave it: ${JSON.stringify(facts.leave)}`);
        await ctx.shot(page, 'mqr_0_leave');

        // 2. Quick trade it: kept as a pref, said up front
        await click(opt('quicktrade'));
        await page.waitForTimeout(300);
        facts.trade = await side();
        facts.pref = await page.evaluate(async () => (await import('/js/mods/pz2qol/prefs.js')).getPref('deskRefused'));
        await ctx.shot(page, 'mqr_1_option');
        layoutProblems('option', await layout(page), problems);
        if (facts.pref !== 'quicktrade') problems.push(`pref deskRefused: ${JSON.stringify(facts.pref)}`);
        if (facts.trade.note !== 'Refused ones: quick-traded at once (permanent).' || !/^List \d+ animals · refused → quick trade$/.test(facts.trade.list)) problems.push(`Quick trade it, up front: ${JSON.stringify(facts.trade)}`);

        // 3. List: the job asks for it; the run card shows them apart
        const n = +(facts.trade.list.match(/^List (\d+)/) || [])[1];
        await click(page.locator('.PZ2QoL_mdSide .PZ2QoL_kpBtn.primary'));
        await page.waitForFunction(() => window.__mqr.jobs.length >= 1 && !window.__mqr.running, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        const job = await page.evaluate(() => window.__mqr.jobs[0]);
        facts.job = job && { head: job.head, n: job.items.length };
        facts.done = await side();
        await ctx.shot(page, 'mqr_2_done');
        if (!job || !/^v1 \d+ list onrefused=quicktrade$/.test(job.head) || job.items.length !== n) problems.push(`job: ${JSON.stringify(facts.job)} (ticked ${n})`);
        if (!/quick-traded 2 after refusal \(\$1,800\)/.test(facts.done.card) || !/^Listed \d+ of \d+/.test(facts.done.card.split('\n').find(l => /^Listed/.test(l)) || '')) problems.push(`done card: ${JSON.stringify(facts.done.card)}`);
        if (!facts.done.lines.some(l => /quick-traded after refusal · \$900/.test(l))) problems.push(`no per-animal quick line: ${JSON.stringify(facts.done.lines)}`);
        facts.rowsDone = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_mdCell.state.done')].map(n => n.innerText));
        layoutProblems('done', await layout(page), problems);

        // 4. Quick release it before its first confirmed run: one at most (refusedmax=1)
        await click(opt('release'));
        await page.waitForTimeout(300);
        facts.release = await side();
        if (facts.release.note !== 'Refused ones: released at once (permanent), the first one only.' || !/· refused → release$/.test(facts.release.list)) problems.push(`Quick release it, up front: ${JSON.stringify(facts.release)}`);
        // the listed ones off the market again (more animals to list)
        await page.evaluate(async () => {
            const DS = await import('/js/common/core/DataStore.js');
            const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
            const LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
            const col = new DataStoreCollection(LIST);
            await new Promise(r => setTimeout(r, 100));
            for (const c of col._source) DS.setValue(c, 'auctionTimerSeconds', -1);
            col.dispose();
        });
        await page.waitForTimeout(1500);
        await tickAll();
        await checkPrices();
        await page.evaluate(() => { window.__mqr.refuseIdx = new Set([0, 1]); });
        await click(page.locator('.PZ2QoL_mdSide .PZ2QoL_kpBtn.primary'));
        await page.waitForFunction(() => window.__mqr.jobs.length >= 2 && !window.__mqr.running, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        const job2 = await page.evaluate(() => window.__mqr.jobs[1]);
        facts.job2 = job2 && job2.head;
        facts.release.done = await side();
        facts.release.accepted = await page.evaluate(async () => (await import('/js/mods/pz2qol/prefs.js')).getPref('quickAccepted'));
        await ctx.shot(page, 'mqr_3_release');
        if (!job2 || !/^v1 \d+ list onrefused=release refusedmax=1$/.test(job2.head)) problems.push(`release job: ${facts.job2}`);
        if (!/released 1 after refusal/.test(facts.release.done.card) || !/1 refused by the server/.test(facts.release.done.card)) problems.push(`release card: ${JSON.stringify(facts.release.done.card)}`);
        if (!facts.release.accepted || facts.release.accepted.release !== true) problems.push(`one release after refusal confirmed: not accepted (${JSON.stringify(facts.release.accepted)})`);

        // 5. back to Leave it: no option in the job
        await click(opt('leave'));
        await page.waitForTimeout(300);
        facts.back = { pref: await page.evaluate(async () => (await import('/js/mods/pz2qol/prefs.js')).getPref('deskRefused')), side: await side() };
        if (facts.back.pref !== undefined || facts.back.side.note) problems.push(`back to Leave it: ${JSON.stringify(facts.back)}`);
        facts.events = await page.evaluate(() => window.__mqr.events.slice());
        if (facts.events.length) problems.push(`vanilla events fired: ${JSON.stringify(facts.events)}`);
    }
    finally {
        await page.evaluate(async () => {
            if (window.__mqr) window.__mqr.active = false;
            window.__PZ2QOL_TEST_FRANCHISE = undefined;
            delete window.__PZ2QOL_TEST_PEEK_GAP_MS;
            if (typeof engine !== 'undefined') delete engine.__harness;
            const prefs = await import('/js/mods/pz2qol/prefs.js');
            prefs.setPref('deskRefused', undefined);
            prefs.setPref('quickAccepted', undefined);
            const d = (await import('/js/mods/pz2qol/kinpanel.js')).panelApi('desk');
            if (d && d.isOpen()) d.close();
        }).catch(() => {});
    }
    if (problems.length) throw new Error('market desk refused listings: ' + problems.join('; '));
    return facts;
}
