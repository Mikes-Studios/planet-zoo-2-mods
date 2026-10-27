import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['game.js'] });
const handlers = {};
globalThis.engine = { on: (event, fn) => { handlers[event] = fn; }, trigger: () => {} };
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const listerlua = await import('/js/mods/pz2qol/listerlua.js');

const verdict = { trade: false, quickTrade: true, quickRelease: true, rehome: null, src: 'page', v: 2 };
const stateOf = (run, verdicts) => JSON.stringify({ run, req: 'Lpg1_1', phase: 'running', mode: 'check', index: 1, step: 'select',
    results: verdicts.map((v, i) => ({ guid: String(100 + i), status: v ? 'checked' : 'working', verdict: v })) });

test('a verdict the engine sent once stays with its animal in the run\'s later states', () => {
    listerlua.engineCaps();
    handlers.PZ2QoL_ListerState(stateOf(4, [verdict, null]));
    handlers.PZ2QoL_ListerState(stateOf(4, [null, verdict]));
    assert.deepEqual(listerlua.getEngineState().results.map(r => r.verdict), [verdict, verdict]);
    handlers.PZ2QoL_ListerState(stateOf(5, [null, null]));
    assert.deepEqual(listerlua.getEngineState().results.map(r => r.verdict), [null, null], 'another run starts empty');
});
