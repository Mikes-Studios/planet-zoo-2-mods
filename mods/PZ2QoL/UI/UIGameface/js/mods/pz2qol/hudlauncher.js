// In-park launcher: round buttons docked on top of the game's own tools
// column (bottom left: Paths, Barriers, Terrain ...), styled like it.
//  - Species board: opens (or closes) the board in one click.
//  - Breeding programme (under it): the small Breeding window, where the
//    game opens its info panels (breedwin.js).
//  - Autosave: shows the mod's autosave state; click for its settings.
//  - Settings: the mod's settings, every switch in one place (the Kin
//    planner's Settings, opened).
//  - Script profiler (bottom): which scripts take time each frame
//    (profiler.js); the first button given up when room is short.
//
// Our own element under <body>, placed every tick from the tools column's
// box (.ToolsBar_root), never inside the game's preact tree (the game
// recreates that column). Hidden whenever the column is hidden (management
// screen, photo/camera mode, hidden UI, cinematics), and it gives up the
// autosave button, then the Breeding button, then the Settings button, then
// itself, when the alert buttons above leave no room.
import { autosaveCard, getAutosaveSummary, installAutosave, onAutosave } from '/js/mods/pz2qol/autosave.js';
import { isLogEnabled } from '/js/mods/pz2qol/debuglog.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { GAME_TOOLTIPS, GAME_WINDOWS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { h, icon, setClass, setText, visibleBox } from '/js/mods/pz2qol/ui.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';

const TICK_MS = 250;

let dock = null;
let boardBtn = null;
let breedBtn = null;
let settingsBtn = null;
let saveBtn = null;
let saveBadge = null;
let card = null;
let boardModule = null;
let breedModule = null;
let profBtn = null;
let profModule = null;
let fitRoom = null; // the room above the tools column and the log state the dock was last fitted to

function board() {
    if (boardModule) return Promise.resolve(boardModule);
    return import('/js/mods/pz2qol/kinboard.js').then(m => (boardModule = m));
}

function toggleBoard() {
    breadcrumb('board_launch');
    closeCard();
    board().then(m => {
        if (m.isSpeciesBoardOpen && m.isSpeciesBoardOpen()) m.closeSpeciesBoard();
        else m.openSpeciesBoard({});
        setTimeout(sync, 50);
    }).catch(e => reportError('ui', 'Species board could not open', e));
}

function breeding() {
    if (breedModule) return Promise.resolve(breedModule);
    return import('/js/mods/pz2qol/breedwin.js').then(m => (breedModule = m));
}

function toggleBreeding() {
    breadcrumb('breed_launch');
    closeCard();
    breeding().then(m => {
        m.toggleBreedingWindow({});
        setTimeout(sync, 50);
    }).catch(e => reportError('ui', 'Breeding window could not open', e));
}

function openSettings() {
    breadcrumb('settings_launch');
    closeCard();
    import('/js/mods/pz2qol/kinplanner.js')
        .then(m => m.openKinPlanner({ settings: true }))
        .catch(e => reportError('ui', 'Settings could not open', e, { silent: true }));
}

function profiler() {
    if (profModule) return Promise.resolve(profModule);
    return import('/js/mods/pz2qol/profiler.js').then(m => (profModule = m));
}

function toggleProfilerPanel() {
    breadcrumb('prof_launch');
    closeCard();
    profiler().then(m => {
        m.toggleProfiler();
        setTimeout(sync, 50);
    }).catch(e => reportError('ui', 'Script profiler could not open', e));
}

// a round button with a hover label to its right, like the game's own
function roundButton(iconName, label, onClick) {
    const tip = h('div.PZ2QoL_dockTip', { text: label });
    const b = h('div.PZ2QoL_dockBtn', { onClick: () => {
        try {
            onClick();
        }
        catch (e) {
            reportError('ui', `"${label}" failed`, e);
        }
    } }, h('div.PZ2QoL_dockBg'), icon(iconName, 'brown', 'dock'), tip);
    b.addEventListener('mouseenter', () => setClass(b, 'hover', true));
    b.addEventListener('mouseleave', () => setClass(b, 'hover', false));
    b.__tip = tip;
    return b;
}

function closeCard() {
    if (!card) return;
    card.remove();
    card = null;
    setClass(saveBtn, 'on', false);
}

function toggleCard() {
    if (card) return closeCard();
    card = autosaveCard(closeCard);
    document.body.appendChild(card);
    setClass(saveBtn, 'on', true);
    sync();
}

function build() {
    boardBtn = roundButton('IconAnimals', 'Species board', toggleBoard);
    saveBtn = roundButton('save', 'Autosave', toggleCard);
    breedBtn = roundButton('Icon_Heart', 'Breeding programme', toggleBreeding);
    settingsBtn = roundButton('IconSettings', 'Settings', openSettings);
    profBtn = roundButton('IconTime', 'Script profiler', toggleProfilerPanel);
    saveBadge = h('div.PZ2QoL_dockBadge');
    saveBtn.appendChild(saveBadge);
    dock = h('div.PZ2QoL_dock', null, h('div.PZ2QoL_dockPanel'), settingsBtn, saveBtn, boardBtn, breedBtn, profBtn);
    document.body.appendChild(dock);
    document.addEventListener('click', e => {
        if (card && !card.contains(e.target) && !saveBtn.contains(e.target)) closeCard();
    });
    document.addEventListener('keydown', e => {
        if (card && (e.key === 'Escape' || e.keyCode === 27)) {
            e.stopPropagation();
            closeCard();
        }
    }, true);
}

function sync() {
    if (!dock) return;
    const sum = getAutosaveSummary();
    if (sum) {
        setText(saveBadge, sum.short);
        saveBadge.dataset.tone = sum.tone;
        setText(saveBtn.__tip, `${sum.title} · ${sum.detail}`);
    }
    let open = false;
    try {
        open = !!(boardModule && boardModule.isSpeciesBoardOpen && boardModule.isSpeciesBoardOpen());
    }
    catch (e) {
        open = false;
    }
    setClass(boardBtn, 'on', open);
    let bw = false;
    try {
        bw = !!(breedModule && breedModule.isBreedingWindowOpen && breedModule.isBreedingWindowOpen());
    }
    catch (e) {
        bw = false;
    }
    setClass(breedBtn, 'on', bw);
    let pf = false;
    try {
        pf = !!(profModule && profModule.isProfilerOpen && profModule.isProfilerOpen());
    }
    catch (e) {
        pf = false;
    }
    setClass(profBtn, 'on', pf);
    if (card && card.__sync) card.__sync();
}

// Gives up the script profiler, then the autosave button, then the Breeding
// button, then the Settings button, then the whole dock until it fits;
// measured again only when the room or the build's log changes. The script
// profiler is a developer tool: debug builds only.
function fitDock(room) {
    const debug = isLogEnabled() === true;
    const key = `${room}|${debug}`;
    if (key === fitRoom) return;
    fitRoom = key;
    const giveUp = [profBtn, saveBtn, breedBtn, settingsBtn, dock];
    for (const node of giveUp) setClass(node, 'displayNone', node === profBtn && !debug);
    for (const node of giveUp) {
        if (dock.getBoundingClientRect().height <= room) return;
        setClass(node, 'displayNone', true);
    }
}

function place() {
    const tools = visibleBox(document.querySelector('.ToolsBar_root'));
    if (!tools) {
        dock.style.display = 'none';
        closeCard();
        return;
    }
    dock.style.display = 'flex';
    // just above the tools column, same left edge
    dock.style.left = `${Math.round(tools.left)}px`;
    dock.style.top = '';
    dock.style.bottom = `${Math.round(window.innerHeight - tools.top)}px`;
    // the alert buttons above grow downwards: keep clear of them
    const alerts = visibleBox(document.querySelector('.NotificationsModule_buttons'));
    fitDock(alerts ? tools.top - alerts.bottom - 4 : Infinity);
    stepAside(dock, `${GAME_TOOLTIPS}, ${GAME_WINDOWS}`, 'dock');
    if (card) {
        const r = saveBtn.getBoundingClientRect();
        if (r.height <= 0) return closeCard();
        card.style.left = `${Math.round(r.right + 14)}px`;
        card.style.bottom = `${Math.round(Math.max(8, window.innerHeight - r.bottom - 6))}px`;
    }
}

let installed = false;
export function installHudLauncher() {
    if (installed) return true;
    if (!isHudPage()) return true;
    installed = true;
    installAutosave();
    build();
    onAutosave(() => sync());
    setInterval(() => {
        try {
            place();
            sync();
        }
        catch (e) {
            reportError('ui', 'HUD launcher failed', e, { silent: true });
        }
    }, TICK_MS);
    return true;
}
