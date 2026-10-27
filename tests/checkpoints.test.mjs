// node --test tests/checkpoints.test.mjs
// A debug build logs a breadcrumb only when tools/trace/checkpoints.txt
// lists its name: the page's breadcrumbs reach Lua as js_<name> (Core:Mark),
// main.js's install steps as js_step_<letters of the step's name>, and the
// Lua side's own marks by their name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'mods', 'PZ2QoL', 'UI', 'UIGameface', 'js', 'mods', 'pz2qol');
const listed = new Set(fs.readFileSync(path.join(ROOT, 'tools', 'trace', 'checkpoints.txt'), 'utf8').split(/\r?\n/).map(n => n.trim()).filter(Boolean));
const missing = names => [...new Set(names)].filter(n => !listed.has(n));

test("every main.js install step's breadcrumb is listed", () => {
    const main = fs.readFileSync(path.join(JS, 'main.js'), 'utf8');
    const steps = [...main.matchAll(/^step\('([^']+)'/gm)].map(m => `js_step_${m[1].replace(/[^A-Za-z]/g, '')}`);
    assert.ok(steps.length > 20, 'the steps were found');
    assert.deepEqual(missing(steps), []);
});

test('every literal page breadcrumb is listed', () => {
    const names = [];
    for (const file of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
        const text = fs.readFileSync(path.join(JS, file), 'utf8');
        for (const m of text.matchAll(/\b(?:breadcrumb|trace)\('([A-Za-z0-9_]+)'\)/g)) names.push(`js_${m[1]}`);
    }
    assert.ok(names.length > 100, 'the breadcrumbs were found');
    assert.deepEqual(missing(names), []);
});

test('every literal Lua mark is listed', () => {
    const main = path.join(ROOT, 'mods', 'PZ2QoL', 'Main');
    const names = [];
    for (const file of fs.readdirSync(main).filter(f => f.endsWith('.lua'))) {
        const text = fs.readFileSync(path.join(main, file), 'utf8');
        for (const m of text.matchAll(/(?:\b(?:mark|mk|cp)|:(?:Mark|Checkpoint|_Mark))\("([a-z0-9_]+)"\)/g)) names.push(m[1]);
    }
    assert.ok(names.length > 100, 'the marks were found');
    assert.deepEqual(missing(names), []);
});
