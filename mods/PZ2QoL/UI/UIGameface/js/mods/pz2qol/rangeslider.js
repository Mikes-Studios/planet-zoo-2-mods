// A two-knob range slider: drag either knob, or click the track to move the
// nearer one. Gameface has no <input type=range> with two thumbs, so this is
// plain divs and mouse events (like pace.js). Built once and kept, so a
// re-render of the panel around it never interrupts a drag. The value is
// committed on release; while dragging only the slider itself changes.
//
//   opts.bounds  () => [min, max]       (may change, e.g. the price range)
//   opts.get     () => [lo, hi]
//   opts.set     (lo, hi) => void        on release or click
//   opts.step    snap (default 1)
//   opts.fmt     (lo, hi, [min, max]) => text shown next to the track
//   opts.title   tooltip
import { h, setClass, setText } from '/js/mods/pz2qol/ui.js';

export function rangeSlider({ bounds, get, set, step = 1, fmt = (lo, hi) => `${lo}–${hi}`, title = '', cls = '' }) {
    const fill = h('div.PZ2QoL_rngFill');
    const knobLo = h('div.PZ2QoL_rngKnob.lo');
    const knobHi = h('div.PZ2QoL_rngKnob.hi');
    const track = h('div.PZ2QoL_rngTrack', { title: title || undefined }, h('div.PZ2QoL_rngRail'), fill, knobLo, knobHi);
    const value = h('div.PZ2QoL_rngValue');
    const node = h(`div.PZ2QoL_rng${cls ? '.' + cls : ''}`, null, track, value);
    let live = null; // [lo, hi] while dragging
    let which = null; // 'lo' | 'hi', or 'tie' until the first move picks one
    let pressedAt = null;

    const range = () => {
        const b = bounds();
        return [b[0], Math.max(b[0] + step, b[1])];
    };
    const snap = v => {
        const [min, max] = range();
        return Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
    };
    const current = () => {
        const [min, max] = range();
        const [lo, hi] = live || get();
        return [Math.max(min, Math.min(max, lo)), Math.max(min, Math.min(max, hi))];
    };
    const draw = () => {
        const [min, max] = range();
        const [lo, hi] = current();
        const p = v => `${(v - min) / (max - min) * 100}%`;
        knobLo.style.left = p(lo);
        knobHi.style.left = p(hi);
        fill.style.left = p(lo);
        fill.style.width = `${(hi - lo) / (max - min) * 100}%`;
        setText(value, fmt(lo, hi, [min, max]));
        setClass(node, 'full', lo <= min && hi >= max);
    };
    const fromX = x => {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return null;
        const [min, max] = range();
        return snap(min + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (max - min));
    };
    const move = x => {
        const v = fromX(x);
        if (v == null) return;
        if (which === 'tie') {
            if (v === pressedAt) return;
            which = v < pressedAt ? 'lo' : 'hi';
        }
        const [lo, hi] = current();
        live = which === 'lo' ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)];
        draw();
    };
    track.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        const v = fromX(e.clientX);
        if (v == null) return;
        const [lo, hi] = current();
        // the nearer knob; on a tie the side pressed, or between them (one value) the way the drag goes
        const toLo = Math.abs(v - lo);
        const toHi = Math.abs(v - hi);
        which = toLo < toHi ? 'lo' : toLo > toHi ? 'hi' : v < lo ? 'lo' : v > hi ? 'hi' : 'tie';
        pressedAt = v;
        setClass(node, 'dragging', true);
        move(e.clientX);
    });
    document.addEventListener('mousemove', e => {
        if (which) move(e.clientX);
    });
    document.addEventListener('mouseup', () => {
        if (!which) return;
        which = null;
        setClass(node, 'dragging', false);
        const v = live;
        live = null;
        if (v) set(v[0], v[1]);
        draw();
    });
    // the panels close on outside clicks; a click on the slider is inside
    track.addEventListener('click', e => e.stopPropagation());
    node.__update = draw;
    draw();
    return node;
}
