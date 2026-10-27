// Guest Education (Management > Education): the topics each species in the
// zoo still lacks, and Fill topics, which sets the props that show nothing
// or a topic shown elsewhere to a missing one (pz2qol.education.lua).
// The zoo's rating counts the topics placed per species, so a prop showing
// a topic another prop already shows adds nothing.
import { translate } from '/js/common/core/Localisation.js';
import { chip, collapser, setChip } from '/js/mods/pz2qol/bars.js';
import { educationRows, fillSummary, missingCount } from '/js/mods/pz2qol/educationcore.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { GAME_TOOLTIPS, GAME_WINDOWS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { clear, h, isGamePopupOpen, setClass, setText, visibleBox } from '/js/mods/pz2qol/ui.js';

const SCREEN_CLASSES = ['ManagementEducationOverview_root', 'ManagementEducationSpecies_root', 'ManagementEducationObjects_root'];
const SCREENS = SCREEN_CLASSES.map(c => '.' + c).join(', ');
const ASK_EVERY_MS = 3000;
const ANSWER_MS = 4000;

const NAMES = {
    species: id => speciesName(id),
    topic: s => {
        try {
            return translate(s);
        }
        catch (e) {
            return s;
        }
    },
};

function ask(event, waiting, seq) {
    const reqId = 'e' + seq;
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            waiting.delete(reqId);
            resolve(null);
        }, ANSWER_MS);
        waiting.set(reqId, json => {
            clearTimeout(timer);
            try {
                resolve(JSON.parse(json || 'null'));
            }
            catch (e) {
                reportError('ui', 'Education: the park\'s answer could not be read.', e, { silent: true });
                resolve(null);
            }
        });
        engine.trigger(event, reqId);
    });
}

function buildBar(state) {
    const note = h('div.PZ2QoL_eduNote');
    const list = h('div.PZ2QoL_eduList');
    const fill = chip('Fill topics', 'Sets the education props that show nothing, or a topic another prop already shows, to a topic a species here still lacks. A prop that fits none keeps its setting.', () => {
        breadcrumb('edu_fill');
        state.request('PZ2QoL_EduFill').then(result => {
            if (!result || result.error) {
                setText(note, 'The park did not answer. Close the Education screen and open it again.');
                return;
            }
            setText(note, fillSummary(result));
            bar.__show(result.report);
        });
    }, 'IconEducation');
    const bar = h('div.PZ2QoL_bar.PZ2QoL_card.edu');
    bar.appendChild(collapser(bar, 'edu', 'Topics'));
    bar.appendChild(h('div.PZ2QoL_expandOnly.PZ2QoL_eduBody', null, h('div.PZ2QoL_eduHead', null, fill, note), list));
    bar.__show = report => {
        const sig = JSON.stringify(report);
        if (bar.__sig === sig) return;
        bar.__sig = sig;
        clear(list);
        const rows = educationRows(report, NAMES);
        if (!rows.length) list.appendChild(h('div.PZ2QoL_eduRow', { text: 'No animals in a habitat yet.' }));
        for (const row of rows) list.appendChild(h(`div.PZ2QoL_eduRow${row.done ? '.done' : ''}`, { text: row.text }));
        const left = missingCount(report);
        setChip(fill, false, undefined, left || '');
        setClass(fill, 'disabled', !(report && report.spare > 0 && left > 0));
    };
    return bar;
}

export function installEducation() {
    if (!isHudPage()) return true;
    const waiting = new Map();
    let seq = 0;
    const answer = (reqId, json) => {
        const done = waiting.get(String(reqId));
        if (!done) return;
        waiting.delete(String(reqId));
        done(json);
    };
    engine.on('PZ2QoL_EduReportResult', answer);
    engine.on('PZ2QoL_EduFillResult', answer);
    const state = { request: event => ask(event, waiting, ++seq) };
    let bar = null;
    let reservedFor = null;
    let lastAsk = 0;
    const reserveStyle = document.createElement('style');
    document.head.appendChild(reserveStyle);
    const reserve = px => {
        const rule = px > 0 ? SCREEN_CLASSES.map(c => `.PZ2QoL .${c} { padding-top: ${Math.round(px)}px; }`).join('\n') : '';
        if (reservedFor !== rule) reserveStyle.textContent = reservedFor = rule;
    };
    setInterval(() => {
        try {
            const screen = Array.from(document.querySelectorAll(SCREENS)).find(s => visibleBox(s));
            const r = screen && !isGamePopupOpen() ? visibleBox(screen) : null;
            if (!r) {
                if (bar) bar.style.display = 'none';
                reserve(0);
                return;
            }
            if (!bar) {
                bar = buildBar(state);
                document.body.appendChild(bar);
            }
            bar.style.display = 'flex';
            bar.style.left = `${Math.round(r.left + 6)}px`;
            bar.style.top = `${Math.round(r.top + 4)}px`;
            bar.style.width = `${Math.round(r.width - 12)}px`;
            stepAside(bar, `${GAME_TOOLTIPS}, ${GAME_WINDOWS}`, 'education bar', screen);
            reserve(bar.getBoundingClientRect().height + 10);
            if (Date.now() - lastAsk < ASK_EVERY_MS) return;
            lastAsk = Date.now();
            state.request('PZ2QoL_EduReport').then(report => {
                if (report && !report.error) bar.__show(report);
            });
        }
        catch (e) {
            reportError('ui', 'Education bar failed', e, { silent: true });
        }
    }, 250);
    return true;
}
