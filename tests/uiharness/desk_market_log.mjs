// Browser-harness scenario: the detailed debug log (debuglog.js) of the
// Market desk session desk_market.mjs just ran (it runs right before this
// one: scenarios are sorted by file name). run.mjs's openFrontend turns the
// log on (PZ2QoL_LogState 'on', as Lua does in a debug build) and collects
// what the page sends Lua (PZ2QoL_Log) in window.__dlog.
// Checks: the desk's open / rail / prices / filters / ticks / list events,
// the listing through the (fake) Lua engine with each animal's price
// decision and result, one animal end to end by its GUID, the line format,
// and the Ctrl+Shift+L panel (layout, lines, close).

export const name = 'market desk debug log';

const LINE = /^js#\d+@\d\d:\d\d:\d\d\.\d{3} [A-Za-z0-9_]+ [A-Za-z0-9_]+( |$)/;

export async function frontend(page, ctx) {
    const facts = ctx.facts || {};
    const problems = [];
    facts.problems = problems;
    await page.waitForTimeout(400); // the last batch (every 150 ms)
    const L = await page.evaluate(() => (window.__dlog || []).slice());
    facts.lines = L.length;
    facts.all = L; // the whole session's log, for reading in report.json
    const has = re => L.some(l => re.test(l));
    const first = re => L.find(l => re.test(l));
    if (!L.length) {
        problems.push('no debug log lines at all (PZ2QoL_Log never sent)');
        throw new Error('market desk debug log: ' + problems.join('; '));
    }
    const bad = L.filter(l => !LINE.test(l));
    if (bad.length) problems.push(`${bad.length} line(s) not in the "js#seq@time area event" format, e.g. ${bad[0]}`);
    // the desk
    const want = [
        [/ desk open keys=\d+ pageRows=\d+ /, 'desk open'],
        [/ desk rail source=storage pageRows=\d+ rows=\d+ guids=\d+ /, 'rail (source, counts, GUIDs)'],
        [/ desk rail_counts part=1 counts="?\S+:\d+\/\d+\/\d+/, 'rail counts per species'],
        [/ desk prices species=\S+ rows=\d+ priced=\d+ /, 'prices shown'],
        [/ desk filters patch=/, 'filter change'],
        [/ desk tick_shown on=true ticked=\d+/, 'tick all shown'],
        [/ desk list_click /, 'List click'],
        [/ lister list_request n=\d+ /, 'list request'],
        [/ lister list_path engine=true /, 'list path: the engine'],
        [/ lister caps ok=true /, 'engine caps'],
        [/ pricing decision i=\d+ guid=\d+ key=\S+ where=job id=\d+ .*price=\S+ .*conf=\w+/, 'price decision per job animal'],
        [/ lister job_built animals=\d+ rows=\d+ inJob=\d+/, 'job built'],
        [/ lister engine_start req=R\S+ head="v1 \d+" animals=\d+/, 'engine start (job)'],
        [/ lister engine_started run=\d+ req=R\S+ ok=true/, 'engine started'],
        [/ lister engine_state run=\d+ .*phase=running/, 'engine state running'],
        [/ lister engine_result run=\d+ i=\d+ guid=\d+ status=listed price=\d+ hours=\d+/, 'a listed result'],
        [/ lister engine_result run=\d+ i=2 guid=\d+ status=refused kind=refused/, 'the refused result'],
        [/ desk list_result ok=true count=\d+/, 'desk list result'],
        [/ lister page_watch key=\S+ req=w1_1/, 'the page watch'],
        [/ lister page_seen key=\S+ req=w1_1 text="?v2\|/, 'what the page reported'],
        [/ desk close /, 'desk close'],
    ];
    for (const [re, what] of want) if (!has(re)) problems.push(`no "${what}" line (${re})`);
    // one animal end to end, by the GUID the job gave it
    const job = first(/ pricing decision i=1 guid=\d+ key=\S+ where=job /);
    const g = job && (job.match(/ guid=(\d+) /) || [])[1];
    facts.followGuid = g || null;
    if (g) {
        const mine = L.filter(l => l.includes(` guid=${g} `) || l.endsWith(` guid=${g}`));
        facts.followed = mine.map(l => l.replace(/^js#\d+@\S+ /, '').slice(0, 160));
        const order = [/ pricing decision /, / lister engine_result .*status=listed/];
        let at = -1;
        for (const re of order) {
            const i = mine.findIndex((l, k) => k > at && re.test(l));
            if (i < 0) {
                problems.push(`animal ${g}: no ${re} after its earlier lines: ${JSON.stringify(facts.followed)}`);
                break;
            }
            at = i;
        }
    }
    else problems.push('no job decision with a GUID to follow');
    // the scoped part: the game's filters cleared and put back, through Lua
    if (!has(/ desk filters_ask action=clear/) || !has(/ desk filters_answer action=clear answered=true ok=true/)) problems.push('no "filters clear" ask/answer lines');
    if (!has(/ desk filters_ask action=restore/)) problems.push('no "filters restore" line');
    // price check (the desk's button)
    if (!has(/ peek start species=/) || !has(/ peek done species=\S+ listings=\d+/)) problems.push('no market check lines');
    facts.sample = L.filter(l => / (desk|lister|pricing|peek) /.test(l)).slice(0, 40);

    // the panel (Ctrl+Shift+L): newest lines, inside the view, closes
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyL');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    facts.panel = await page.evaluate(() => {
        const p = document.querySelector('.PZ2QoL_dlog');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        const lines = [...p.querySelectorAll('.PZ2QoL_dlogLine')];
        const heads = [...p.querySelectorAll('.PZ2QoL_dlogHead > *')].map(n => n.getBoundingClientRect());
        let overlap = 0;
        for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
            const a = heads[i], b = heads[j];
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap++;
        }
        return {
            open: p.style.display !== 'none' && r.width > 0, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
            lines: lines.length, last: lines.length ? lines[lines.length - 1].textContent : '', info: (p.querySelector('.PZ2QoL_dlogInfo') || {}).textContent || '',
            overlap, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        };
    });
    await ctx.shot(page, 'md_log_panel');
    if (!facts.panel || !facts.panel.open) problems.push(`Ctrl+Shift+L did not open the log panel: ${JSON.stringify(facts.panel)}`);
    else {
        if (!(facts.panel.lines >= 10)) problems.push(`log panel shows ${facts.panel.lines} lines`);
        if (!facts.panel.inside) problems.push(`log panel outside the view: ${JSON.stringify(facts.panel)}`);
        if (facts.panel.overlap) problems.push(`log panel header items overlap (${facts.panel.overlap})`);
        if (!/writing to dbg\/trace\.log/.test(facts.panel.info)) problems.push(`log panel state: "${facts.panel.info}"`);
    }
    // Area filter: lister only (each click steps to the next area)
    const areaBtn = page.locator('.PZ2QoL_dlog .PZ2QoL_dlogBtn', { hasText: /^Area:/ });
    for (let i = 0; i < 20 && !/^Area: lister$/.test((await areaBtn.innerText()).trim()); i++) await areaBtn.click();
    await page.waitForTimeout(150);
    facts.panelLister = await page.evaluate(() => [...document.querySelectorAll('.PZ2QoL_dlog .PZ2QoL_dlogLine')].map(n => n.textContent));
    if (!facts.panelLister.length || facts.panelLister.some(l => !/ lister /.test(l))) problems.push(`Area: lister shows other lines: ${facts.panelLister.slice(0, 2)}`);
    await ctx.shot(page, 'md_log_panel_lister');
    await page.locator('.PZ2QoL_dlog .PZ2QoL_dlogBtn', { hasText: /^Close$/ }).click();
    await page.waitForTimeout(150);
    facts.panelClosed = await page.evaluate(() => { const p = document.querySelector('.PZ2QoL_dlog'); return !p || p.style.display === 'none'; });
    if (!facts.panelClosed) problems.push('log panel did not close');
    if (problems.length) throw new Error('market desk debug log: ' + problems.join('; '));
    return facts;
}
