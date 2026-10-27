import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictOffspring } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';

// The game's Compare Mates ranges (helpers.comparematesuiutils.lua, GetMinMaxGeneGrades,
// game 1.0.5): fertility and immunity count differing alleles between one strand of each
// parent; size and longevity add up the good alleles (A or B) of one strand of each.
function gameRange(father, mother, hetero) {
    const fa = father.slice(0, 6), fb = father.slice(6, 12), ma = mother.slice(0, 6), mb = mother.slice(6, 12);
    if (hetero) {
        const diff = (x, y) => [...x].filter((c, i) => c !== y[i]).length;
        const grades = [diff(ma, fa), diff(mb, fb), diff(ma, fb), diff(mb, fa)];
        return { min: Math.min(...grades) / 6, max: Math.max(...grades) / 6 };
    }
    const good = s => [...s].filter(c => c === 'A' || c === 'B').length;
    return {
        min: (Math.min(good(ma), good(mb)) + Math.min(good(fa), good(fb))) / 12,
        max: (Math.max(good(ma), good(mb)) + Math.max(good(fa), good(fb))) / 12,
    };
}

test('offspring gene ranges match the game\'s Compare Mates formula', () => {
    let x = 12345;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const strand = () => Array.from({ length: 12 }, () => 'ABab'[Math.floor(rnd() * 4)]).join('');
    const stats = [['fertility', 'F', true], ['immunity', 'I', true], ['size', 'S', false], ['longevity', 'L', false]];
    for (let n = 0; n < 500; n++) {
        const father = { F: strand(), I: strand(), S: strand(), L: strand() };
        const mother = { F: strand(), I: strand(), S: strand(), L: strand() };
        const mod = predictOffspring(father, mother);
        for (const [id, key, hetero] of stats) {
            const game = gameRange(father[key], mother[key], hetero);
            assert.ok(Math.abs(mod[id].min - game.min) < 1e-9 && Math.abs(mod[id].max - game.max) < 1e-9,
                `${id}: mod ${mod[id].min}-${mod[id].max}, game ${game.min}-${game.max}`);
        }
    }
});
