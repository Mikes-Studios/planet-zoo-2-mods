import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['kinhooks.js'] });
const { createMarketCalves } = await import('/js/mods/pz2qol/marketcalves.js');

const MATE = { F: 'AAAAAAAAAAAA', I: 'AAAAAAAAAAAA', S: 'AAAAAAAAAAAA', L: 'AAAAAAAAAAAA' };
const LISTING_GENES = { F: 'AAAAAAaaaaaa', I: 'AAAAAAaaaaaa', S: 'AAAAAAaaaaaa', L: 'AAAAAAaaaaaa' };

function harness() {
    const asked = [];
    globalThis.engine = { trigger: (name, reqId, ids) => asked.push(ids.split(',')), on() {} };
    let time = 1000;
    const calves = createMarketCalves({ now: () => time });
    return { calves, asked, advance: ms => { time += ms; } };
}

// a Market row: its list key (what the game knows it by) and its place on the page
const zebra = (key, gender = 1, place = 0) => ({ id: place, key: String(key), name: `Z${key}`, gender, species: '[Animal_Zebra_Grevys]' });

// the rows on screen, asked for and answered by the game (genes by list key)
function answered(calves, rows, genes) {
    for (const r of rows) calves.calvesFor(r);
    calves.ask();
    calves.onAnswer('G1', JSON.stringify(genes));
}

test('a hand-over only counts for the species it was made for', () => {
    const { calves } = harness();
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 60 });
    answered(calves, [zebra(7)], { 7: LISTING_GENES });
    assert.notEqual(calves.calvesFor(zebra(7)), null);
    assert.equal(calves.calvesFor({ id: 0, key: '8', gender: 1, species: '[Animal_Okapi]' }), null, 'no calf score against another species\' mates');
});

test('a list of another species for a while ends the hand-over', () => {
    const { calves, advance } = harness();
    let changes = 0;
    calves.onMarketMatesChange(() => changes++);
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 60 });
    const okapis = [{ id: 1, species: '[Animal_Okapi]' }];
    calves.noteMarketRows(okapis);
    advance(500);
    calves.noteMarketRows(okapis);
    assert.equal(calves.floorFor(zebra(7)), 60, 'the last query\'s rows can linger a moment');
    advance(2000);
    calves.noteMarketRows(okapis);
    assert.equal(calves.floorFor(zebra(7)), null);
    assert.equal(changes, 2, 'listeners hear the hand-over and its end');
});

test('a listing Lua could not read, or left out of its answer, is asked again later', () => {
    const { calves, asked, advance } = harness();
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 60 });
    calves.calvesFor(zebra(7));
    calves.calvesFor(zebra(8));
    calves.ask();
    assert.deepEqual(asked, [['7', '8']]);
    calves.onAnswer('G1', JSON.stringify({ 7: false }));
    calves.calvesFor(zebra(7));
    calves.calvesFor(zebra(8));
    calves.ask();
    assert.equal(asked.length, 1, 'not asked again at once');
    advance(5000);
    calves.calvesFor(zebra(7));
    calves.calvesFor(zebra(8));
    calves.ask();
    assert.deepEqual(asked[1], ['7', '8']);
    calves.onAnswer('G2', JSON.stringify({ 7: LISTING_GENES, 8: LISTING_GENES }));
    assert.notEqual(calves.calvesFor(zebra(7)), null);
    assert.notEqual(calves.calvesFor(zebra(8)), null);
});

test('without a hand-over, a listing is judged against your breeders the park handed over', () => {
    const { calves } = harness();
    let changes = 0;
    calves.onMarketMatesChange(() => changes++);
    calves.onRelay('M1', JSON.stringify({ Zebra_Grevys: { f: { mates: [MATE], floor: 70 }, m: { mates: [], floor: 70 } } }));
    answered(calves, [zebra(7)], { 7: LISTING_GENES });
    assert.equal(changes, 1);
    assert.notEqual(calves.calvesFor(zebra(7)), null, 'a female listing against your males');
    assert.equal(calves.floorFor(zebra(7)), 70);
    assert.equal(calves.knowsMates(zebra(9, 0)), false, 'no females of yours: a male listing has nothing to be judged by');
    assert.equal(calves.calvesFor({ id: 0, key: '9', gender: 1, species: '[Animal_Okapi]' }), null);
    calves.onRelay('M2', JSON.stringify({ Zebra_Grevys: { f: { mates: [MATE], floor: 70 }, m: { mates: [], floor: 70 } } }));
    assert.equal(changes, 1, 'the same hand-over again changes nothing');
});

test("a notice's hand-over wins over the park's for its species and sex", () => {
    const { calves } = harness();
    calves.onRelay('M1', JSON.stringify({ Zebra_Grevys: { f: { mates: [MATE], floor: 70 } } }));
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 55 });
    assert.equal(calves.floorFor(zebra(7)), 55);
});

test('the game is asked by list key, and rows in the same place on two pages are two animals', () => {
    const { calves, asked } = harness();
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 0 });
    calves.calvesFor(zebra('animal_a', 1, 3));
    calves.calvesFor(zebra('animal_b', 1, 3));
    calves.ask();
    assert.deepEqual(asked.at(-1), ['animal_a', 'animal_b'], 'the game is asked by list key, never by the place on the page');
    const other = { F: 'aaaaaaaaaaaa', I: 'aaaaaaaaaaaa', S: 'aaaaaaaaaaaa', L: 'aaaaaaaaaaaa' };
    calves.onAnswer('G1', JSON.stringify({ animal_a: LISTING_GENES, animal_b: other }));
    assert.notEqual(calves.calvesFor(zebra('animal_a', 1, 3)), calves.calvesFor(zebra('animal_b', 1, 3)));
});

test("a male listing is scored by his average calves over your females, a female by her best male", () => {
    const { calves } = harness();
    const POOR = { F: 'AAAAAAAAAAAA', I: 'AAAAAAAAAAAA', S: 'aaaaaaaaaaaa', L: 'aaaaaaaaaaaa' };
    calves.onRelay('M1', JSON.stringify({ Zebra_Grevys: { m: { mates: [MATE, POOR], floor: 0 }, f: { mates: [MATE, POOR], floor: 0 } } }));
    const male = zebra('he', 0), female = zebra('she', 1);
    answered(calves, [male, female], { he: LISTING_GENES, she: LISTING_GENES });
    assert.ok(calves.calvesFor(male) < calves.bestCalvesFor(male), 'his score is the average, under his best');
    assert.equal(calves.calvesFor(female), calves.bestCalvesFor(female), 'hers is her best male');
});

test('an answer for a key another listing has moved to since is dropped and asked again, never given to it', () => {
    const { calves, asked } = harness();
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'f', mates: [MATE], floor: 0 });
    calves.calvesFor(zebra('animal_3'));
    calves.ask();
    const resorted = Object.assign(zebra('animal_3'), { name: 'Other' });
    calves.calvesFor(resorted);
    calves.onAnswer('G1', JSON.stringify({ animal_3: LISTING_GENES }));
    assert.equal(calves.calvesFor(resorted), null, 'the first listing genes are not given to the second');
    calves.ask();
    assert.deepEqual(asked.at(-1), ['animal_3'], 'the one there now is asked for');
});

test('the rows on screen fade by your standard where it applies, by the Dim below step elsewhere', () => {
    const { calves } = harness();
    calves.onRelay('M1', JSON.stringify({ Zebra_Grevys: { f: { mates: [MATE], floor: 73 }, m: { mates: [MATE], floor: 73 } } }));
    calves.noteMarketRows([zebra('a'), zebra('b', 0)]);
    assert.deepEqual(calves.shownFading(), { standard: 73, others: false }, 'a species you keep: no Dim below steps');
    calves.noteMarketRows([zebra('a'), { id: 1, key: 'o', name: 'Okapi', gender: 1, species: '[Animal_Okapi]' }]);
    assert.deepEqual(calves.shownFading(), { standard: 73, others: true }, 'a species you do not keep beside it: the steps for that one');
    calves.noteMarketRows([{ id: 1, key: 'o', name: 'Okapi', gender: 1, species: '[Animal_Okapi]' }]);
    assert.deepEqual(calves.shownFading(), { standard: null, others: true });
});

test('one of your animals on the Storage window gets the score the park worked out, matched by sex, name and genes', () => {
    const { calves } = harness();
    calves.onRelay('M1', JSON.stringify({ Zebra_Grevys: { m: { mates: [MATE], floor: 70 }, f: { mates: [MATE], floor: 70 }, unplaced: [{ x: 0, n: 'Spare', p: [83, 83, 92, 83], c: 79, b: 84 }] } }));
    const row = (name, size) => ({ id: 0, key: 'animal_0', gender: 0, name: `[STRING_LITERAL:Value=|${name}|]`, species: '[Animal_Zebra_Grevys]', genes: { fertility: 0.83, immunity: 0.83, size, longevity: 0.83 } });
    assert.deepEqual(calves.yoursCalvesFor(row('Spare', 0.92)), { score: 79, best: 84 });
    assert.equal(calves.yoursCalvesFor(row('Spare', 0.5)), null, 'a namesake with other genes is another animal');
    assert.equal(calves.yoursCalvesFor(row('Other', 0.92)), null);
});

test('a notice\'s strict hand-over hides the listings whose calves miss its floor, until the player asks to see them', () => {
    const { calves } = harness();
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'm', mates: [MATE], floor: 0 });
    const bull = zebra(7, 0);
    answered(calves, [bull], { 7: LISTING_GENES });
    const score = calves.calvesFor(bull);
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'm', mates: [MATE], floor: score + 1, strict: true });
    assert.equal(calves.strictWeak(bull), true, 'his calves miss the floor');
    assert.equal(calves.strictWeak(zebra(9, 0)), false, 'one whose genes are not in yet stays');
    assert.equal(calves.strictState().on, true);
    calves.setShowWeak(true);
    assert.equal(calves.strictState().showWeak, true);
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'm', mates: [MATE], floor: score, strict: true });
    assert.equal(calves.strictWeak(bull), false, 'calves at the floor meet it');
    assert.equal(calves.strictState().showWeak, false, 'a new hand-over hides again');
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'm', mates: [MATE], floor: score + 1 });
    assert.equal(calves.strictWeak(bull), false, 'without strict nothing is hidden, only faded');
    calves.setMarketMates({ species: 'Zebra_Grevys', sex: 'm', mates: [MATE], floor: null, strict: true });
    assert.equal(calves.strictState().on, false, 'no floor (fresh blood): the game filters only');
});
