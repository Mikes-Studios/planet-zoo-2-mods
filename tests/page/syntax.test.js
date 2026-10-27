import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOD_UI = fileURLToPath(new URL('../../mods/PZ2QoL/UI/UIGameface/', import.meta.url));
const MOD_SCRIPTS = join(MOD_UI, 'js', 'mods', 'pz2qol');
const MODULE_GRAPH = fileURLToPath(new URL('./modulegraph.mjs', import.meta.url));

function modScripts() {
    const names = readdirSync(MOD_SCRIPTS).filter(name => name.endsWith('.js'));
    return names.map(name => join(MOD_SCRIPTS, name));
}

// the unpacked game UI, as the browser harness takes it (PZ2H_GAME)
function gameUiRoot() {
    return process.env.PZ2H_GAME || '';
}

// most modules read game globals as they load, so they are parsed and linked, never run
test('every mod script parses', () => {
    const unparsed = [];
    for (const path of modScripts()) {
        const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
        if (check.status !== 0) unparsed.push(`${path}: ${(check.stderr || '').split('\n').find(line => /Error/.test(line)) || 'does not parse'}`);
    }
    assert.deepEqual(unparsed, []);
});

test("every mod script's imports resolve to exports of the mod or the game", t => {
    const gameUi = gameUiRoot();
    if (!gameUi || !existsSync(join(gameUi, 'js'))) {
        t.skip('set PZ2H_GAME to the unpacked game UI (UIGameface, as for tests/uiharness/run.mjs) to check the imports against the game');
        return;
    }
    const link = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', MODULE_GRAPH, MOD_UI, gameUi, ...modScripts()], { encoding: 'utf8' });
    assert.equal(link.status, 0, link.stderr);
    assert.deepEqual(JSON.parse(link.stdout), []);
});
