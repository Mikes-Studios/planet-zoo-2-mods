import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { liveTimers, stopPageTimers, triggered } from './fakepage.js';
import { HIPPO, HIPPO_FACTS, Sex, TRADE, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

const { applyKinSnapshot } = await import('/js/mods/pz2qol/kin.js');
const { moveAnimal, moveOutcome, planBlockedReason, requestDestinations, runPlan } = await import('/js/mods/pz2qol/kinmoves.js');

after(stopPageTimers);

function loadPark(animals) {
    const habitats = [...new Set(animals.map(a => a.hab).filter(Boolean))].map(id => ({ id, name: id, kind: 'habitat' }));
    return applyKinSnapshot({ scope: 'park', animals, habitats, speciesFacts: {} });
}

function lastRequest(event) {
    const call = triggered.filter(c => c[0] === event).pop();
    return call ? call[1] : null;
}

test('a plan waits while a single move has no answer from the game yet', async () => {
    loadPark([animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2')]);
    const sent = moveAnimal('Mum', 'H2');
    assert.match(planBlockedReason(), /still waiting for the game's answer/);
    engine.emit('PZ2QoL_KinMoveResult', lastRequest('PZ2QoL_KinMove'), true, '');
    assert.equal((await sent).ok, true);
    assert.equal(planBlockedReason(), '');
});

// The game takes the move and the next scan shows the animal on its way.
function gameMoves(animals) {
    engine.answer('PZ2QoL_KinMove', (reqId, id) => {
        engine.emit('PZ2QoL_KinMoveResult', reqId, true, '');
        setTimeout(() => loadPark(animals.map(a => (a.id === id ? Object.assign({}, a, { moving: true }) : a))), 20);
    });
}

test('a move confirmed early asks for no more rescans', async () => {
    const animals = [animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2')];
    loadPark(animals);
    gameMoves(animals);
    const result = await runPlan([{ id: 'Mum', to: 'H2' }]);
    assert.equal(result.ok, true);
    const rescanDelays = [1500, 4000, 8000];
    assert.deepEqual(liveTimers().filter(ms => rescanDelays.includes(ms)), []);
});

test('each move of a run has its own outcome, by animal, not by a name that starts the same', async () => {
    const animals = [animal('Anna', Sex.Female, 'H1'), animal('Ann', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2')];
    loadPark(animals);
    gameMoves(animals);
    const result = await runPlan([{ id: 'Anna', to: 'H2' }, { id: 'Ann', to: 'H2' }], {
        beforeEach: async m => (m.id === 'Anna' ? 'the game stayed busy' : ''),
    });
    const model = loadPark(animals.map(a => (a.id === 'Ann' ? Object.assign({}, a, { moving: true }) : a)));
    assert.deepEqual(moveOutcome(result, model, 'Anna', 'H2'), { landed: false, asked: false, why: 'the game stayed busy' });
    assert.deepEqual(moveOutcome(result, model, 'Ann', 'H2'), { landed: true, asked: true, why: '' });
});

test('a move whose check before it fails is skipped, not sent', async () => {
    const animals = [animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2')];
    loadPark(animals);
    gameMoves(animals);
    const from = triggered.length;
    const result = await runPlan([{ id: 'Mum', to: 'H2' }], {
        beforeEach: async () => {
            throw new Error('gate broke');
        },
    });
    assert.deepEqual(triggered.slice(from).filter(call => call[0] === 'PZ2QoL_KinMove'), []);
    assert.equal(result.log[0].status, 'held');
});

test('a sick animal sent on to a quarantine on its way to the trade centre has landed', async () => {
    const animals = [animal('Sick', Sex.Female, 'H1')];
    loadPark(animals);
    engine.answer('PZ2QoL_KinMove', reqId => {
        engine.emit('PZ2QoL_KinMoveResult', reqId, true, 'quarantine');
        setTimeout(() => loadPark([Object.assign({}, animals[0], { hab: '', lt: 'quarantine' })]), 20);
    });
    const result = await runPlan([{ id: 'Sick', to: TRADE }]);
    const outcome = moveOutcome(result, loadPark([Object.assign({}, animals[0], { hab: '', lt: 'quarantine' })]), 'Sick', TRADE);
    assert.equal(outcome.landed, true);
    assert.equal(result.log[0].status, 'quarantine');
});

// The game refuses the moves of the animals in `refused`; it takes the rest
// and the next scan shows each taken one on its way.
function gameRefuses(animals, refused) {
    const onTheirWay = new Set();
    engine.answer('PZ2QoL_KinMove', (reqId, id) => {
        if (refused.includes(id)) return engine.emit('PZ2QoL_KinMoveResult', reqId, false, 'The game refused it.');
        engine.emit('PZ2QoL_KinMoveResult', reqId, true, '');
        onTheirWay.add(id);
        setTimeout(() => loadHippos(animals.map(a => (onTheirWay.has(a.id) ? Object.assign({}, a, { moving: true }) : a))), 20);
    });
}

function loadHippos(animals) {
    const habitats = [...new Set(animals.map(a => a.hab).filter(Boolean))].map(id => ({ id, name: id, kind: 'habitat' }));
    return applyKinSnapshot({ scope: 'park', animals, habitats, speciesFacts: { [HIPPO]: HIPPO_FACTS } });
}

function movesSent(from) {
    return triggered.slice(from).filter(call => call[0] === 'PZ2QoL_KinMove').map(call => call[2]);
}

test('a run whose move to part a sister from her habitat is refused holds her brother back', async () => {
    const animals = [
        animal('Sis', Sex.Female, 'A', { par: ['Mum', 'Dad'] }), animal('Bro', Sex.Male, 'C', { par: ['Mum', 'Dad'] }),
        animal('Fx', Sex.Female, 'A'), animal('Mx', Sex.Male, 'B'),
    ];
    loadHippos(animals);
    gameRefuses(animals, ['Sis']);
    const from = triggered.length;
    const result = await runPlan([{ id: 'Sis', to: TRADE }, { id: 'Bro', to: 'A' }, { id: 'Mx', to: 'C' }]);
    assert.deepEqual(movesSent(from), ['Sis', 'Mx']);
    assert.equal(result.log.find(row => row.id === 'Bro').status, 'held');
});

test('a brother already on his way counts where he is going when a later move is checked', async () => {
    const animals = [
        animal('Sis', Sex.Female, 'A', { par: ['Mum', 'Dad'] }), animal('Bro', Sex.Male, 'C', { par: ['Mum', 'Dad'] }),
        animal('Fx', Sex.Female, 'A'), animal('Mx', Sex.Male, 'B'),
    ];
    loadHippos(animals);
    gameRefuses(animals, ['Mx']);
    const from = triggered.length;
    const result = await runPlan([{ id: 'Bro', to: 'B' }, { id: 'Mx', to: 'C' }, { id: 'Sis', to: 'B' }]);
    assert.deepEqual(movesSent(from), ['Bro', 'Mx']);
    assert.equal(result.log.find(row => row.id === 'Sis').status, 'held');
});

test('a habitat built after the destinations were asked is asked about, not taken as unsuitable', async () => {
    let asks = 0;
    engine.answer('PZ2QoL_KinDestinations', reqId => {
        asks++;
        const habs = [...new Set(park.map(a => a.hab))];
        engine.emit('PZ2QoL_KinDestinationsResult', reqId, JSON.stringify({ bySpecies: { [HIPPO]: Object.fromEntries(habs.map(h => [h, { ok: true }])) }, habitats: habs.map(id => ({ id, name: id })) }));
    });
    let park = [animal('Hana', Sex.Female, 'D1'), animal('Hiro', Sex.Male, 'D1')];
    loadPark(park);
    await requestDestinations(['Hana']);
    await requestDestinations(['Hana']);
    assert.equal(asks, 1, 'cached while the zoo has the same habitats');
    // a new habitat, and Hiro moved into it
    park = [park[0], Object.assign({}, park[1], { hab: 'D2' })];
    loadPark(park);
    const d = await requestDestinations(['Hana']);
    assert.equal(asks, 2);
    assert.equal(d.bySpecies[HIPPO].D2.ok, true);
});
