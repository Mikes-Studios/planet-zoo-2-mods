import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { clickText, nodesWithText, sleep, stopPageTimers } from './fakepage.js';
import { Sex, TRADE, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

const { applyKinSnapshot } = await import('/js/mods/pz2qol/kin.js');
const { moveAnimal } = await import('/js/mods/pz2qol/kinmoves.js');
const { installQuarantineAlerts } = await import('/js/mods/pz2qol/kinquarantine.js');

after(stopPageTimers);
installQuarantineAlerts();

function loadPark(animals) {
    return applyKinSnapshot({ scope: 'park', animals, habitats: [{ id: 'H1', name: 'H1', kind: 'habitat' }], speciesFacts: {} });
}

function gameAnswersMoves(ok, detail) {
    engine.answer('PZ2QoL_KinMove', reqId => engine.emit('PZ2QoL_KinMoveResult', reqId, ok, detail));
}

test('a send on from quarantine that the game refuses can be tried again, and is offered again', async () => {
    const sick = animal('Sick', Sex.Female, 'H1');
    loadPark([sick]);
    gameAnswersMoves(true, 'quarantine');
    await moveAnimal('Sick', TRADE);
    const treated = [Object.assign({}, sick, { hab: '', lt: 'quarantine', qReady: true })];
    loadPark(treated);
    assert.equal(nodesWithText('Passed quarantine').length, 1);
    gameAnswersMoves(false, 'The trade centre is full.');
    clickText('Send to trade centre');
    await sleep(300);
    assert.equal(nodesWithText('Try again').length, 1);
    clickText('Dismiss');
    await sleep(300);
    loadPark(treated);
    assert.equal(nodesWithText('Passed quarantine').length, 1, 'told again once the failure notice is gone');
});
