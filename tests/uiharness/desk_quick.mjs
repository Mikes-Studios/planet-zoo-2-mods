// Browser-harness scenario: the Market desk's Quick trade category and Check
// storage (docs/PLAN-desk-quick-release.md, Phase 1), through a fake Lua
// engine in the page that answers a 'check' job like pz2qol.lister.lua:
// each animal selected, its verdict (market / quick / rehome) sent with its
// result, nothing listed or sold, the selection cleared at the end.
// Checks: the "Check storage (N not checked, ≈ M min)" button and its job
// (check mode, only the shown species' unchecked animals), the run card,
// Stop, a second run for the rest, the categories on the rows ("Quick trade
// · $1,200", "Rehome only"), the rail and header counts (quick never
// counted as sellable), the fifth Show segment, Tick all leaving quick and
// rehome rows alone, Read storage again clearing the categories, no
// listing or quick-trade event ever fired, the page report v2 read from the
// real DataStore, layout.

export const name = 'market desk quick trade';

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
    for (const sel of ['.PZ2QoL_md .PZ2QoL_kpHead > *', '.PZ2QoL_mdBody > *', '.PZ2QoL_mdSide > *', '.PZ2QoL_mdTools > *']) {
        const g = [...document.querySelectorAll(sel)].filter(e => !e.classList.contains('PZ2QoL_kpFlex') && e.getBoundingClientRect().width);
        for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (hit(g[i].getBoundingClientRect(), g[j].getBoundingClientRect())) out.overlaps.push(`${g[i].className} x ${g[j].className}`);
    }
    for (const el of root.querySelectorAll('.PZ2QoL_kpBtn, .PZ2QoL_kpTitle, .PZ2QoL_mdSegItem, .PZ2QoL_mdEnginePill')) {
        if (el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1) out.textOverflow.push(`${el.className}: ${el.innerText.trim().slice(0, 40)}`);
    }
    return out;
});

function layoutProblems(tag, l, problems) {
    if (l.outside.length) problems.push(`${tag}: ${l.outside.length} element(s) outside the view, e.g. ${l.outside.slice(0, 3).join('; ')}`);
    if (l.overlaps.length) problems.push(`${tag}: overlapping ${l.overlaps.slice(0, 3).join('; ')}`);
    if (l.textOverflow.length) problems.push(`${tag}: text overflows ${l.textOverflow.slice(0, 3).join('; ')}`);
}

// The fake engine: GUIDs from the row ids; a check job walks its animals on
// timers and sends each one's verdict from f.plan (guid -> Lua's verdictOf).
async function installFakeEngine(page) {
    await page.evaluate(async () => {
        const DS = await import('/js/common/core/DataStore.js');
        const LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
        const DATA = ['hubAnimalsData', 'animalStorageData'];
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(LIST);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const keysNow = () => col._source.map(c => c[c.length - 1]);
        if (window.__md) window.__md.active = false;
        if (window.__mdf) window.__mdf.active = false;
        const f = window.__mq = { active: true, jobs: [], stops: 0, stepMs: 150, runSeq: 100, plan: new Map(), events: [], seen: [], check: true, keys: keysNow };
        const guidOf = key => {
            const id = DS.getValue(LIST.concat(key), 'id');
            return id == undefined ? null : String(900000000000000000n + BigInt(String(id).replace(/\D/g, '') || 0));
        };
        window.__mqGuid = guidOf;
        if (!window.__mqHooks) {
            window.__mqHooks = true;
            // what must never fire from the desk here: a listing or a quick action
            for (const ev of ['AnimalStorage_AddToMarket', 'AnimalStorage_QuickTrade_Cash', 'AnimalStorage_QuickTrade_Credits', 'AnimalStorage_Rehome']) {
                engine.on(ev, () => { if (window.__mq) window.__mq.events.push(ev); });
            }
            engine.on('PZ2QoL_ListerSeen', (req, text) => { if (window.__mq && String(req).startsWith('wq')) window.__mq.seen.push(String(text)); });
        }
        engine.on('PZ2QoL_ListerHello', req => {
            if (!f.active) return;
            const rows = document.querySelectorAll('.MarketAnimalListItem_root').length;
            setTimeout(() => engine.trigger('PZ2QoL_ListerCaps', req, JSON.stringify({ ok: true, missing: [], storage: true, online: true, rows: Math.max(1, rows), running: !!f.running, version: 1, check: f.check })), 20);
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
        engine.on('PZ2QoL_ListerStop', () => {
            if (!f.active) return;
            f.stops++;
            f.stopRequested = true;
        });
        engine.on('PZ2QoL_ListerStart', (req, text) => {
            if (!f.active) return;
            const lines = String(text).split('\n');
            const head = lines[0];
            const items = lines.slice(1).map(l => {
                const [guid, key, price, hours] = l.split(' ');
                return { guid, key, price, hours };
            });
            f.jobs.push({ req, head, items });
            if (!/ check$/.test(head)) {
                setTimeout(() => engine.trigger('PZ2QoL_ListerState', JSON.stringify({ run: 0, req, phase: 'done', refused: true, total: 0, index: 0, step: '', waited: 0, message: 'only checks here', results: [] })), 20);
                return;
            }
            f.running = true;
            f.stopRequested = false;
            f.runSeq++;
            const st = { run: f.runSeq, req, mode: 'check', phase: 'running', total: items.length, index: 0, step: 'server', waited: 0, paceMs: +head.split(' ')[1], message: '',
                results: items.map(i => ({ guid: i.guid, status: 'pending', kind: '', price: null, hours: null, capped: null, usedDefault: false, detail: '', verdict: null })) };
            const send = () => engine.trigger('PZ2QoL_ListerState', JSON.stringify(st));
            let i = 0;
            const end = phase => {
                st.phase = phase;
                st.step = '';
                st.message = phase === 'done' ? `Checked ${i} of ${items.length}.` : 'Stopped by you.';
                f.running = false;
                // the engine leaves nothing selected
                DS.setValue(DATA, 'selectedAnimalIDs', []);
                engine.trigger('PZ2QoL_ListerWatch', '', '');
                send();
            };
            const tick = () => {
                if (f.stopRequested) return end('stopped');
                if (i >= items.length) return end('done');
                st.index = i;
                const it = items[i];
                st.results[i].status = 'working';
                st.step = 'select';
                send();
                const key = keysNow().find(k => guidOf(k) === it.guid);
                const v = f.plan.get(it.guid) || { trade: true, quickTrade: true, quickRelease: true, rehome: false, tradeWhy: '', quickTradeWhy: '', quickReleaseWhy: '', quickTradeValue: '$700', quickReleaseValue: '30', quickTradePrice: 700, quickReleasePrice: 30, src: 'page', v: 2 };
                if (key) {
                    DS.setValue(DATA, 'selectedAnimalIDs', [key]);
                    // what the native writes for the selection: the page reports it back (v2)
                    const ACT = DATA.concat('actions');
                    try {
                        DS.setValue(ACT, 'tradeAllowed', v.trade);
                        DS.setValue(ACT, 'tradeDisallowedReason', v.trade ? '' : '[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalList_Problem_NoBirthZoo]]');
                        DS.setValue(ACT, 'quickTradeAllowed', v.quickTrade);
                        DS.setValue(ACT, 'quickTradeValue', v.quickTradeValue);
                        DS.setValue(ACT, 'quickReleaseAllowed', v.quickRelease);
                        DS.setValue(ACT, 'quickReleaseValue', v.quickReleaseValue);
                        DS.setValue(ACT, 'rehomeAllowed', v.rehome);
                    }
                    catch (e) {
                        f.dsError = String(e && e.message);
                    }
                    if (i === 0 && !f.watched) {
                        f.watched = true;
                        f.watchKey = key;
                        engine.trigger('PZ2QoL_ListerWatch', 'wq_1', key);
                    }
                }
                setTimeout(() => {
                    if (f.stopRequested) return end('stopped');
                    st.results[i].status = 'checked';
                    st.results[i].verdict = v;
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
    // storage: two species, every animal sellable by its row
    facts.setup = await page.evaluate(async () => {
        window.__PZ2QOL_TEST_FRANCHISE = true;
        const DS = await import('/js/common/core/DataStore.js');
        const LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(LIST);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const keys = col._source.map(c => c[c.length - 1]);
        col.dispose();
        const first = DS.getValue(LIST.concat(keys[0]), 'species');
        keys.forEach((k, i) => {
            if (i < 6) DS.setValue(LIST.concat(k), 'species', first);
            DS.setValue(LIST.concat(k), 'isMoving', false);
            DS.setValue(LIST.concat(k), 'isPregnant', false);
            DS.setValue(LIST.concat(k), 'isShoal', false);
            DS.setValue(LIST.concat(k), 'auctionTimerSeconds', -1);
            DS.setValue(LIST.concat(k), 'maturity', 2);
            DS.setValue(LIST.concat(k), 'storageTag', 0);
        });
        DS.setValue(['hubAnimalsData', 'animalStorageData'], 'selectedAnimalIDs', []);
        DS.setValue(['hubAnimalsData', 'animalStorageData'], 'animalsInStorage', keys.length);
        return { species: first, keys: keys.slice(0, 6), total: keys.length };
    });
    await installFakeEngine(page);
    // the plan: the first animal of the species is Quick trade only (not born in a
    // player zoo), the second Rehome only, the rest go to the market
    await page.evaluate(s => {
        const f = window.__mq;
        const g = s.keys.map(k => window.__mqGuid(k));
        const base = { quickTradeWhy: '', quickReleaseWhy: '', src: 'page', v: 2 };
        f.plan.set(g[0], Object.assign({}, base, { trade: false, quickTrade: true, quickRelease: false, rehome: false, tradeWhy: '[AnimalList_Problem_NoBirthZoo]', quickReleaseWhy: '[AnimalList_Problem_NoBirthZoo]', quickTradeValue: '$1,200', quickReleaseValue: '85', quickTradePrice: 1200, quickReleasePrice: 85 }));
        f.plan.set(g[1], Object.assign({}, base, { trade: false, quickTrade: false, quickRelease: false, rehome: true, tradeWhy: '[AnimalList_Problem_CantBeSold]', quickTradeValue: '', quickReleaseValue: '', quickTradePrice: null, quickReleasePrice: null }));
        f.quickKey = s.keys[0];
        f.rehomeKey = s.keys[1];
        f.quickGuid = g[0];
    }, facts.setup);
    const sp = facts.setup.species;
    const deskOpen = () => page.evaluate(async () => (await import('/js/mods/pz2qol/kinpanel.js')).panelApi('desk').open());
    const checkBtn = () => page.locator('.PZ2QoL_md .PZ2QoL_mdCheck .PZ2QoL_kpBtn');
    const checkText = () => page.evaluate(() => ((document.querySelector('.PZ2QoL_md .PZ2QoL_mdCheck .PZ2QoL_kpBtn') || {}).innerText || '').trim());
    const rowState = key => page.evaluate(k => {
        const row = document.querySelector(`.PZ2QoL_mdRow[data-key="${k}"]`);
        const st = row && row.querySelector('.PZ2QoL_mdCell.state');
        return row ? { blocked: row.classList.contains('blocked'), on: row.classList.contains('on'), state: st.innerText, cls: st.className, title: st.title } : null;
    }, key);
    try {
        await deskOpen();
        await page.waitForSelector('.PZ2QoL_md:not(.hidden) .PZ2QoL_mdRow[data-id^="g"]', { timeout: 8000 });
        await page.waitForTimeout(800);
        await click(page.locator(`.PZ2QoL_mdSpecies[data-species="${sp.replace(/"/g, '\\"')}"]`));
        await page.waitForTimeout(400);
        // 1. the button: the shown species' unchecked animals and the estimate
        facts.before = { button: await checkText(), shownRows: await page.evaluate(() => document.querySelectorAll('.PZ2QoL_mdRow[data-id]').length) };
        const m = /^Check storage \((\d+) not checked, ≈ (\d+) min\)$/.exec(facts.before.button);
        if (!m) problems.push(`Check storage button: "${facts.before.button}"`);
        else if (+m[1] !== facts.before.shownRows) problems.push(`Check storage counts ${m[1]}, the species shows ${facts.before.shownRows}`);
        facts.segments = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_mdSeg')].filter(n => (n.querySelector('.PZ2QoL_mdSegLabel') || {}).textContent === 'Show').map(n => [...n.querySelectorAll('.PZ2QoL_mdSegItem')].map(x => x.getAttribute('data-value')))[0]);
        if (JSON.stringify(facts.segments) !== JSON.stringify(['any', 'sellable', 'quick', 'listed', 'blocked'])) problems.push(`Show segments: ${JSON.stringify(facts.segments)}`);
        await ctx.shot(page, 'mq_1_before');
        layoutProblems('before', await layout(page), problems);

        // 2. Check storage, then Stop after the first animal
        await page.evaluate(() => { window.__mq.stepMs = 350; });
        await click(checkBtn());
        await page.waitForSelector('.PZ2QoL_mdRun.check.running', { timeout: 4000 });
        await page.waitForTimeout(200);
        facts.running = await page.evaluate(() => ({
            head: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunHead') || {}).innerText || '',
            now: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunNow') || {}).innerText || '',
            stop: ((document.querySelector('.PZ2QoL_md .PZ2QoL_mdCheck .PZ2QoL_kpBtn') || {}).innerText || '').trim(),
            scrim: !!document.querySelector('.PZ2QoL_mdScrim.solid'),
            working: [...document.querySelectorAll('.PZ2QoL_mdCell.state.working')].map(n => n.innerText),
        }));
        await ctx.shot(page, 'mq_2_checking');
        const job1 = await page.evaluate(() => window.__mq.jobs[0]);
        facts.job1 = job1 && { head: job1.head, n: job1.items.length, lines: job1.items.slice(0, 2) };
        if (!job1 || !/^v1 \d+ check$/.test(job1.head) || +job1.head.split(' ')[1] < 150) problems.push(`check job header: ${job1 && job1.head}`);
        if (!job1 || job1.items.length !== facts.before.shownRows || !job1.items.every(it => /^\d+$/.test(it.guid) && it.price === '-' && it.hours === 'default')) problems.push(`check job: ${JSON.stringify(facts.job1)}`);
        if (!/Checking storage/.test(facts.running.head) || !facts.running.now || facts.running.stop !== 'Stop checking' || !facts.running.scrim) problems.push(`running check: ${JSON.stringify(facts.running)}`);
        if (!facts.running.working.some(t => /Checking…/.test(t))) problems.push(`no "Checking…" row: ${JSON.stringify(facts.running.working)}`);
        await page.waitForFunction(() => { const s = document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunCount'); return s && /^[1-9]\d*\//.test(s.innerText); }, null, { timeout: 5000 }).catch(() => {});
        await click(checkBtn());
        await page.waitForSelector('.PZ2QoL_mdRun.check.stopped', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
        facts.stopped = await page.evaluate(() => ({
            stops: window.__mq.stops,
            head: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunHead') || {}).innerText || '',
            summary: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunStep') || {}).innerText || '',
            selection: null,
        }));
        facts.stopped.selection = await page.evaluate(async () => (await import('/js/common/core/DataStore.js')).getValue(['hubAnimalsData', 'animalStorageData'], 'selectedAnimalIDs'));
        facts.stopped.button = await checkText();
        await ctx.shot(page, 'mq_3_stopped');
        const m2 = /^Check storage \((\d+) not checked/.exec(facts.stopped.button);
        if (facts.stopped.stops < 1 || !/Check stopped/.test(facts.stopped.head) || !/^Checked \d+ of \d+/.test(facts.stopped.summary)) problems.push(`stop: ${JSON.stringify(facts.stopped)}`);
        if (!m2 || !(+m2[1] < facts.before.shownRows)) problems.push(`after Stop the button still counts all: "${facts.stopped.button}"`);
        if (!Array.isArray(facts.stopped.selection) || facts.stopped.selection.length) problems.push(`selection after the check: ${JSON.stringify(facts.stopped.selection)}`);

        // 3. again: only the rest
        await page.evaluate(() => { window.__mq.stepMs = 80; });
        await click(checkBtn());
        await page.waitForSelector('.PZ2QoL_mdRun.check.done', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(500);
        const job2 = await page.evaluate(() => window.__mq.jobs[1]);
        facts.job2 = job2 && { n: job2.items.length, first: job2.items[0] };
        if (!job2 || job2.items.length !== +((m2 || [])[1] || -1) || job2.items.some(it => job1.items.slice(0, facts.before.shownRows - job2.items.length).some(x => x.guid === it.guid))) problems.push(`second check job: ${JSON.stringify(facts.job2)}`);
        facts.done = await page.evaluate(() => ({
            head: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunHead') || {}).innerText || '',
            summary: (document.querySelector('.PZ2QoL_mdRun.check .PZ2QoL_mdRunStep') || {}).innerText || '',
            sub: (document.querySelector('.PZ2QoL_mdSub') || {}).innerText || '',
            rail: ((document.querySelector('.PZ2QoL_mdSpecies.on .PZ2QoL_mdSpeciesMeta') || {}).innerText || '').replace(/\s+/g, ' '),
        }));
        facts.done.button = await checkText();
        facts.done.buttonDisabled = await page.evaluate(() => !!document.querySelector('.PZ2QoL_md .PZ2QoL_mdCheck .PZ2QoL_kpBtn.disabled'));
        facts.quickRow = await rowState(await page.evaluate(() => window.__mq.quickKey));
        facts.rehomeRow = await rowState(await page.evaluate(() => window.__mq.rehomeKey));
        await ctx.shot(page, 'mq_4_checked');
        if (!/Storage checked/.test(facts.done.head) || !/Checked \d+ of \d+: \d+ sellable/.test(facts.done.summary)) problems.push(`done card: ${JSON.stringify(facts.done)}`);
        if (!/1 Quick trade only/.test(facts.done.sub)) problems.push(`header counts: "${facts.done.sub}"`);
        if (!/1 quick/.test(facts.done.rail) || !new RegExp(`^${facts.before.shownRows - 2} sellable`).test(facts.done.rail)) problems.push(`rail counts: "${facts.done.rail}" (shown ${facts.before.shownRows})`);
        if (facts.done.button !== 'Check storage (all checked)' || !facts.done.buttonDisabled) problems.push(`button when all checked: "${facts.done.button}" disabled ${facts.done.buttonDisabled}`);
        if (!facts.quickRow || !facts.quickRow.blocked || !/quick/.test(facts.quickRow.cls) || facts.quickRow.state !== 'Quick trade · $1,200' || !/not born in a player zoo|NoBirthZoo|player zoo/i.test(facts.quickRow.title)) problems.push(`quick row: ${JSON.stringify(facts.quickRow)}`);
        if (!facts.rehomeRow || !facts.rehomeRow.blocked || facts.rehomeRow.state !== 'Rehome only') problems.push(`rehome row: ${JSON.stringify(facts.rehomeRow)}`);
        layoutProblems('checked', await layout(page), problems);

        // 4. the Show segment and the ticks
        const showSeg = v => page.locator('.PZ2QoL_mdSeg', { hasText: 'Show' }).locator(`.PZ2QoL_mdSegItem[data-value="${v}"]`);
        const shownKeys = () => page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_mdRow[data-id]')].map(n => n.getAttribute('data-key')));
        await click(showSeg('quick'));
        await page.waitForTimeout(300);
        facts.segQuick = await shownKeys();
        await ctx.shot(page, 'mq_5_segment_quick');
        await click(showSeg('sellable'));
        await page.waitForTimeout(300);
        facts.segSellable = await shownKeys();
        await click(showSeg('blocked'));
        await page.waitForTimeout(300);
        facts.segBlocked = await shownKeys();
        await click(showSeg('any'));
        await page.waitForTimeout(300);
        const qk = await page.evaluate(() => window.__mq.quickKey);
        const rk = await page.evaluate(() => window.__mq.rehomeKey);
        if (JSON.stringify(facts.segQuick) !== JSON.stringify([qk])) problems.push(`Show: Quick trade shows ${JSON.stringify(facts.segQuick)}, want [${qk}]`);
        if (facts.segSellable.includes(qk) || facts.segSellable.includes(rk) || facts.segSellable.length !== facts.before.shownRows - 2) problems.push(`Show: Sellable shows ${JSON.stringify(facts.segSellable)}`);
        if (!facts.segBlocked.includes(rk) || facts.segBlocked.includes(qk)) problems.push(`Show: Not sellable shows ${JSON.stringify(facts.segBlocked)}`);
        await click(page.locator('.PZ2QoL_mdTools .PZ2QoL_kpBtn', { hasText: 'Tick all shown' }));
        await page.waitForTimeout(300);
        facts.ticks = { quick: (await rowState(qk)).on, rehome: (await rowState(rk)).on, big: await page.evaluate(() => +(document.querySelector('.PZ2QoL_mdBig .n') || {}).innerText) };
        await click(page.locator(`.PZ2QoL_mdRow[data-key="${qk}"]`));
        await page.waitForTimeout(200);
        facts.ticks.quickClicked = (await rowState(qk)).on;
        if (facts.ticks.quick || facts.ticks.rehome || facts.ticks.quickClicked || facts.ticks.big !== facts.before.shownRows - 2) problems.push(`ticks: ${JSON.stringify(facts.ticks)}`);
        await click(page.locator('.PZ2QoL_mdTools .PZ2QoL_kpBtn', { hasText: 'Untick shown' }));

        // 5. the page's report to the engine: v2, read from the real DataStore,
        // its fields by name (pz2qol.lister.lua ParseSeen decodes it)
        facts.seen = await page.evaluate(async () => {
            const { SEEN_FIELDS } = await import('/js/mods/pz2qol/listercore.js');
            const f = window.__mq;
            const first = f.seen[0] || '';
            const parts = first.split('|');
            const at = name => decodeURIComponent(parts[SEEN_FIELDS.indexOf(name)] || '');
            const fields = ['version', 'key', 'allowed', 'reason', 'quickTrade', 'quickTradeValue'];
            return { n: f.seen.length, key: f.watchKey, head: first.slice(0, 40), fields: Object.fromEntries(fields.map(n => [n, at(n)])), dsError: f.dsError };
        });
        const d = facts.seen.fields;
        if (!facts.seen.n || d.version !== 'v2' || d.key !== facts.seen.key || d.quickTrade !== '1' || d.quickTradeValue !== '$1,200' || d.allowed !== '0' || !/NoBirthZoo/.test(d.reason)) problems.push(`page report v2: ${JSON.stringify(facts.seen)}`);

        // 6. Read storage again: the categories are checked afresh
        await click(page.locator('.PZ2QoL_md .PZ2QoL_kpBtn', { hasText: 'Read storage again' }));
        await page.waitForTimeout(1500);
        facts.reread = { button: await checkText(), quick: await rowState(qk) };
        if (!/^Check storage \(\d+ not checked/.test(facts.reread.button) || !facts.reread.quick || facts.reread.quick.blocked) problems.push(`after Read storage again: ${JSON.stringify(facts.reread)}`);

        // 7. an engine that can't check (an older Main.ovl): the button is off
        await page.evaluate(() => { window.__mq.check = false; });
        await click(page.locator('.PZ2QoL_md .PZ2QoL_kpBtn', { hasText: 'Read storage again' }));
        await page.waitForTimeout(1500);
        facts.noCheck = await page.evaluate(() => !!document.querySelector('.PZ2QoL_md .PZ2QoL_mdCheck .PZ2QoL_kpBtn.disabled'));
        if (!facts.noCheck) problems.push('Check storage enabled although the engine has no check mode');
        await ctx.shot(page, 'mq_6_nocheck');

        // nothing listed, sold or released, ever
        facts.events = await page.evaluate(() => window.__mq.events.slice());
        if (facts.events.length) problems.push(`the desk fired ${JSON.stringify(facts.events)}`);
        facts.listingJobs = await page.evaluate(() => window.__mq.jobs.filter(j => !/ check$/.test(j.head)).length);
        if (facts.listingJobs) problems.push(`${facts.listingJobs} listing job(s) sent during the checks`);
    }
    finally {
        await page.evaluate(async () => {
            if (window.__mq) window.__mq.active = false;
            window.__PZ2QOL_TEST_FRANCHISE = undefined;
            const d = (await import('/js/mods/pz2qol/kinpanel.js')).panelApi('desk');
            if (d && d.isOpen()) d.close();
        }).catch(() => {});
    }
    if (problems.length) throw new Error('market desk quick trade: ' + problems.join('; '));
    return facts;
}
