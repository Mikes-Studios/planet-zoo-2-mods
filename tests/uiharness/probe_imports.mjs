// Diagnostic: import each mod module in the browser and report link errors.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
// the same folders and options as run.mjs
const WORK = path.resolve(opt('--work', process.env.PZ2H_WORK || "C:/Users/'admin'/AppData/Local/Temp/claude/C--Github-Planet-Zoo-2-Mods/a5756abe-49da-4666-a235-008cb1e4b99f/scratchpad/harness"));
const GAME = path.resolve(opt('--game', process.env.PZ2H_GAME || path.join(WORK, '..', 'ui', 'UIGameface')));
const EDGE = opt('--edge', process.env.PZ2H_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const require = createRequire(path.join(WORK, 'package.json'));
const { chromium } = require('playwright-core');
const srv = await startServer({ roots: [path.resolve(HERE, '..', '..', 'mods', 'PZ2QoL', 'UI', 'UIGameface'), GAME] });
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.goto(srv.url + '/PZ2QoL/probe.html');
const MODS = fs.readdirSync(path.resolve(HERE, '..', '..', 'mods', 'PZ2QoL', 'UI', 'UIGameface', 'js', 'mods', 'pz2qol'))
    .filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
let failed = 0;
for (const m of MODS) {
    const r = await page.evaluate(async m => {
        try { await import(`/js/mods/pz2qol/${m}.js`); return 'ok'; } catch (e) { return String(e && e.message || e); }
    }, m);
    console.log(m, r);
    if (r !== 'ok') failed++;
}
await browser.close(); srv.server.close();
if (failed) { console.log(`FAIL: ${failed} module(s) did not import`); process.exit(1); }
