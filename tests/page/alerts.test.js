import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { clickText, nodesWithText, sleep, stopPageTimers } from './fakepage.js';
import { Sex, TRADE, animal, juvenile } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

const { applyKinSnapshot, setKinAlertFilter, setKinSettings } = await import('/js/mods/pz2qol/kin.js');
const { getLifeLog, hideUnderGamePopups, installKinAlerts, kinAlertCount, kinToast } = await import('/js/mods/pz2qol/kinalerts.js');
const { isGamePopupOpen } = await import('/js/mods/pz2qol/ui.js');

after(stopPageTimers);
installKinAlerts();

function loadPark(animals) {
    const habitats = [...new Set(animals.map(a => a.hab).filter(Boolean))].map(id => ({ id, name: id, kind: 'habitat' }));
    return applyKinSnapshot({ scope: 'park', animals, habitats, speciesFacts: {} });
}

const parents = () => [animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H2')];

test('a risk that turns up during Auto mode\'s quiet window is told once the window ends', () => {
    loadPark(parents().concat([juvenile('Son', Sex.Male, 'H1', { par: ['Mum', 'Dad'] })]));
    setKinAlertFilter(() => true);
    const grown = parents().concat([animal('Son', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 })]);
    loadPark(grown);
    assert.equal(kinAlertCount(), 0, 'quiet while the run is in flight');
    setKinAlertFilter(null);
    loadPark(grown);
    assert.equal(kinAlertCount(), 1);
});

test('a risk the run itself clears during its quiet window is never told', () => {
    const before = kinAlertCount();
    const family = (sonHab, juv) => [animal('Ma', Sex.Female, 'H3'), animal('Pa', Sex.Male, 'H4'),
        juv ? juvenile('Boy', Sex.Male, 'H3', { par: ['Ma', 'Pa'] }) : animal('Boy', Sex.Male, sonHab, { par: ['Ma', 'Pa'], age: 8 })];
    loadPark(family('H3', true));
    setKinAlertFilter(() => true);
    loadPark(family('H3', false));
    loadPark(family('H4', false));
    setKinAlertFilter(null);
    loadPark(family('H4', false));
    assert.equal(kinAlertCount(), before);
});

test('a heads-up from another module goes to the log only for a "Needs you only" player', () => {
    const before = kinAlertCount();
    assert.equal(kinToast({ severity: 'future', level: 'heads', kind: 'elderly', title: 'Elderly in the way', text: 'x' }), null);
    assert.equal(kinAlertCount(), before);
    assert.equal(getLifeLog()[0].title, 'Elderly in the way');
    kinToast({ severity: 'risk', level: 'action', kind: 'need', title: 'Needs a male', text: 'x' });
    assert.equal(kinAlertCount(), before + 1);
});

test('the answer to a click of the player pops up for a "Needs you only" player too', () => {
    const before = kinAlertCount();
    assert.notEqual(kinToast({ severity: 'covered', level: 'heads', kind: 'boxed', answer: true, title: 'Nala is on its way', text: 'To H2.' }), null);
    assert.equal(kinAlertCount(), before + 1);
    assert.equal(getLifeLog()[0].title, 'Nala is on its way');
});

test('a nearly elderly animal at the trade centre gets no Send button, and a late Send says why nothing moved', () => {
    setKinSettings({ elderlyAlert: true });
    loadPark([animal('Gugu', Sex.Male, TRADE, { age: 39.4 }), animal('Rafa', Sex.Male, 'H5', { age: 39.4 })]);
    assert.equal(nodesWithText('Send to the trade centre').length, 1, 'only the habitat animal has a Send button');
    loadPark([animal('Gugu', Sex.Male, TRADE, { age: 39.4 }), animal('Rafa', Sex.Male, TRADE, { age: 39.4 })]);
    clickText('Send to the trade centre');
    assert.equal(nodesWithText('Rafa was not sent to the trade centre').length, 1);
});

test('another module\'s toast column hides while a game popup is open', async () => {
    const column = document.createElement('div');
    document.body.appendChild(column);
    hideUnderGamePopups(column);
    const pageQuery = document.querySelector;
    document.querySelector = selector => (selector === '.PopupActionsModule_root.show' ? {} : null);
    try {
        assert.equal(isGamePopupOpen(), true);
        await sleep(600);
        assert.equal(column.classList.contains('underPopup'), true);
    }
    finally {
        document.querySelector = pageQuery;
    }
});
