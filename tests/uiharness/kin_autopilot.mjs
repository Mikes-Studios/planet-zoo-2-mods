// Browser-harness scenario: Auto mode per species on the Species board
// (kinautoui.js, kinboard.js; runtime kinauto.js).
// Runs on the in-park HUD page in its own lane (group "autopilot"), so it
// seeds the kin fixture itself, plus a second lion habitat and the trade
// centre, as a Franchise zoo (nothing ever runs without a click).
// Fakes the Lua side: PZ2QoL_KinDestinations, PZ2QoL_KinSpecies, and the
// player-save store (PZ2QoL_StoreLoad / PZ2QoL_StoreSave); records any
// PZ2QoL_KinMove / PZ2QoL_KinContracept (there must be none).
// Walks:
//   a. off: the actions area has the "Auto mode" button, and nothing else on
//      the board is Auto's (no tags, no rail tag, no card menu item);
//   b. the button opens the Auto panel for the selected species; the button
//      again, Close, Esc, Breeding programme and Thin out each close it;
//   c. Turn on (the store is ready): status line, button and saved kinAuto
//      change, nothing is sent;
//   d. the segments, switches and make-up arrows change the saved settings;
//   e. the card menu's "Auto mode: hands off" and its tag on the card;
//   f. a 1280x720 window: nothing overflows or overlaps;
//   g. Turn off: the board is as it was.
// A real run (moves) is not driven here: the Node tests cover it.
// Leaves Auto mode off, the board closed, the store and window as found.
import { seedZooKin } from './kin_fixture.mjs';
import { layoutFacts, layoutProblems } from './kin_board.mjs';

export const name = 'autopilot';

const BOARD = '/js/mods/pz2qol/kinboard.js';
const AUTO = '/js/mods/pz2qol/kinauto.js';
const STORE = '/js/mods/pz2qol/userstore.js';
const BTN = '.PZ2QoL_kb .PZ2QoL_kbActions .PZ2QoL_kpBtn.PZ2QoL_kbAutoBtn';
const PANEL = '.PZ2QoL_kb .PZ2QoL_kbAuto';
const SPECIES = 'Lion';

async function click(locator) {
    try {
        await locator.first().click({ timeout: 2500 });
    }
    catch (e) {
        await locator.first().dispatchEvent('click');
    }
}

// Auto mode's marks on the Species board outside its own panel
const boardAuto = page => page.evaluate(() => {
    const kb = document.querySelector('.PZ2QoL_kb');
    const n = s => (kb ? kb.querySelectorAll(s).length : 0);
    const btn = kb && kb.querySelector('.PZ2QoL_kbActions .PZ2QoL_kbAutoBtn');
    return {
        button: btn ? btn.innerText.trim() : null,
        buttonOn: !!btn && btn.classList.contains('on'),
        buttonAutoOn: !!btn && btn.classList.contains('autoOn'),
        panel: n('.PZ2QoL_kbAuto'),
        tags: kb ? [...kb.querySelectorAll('.PZ2QoL_kbTag.auto')].map(t => `${t.closest('[data-id]')?.getAttribute('data-id')}:${t.textContent}`) : [],
        menu: kb ? [...kb.querySelectorAll('.PZ2QoL_kbMenuItem.auto')].map(t => t.textContent) : [],
        menuOpen: n('.PZ2QoL_kbMenu'),
        rail: kb ? [...kb.querySelectorAll('.PZ2QoL_kbSpecies .PZ2QoL_kbSpeciesMeta')].map(e => e.textContent).filter(t => /\bauto\b/i.test(t)) : [],
        cols: n('.PZ2QoL_kbCol'),
        prog: n('.PZ2QoL_kbProg:not(.PZ2QoL_kbAuto)'),
        cull: n('.PZ2QoL_kbCull'),
    };
});

// The actions area: its buttons in rows, and the pause slider under
// Execute still on screen (its scroll box may cut its tail, as before Auto
// mode; a fourth button row once pushed it out altogether)
const actionsFacts = page => page.evaluate(() => {
    const el = document.querySelector('.PZ2QoL_kb .PZ2QoL_kbActions');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const pace = el.querySelector('.PZ2QoL_pace');
    const vp = pace && pace.closest('.PZ2QoL_kpViewport');
    const pr = pace ? pace.getBoundingClientRect() : null;
    const vr = vp ? vp.getBoundingClientRect() : null;
    return {
        rows: [...el.querySelectorAll('.PZ2QoL_kbActRow')].map(r => [...r.querySelectorAll('.PZ2QoL_kpBtn')].map(b => b.innerText.trim())),
        pace: pace ? Math.round(Math.min(pr.bottom, vr.bottom, box.bottom) - Math.max(pr.top, vr.top, box.top)) : -1,
        paceHeight: pr ? Math.round(pr.height) : 0,
    };
});

const panelState = page => page.evaluate(sel => {
    const p = document.querySelector(sel);
    if (!p) return null;
    return {
        species: p.getAttribute('data-species'),
        status: p.getAttribute('data-status'),
        title: p.querySelector('.PZ2QoL_kbProgTitle')?.textContent || '',
        sub: p.querySelector('.PZ2QoL_kbProgSub')?.textContent || '',
        head: [...p.querySelectorAll('.PZ2QoL_kbProgHead .PZ2QoL_kpBtn')].map(b => `${b.innerText.trim()}${b.classList.contains('disabled') ? ' (disabled)' : ''}`),
        sections: [...p.querySelectorAll('.PZ2QoL_apSectionTitle')].map(t => t.textContent),
        every: p.querySelector('.PZ2QoL_kbSegItem.on[data-every]')?.getAttribute('data-every') || null,
        step: p.querySelector('.PZ2QoL_kbSegItem.on[data-step]')?.getAttribute('data-step') || null,
        fill: p.querySelector('.PZ2QoL_kbSegItem.on[data-fill]')?.getAttribute('data-fill') || null,
        fills: p.querySelectorAll('[data-fill]').length,
        ratio: p.querySelector('.PZ2QoL_apRatio')?.getAttribute('data-ratio') || null,
        warn: p.querySelector('.PZ2QoL_kbProgWarn')?.textContent || '',
    };
}, PANEL);

// The settings as Auto mode keeps them, and the store's copy
const saved = page => page.evaluate(async ({ auto, store, sp }) => {
    const A = await import(auto);
    const S = await import(store);
    const s = A.getSpeciesAuto(sp).settings;
    const k = S.getUserData('kinAuto');
    const r = S.getUserData('kinRatio');
    return {
        on: s.on, every: s.every, step: s.step, trade: s.trade, thin: s.thin, fill: s.fill,
        stored: k && k.sp && k.sp[sp] ? { on: k.sp[sp].on, every: k.sp[sp].every, step: k.sp[sp].step, trade: k.sp[sp].trade, thin: k.sp[sp].thin, fill: k.sp[sp].fill } : null,
        ratio: r && r[sp] ? r[sp] : 'auto',
    };
}, { auto: AUTO, store: STORE, sp: SPECIES });

// The Auto panel's own layout: it fills the board's middle area, its
// sections stack, nothing in it is cut off sideways, spills out of its
// box, overlaps a sibling or runs out of its button or segment; a body
// taller than its box has a scroll bar.
const panelLayout = page => page.evaluate(sel => {
    const out = { fills: '', direction: [], cut: [], spill: [], overlaps: [], textOverflow: [], bar: '' };
    const root = document.querySelector(sel);
    if (!root) return out;
    const name = el => `${String(el.className || el.tagName).replace(/PZ2QoL_/g, '')}${el.innerText ? ` "${el.innerText.trim().replace(/\s+/g, ' ').slice(0, 30)}"` : ''}`;
    const pr = root.getBoundingClientRect();
    // the panel takes the middle area's width (inside its padding) and
    // reaches its bottom
    const area = root.parentElement;
    const ar = area.getBoundingClientRect();
    const acs = getComputedStyle(area);
    const inner = { left: ar.left + parseFloat(acs.paddingLeft), right: ar.right - parseFloat(acs.paddingRight), bottom: ar.bottom - parseFloat(acs.paddingBottom) };
    if (Math.abs(pr.left - inner.left) > 2 || Math.abs(pr.right - inner.right) > 2 || inner.bottom - pr.bottom > 12) out.fills = `panel ${Math.round(pr.left)}..${Math.round(pr.right)} x ..${Math.round(pr.bottom)} in ${Math.round(inner.left)}..${Math.round(inner.right)} x ..${Math.round(inner.bottom)}`;
    for (const el of root.querySelectorAll('.PZ2QoL_kbAuto, .PZ2QoL_apSection, .PZ2QoL_apSectionBody, .PZ2QoL_apPlan, .PZ2QoL_apRuns, .PZ2QoL_apLogText, .PZ2QoL_kbProgTitles')) {
        if (getComputedStyle(el).flexDirection !== 'column') out.direction.push(name(el));
    }
    for (const el of [root, ...root.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < pr.left - 1 || r.right > pr.right + 1) out.cut.push(`${name(el)} [${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(pr.left)}..${Math.round(pr.right)}]`);
    }
    const scroll = root.querySelector('.PZ2QoL_kpScroll.kbAutoBody');
    if (scroll) {
        const br = scroll.getBoundingClientRect();
        for (const el of scroll.querySelectorAll('.PZ2QoL_kpContent *')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.right > br.right + 1 || r.left < br.left - 1) {
                out.cut.push(`${name(el)} cut off sideways in the scroll area`);
                break;
            }
        }
        const content = scroll.querySelector('.PZ2QoL_kpContent');
        const vp = scroll.querySelector('.PZ2QoL_kpViewport');
        const bar = scroll.querySelector('.PZ2QoL_kpBar.v');
        const taller = content && vp && content.getBoundingClientRect().height > vp.getBoundingClientRect().height + 2;
        const barShown = !!bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0 && !bar.classList.contains('hidden');
        if (taller && !barShown) out.bar = `content ${Math.round(content.getBoundingClientRect().height)} px in a ${Math.round(vp.getBoundingClientRect().height)} px box, no scroll bar`;
        // the sections stop short of the scroll bar
        if (barShown) {
            const bl = bar.getBoundingClientRect().left;
            const under = [...content.children].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().right > bl + 0.5);
            if (under.length) out.overlaps.push(`${under.length} block(s) under the scroll bar, e.g. ${name(under[0])}`);
        }
        if (scroll.getBoundingClientRect().bottom > pr.bottom + 1) out.spill.push('the scroll area reaches below the panel');
    }
    for (const box of root.querySelectorAll('.PZ2QoL_kbProgHead, .PZ2QoL_apSection, .PZ2QoL_apRow, .PZ2QoL_apSeg, .PZ2QoL_apRatio, .PZ2QoL_kpSwitch, .PZ2QoL_apBanner, .PZ2QoL_apPlan, .PZ2QoL_apRunHead, .PZ2QoL_apLog')) {
        const br = box.getBoundingClientRect();
        if (!br.width || !br.height) continue;
        for (const el of box.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            if (cs.position === 'absolute' || cs.position === 'fixed') continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.left < br.left - 1 || r.top < br.top - 1 || r.right > br.right + 1 || r.bottom > br.bottom + 1) {
                out.spill.push(`${name(el)} spills out of ${name(box).split(' ')[0]}`);
                break;
            }
        }
    }
    const rect = el => el.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const parents = [root, ...root.querySelectorAll('.PZ2QoL_kbProgHead, .PZ2QoL_kbProgTitles, .PZ2QoL_kpContent, .PZ2QoL_apSection, .PZ2QoL_apSectionBody, .PZ2QoL_apRow, .PZ2QoL_apSeg, .PZ2QoL_apRatio, .PZ2QoL_apPlanHead, .PZ2QoL_apRunHead, .PZ2QoL_apLog')];
    for (const p of parents) {
        const kids = [...p.children].filter(e => !e.classList.contains('PZ2QoL_kpFlex') && rect(e).width && rect(e).height);
        for (let i = 0; i < kids.length; i++) {
            for (let j = i + 1; j < kids.length; j++) if (hit(rect(kids[i]), rect(kids[j]))) out.overlaps.push(`${name(kids[i])} x ${name(kids[j])}`);
        }
    }
    for (const el of root.querySelectorAll('.PZ2QoL_kpBtn, .PZ2QoL_kbSegItem, .PZ2QoL_kbProgTitle, .PZ2QoL_kbProgSub, .PZ2QoL_apSectionTitle, .PZ2QoL_apLabel, .PZ2QoL_kpSwitchLabel, .PZ2QoL_kbRatioValue, .PZ2QoL_apText')) {
        if (el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 1) out.textOverflow.push(name(el));
    }
    return out;
}, PANEL);

function panelProblems(tag, l, problems) {
    if (l.fills) problems.push(`${tag}: the panel does not fill the board's middle area (${l.fills})`);
    if (l.direction.length) problems.push(`${tag}: laid out as a row, not a column: ${l.direction.slice(0, 3).join('; ')}`);
    if (l.cut.length) problems.push(`${tag}: cut off sideways: ${l.cut.slice(0, 3).join('; ')}`);
    if (l.spill.length) problems.push(`${tag}: ${l.spill.slice(0, 3).join('; ')}`);
    if (l.overlaps.length) problems.push(`${tag}: overlapping ${l.overlaps.slice(0, 3).join('; ')}`);
    if (l.textOverflow.length) problems.push(`${tag}: text overflows ${l.textOverflow.slice(0, 3).join('; ')}`);
    if (l.bar) problems.push(`${tag}: ${l.bar}`);
}

// The fixture as a Franchise zoo, a second lion habitat, the trade centre,
// and the fake Lua side.
async function seedAuto(page) {
    await page.evaluate(async () => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        const store = await import('/js/mods/pz2qol/userstore.js');
        const snap = JSON.parse(JSON.stringify(window.__kinFixture.snapshot));
        snap.mode = 'franchise';
        snap.tradeCentre = { id: '501', name: 'Trade Centre' };
        snap.habitats.push({ id: '9003', name: 'Plains Habitat', kind: 'habitat' });
        const genes = s => {
            const L = 'ABCDEFGH';
            const st = o => Array.from({ length: 6 }, (_, i) => L[(s * 5 + (i + o) * 3) % 8]).join('');
            return { F: st(0) + st(4), I: st(1) + st(7), S: st(2) + st(3), L: st(3) + st(6) };
        };
        const add = (id, name, sex) => snap.animals.push({
            id, key: 'animal_' + id, guid: 'gx' + id, name, species: 'Lion', sex, juv: false, contra: false, infertile: false, preg: false,
            hab: '9003', loc: 'Plains Habitat', par: [], mates: [], genes: genes(+id),
        });
        add('8001', 'Bako', 0);
        add('8002', 'Nala', 1);
        add('8003', 'Tamu', 0);
        add('8004', 'Imara', 1);
        for (const a of snap.animals) if (!a.lt) a.lt = a.hab ? 'habitat' : 'other';
        kin.applyKinSnapshot(snap);

        const ok = { ok: true };
        const DEST = {
            bySpecies: {
                Lion: { 9000: ok, 9003: ok, 9001: { ok: false, reason: 'Too humid for lions' }, 9002: { ok: false, reason: 'Too cold for lions' } },
                Tiger: { 9001: ok, 9000: { ok: false, reason: 'Too dry' }, 9002: { ok: false, reason: 'Too cold' }, 9003: { ok: false, reason: 'Too dry' } },
                Zebra: { 9002: ok, 9000: ok, 9003: ok, 9001: { ok: false, reason: 'Too humid' } },
            },
            habitats: [{ id: '9003', name: 'Plains Habitat' }],
            tradeCentre: { id: '501', name: 'Trade Centre' },
        };
        const info = habs => ({
            social: { min: 2, max: 8 },
            fertilityAges: { maturity: 0, infertility: 999 },
            mating: 'polygyny',
            habitats: Object.fromEntries(String(habs || '').split(',').filter(Boolean).map(h => [h, { available: { land: 30000 } }])),
        });
        const mirror = (() => {
            try {
                return localStorage.getItem('PZ2QoL.userdata.v1');
            }
            catch (e) {
                return null;
            }
        })();
        window.__ka = {
            active: true, restoring: false, dest: 0, lastDest: 0, species: 0, moves: [], contra: [], saves: [], file: '{}',
            before: { status: store.userDataStatus(), reason: store.userDataReason(), mirror },
        };
        engine.on('PZ2QoL_KinDestinations', reqId => {
            const k = window.__ka;
            if (!k.active) return;
            k.dest++;
            k.lastDest = Date.now();
            engine.trigger('PZ2QoL_KinDestinationsResult', reqId, JSON.stringify(DEST));
        });
        engine.on('PZ2QoL_KinSpecies', (reqId, species, habs) => {
            const k = window.__ka;
            if (!k.active || !['Lion', 'Tiger', 'Zebra'].includes(String(species))) return;
            k.species++;
            setTimeout(() => engine.trigger('PZ2QoL_KinSpeciesResult', reqId, JSON.stringify(info(habs))), 50);
        });
        // never answered: Auto mode must not send any in this scenario
        engine.on('PZ2QoL_KinMove', (reqId, id, to) => {
            if (window.__ka.active) window.__ka.moves.push([String(id), String(to)]);
        });
        engine.on('PZ2QoL_KinContracept', (id, on) => {
            if (window.__ka.active) window.__ka.contra.push([String(id), !!on]);
        });
        // the player-save store (the Lua side keeps it in Saves\player)
        engine.on('PZ2QoL_StoreLoad', req => {
            const k = window.__ka;
            if (k.restoring) {
                // back to how the page found it (no Lua side in the harness)
                if (k.before.status === 'file') engine.trigger('PZ2QoL_StoreData', req, true, 1, 1, '{}');
                else engine.trigger('PZ2QoL_StoreData', req, false, 1, 1, k.before.reason || 'nolua');
                return;
            }
            if (k.active) engine.trigger('PZ2QoL_StoreData', req, true, 1, 1, k.file);
        });
        engine.on('PZ2QoL_StoreSave', (req, text) => {
            const k = window.__ka;
            if (!k.active) return;
            k.file = String(text);
            k.saves.push(String(text));
            engine.trigger('PZ2QoL_StoreSaved', req, true);
        });
        engine.trigger('PZ2QoL_Hello'); // the store reads "the file"
    });
}

export async function hud(page, ctx) {
    const facts = ctx.facts || {};
    const problems = [];
    facts.problems = problems;
    const viewport = page.viewportSize();
    const board = async species => {
        await page.evaluate(async ({ url, species }) => (await import(url)).openSpeciesBoard({ species }), { url: BOARD, species });
        // the board keeps an open Auto panel (like the Breeding programme)
        // for the next time it opens
        await page.waitForSelector('.PZ2QoL_kb:not(.hidden) .PZ2QoL_kbCol, .PZ2QoL_kb:not(.hidden) .PZ2QoL_kbAuto', { timeout: 6000 });
        await page.waitForTimeout(700);
    };
    const closeBoard = () => page.evaluate(async url => (await import(url)).closeSpeciesBoard(), BOARD);
    const autoBtn = () => page.locator(BTN);
    const pressAuto = async () => {
        await click(autoBtn());
        await page.waitForTimeout(350);
    };
    const panelOpen = async () => (await page.locator(PANEL).count()) > 0;
    // the first lion card in the Savannah habitat, and its menu
    const cardId = async () => page.evaluate(() => document.querySelector('.PZ2QoL_kb .PZ2QoL_kbCol[data-col="9000"] .PZ2QoL_kbCard[data-id]')?.getAttribute('data-id'));
    const openMenu = async id => {
        await click(page.locator(`.PZ2QoL_kb .PZ2QoL_kbCard[data-id="${id}"] .PZ2QoL_kbCardMenu`));
        await page.waitForTimeout(300);
    };
    const escape = async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    };

    try {
        // the fixture needs the zoo's Animals rows (management Animals)
        await page.evaluate(() => engine.trigger('World_ShowHUD'));
        await page.evaluate(() => engine.trigger('Management_SetManagementIndex', 7 /* ManagementSectionID.Animals */));
        await page.waitForSelector('.ManagementAnimals_root', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(1200);
        await seedZooKin(page);
        await seedAuto(page);
        await page.waitForTimeout(400);
        facts.store = await page.evaluate(async url => (await import(url)).userDataStatus(), STORE);
        if (facts.store !== 'file') problems.push(`the fake player-save store was not read: ${facts.store}`);

        // a. off: the button, and nothing else of Auto's on the board
        await board(SPECIES);
        facts.off = await boardAuto(page);
        await ctx.shot(page, 'ka_1_off_board');
        facts.layoutOff = await layoutFacts(page);
        layoutProblems('board (off)', facts.layoutOff, problems);
        facts.actionsOff = await actionsFacts(page);
        if (!facts.actionsOff || facts.actionsOff.pace < facts.actionsOff.paceHeight * 0.6) problems.push(`off: the pause slider under Execute is cut off (${JSON.stringify(facts.actionsOff)})`);
        facts.offCard = await cardId();
        await openMenu(facts.offCard);
        facts.offMenu = await boardAuto(page);
        await ctx.shot(page, 'ka_2_off_card_menu');
        await escape();
        if (facts.off.button !== 'Auto mode') problems.push(`off: the Auto button reads "${facts.off.button}"`);
        if (facts.off.buttonOn || facts.off.buttonAutoOn) problems.push('off: the Auto button looks on');
        if (facts.off.panel) problems.push('off: the Auto panel shows without a click');
        if (facts.off.tags.length || facts.off.rail.length) problems.push(`off: Auto tags on the board: ${JSON.stringify([facts.off.tags, facts.off.rail])}`);
        if (!facts.offMenu.menuOpen) problems.push('off: the card menu did not open');
        if (facts.offMenu.menu.length) problems.push(`off: Auto items in the card menu: ${facts.offMenu.menu}`);

        // b. open and close
        await pressAuto();
        facts.open = { board: await boardAuto(page), panel: await panelState(page) };
        await ctx.shot(page, 'ka_3_panel_off');
        facts.layoutPanelOff = await panelLayout(page);
        panelProblems('panel (off)', facts.layoutPanelOff, problems);
        layoutProblems('board with the panel (off)', await layoutFacts(page), problems);
        const P = facts.open.panel;
        if (!P) problems.push('the Auto button did not open the panel');
        else {
            if (P.species !== SPECIES) problems.push(`the panel is for "${P.species}", not ${SPECIES}`);
            if (P.status !== 'off') problems.push(`panel status "${P.status}" while off`);
            if (!/^Off/.test(P.sub)) problems.push(`status line while off: "${P.sub}"`);
            if (!P.head.some(t => t === 'Turn on')) problems.push(`no usable Turn on in the panel head: ${P.head}`);
            if (!P.head.includes('Close')) problems.push(`no Close in the panel head: ${P.head}`);
            for (const s of ['How often (game time)', 'Breeding programme', 'Thin out', 'Left alone', 'Last runs']) if (!P.sections.includes(s)) problems.push(`the panel has no "${s}" section (${P.sections})`);
            if (P.warn) problems.push(`store warning with the store ready: "${P.warn}"`);
        }
        if (!facts.open.board.buttonOn) problems.push('the Auto button is not marked while its panel is open');
        if (facts.open.board.cols) problems.push('the habitat columns still show under the Auto panel');
        // the button again closes it
        await pressAuto();
        facts.closeByButton = { panel: await panelOpen(page), cols: (await boardAuto(page)).cols };
        if (facts.closeByButton.panel || !facts.closeByButton.cols) problems.push(`the Auto button again: ${JSON.stringify(facts.closeByButton)}`);
        // Close
        await pressAuto();
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Close' }));
        await page.waitForTimeout(300);
        facts.closeByClose = await panelOpen(page);
        if (facts.closeByClose) problems.push('Close did not close the Auto panel');
        // Esc closes the panel, not the board
        await pressAuto();
        await escape();
        facts.closeByEsc = { panel: await panelOpen(page), board: await page.locator('.PZ2QoL_kb:not(.hidden)').count() };
        if (facts.closeByEsc.panel || !facts.closeByEsc.board) problems.push(`Esc: ${JSON.stringify(facts.closeByEsc)}`);
        // Breeding programme and Thin out take its place
        await pressAuto();
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbActions .PZ2QoL_kpBtn.PZ2QoL_kbProgBtn'));
        await page.waitForTimeout(500);
        facts.toProgramme = await boardAuto(page);
        if (facts.toProgramme.panel || !facts.toProgramme.prog || facts.toProgramme.buttonOn) problems.push(`Breeding programme over the Auto panel: ${JSON.stringify({ auto: facts.toProgramme.panel, prog: facts.toProgramme.prog, btnOn: facts.toProgramme.buttonOn })}`);
        await escape();
        await pressAuto();
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbActions .PZ2QoL_kpBtn', { hasText: 'Thin out' }));
        await page.waitForTimeout(500);
        facts.toCull = await boardAuto(page);
        if (facts.toCull.panel || !facts.toCull.cull) problems.push(`Thin out over the Auto panel: ${JSON.stringify({ auto: facts.toCull.panel, cull: facts.toCull.cull })}`);
        await escape();
        // and back: the Auto button over an open programme
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbActions .PZ2QoL_kpBtn.PZ2QoL_kbProgBtn'));
        await page.waitForTimeout(400);
        await pressAuto();
        facts.overProgramme = await boardAuto(page);
        if (!facts.overProgramme.panel || facts.overProgramme.prog) problems.push(`the Auto button over the Breeding programme: ${JSON.stringify({ auto: facts.overProgramme.panel, prog: facts.overProgramme.prog })}`);

        // c. Turn on
        if (!(await panelOpen(page))) await pressAuto();
        const savesBefore = await page.evaluate(() => window.__ka.saves.length);
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Turn on' }));
        await page.waitForTimeout(800);
        facts.on = { panel: await panelState(page), board: await boardAuto(page), saved: await saved(page) };
        facts.on.saves = await page.evaluate(n => window.__ka.saves.slice(n).filter(s => /kinAuto/.test(s)).length, savesBefore);
        await ctx.shot(page, 'ka_4_panel_on');
        facts.layoutPanelOn = await panelLayout(page);
        panelProblems('panel (on)', facts.layoutPanelOn, problems);
        // Clean up: the habitats to tick, the species' own ticked, and Cancel back
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Clean up' }));
        await page.waitForTimeout(400);
        facts.cleanPick = await page.evaluate(sel => {
            const root = document.querySelector(sel);
            const rows = Array.from(root.querySelectorAll('.PZ2QoL_apPick'));
            return {
                rows: rows.length,
                ticked: rows.filter(r => r.classList.contains('on')).map(r => r.querySelector('.PZ2QoL_apPickName').textContent),
                btns: Array.from(root.querySelectorAll('.PZ2QoL_kpBtn')).map(b => b.textContent.trim()),
            };
        }, PANEL);
        await ctx.shot(page, 'ka_4b_clean_pick');
        if (!facts.cleanPick.rows) problems.push('Clean up: no habitats to tick');
        if (!facts.cleanPick.ticked.length) problems.push("Clean up: the species' own habitats are not ticked");
        if (!facts.cleanPick.btns.some(t => /^Clean up \d+ habitat/.test(t)) || !facts.cleanPick.btns.includes('Whole zoo')) problems.push(`Clean up: the starts are missing (${facts.cleanPick.btns})`);
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Cancel' }));
        await page.waitForTimeout(300);
        if (await page.locator(`${PANEL} .PZ2QoL_apPick`).count()) problems.push('Clean up: Cancel left the habitat list open');
        panelProblems('panel (after Clean up)', await panelLayout(page), problems);
        layoutProblems('board with the panel (on)', await layoutFacts(page), problems);
        const O = facts.on;
        if (!O.saved.on || !O.saved.stored || !O.saved.stored.on) problems.push(`Turn on did not save: ${JSON.stringify(O.saved)}`);
        if (!O.saves) problems.push('Turn on did not write the player-save store');
        if (!O.panel || O.panel.status === 'off' || /^Off/.test(O.panel.sub)) problems.push(`the panel after Turn on: ${JSON.stringify(O.panel && { status: O.panel.status, sub: O.panel.sub })}`);
        if (O.panel && (!O.panel.head.some(t => /^Run now/.test(t)) || !O.panel.head.includes('Turn off') || O.panel.head.includes('Turn on'))) problems.push(`panel head after Turn on: ${O.panel.head}`);
        if (!/^Auto · /.test(O.board.button || '') || !O.board.buttonAutoOn) problems.push(`the Auto button after Turn on: "${O.board.button}" (autoOn ${O.board.buttonAutoOn})`);

        // d. the settings
        const pick = async (attr, v) => {
            await click(page.locator(`${PANEL} .PZ2QoL_kbSegItem[data-${attr}="${v}"]`));
            await page.waitForTimeout(250);
            return { shown: (await panelState(page))?.[attr] ?? null, saved: await saved(page) };
        };
        facts.settings = {};
        facts.settings.every = await pick('every', 12);
        if (facts.settings.every.saved.every !== 12 || facts.settings.every.saved.stored?.every !== 12 || facts.settings.every.shown !== '12') problems.push(`How often 1 year: ${JSON.stringify(facts.settings.every)}`);
        facts.settings.step = await pick('step', 0);
        if (facts.settings.step.saved.step !== 0 || facts.settings.step.saved.stored?.step !== 0 || facts.settings.step.shown !== '0') problems.push(`Fewest moves: ${JSON.stringify(facts.settings.step)}`);
        const trade0 = (await saved(page)).trade;
        await click(page.locator(`${PANEL} .PZ2QoL_kpSwitch`, { hasText: 'Bring breeders' }));
        await page.waitForTimeout(250);
        facts.settings.trade = [trade0, (await saved(page)).trade];
        if (facts.settings.trade[0] === facts.settings.trade[1]) problems.push(`the trade-centre switch: ${facts.settings.trade}`);
        const thin0 = await saved(page);
        if (thin0.thin) {
            await click(page.locator(`${PANEL} .PZ2QoL_kpSwitch`, { hasText: 'thin out' }));
            await page.waitForTimeout(250);
        }
        facts.settings.fillsWhileOff = (await panelState(page)).fills;
        await click(page.locator(`${PANEL} .PZ2QoL_kpSwitch`, { hasText: 'thin out' }));
        await page.waitForTimeout(250);
        facts.settings.thin = (await saved(page)).thin;
        facts.settings.fillsWhileOn = (await panelState(page)).fills;
        if (!facts.settings.thin) problems.push('the Thin out switch did not turn it on');
        if (facts.settings.fillsWhileOff || !facts.settings.fillsWhileOn) problems.push(`fill segments: ${facts.settings.fillsWhileOff} with Thin out off, ${facts.settings.fillsWhileOn} with it on`);
        facts.settings.fill = await pick('fill', 'lean');
        if (facts.settings.fill.saved.fill !== 'lean' || facts.settings.fill.saved.stored?.fill !== 'lean' || facts.settings.fill.shown !== 'lean') problems.push(`fill Lean: ${JSON.stringify(facts.settings.fill)}`);
        // the make-up arrows: the Breeding programme's own kinRatio entry
        const r0 = (await saved(page)).ratio;
        await click(page.locator(`${PANEL} .PZ2QoL_apRatio .PZ2QoL_kbRatioArrow.next`));
        await page.waitForTimeout(250);
        const r1 = { saved: (await saved(page)).ratio, shown: (await panelState(page)).ratio };
        await click(page.locator(`${PANEL} .PZ2QoL_apRatio .PZ2QoL_kbRatioArrow.prev`));
        await page.waitForTimeout(250);
        const r2 = (await saved(page)).ratio;
        facts.settings.ratio = [r0, r1, r2];
        if (r1.saved === r0 || r1.shown !== r1.saved || r2 !== r0) problems.push(`make-up arrows: ${JSON.stringify(facts.settings.ratio)}`);
        await ctx.shot(page, 'ka_5_panel_settings');
        facts.layoutSettings = await panelLayout(page);
        panelProblems('panel (settings)', facts.layoutSettings, problems);
        // the rest of the panel
        const body = await page.locator(`${PANEL} .PZ2QoL_kpScroll.kbAutoBody`).boundingBox();
        if (body) {
            await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
            for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
            await page.waitForTimeout(300);
            facts.scrolled = await page.evaluate(sel => {
                const vp = document.querySelector(`${sel} .PZ2QoL_kpScroll.kbAutoBody .PZ2QoL_kpViewport`);
                return vp ? vp.scrollTop : null;
            }, PANEL);
            await ctx.shot(page, 'ka_5b_panel_scrolled');
            facts.layoutScrolled = await panelLayout(page);
            panelProblems('panel (scrolled)', facts.layoutScrolled, problems);
            await page.mouse.move(5, 5);
        }
        else problems.push('no scroll area in the Auto panel');
        facts.sends = await page.evaluate(() => ({ moves: window.__ka.moves.length, contra: window.__ka.contra.length }));
        if (facts.sends.moves || facts.sends.contra) problems.push(`Franchise: Auto mode acted without a click ${JSON.stringify(facts.sends)}`);

        // e. the card menu: hands off
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Close' }));
        await page.waitForTimeout(300);
        facts.onBoard = await boardAuto(page);
        await ctx.shot(page, 'ka_6_on_board');
        layoutProblems('board (on)', await layoutFacts(page), problems);
        if (!facts.onBoard.rail.length) problems.push('the species rail does not show Auto mode is on');
        const id = await cardId();
        await openMenu(id);
        facts.onMenu = await boardAuto(page);
        await ctx.shot(page, 'ka_7_on_card_menu');
        layoutProblems('card menu (on)', await layoutFacts(page), problems);
        if (!facts.onMenu.menu.includes('Auto mode: hands off')) problems.push(`card menu while on: ${JSON.stringify(facts.onMenu.menu)}`);
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbMenuItem.auto', { hasText: 'hands off' }));
        await page.waitForTimeout(400);
        facts.pinned = {
            tags: (await boardAuto(page)).tags,
            api: await page.evaluate(async ({ auto, id }) => (await import(auto)).isAutoPinned(id), { auto: AUTO, id }),
            leftAlone: await page.evaluate(() => {
                const s = [...document.querySelectorAll('.PZ2QoL_kb .PZ2QoL_apSection')].find(n => /Left alone/i.test(n.textContent));
                return s ? s.innerText : null;
            }),
        };
        await ctx.shot(page, 'ka_8_hands_off_tag');
        if (!facts.pinned.api) problems.push('"Auto mode: hands off" did not pin the animal');
        if (!facts.pinned.tags.includes(`${id}:hands off`)) problems.push(`no "hands off" tag on card ${id}: ${JSON.stringify(facts.pinned.tags)}`);
        // shown in the panel's Left alone section
        await pressAuto();
        facts.pinned.panel = await page.evaluate(sel => {
            const s = [...document.querySelectorAll(`${sel} .PZ2QoL_apSection`)].find(n => /Left alone/i.test(n.textContent));
            return s ? s.innerText.replace(/\s+/g, ' ') : null;
        }, PANEL);
        if (!/Hands off \(1\)/.test(facts.pinned.panel || '')) problems.push(`Left alone section with one animal pinned: "${facts.pinned.panel}"`);
        await pressAuto();
        // and back
        await openMenu(id);
        facts.unpinMenu = (await boardAuto(page)).menu;
        await click(page.locator('.PZ2QoL_kb .PZ2QoL_kbMenuItem.auto', { hasText: 'may move it again' }));
        await page.waitForTimeout(400);
        facts.unpinned = { tags: (await boardAuto(page)).tags, api: await page.evaluate(async ({ auto, id }) => (await import(auto)).isAutoPinned(id), { auto: AUTO, id }) };
        if (!facts.unpinMenu.includes('Auto mode may move it again')) problems.push(`card menu of a pinned animal: ${JSON.stringify(facts.unpinMenu)}`);
        if (facts.unpinned.api || facts.unpinned.tags.some(t => t.startsWith(`${id}:hands off`))) problems.push(`unpin: ${JSON.stringify(facts.unpinned)}`);

        // f. a smaller window
        await closeBoard();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(800);
        await board(SPECIES);
        await ctx.shot(page, 'ka_9_narrow_board');
        facts.layoutNarrowBoard = await layoutFacts(page);
        layoutProblems('1280x720 board', facts.layoutNarrowBoard, problems);
        facts.actionsNarrow = await actionsFacts(page);
        if (!facts.actionsNarrow || facts.actionsNarrow.pace < facts.actionsNarrow.paceHeight * 0.6) problems.push(`1280x720: the pause slider under Execute is cut off (${JSON.stringify(facts.actionsNarrow)})`);
        facts.narrowButton = await page.evaluate(sel => {
            const b = document.querySelector(sel);
            return b ? { text: b.innerText.trim(), fits: b.scrollWidth <= b.clientWidth + 1 } : null;
        }, BTN);
        if (!facts.narrowButton || !facts.narrowButton.fits) problems.push(`1280x720: the Auto button text does not fit: ${JSON.stringify(facts.narrowButton)}`);
        await pressAuto();
        await page.waitForTimeout(300);
        await ctx.shot(page, 'ka_10_narrow_panel');
        facts.layoutNarrow = await panelLayout(page);
        panelProblems('1280x720 panel', facts.layoutNarrow, problems);
        layoutProblems('1280x720 board with the panel', await layoutFacts(page), problems);
        const nb = await page.locator(`${PANEL} .PZ2QoL_kpScroll.kbAutoBody`).boundingBox();
        if (nb) {
            await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
            for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
            await page.waitForTimeout(300);
            await ctx.shot(page, 'ka_10b_narrow_panel_scrolled');
            facts.layoutNarrowScrolled = await panelLayout(page);
            panelProblems('1280x720 panel (scrolled)', facts.layoutNarrowScrolled, problems);
            await page.mouse.move(5, 5);
        }
        await closeBoard();
        await page.setViewportSize(viewport);
        await page.waitForTimeout(800);

        // g. Turn off (the board opens on the Auto panel left open above)
        await board(SPECIES);
        facts.reopened = await panelOpen(page);
        if (!facts.reopened) await pressAuto();
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Turn off' }));
        await page.waitForTimeout(600);
        facts.offAgain = { panel: await panelState(page), saved: await saved(page) };
        await click(page.locator(`${PANEL} .PZ2QoL_kbProgHead .PZ2QoL_kpBtn`, { hasText: 'Close' }));
        await page.waitForTimeout(300);
        facts.offAgain.board = await boardAuto(page);
        await openMenu(await cardId());
        facts.offAgain.menu = (await boardAuto(page)).menu;
        await ctx.shot(page, 'ka_11_off_again');
        await escape();
        const F = facts.offAgain;
        if (F.saved.on || !F.saved.stored || F.saved.stored.on) problems.push(`Turn off did not save: ${JSON.stringify(F.saved)}`);
        if (!F.panel || F.panel.status !== 'off' || !/^Off/.test(F.panel.sub)) problems.push(`the panel after Turn off: ${JSON.stringify(F.panel && { status: F.panel.status, sub: F.panel.sub })}`);
        if (F.board.button !== 'Auto mode' || F.board.buttonAutoOn) problems.push(`the Auto button after Turn off: "${F.board.button}"`);
        if (F.board.tags.length || F.board.rail.length || F.menu.length) problems.push(`after Turn off, Auto marks on the board: ${JSON.stringify([F.board.tags, F.board.rail, F.menu])}`);
        facts.sentTotal = await page.evaluate(() => ({ moves: window.__ka.moves.length, contra: window.__ka.contra.length, dest: window.__ka.dest, species: window.__ka.species, saves: window.__ka.saves.length }));
        if (facts.sentTotal.moves || facts.sentTotal.contra) problems.push(`sent without a run: ${JSON.stringify(facts.sentTotal)}`);
    }
    finally {
        // leave the page as the other scenarios expect it
        await page.mouse.up().catch(() => {});
        if (viewport) await page.setViewportSize(viewport).catch(() => {});
        await page.evaluate(async ({ board, auto, store, sp }) => {
            const A = await import(auto);
            try {
                if (A.getSpeciesAuto(sp).settings.on) A.setSpeciesAuto(sp, { on: false });
            }
            catch (e) {
                // the store is put back below anyway
            }
            (await import(board)).closeSpeciesBoard();
            for (const t of document.querySelectorAll('.PZ2QoL_apToast')) t.remove();
            const k = window.__ka;
            if (k) {
                k.active = false;
                // the store as found: no kinAuto, no kinRatio, the same status
                const S = await import(store);
                S._resetUserStoreForTests({});
                k.restoring = true;
                S.loadUserData();
                await new Promise(r => setTimeout(r, 100));
                k.restoring = false;
                try {
                    if (k.before.mirror == null) localStorage.removeItem('PZ2QoL.userdata.v1');
                    else localStorage.setItem('PZ2QoL.userdata.v1', k.before.mirror);
                }
                catch (e) {
                    // session memory only
                }
            }
            const kin = await import('/js/mods/pz2qol/kin.js');
            if (window.__kinFixture) kin.applyKinSnapshot(window.__kinFixture.snapshot);
        }, { board: BOARD, auto: AUTO, store: STORE, sp: SPECIES }).catch(() => {});
        facts.storeAfter = await page.evaluate(async url => {
            const S = await import(url);
            return { status: S.userDataStatus(), reason: S.userDataReason(), kinAuto: S.getUserData('kinAuto') === undefined ? 'none' : 'left' };
        }, STORE).catch(() => null);
        // kinmoves keeps destinations 30 s per species: with --jobs 1 the
        // next scenario on this page (the board) must ask the game itself
        const wait = await page.evaluate(() => (window.__ka && window.__ka.lastDest ? Math.max(0, 31000 - (Date.now() - window.__ka.lastDest)) : 0)).catch(() => 0);
        // (in lanes every group gets a fresh page: no wait)
        const ji = process.argv.indexOf('--jobs');
        const jobs = Number(ji >= 0 ? process.argv[ji + 1] : process.env.PZ2H_JOBS || 4) || 1;
        if (wait && jobs <= 1) await page.waitForTimeout(wait);
    }
    if (facts.storeAfter && facts.storeAfter.kinAuto !== 'none') problems.push(`the store still holds kinAuto after the scenario: ${JSON.stringify(facts.storeAfter)}`);
    if (problems.length) throw new Error('auto mode: ' + problems.join('; '));
    return facts;
}
