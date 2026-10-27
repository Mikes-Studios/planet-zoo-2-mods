// Autosave: pure helpers (no engine, no DOM), shared by autosave.js and
// the unit tests. The state comes from Lua (PZ2QoL.Autosave):
// { minutes, minMinutes, available, inPark, armed, pending, elapsed,
//   retryIn, nextTry, sinceSave, lastKind, lastError }; retryIn: seconds to
// the next try (null: not known), nextTry: 'retry' | 'interval' | 'waiting' | 'manual'.

export const AUTOSAVE_CHOICES = [0, 2, 3, 5, 10];
export const AUTOSAVE_MIN_MINUTES = 2;

export function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return `${sec} s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min`;
    const hours = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const DUE_WAITING = 'A save is due; waiting for the game to get its autosave ready.';
const KIND_LABEL = { mod: 'by the mod', game: "by the game's own timer", manual: 'by you' };

function nextTryText(s, age) {
    const left = fmtDuration(Math.max(0, s.retryIn - age));
    if (s.nextTry === 'retry') return `The mod tries again in ${left}.`;
    if (s.nextTry === 'interval') return `The mod tries again at its next autosave, in ${left}; Save now tries at once.`;
    if (s.nextTry === 'waiting') return DUE_WAITING;
    return 'Press Save now to try again.';
}

// What the launcher shows. ageSec: seconds since the state arrived (the
// clock only runs in the park, where Lua resends every 10 s anyway).
export function autosaveSummary(state, ageSec = 0) {
    const s = state || {};
    const age = s.inPark && s.armed && !s.pending ? Math.max(0, ageSec) : 0;
    const since = s.sinceSave >= 0 ? s.sinceSave + age : -1;
    const last = since >= 0 ? `Last save ${fmtDuration(since)} ago${KIND_LABEL[s.lastKind] ? ' ' + KIND_LABEL[s.lastKind] : ''}` : 'No save yet this session';
    if (!s.available) {
        return { tone: 'off', short: 'Game', title: "Autosave: the game's own", detail: 'This game version has no autosave call the mod can use, so the game autosaves on its own.', last };
    }
    if (s.pending) {
        return { tone: 'busy', short: '…', title: 'Saving…', detail: 'The game is writing an autosave.', last };
    }
    if (s.lastError) {
        return { tone: 'bad', short: '!', title: 'Autosave failed', detail: `${s.lastError} ${nextTryText(s, age)}`, last };
    }
    if (!s.minutes) {
        return { tone: 'off', short: 'Off', title: "Autosave: the game's own", detail: 'The game saves every 10 minutes of park time; its clock waits while you are in the hub.', last };
    }
    const left = Math.max(0, s.minutes * 60 - (s.elapsed || 0) - age);
    let detail;
    if (!s.inPark) detail = `Every ${s.minutes} min of park time. The clock waits while you are away from the park.`;
    else if (left > 0) detail = `Next save in ${fmtDuration(left)}.`;
    else if (!s.armed) detail = DUE_WAITING;
    else detail = 'A save is due and starts in a moment.';
    return { tone: left <= 0 ? 'due' : 'on', short: `${s.minutes}m`, title: `Autosave every ${s.minutes} min`, detail, last, left };
}

export function parseAutosaveState(json) {
    try {
        const s = JSON.parse(json);
        return s && typeof s === 'object' ? s : null;
    }
    catch (e) {
        return null;
    }
}
