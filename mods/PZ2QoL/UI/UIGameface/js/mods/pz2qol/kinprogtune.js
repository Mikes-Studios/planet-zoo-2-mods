// The Breeding programme's fine tuning: every optimiser rule the player may
// change (kinprogramme.js PROGRAMME_DEFAULTS), with a few choices each.
// Pure (node tests). Kept player-wide in prefs.js under TUNE_PREF as
// { key: choice id }; a key left out is the default, so an empty tuning
// gives exactly the plans the mod made before. Used by the Breeding window
// (where it is set), the Species board's programme and Auto mode, so all
// three plan alike.

export const TUNE_PREF = 'progTune';

// choices: { id, label, value (the options patch) }; the default first-class
// choice has id 'default' and no patch.
export const PROGRAMME_TUNING = Object.freeze([
    {
        key: 'moveCost', group: 'Moves', label: 'Cost of a move',
        help: 'How much one move must gain to be made. "Slider" uses the Fewer moves to Best genetics slider.',
        choices: [
            { id: 'default', label: 'Slider' },
            { id: 'free', label: 'Free', value: { moveCost: 0 } },
            { id: 'tiny', label: 'Tiny', value: { moveCost: 0.02 } },
            { id: 'low', label: 'Low', value: { moveCost: 0.04 } },
            { id: 'mid', label: 'Medium', value: { moveCost: 0.08 } },
            { id: 'high', label: 'High', value: { moveCost: 0.15 } },
            { id: 'max', label: 'Very high', value: { moveCost: 0.3 } },
        ],
    },
    {
        key: 'outsiderCost', group: 'Moves', label: 'Joining a settled group',
        help: 'Extra cost when an animal joins a habitat that already has this species.',
        choices: [
            { id: 'default', label: 'Slider' },
            { id: 'free', label: 'Free', value: { outsiderCost: 0 } },
            { id: 'low', label: 'Low', value: { outsiderCost: 0.02 } },
            { id: 'mid', label: 'Medium', value: { outsiderCost: 0.06 } },
            { id: 'high', label: 'High', value: { outsiderCost: 0.15 } },
        ],
    },
    {
        key: 'bondBreakCost', group: 'Moves', label: 'Splitting a bonded pair',
        help: 'Cost of separating two monogamous mates (they mourn).',
        choices: [
            { id: 'free', label: 'Free', value: { bondBreakCost: 0 } },
            { id: 'low', label: 'Low', value: { bondBreakCost: 0.05 } },
            { id: 'default', label: 'Normal' },
            { id: 'high', label: 'High', value: { bondBreakCost: 0.4 } },
            { id: 'never', label: 'Never', value: { bondBreakCost: 3 } },
        ],
    },
    {
        key: 'overCapacityPenalty', group: 'Groups', label: 'Habitat room',
        help: 'Adults over a habitat\'s room for the species.',
        choices: [
            { id: 'default', label: 'Strict' },
            { id: 'soft', label: 'Soft', value: { overCapacityPenalty: 0.3 } },
            { id: 'off', label: 'Ignore', value: { overCapacityPenalty: 0 } },
        ],
    },
    {
        key: 'structurePenalty', group: 'Groups', label: 'Group make-up limit',
        help: 'Breeders over the make-up. The game\'s most adults per sex in a habitat always applies.',
        choices: [
            { id: 'default', label: 'Strict' },
            { id: 'soft', label: 'Soft', value: { structurePenalty: 0.3 } },
            { id: 'off', label: 'Ignore', value: { structurePenalty: 0 } },
        ],
    },
    {
        key: 'lineBonus', group: 'Groups', label: 'Mix of family lines',
        help: 'A small bonus per family line in a habitat (more choice of mates later).',
        choices: [
            { id: 'off', label: 'Off', value: { lineBonus: 0 } },
            { id: 'default', label: 'Small' },
            { id: 'mid', label: 'Medium', value: { lineBonus: 0.03 } },
            { id: 'high', label: 'Large', value: { lineBonus: 0.08 } },
        ],
    },
    {
        key: 'spareOut', group: 'Groups', label: 'Spare adults',
        help: 'Adults over the make-up that don\'t breed.',
        choices: [
            { id: 'default', label: 'To the trade centre' },
            { id: 'stay', label: 'Leave them', value: { spareOut: false } },
        ],
    },
    {
        key: 'defaultCapacity', group: 'Groups', label: 'Room when the game gives none',
        help: 'Adults per habitat when the game has no space figure for it.',
        choices: [
            { id: '4', label: '4', value: { defaultCapacity: 4 } },
            { id: '6', label: '6', value: { defaultCapacity: 6 } },
            { id: 'default', label: '8' },
            { id: '12', label: '12', value: { defaultCapacity: 12 } },
            { id: '16', label: '16', value: { defaultCapacity: 16 } },
            { id: '24', label: '24', value: { defaultCapacity: 24 } },
        ],
    },
    {
        key: 'search', group: 'Search', label: 'Classic search',
        help: 'How long the Classic optimiser looks for a better layout.',
        choices: [
            { id: 'quick', label: 'Quick', value: { maxEvaluations: 600000, timeBudgetMs: 1500 } },
            { id: 'default', label: 'Standard' },
            { id: 'long', label: 'Long', value: { maxEvaluations: 10000000, timeBudgetMs: 20000 } },
            { id: 'max', label: 'Very long', value: { maxEvaluations: 30000000, timeBudgetMs: 60000 } },
        ],
    },
    {
        key: 'exactLimit', group: 'Search', label: 'Try every layout up to',
        help: 'Below this many possible layouts the optimiser scores each one (the best plan there is).',
        choices: [
            { id: '5k', label: '5 000', value: { exactLimit: 5000 } },
            { id: 'default', label: '20 000' },
            { id: '100k', label: '100 000', value: { exactLimit: 100000 } },
            { id: '500k', label: '500 000', value: { exactLimit: 500000 } },
        ],
    },
].map(t => Object.freeze(Object.assign(t, { choices: Object.freeze(t.choices.map(c => Object.freeze(c))) }))));

const BY_KEY = new Map(PROGRAMME_TUNING.map(t => [t.key, t]));

// Only known keys with known choices, never 'default' (that is "left out").
export function normalizeTuning(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
        const t = BY_KEY.get(k);
        if (!t || v === 'default') continue;
        if (t.choices.some(c => c.id === v)) out[k] = v;
    }
    return out;
}

export function tuningChoice(tune, key) {
    const t = BY_KEY.get(key);
    const v = normalizeTuning(tune)[key];
    return t ? (t.choices.find(c => c.id === v) || t.choices.find(c => c.id === 'default')) : null;
}

// The programme options with the tuning on top (a new object). The slider's
// move cost stays unless "Cost of a move" / "Joining a settled group" is set.
export function applyTuning(options, tune) {
    const out = Object.assign({}, options);
    const t = normalizeTuning(tune);
    for (const [k, id] of Object.entries(t)) {
        const c = BY_KEY.get(k).choices.find(x => x.id === id);
        if (c && c.value) Object.assign(out, c.value);
    }
    return out;
}

// A short stable key ('' for the defaults): part of a plan's cache key.
export function tuningKey(tune) {
    const t = normalizeTuning(tune);
    return Object.keys(t).sort().map(k => `${k}=${t[k]}`).join(',');
}

export function tuningCount(tune) {
    return Object.keys(normalizeTuning(tune)).length;
}
