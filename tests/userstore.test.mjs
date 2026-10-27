// node --test tests/userstore.test.mjs
// Habitat assignments survive closing the board and restarting the game:
// they live in the game's player save on this device, one entry per zoo,
// Franchise included (through the Lua side), not only in Gameface's
// localStorage (which the game does not keep). The fake below stands for
// the Lua store of the current zoo; 'file' is the status name for "kept".
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./gameface-loader.mjs', import.meta.url);

// --- a fake game: engine events, localStorage and the Lua file store
const fake = { file: null, available: true, answer: true, saves: 0, handlers: new Map() };

function freshStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

globalThis.window = { localStorage: freshStorage() };
globalThis.engine = {
    on(name, fn) {
        if (!fake.handlers.has(name)) fake.handlers.set(name, []);
        fake.handlers.get(name).push(fn);
    },
    trigger(name, ...args) {
        const fire = (ev, ...a) => setTimeout(() => (fake.handlers.get(ev) || []).forEach(fn => fn(...a)), 5);
        if (name === 'PZ2QoL_StoreLoad' && fake.answer) {
            if (!fake.available) return fire('PZ2QoL_StoreData', args[0], false, 1, 1, fake.reason || 'nopark');
            const text = fake.file == null ? '{}' : fake.file;
            // in two chunks, like a large file
            const half = Math.ceil(text.length / 2);
            fire('PZ2QoL_StoreData', args[0], true, 1, 2, text.slice(0, half));
            fire('PZ2QoL_StoreData', args[0], true, 2, 2, text.slice(half));
        }
        if (name === 'PZ2QoL_StoreSave') {
            assert.ok(/^[\x20-\x7e]*$/.test(args[1]), 'the file text is ASCII');
            if (fake.available) {
                fake.file = args[1];
                fake.saves++;
            }
            fire('PZ2QoL_StoreSaved', args[0], fake.available);
        }
    },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let boot = 0;
// a game start: fresh modules, fresh UI storage, no event listeners
async function start() {
    await sleep(450); // the previous game's last save lands first
    boot++;
    fake.handlers = new Map();
    window.localStorage = freshStorage();
    const assign = await import(`../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinassign.js?boot=${boot}`);
    return assign;
}

// habitats: [id, name, residents' GUIDs, the game's habitat id]
const LEMURS = [['101', 'Lemur Woods', ['g1', 'g2'], 'h1'], ['102', 'Lemur Island', ['g3'], 'h2']];
const model = (park, habitats = LEMURS) => ({
    park,
    habitats: new Map(habitats.map(([id, name]) => [id, { id, name, kind: 'habitat' }])),
    animals: new Map(habitats.flatMap(([id, , guids = []]) => guids.map(g => ['a' + g, { id: 'a' + g, guid: g, hab: id }]))),
    snapshot: { habs: habitats.map(([id, name, , hid]) => ({ id, name, hid: hid || null })) },
});

test('an assignment is written to the data file and back after a restart', async () => {
    fake.file = null;
    let a = await start();
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'file');
    a.toggleAssignment(model('Lemur Valley'), '101', 'RingTailedLemur', 'Lemur Woods');
    await sleep(600);
    assert.ok(fake.file && fake.file.includes('RingTailedLemur'), 'saved to the file');

    a = await start(); // the game restarted: localStorage is empty
    assert.equal(a.getAssignments(model('Lemur Valley')).size, 0, 'nothing before the file is read');
    await sleep(50);
    const got = a.getAssignments(model('Lemur Valley'));
    assert.deepEqual(Array.from(got.get('101') || []), ['RingTailedLemur']);
    assert.equal(a.getAssignments(model('Other Zoo')).size, 0, 'per park');
});

test('a renamed habitat keeps its assignment (found by its residents)', async () => {
    const a = await start();
    await sleep(50);
    const renamed = model('Lemur Valley', [['101', 'Lemur Forest', ['g1', 'g2']]]);
    assert.deepEqual(Array.from(a.getAssignments(renamed).get('101') || []), ['RingTailedLemur']);
});

test('a change made before the file is read is kept and saved', async () => {
    const a = await start();
    a.toggleAssignment(model('Lemur Valley'), '102', 'RingTailedLemur', 'Lemur Island'); // file not read yet
    await sleep(600);
    const got = a.getAssignments(model('Lemur Valley'));
    assert.deepEqual(Array.from(got.keys()).sort(), ['101', '102']);
    assert.ok(fake.file.includes('"102"'), 'the merged data is saved');
});

test('removing an assignment is saved too', async () => {
    let a = await start();
    await sleep(50);
    a.toggleAssignment(model('Lemur Valley'), '102', 'RingTailedLemur');
    await sleep(600);
    a = await start();
    await sleep(50);
    assert.deepEqual(Array.from(a.getAssignments(model('Lemur Valley')).keys()), ['101']);
});

test('non-ASCII park and species names round-trip', async () => {
    let a = await start();
    await sleep(50);
    a.toggleAssignment(model('Zoo de Montréal'), '101', 'Pingüino', 'Pingüinos');
    await sleep(600);
    a = await start();
    await sleep(50);
    assert.deepEqual(Array.from(a.getAssignments(model('Zoo de Montréal')).get('101') || []), ['Pingüino']);
});

test('no data file: the session keeps working and says so', async () => {
    fake.available = false;
    const a = await start();
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'memory');
    a.toggleAssignment(model('Lemur Valley'), '102', 'RingTailedLemur');
    assert.ok(a.getAssignments(model('Lemur Valley')).has('102'), 'kept for this session');
    fake.available = true;
});

test('no answer from the game yet: retried when the Lua side says hello', async () => {
    fake.answer = false;
    const before = fake.file;
    const a = await start();
    fake.answer = true;
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'loading');
    (fake.handlers.get('PZ2QoL_Hello') || []).forEach(fn => fn());
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'file');
    assert.ok(a.getAssignments(model('Lemur Valley')).has('101'));
    assert.equal(fake.file, before);
});

test('no player profile: memory only, and the UI knows why', async () => {
    fake.available = false;
    fake.reason = 'noplayer';
    const a = await start();
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'memory');
    assert.equal(a.assignmentStorageReason(), 'noplayer');
    fake.available = true;
    fake.reason = '';
});

test('the store not found yet (wait): changes are kept and saved once it answers', async () => {
    fake.file = '{"kinAssign":{"Savanna Hub":{"201":{"name":"Plains","species":["Lion"]}}}}';
    fake.available = false;
    fake.reason = 'wait';
    const a = await start();
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'memory');
    assert.equal(a.assignmentStorageReason(), 'wait');
    const savanna = model('Savanna Hub', [['201', 'Plains'], ['202', 'Grassland']]);
    a.toggleAssignment(savanna, '202', 'Lion', 'Grassland');
    // the Lua side found the zoo and the player: it tells the page to read again
    // ('data': the store's answer changed in the same park)
    fake.available = true;
    fake.reason = '';
    (fake.handlers.get('PZ2QoL_StoreReset') || []).forEach(fn => fn('data'));
    await sleep(600);
    assert.equal(a.assignmentStorage(), 'file');
    assert.deepEqual(Array.from(a.getAssignments(savanna).keys()).sort(), ['201', '202']);
    assert.ok(fake.file.includes('"202"') && fake.file.includes('"201"'), 'the change is saved on top of the stored data');
});

test("another zoo: the previous zoo's data is not carried into its store", async () => {
    fake.file = '{"kinAssign":{"Zoo A":{"1":{"name":"Pen","species":["Zebra"]}}}}';
    const a = await start();
    await sleep(50);
    assert.ok(a.getAssignments(model('Zoo A', [['1', 'Pen']])).has('1'));
    // the next zoo's store is empty ('park': a park started)
    fake.file = '{}';
    const savesBefore = fake.saves;
    (fake.handlers.get('PZ2QoL_StoreReset') || []).forEach(fn => fn('park'));
    await sleep(600);
    assert.equal(a.getAssignments(model('Zoo A', [['1', 'Pen']])).size, 0, "only the current zoo's data");
    assert.equal(fake.saves, savesBefore, 'nothing written to the new zoo');
});

test("the zoo's data found later: the store is read again (PZ2QoL_StoreReset)", async () => {
    fake.file = '{}';
    const a = await start();
    await sleep(50);
    assert.equal(a.getAssignments(model('Lemur Valley')).size, 0);
    // the Lua side found the zoo's data after the page asked
    fake.file = '{"kinAssign":{"Lemur Valley":{"103":{"name":"Lemur Bay","species":["RingTailedLemur"]}}}}';
    (fake.handlers.get('PZ2QoL_StoreReset') || []).forEach(fn => fn());
    await sleep(50);
    assert.equal(a.assignmentStorage(), 'file');
    assert.ok(a.getAssignments(model('Lemur Valley', LEMURS.concat([['103', 'Lemur Bay']]))).has('103'), 'the park\'s saved assignment');
});

test('a restart hands out new habitat ids: assignments follow their habitats, no ghosts', async () => {
    await sleep(500); // the previous test's last save
    fake.file = null;
    let a = await start();
    await sleep(50);
    a.toggleAssignment(model('Lemur Valley'), '101', 'RingTailedLemur', 'Lemur Woods');
    a.toggleAssignment(model('Lemur Valley'), '102', 'BlackAndWhiteRuffedLemur', 'Lemur Island');
    await sleep(600);

    // the game restarted: same habitats, new entity ids; 101 is now a gorilla habitat
    a = await start();
    await sleep(50);
    const after = model('Lemur Valley', [['640', 'Lemur Woods', ['g1', 'g2'], 'h1'], ['641', 'Lemur Island', ['g3'], 'h2'], ['101', 'Gorilla Hill', ['g8'], 'h3']]);
    const got = a.getAssignments(after);
    assert.deepEqual(Array.from(got.keys()).sort(), ['640', '641']);
    assert.deepEqual(Array.from(got.get('640')), ['RingTailedLemur']);
    assert.ok(!got.has('101') && !got.has('102'), 'nothing on the old ids');
    await sleep(600);
    const saved = JSON.parse(fake.file).kinAssign['Lemur Valley'];
    assert.deepEqual(Object.keys(saved).sort(), ['640', '641'], 'saved under the new ids');
});
