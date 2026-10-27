// Kin test fixture for the browser harness: plants related families onto
// the harness's dummy zoo rows and hands the page a kin snapshot, the way
// the Lua side (PZ2QoL.Kin) would.
//
// Layout per habitat (rows in order, species "Lion" for habitat 0, "Tiger"
// for 1, "Zebra" for 2):
//   r0 ♂ father of r2, r3        r1 ♀ mother of r2, r3 (founders)
//   r2 ♂ son                     r3 ♀ daughter        -> r2 x r3 full siblings (risk), r0 x r3 father/daughter (risk)
//   r4 ♀ half-sister of r2 (mother e, gone), on contraception -> covered
//   r5 ♀ cousin of r2 (parents siblings of r0 / r1 lines)      -> close kin
//   r6 ♀ juvenile daughter of r2... (r2 x r6 parent/child)    -> future
//   further rows: unrelated founders
export const HABITATS = ['Savannah Habitat', 'Jungle Habitat', 'Arctic Habitat'];
export const SPECIES = ['Lion', 'Tiger', 'Zebra'];

function genes(seed) {
    const L = 'ABCDEFGH';
    const pick = i => L[(seed * 7 + i * 3) % L.length];
    const strand = off => Array.from({ length: 6 }, (_, i) => pick(i + off)).join('');
    return { F: strand(0) + strand(5), I: strand(1) + strand(9), S: strand(2) + strand(4), L: strand(3) + strand(8) };
}

// rows: [{ id: 'animal_12', name }]; returns { snapshot, layout }
export function buildFixtureSnapshot(rows, habitatCount = 3) {
    const animals = [];
    const anc = { gE: [], gGP: [], gGM: [], gP2: ['gGP', 'gGM'], gQ: [] };
    const layout = [];
    const groups = Array.from({ length: habitatCount }, () => []);
    rows.forEach((r, i) => groups[i % habitatCount].push(r));
    groups.forEach((list, hi) => {
        const hab = String(9000 + hi);
        const g = n => (list[n] ? 'g' + list[n].id : '');
        list.forEach((r, n) => {
            const id = String(r.id).replace(/^animal_/, '');
            const sex = [0, 1, 0, 1, 1, 1, 1][n] ?? (n % 2);
            let par = [];
            if (n === 0) par = ['gGP', 'gGM'];        // r0's parents: r5's grandparents
            if (n === 2 || n === 3) par = [g(0), g(1)];
            if (n === 4) par = [g(0), 'gE'];
            if (n === 5) par = ['gP2', 'gQ'];         // gP2 is r0's full sister -> r5 is r2's cousin
            if (n === 6) par = [g(2), 'gQ'];
            const a = {
                id,
                key: 'animal_' + id,
                guid: 'g' + r.id,
                name: r.name || 'Animal ' + id,
                species: SPECIES[hi % SPECIES.length],
                sex,
                juv: n === 6,
                contra: n === 4,
                infertile: n === 6,
                preg: false,
                hab,
                loc: HABITATS[hi % HABITATS.length],
                par,
                mates: n === 2 ? [String(list[3] ? String(list[3].id).replace(/^animal_/, '') : '')] : [],
                genes: genes(n + hi * 10),
            };
            animals.push(a);
            layout.push({ rowId: r.id, id, n, hab, habName: a.loc, sex, species: a.species, juv: a.juv, contra: a.contra });
        });
    });
    return {
        snapshot: {
            v: 1, seq: 1, scope: 'park',
            habitats: groups.map((_, hi) => ({ id: String(9000 + hi), name: HABITATS[hi % HABITATS.length], kind: 'habitat' })),
            animals,
            anc,
        },
        layout,
    };
}

// Reads the zoo Animals rows in the page, makes their DataStore values
// match the fixture (habitat, sex, species, age), and applies the snapshot.
export async function seedZooKin(page) {
    const rows = await page.evaluate(async () => {
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const DS = await import('/js/common/core/DataStore.js');
        const col = new DataStoreCollection(['management', 'animals', 'animals', 'list']);
        for (let i = 0; i < 50 && col._source.length == 0; i++) await new Promise(r => setTimeout(r, 100));
        const out = col._source.map(ctx => ({ id: DS.getValue(ctx, 'id'), name: DS.getValue(ctx, 'name'), key: ctx[ctx.length - 1] }));
        col.dispose();
        return out;
    });
    const { snapshot, layout } = buildFixtureSnapshot(rows.map(r => ({ id: String(r.id).replace(/^animal_/, ''), name: r.name })));
    await page.evaluate(async ({ snapshot, layout }) => {
        const DS = await import('/js/common/core/DataStore.js');
        const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
        const col = new DataStoreCollection(['management', 'animals', 'animals', 'list']);
        await new Promise(r => setTimeout(r, 100));
        const byId = new Map(layout.map(l => [l.id, l]));
        col._source.forEach(ctx => {
            const id = String(DS.getValue(ctx, 'id')).replace(/^animal_/, '');
            const l = byId.get(id);
            if (!l) return;
            DS.setValue(ctx, 'id', 'animal_' + id);
            DS.setValue(ctx, 'location', '[STRING_LITERAL:Value=|' + l.habName + '|]');
            DS.setValue(ctx, 'gender', l.sex);
            DS.setValue(ctx, 'species', '[Animal_' + l.species + ']');
            DS.setValue(ctx, 'contracepted', l.contra);
            DS.setValue(ctx, 'maturity', l.juv ? 0 : 2);
        });
        col.dispose();
        const kin = await import('/js/mods/pz2qol/kin.js');
        kin.applyKinSnapshot(snapshot);
        window.__kinFixture = { snapshot, layout };
    }, { snapshot, layout });
    return { rows, snapshot, layout };
}

// Applies any snapshot in the page.
export async function applySnapshot(page, snapshot) {
    await page.evaluate(async snap => {
        const kin = await import('/js/mods/pz2qol/kin.js');
        kin.applyKinSnapshot(snap);
    }, snapshot);
}

// A Franchise snapshot lets the Market's fresh-blood check (marketmates.js)
// ask about a species' storage at once, before a scenario's fake Lua side
// answers: that ask times out first, and the stored cache starts empty.
export async function settleStoredAsks(page, species) {
    await page.evaluate(async sp => {
        const moves = await import('/js/mods/pz2qol/kinmoves.js');
        const end = Date.now() + 10000;
        while (moves.isAskingStored(sp) && Date.now() < end) await new Promise(r => setTimeout(r, 100));
        moves._clearStoredCache();
    }, species);
}
