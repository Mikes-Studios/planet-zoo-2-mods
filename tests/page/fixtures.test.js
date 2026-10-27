import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fixtureWorld } from './sim/gen.js';
import { autoPass } from './sim/world.js';
import { RULES } from './sim/rules.js';

// the owner's zoos from the debug trace (tools/trace-to-zoo.mjs)
const dir = new URL('./sim/fixtures/', import.meta.url);
for (const name of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    test(`rules: the owner's zoo ${name}`, () => {
        const world = fixtureWorld(JSON.parse(readFileSync(new URL(name, dir), 'utf8')));
        const broken = autoPass(world, { only: RULES });
        if (broken.length) throw new Error(broken.map(v => `${v.species} ${v.rule}: ${v.text}`).join('\n'));
    });
}
