import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { nodesWithText, sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark, sentSince } from './autopark.js';
import { HIPPO, Sex, animal, juvenile } from './zoo.js';
import { loadPages } from './pageloader.js';
import { NAME_GROUPS } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinnamelist.js';
import { chosenGroups, dealName, listFor, nameKey, namesOf, pickName, shuffled } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinnamescore.js';

const ALL = NAME_GROUPS.map(g => g.key);
const FEMALE_NAMES = namesOf('f', ALL);
const MALE_NAMES = namesOf('m', ALL);

loadPages();
after(stopPageTimers);

test('the name lists hold plain ASCII names, none twice across both', () => {
    const all = FEMALE_NAMES.concat(MALE_NAMES);
    const keys = all.map(nameKey);
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
    assert.deepEqual(all.filter(n => !/^[A-Za-z][A-Za-z .'-]{0,23}$/.test(n)), []);
    assert.ok(FEMALE_NAMES.length >= 200 && MALE_NAMES.length >= 200);
});

test('a name no animal has, in list order, then from the start again', () => {
    const names = ['Ada', 'Bo', 'Cy'];
    assert.deepEqual(pickName(names, 0, new Set(['ada'])), { name: 'Bo', next: 2, wrapped: false });
    assert.deepEqual(pickName(names, 2, new Set(['cy'])), { name: 'Ada', next: 1, wrapped: true });
    assert.equal(pickName(names, 1, new Set(['ada', 'bo', 'cy'])), null, 'every name in use: the game keeps its own');
    assert.equal(listFor(Sex.Female, {}), 'f');
    assert.equal(listFor(Sex.Unisex, { f: { n: 3 }, m: { n: 1 } }), 'm');
});

test('the groups ticked in settings decide the names; none ticked, no renaming', () => {
    assert.deepEqual(chosenGroups({}), ALL, 'every group by default');
    assert.deepEqual(chosenGroups({ namesToday: false, namesClassic: false }), ['history', 'authors']);
    const authors = NAME_GROUPS.find(g => g.key === 'authors');
    assert.deepEqual(namesOf('m', ['authors']), authors.male);
    assert.ok(namesOf('m', ['authors']).includes('J. R. R. Tolkien'));
    assert.ok(!namesOf('m', ['history']).includes('J. R. R. Tolkien'), 'an author is in the authors group only');
    assert.deepEqual(namesOf('f', []), []);
});

test('names come in random order, every name once before any comes round again', () => {
    const names = Array.from({ length: 20 }, (_, i) => `N${i}`);
    let seed = 1;
    const newSeed = () => seed++;
    let deck = null;
    const dealt = [];
    for (let k = 0; k < 60; k++) {
        const pick = dealName(names, deck, new Set(), newSeed);
        dealt.push(pick.name);
        deck = pick.deck;
    }
    for (const round of [dealt.slice(0, 20), dealt.slice(20, 40), dealt.slice(40, 60)]) {
        assert.deepEqual(round.slice().sort(), names.slice().sort(), 'a round deals every name once');
    }
    assert.notDeepEqual(dealt.slice(0, 20), names, 'not in list order');
    assert.notDeepEqual(dealt.slice(0, 20), dealt.slice(20, 40), 'each round shuffled afresh');
    assert.deepEqual(shuffled(names, 5), shuffled(names, 5), 'a deck keeps its order across loads');
});

test('a name an animal has is skipped and its turn does not hold up the round', () => {
    const names = ['A', 'B', 'C', 'D'];
    const order = shuffled(names, 9);
    const taken = new Set([nameKey(order[1])]);
    const first = dealName(names, { at: 0, seed: 9, n: 0 }, taken, () => 10);
    const second = dealName(names, first.deck, taken, () => 10);
    assert.deepEqual([first.name, second.name], [order[0], order[2]]);
    assert.equal(dealName(names, { at: 0, seed: 1 }, new Set(names.map(nameKey)), () => 2), null, 'every name in use: the game keeps its own');
    assert.equal(dealName(names, 3, new Set(), () => 4).deck.n, 1, 'a deck saved by the earlier version starts a round');
});

test('a calf born after the zoo loads gets a famous name; the animals there before keep theirs', async () => {
    const { loadPark } = await autoPark();
    // the Kin setting Change juvenile names automatically (off unless the player turns it on)
    (await import('/js/mods/pz2qol/kin.js')).setKinSettings({ uniqueNames: true });
    const names = await import('/js/mods/pz2qol/kinnames.js');
    names.installKinNames();
    await sleep(200);
    const herd = [animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'), juvenile('Older', Sex.Male, 'H1', { age: 0.1 })];
    loadPark(herd);
    const from = triggered.length;
    loadPark(herd.concat([juvenile('Rano', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 0.02 })]));
    const sent = sentSince(from, 'PZ2QoL_KinRename');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1], 'Rano');
    assert.ok(FEMALE_NAMES.includes(sent[0][2]), 'a name from the list');
    loadPark(herd.concat([juvenile('Rano', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 0.02 })]));
    assert.equal(sentSince(from, 'PZ2QoL_KinRename').length, 1, 'each calf once');
    // a calf born in Animal Storage, brought to the park at age 0: its parents live there, not here
    loadPark(herd.concat([juvenile('Rano', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 0.02 }), juvenile('Nissa', Sex.Female, 'H1', { par: ['Away1', 'Away2'], age: 0 })]));
    assert.equal(sentSince(from, 'PZ2QoL_KinRename').length, 1, 'a calf from storage keeps its name');
});

test('young animals of a park species the mod moves get one notice per species; no notice for a species with no animal in this park', async () => {
    const { storedAgeEntries } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js');
    const young = await import('/js/mods/pz2qol/kinstoredhome.js');
    const { installKinAlerts } = await import('/js/mods/pz2qol/kinalerts.js');
    const { installStoredAges } = await import('/js/mods/pz2qol/storedages.js');
    const { speciesName } = await import('/js/mods/pz2qol/speciesnames.js');
    const auto = await import('/js/mods/pz2qol/kinauto.js');
    installKinAlerts();
    installStoredAges();
    young.installStoredHome();
    const { loadPark } = await autoPark();
    loadPark([animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1')]);
    const calf = (name, species) => ({ species: `[Animal_${species}]`, gender: Sex.Female, name, age: 0, maturity: 0, genes: { fertility: 50, immunity: 67, size: 50, longevity: 50 } });
    const entries = storedAgeEntries([calf('Themba', HIPPO), calf('Gyasi', HIPPO), calf('Marco', 'Toucan_Toco')]);
    const hippoTitle = `${speciesName(HIPPO)}: 2 young in Animal Storage`;
    const toucanTitle = `${speciesName('Toucan_Toco')}: Marco is young in Animal Storage`;
    auto.setSpeciesAuto(HIPPO, { on: true });
    auto.setSpeciesAuto('Toucan_Toco', { on: true });
    engine.emit('PZ2QoL_StoredAgesResult', 'G1', JSON.stringify(entries));
    engine.emit('PZ2QoL_StoredAgesResult', 'G2', JSON.stringify(entries));
    assert.equal(nodesWithText(hippoTitle).length, 1, 'one notice for both hippos, once');
    assert.equal(nodesWithText(toucanTitle).length, 0, 'none for a species with no animal in this park');
});

test('animals too old to trade in storage get their own notice to bring them out and live out their lives', async () => {
    const { storedAgeEntries } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js');
    const { speciesName } = await import('/js/mods/pz2qol/speciesnames.js');
    const adult = (name, age) => ({ species: `[Animal_${HIPPO}]`, gender: Sex.Female, name, age, maturity: 2, genes: { fertility: 50, immunity: 67, size: 50, longevity: 50 } });
    // hippos turn elderly at 40: within three years the server refuses every trade
    const entries = storedAgeEntries([adult('Grandma', 38), adult('Prime', 20)]);
    assert.deepEqual(entries.map(e => !!e.o), [true, false]);
    engine.emit('PZ2QoL_StoredAgesResult', 'G3', JSON.stringify(entries));
    assert.equal(nodesWithText(`${speciesName(HIPPO)}: Grandma is too old to trade in Animal Storage`).length, 1);
});
