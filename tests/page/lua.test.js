import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// each tests/page/*.lua loads Main/ files by relative path, so it runs from
// the pack folder; PZ2_LUA names a Lua 5.3 (cobra-tools' luadec lua.exe)
const PACK_DIR = fileURLToPath(new URL('../../mods/PZ2QoL/', import.meta.url));
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const LUA = process.env.PZ2_LUA || '';
const LUA_TESTS = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.lua'));

for (const name of LUA_TESTS) {
    test(`Lua test ${name} passes in Lua 5.3`, t => {
        if (!LUA || !existsSync(LUA)) {
            t.skip('set PZ2_LUA to a Lua 5.3 (cobra-tools/modules/formats/utils/luadec/lua.exe) to run the Lua tests');
            return;
        }
        const run = spawnSync(LUA, [TESTS_DIR + name], { cwd: PACK_DIR, encoding: 'utf8' });
        assert.equal(run.status, 0, `${name} failed:\n${run.stdout}${run.stderr}`);
    });
}
