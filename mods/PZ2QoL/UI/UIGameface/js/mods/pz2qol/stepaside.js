// Our floating widgets sit above the game's tree, so the game's tooltips and
// menus that open where one of them is draw underneath it. The widget steps
// aside (hidden, clicks pass through, its place kept) while one covers it.
//
// Only elements that exist while they show: the HUD keeps full-screen frames
// on the page (.TooltipContainer, .HelperTooltip_root) and shared tooltips
// marked tooltipHidden (visibleBox), and matching those hides a widget for good.
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { setClass, visibleBox } from '/js/mods/pz2qol/ui.js';

// pz2-source Tooltip.js, HelperTooltip.js and the tooltip contents they show
export const GAME_TOOLTIPS = '.Tooltip_root, .HelperTooltip_tooltipContainer, .BrowserItemTooltip_root, .ValidityTooltip_root, .ResearchTooltip_root, .NestParentTooltip_root';
// under a screen's header search: InputField.js suggestions, SpeciesHabitatFilterModal.js filters
export const GAME_DROPDOWNS = '.InputField_resultsMenu, .SpeciesHabitatFilterModal_content';
// full-screen windows the game opens over a screen: ZoopediaModule.js (F11, from any screen),
// and a darkened modal Layer (Layer.js: the hub's Settings, Help, Save...)
export const GAME_WINDOWS = '.ZoopediaModule_root, .LayerCollection .Layer_background.darken';
// what a screen's toolbar and panels step aside for
export const GAME_COVERS = `${GAME_DROPDOWNS}, ${GAME_WINDOWS}`;

// The first element matching selector that shows over box, or null.
export function coveringNode(selector, box) {
    for (const node of document.querySelectorAll(selector)) {
        const r = visibleBox(node);
        if (r && r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) return node;
    }
    return null;
}

// across the widget, where a game window over it shows (fractions of its box)
const PROBES = [[0.04, 0.5], [0.5, 0.5], [0.96, 0.5]];

const up = n => n.parentElement || n.parentNode || null;

function isMod(el) {
    for (let n = el; n && n !== document.body; n = up(n)) {
        if (String(n.className || '').indexOf('PZ2QoL_') !== -1) return true;
    }
    return false;
}

// n is root or inside it. Gameface's own Node.contains says no for a screen's
// own rows, so the parents are walked.
function within(n, root) {
    for (let x = n; x; x = up(x)) if (x === root) return true;
    return false;
}

// el is the screen, inside it, around it, or inside another copy of it (the
// game can keep two of a screen)
function onScreen(el, screen) {
    if (within(el, screen) || within(screen, el)) return true;
    const kind = String(screen.className || '').split(' ')[0];
    for (let n = el; kind && n; n = up(n)) {
        if (String(n.className || '').split(' ')[0] === kind) return true;
    }
    return false;
}

// The game's element showing over the widget where only its own screen
// belongs, or null. The game draws every window under the mod's widgets, so
// whatever opens there (a popup, a side panel, a modal) is found without a
// list of their names. screen: the game element the widget sits on; it and
// the page around it are what belong under the widget.
export function gameAbove(widget, screen) {
    if (!screen || typeof document.elementsFromPoint !== 'function') return null;
    const r = widget.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    for (const [fx, fy] of PROBES) {
        for (const el of document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy)) {
            if (within(el, widget) || isMod(el)) continue;
            if (onScreen(el, screen)) break;
            return el;
        }
    }
    return null;
}

// Logs what the widget steps aside for, so a wrong match reads straight from the trace.
// screen: the game element it sits on (gameAbove), when it sits on one.
export function stepAside(widget, selector, name, screen = null) {
    const node = coveringNode(selector, widget.getBoundingClientRect()) || gameAbove(widget, screen);
    setClass(widget, 'PZ2QoL_yield', !!node);
    const to = node ? String(node.className) : null;
    if (to === (widget.__yieldedTo || null)) return;
    widget.__yieldedTo = to;
    const r = node && node.getBoundingClientRect();
    dlog('ui', 'step_aside', to ? { widget: name, to, box: [r.left, r.top, r.width, r.height].map(Math.round) } : { widget: name, to: null });
}
