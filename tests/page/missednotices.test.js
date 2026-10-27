import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { clickText, nodesWithText, stopPageTimers } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();
after(stopPageTimers);

const { createMissedList, installMissedNotices, missed } = await import('/js/mods/pz2qol/missednotices.js');
const { installKinAlerts, kinToast } = await import('/js/mods/pz2qol/kinalerts.js');
globalThis.location.pathname = '/PZ2QoLHUD.html';
installKinAlerts();
installMissedNotices();

test('the missed list: newest first, a notice told again takes its old place, at most 30', () => {
    let t = 0;
    const list = createMissedList(() => ++t);
    list.add({ title: 'A' });
    list.add({ title: 'B' });
    list.add({ title: 'A', text: 'again' });
    assert.deepEqual(list.entries().map(x => `${x.title}${x.text ? '+' : ''}`), ['A+', 'B']);
    for (let i = 0; i < 40; i++) list.add({ title: `n${i}` });
    assert.equal(list.entries().length, 30);
    list.drop('n39');
    assert.equal(list.entries()[0].title, 'n38');
});

test("a missed notice's button does what the notice's did, and then it goes; one that stays open keeps it", () => {
    const list = createMissedList();
    let ran = 0;
    list.add({ title: 'Bring', actions: [] });
    list.run(list.entries()[0], { label: 'Bring from storage', run: () => ran++ });
    assert.equal(ran, 1);
    assert.deepEqual(list.entries(), []);
    list.add({ title: 'Open' });
    list.run(list.entries()[0], { label: 'Details', closes: false, run: () => ran++ });
    assert.equal(list.entries().length, 1);
});

test('a notice pushed off screen by newer ones waits among the missed, with its buttons; one closed by the player never does', () => {
    missed.clear();
    let brought = 0;
    kinToast({ severity: 'risk', level: 'action', title: 'Pushed out', text: 'x', actions: [{ label: 'Bring it', primary: true, run: () => brought++ }] });
    kinToast({ severity: 'risk', level: 'action', title: 'Closed', text: 'x', actions: [{ label: 'Locate it', run: () => {} }] });
    clickText('Locate it');
    for (const t of ['N1', 'N2', 'N3']) kinToast({ severity: 'future', level: 'action', title: t, text: 'x' });
    assert.deepEqual(missed.entries().map(x => x.title), ['Pushed out']);
    assert.deepEqual(missed.entries()[0].actions.map(a => a.label), ['Bring it'], 'its own button, not Dismiss');
    assert.ok(nodesWithText('Missed notices').length > 0, 'the corner list is there');
    missed.run(missed.entries()[0], missed.entries()[0].actions[0]);
    assert.equal(brought, 1);
    assert.deepEqual(missed.entries(), []);
});

test('a notice told again while it waits among the missed leaves the list: it is on screen once more', () => {
    missed.clear();
    missed.add({ title: 'Told twice' });
    kinToast({ severity: 'future', level: 'action', title: 'Told twice', text: 'x' });
    assert.ok(!missed.entries().some(x => x.title === 'Told twice'));
});
