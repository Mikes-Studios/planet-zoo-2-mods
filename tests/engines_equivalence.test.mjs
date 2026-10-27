// node --test tests/engines_equivalence.test.mjs
// Design section 0a: with no Autopilot option set, Suggest fixes, the
// Breeding programme and Thin out answer exactly what the golden file
// records (re-recorded only for a deliberate change to an engine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEEDS, digestZoo } from './helpers/enginedigest.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/engines_golden.json', import.meta.url), 'utf8'));

test('the board engines answer as before Autopilot (40 seeded zoos)', () => {
    let species = 0;
    for (const seed of SEEDS) {
        const now = JSON.parse(JSON.stringify(digestZoo(seed)));
        assert.deepEqual(now, golden[seed], `seed ${seed}`);
        species += Object.keys(now).length;
    }
    assert.ok(species >= 60, `only ${species} species checked`);
});
