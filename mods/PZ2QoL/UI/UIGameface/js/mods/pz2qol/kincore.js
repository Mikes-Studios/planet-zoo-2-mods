// Kin: relatedness, inbreeding risk and offspring genetics for PZ2QoL.
// Pure computations, no game imports, so it runs under Node tests.
//
// Input is the snapshot the Lua side (PZ2QoL.Kin) sends:
//   { v, seq, scope: 'park' | 'storage',
//     habitats: [{ id, name, kind: 'habitat' | 'exhibit' }],
//     animals: [{ id, key, guid, name, species, sex, juv, contra, infertile,
//                 preg, hab, loc, par: [guid, guid], mates: [id],
//                 bond: { mate, ring, lock: [id], mourn } (monogamous only),
//                 genes: { F, I, S, L } }],
//     anc: { guid: [parentGuid, parentGuid] },    // ancestors not in the zoo
//     bondsOk }                                    // the bond pass answered
// ids are strings (entity ids; exhibit animals 'x<uid>'); guids are strings,
// '' or '0' when unknown. Genes are 12 alleles per stat (strand A = 1..6,
// strand B = 7..12), one letter each.
//
// The game itself only ever calls a pair "inbred" when one is the other's
// parent or they share a parent (CompareMatesPopup.CompareParentsForInbreeding).
// That tier is 'game'. Kin adds the relatives the game does not flag
// (grandparents, aunts/uncles, cousins...) as 'close', using the coefficient
// of kinship over the known pedigree.

export const Sex = { Male: 0, Female: 1, Unisex: 2 };

// Worst first. 'distant' pairs are only shown in the planner. 'held' sits
// below 'future': a young animal grows up for certain, a bond may never end.
export const SEVERITY_ORDER = ['risk', 'kin', 'future', 'held', 'covered', 'distant'];
const SEVERITY_RANK = { risk: 6, kin: 5, future: 4, held: 3, covered: 2, distant: 1 };
export function severityRank(s) {
    return SEVERITY_RANK[s] || 0;
}

export const SEVERITY_INFO = {
    risk: { label: 'Inbreeding risk', short: 'Risk', tip: 'The game counts this pair as inbred, and both can breed now.' },
    kin: { label: 'Close kin', short: 'Kin', tip: 'Closely related, but the game does not warn about it. Their young lose fertility and immunity all the same.' },
    future: { label: 'Future risk', short: 'Later', tip: 'Related, and one of them is still young. They become a risk when it grows up.' },
    held: { label: 'Bonded elsewhere', short: 'Bonded', tip: 'Related, but the game will not let them breed: one of them has a mate (monogamy). If that bond ends, this becomes a risk again.' },
    covered: { label: 'Covered', short: 'Covered', tip: 'Related, but they cannot breed: contraception, infertility, old age, or one will be too old by the time the other grows up.' },
    distant: { label: 'Distant kin', short: 'Far', tip: 'Distantly related (below the close-kin threshold).' },
};

// Kinship below this is 'distant' unless the game flags the pair.
// 1/16 = first cousins, great-grandparents, half aunts/uncles.
export const DEFAULT_CLOSE_KINSHIP = 1 / 16;
const MAX_GENERATIONS = 8;

// A relation's tier: 'game' (the game's own rule), 'close' (at or over the
// model's close-kin line) or 'distant'; null when not related.
export function kinTier(model, rel) {
    if (!rel) return null;
    return rel.game ? 'game' : rel.kinship >= model.closeKinship - 1e-9 ? 'close' : 'distant';
}

function known(g) {
    return g != null && g !== '' && g !== '0' && g !== 0;
}

function asArray(v) {
    return Array.isArray(v) ? v : [];
}

// A monogamous animal's bond, from the Lua bond pass: its mate (the one the
// info panel shows; it may be dead or elsewhere), whether the game calls the
// two mates ("ring"), the animals the game locks it against ("IconLock":
// it has an existing mate) and the mourning time when the bond is broken.
function normalizeBond(b) {
    if (!b || typeof b !== 'object' || b.mate == null || b.mate === '') return null;
    return {
        mate: String(b.mate),
        ring: b.ring === true,
        // the game puts the mate in the same habitat (alive), even while it is
        // away at the vet or in transport
        here: b.here === true,
        lock: asArray(b.lock).map(String),
        // the animals whose check failed this scan: unknown, held like a lock while the bond is whole
        unk: asArray(b.unk).map(String),
        mourn: typeof b.mourn === 'number' && isFinite(b.mourn) && b.mourn > 0 ? b.mourn : 0,
    };
}

// ------------------------------------------------------------- snapshot

export function normalizeSnapshot(raw) {
    const snap = raw && typeof raw === 'object' ? raw : {};
    const animals = asArray(snap.animals).filter(a => a && a.id != null).map(a => ({
        id: String(a.id),
        key: a.key != null ? String(a.key) : `animal_${a.id}`,
        guid: known(a.guid) ? String(a.guid) : '',
        name: a.name != null && a.name !== '' ? String(a.name) : '?',
        species: a.species != null ? String(a.species) : '',
        sex: typeof a.sex === 'number' ? a.sex : Sex.Unisex,
        juv: !!a.juv,
        contra: !!a.contra,
        infertile: !!a.infertile || (typeof a.maturity === 'number' && a.maturity >= 4),
        preg: !!a.preg,
        // the game's EAnimalMaturity, only on Animal Storage rows (storedFert)
        maturity: typeof a.maturity === 'number' ? a.maturity : undefined,
        // at the vet, in a quarantine or carried, but assigned to `hab`
        away: a.away ? String(a.away) : '',
        alive: a.alive !== false,
        hab: a.hab != null && a.hab !== '' && a.hab !== 0 ? String(a.hab) : '',
        loc: a.loc != null ? String(a.loc) : '',
        exhibit: !!a.exhibit,
        // where it is: 'habitat' | 'trade' | 'transit' | 'quarantine' | 'vet' | 'escaped' | 'other'
        lt: a.lt != null ? String(a.lt) : (a.hab != null && a.hab !== '' ? 'habitat' : ''),
        moving: !!a.moving,
        // in a transport box (the game's bBoxed); kinboxed.js
        boxed: !!a.boxed,
        // sick or injured, and passed quarantine (kinmoves.js, kinquarantine.js)
        sick: !!a.sick,
        qReady: !!a.qReady,
        age: typeof a.age === 'number' ? a.age : undefined,
        // the game's age quarter for the UI: 0 child, 1 young adult, 2 adult, 3 elderly
        ageQ: typeof a.ageQ === 'number' ? a.ageQ : undefined,
        par: asArray(a.par).filter(known).map(String),
        mates: asArray(a.mates).map(String),
        bond: normalizeBond(a.bond),
        genes: a.genes && typeof a.genes === 'object' ? a.genes : null,
        // growing up (kinlife.js): a juvenile's adult age and years left
        // (undefined when the game did not answer); an adult the group does
        // not accept: 'pop' | 'mat' | 'sex' | 'yes' (null: none, or unknown)
        adultAge: typeof a.adultAge === 'number' && isFinite(a.adultAge) ? a.adultAge : undefined,
        adultIn: typeof a.adultIn === 'number' && isFinite(a.adultIn) ? a.adultIn : undefined,
        out: a.out === 'pop' || a.out === 'mat' || a.out === 'sex' || a.out === 'yes' ? a.out : null,
    }));
    const anc = {};
    if (snap.anc && typeof snap.anc === 'object') {
        for (const g in snap.anc) {
            if (known(g)) anc[String(g)] = asArray(snap.anc[g]).filter(known).map(String);
        }
    }
    // per species: { maturity, infertility, life } in years (the game's
    // fertility bounds and longevity; infertility above 900 = never), and
    // collective: shoals and colonies, which breed as one group
    const speciesFacts = {};
    if (snap.speciesFacts && typeof snap.speciesFacts === 'object') {
        for (const [sp, f] of Object.entries(snap.speciesFacts)) {
            if (!f || typeof f !== 'object') continue;
            const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
            speciesFacts[sp] = { maturity: num(f.maturity), infertility: num(f.infertility), life: num(f.life), collective: f.collective === true };
            // growing up (kinlife.js): the game's adults per habitat and its
            // maturation rule ('males' | 'females' | 'all' | 'none'); null: unknown
            const social = f.social && typeof f.social === 'object' && num(f.social.max) != null ? { min: num(f.social.min), max: num(f.social.max) } : null;
            const maturation = ['males', 'females', 'all', 'none'].includes(f.maturation) ? f.maturation : null;
            speciesFacts[sp].social = social;
            speciesFacts[sp].maturation = maturation;
        }
    }
    for (const a of animals) a.fert = a.maturity != null ? storedFert(a.maturity) : fertilityOf(a, speciesFacts[a.species]);
    const habitats = asArray(snap.habitats).filter(h => h && h.id != null).map(h => ({
        id: String(h.id),
        name: h.name != null ? String(h.name) : '',
        kind: h.kind === 'exhibit' ? 'exhibit' : 'habitat',
    }));
    // every habitat in the park, empty ones too, with the game's habitat id
    // (entity ids change when the zoo loads; see kinboardcore resolveAssignments)
    const habs = asArray(snap.habs).filter(h => h && h.id != null).map(h => ({
        id: String(h.id),
        name: h.name != null ? String(h.name) : '',
        hid: h.hid != null && h.hid !== '' ? String(h.hid) : null,
    }));
    return {
        normalized: true,
        v: snap.v || 1,
        seq: snap.seq || 0,
        scope: snap.scope === 'storage' ? 'storage' : 'park',
        habitats,
        habs,
        animals,
        anc,
        speciesFacts,
        names: snap.names && typeof snap.names === 'object' ? snap.names : {},
        // the Lua bond pass answered (false: it failed, so no bond data this scan)
        bondsOk: snap.bondsOk === true,
        park: snap.park != null ? String(snap.park) : '',
        // 'franchise' | 'offline' (Sandbox, Career, Challenge) | 'unknown'
        mode: snap.mode === 'franchise' || snap.mode === 'offline' ? snap.mode : 'unknown',
        // the park's sandbox switches: false only when the park turned one off
        rules: {
            socialGroups: !(snap.rules && snap.rules.socialGroups === false),
            overcrowding: !(snap.rules && snap.rules.overcrowding === false),
        },
        // a wildlife reserve rather than a zoo
        reserve: snap.reserve === true,
        tradeCentre: snap.tradeCentre && snap.tradeCentre.id != null ? { id: String(snap.tradeCentre.id), name: String(snap.tradeCentre.name || 'Trade centre') } : null,
    };
}

// ------------------------------------------------------------ fertility

// Where an animal is in its breeding life, from the game's flags, its age
// and the species' fertility ages:
//   state: 'juvenile' (too young), 'young' (adult in looks, not yet
//          mature: the game reports it infertile), 'fertile', 'ending'
//          (fertile, but the last fifth of its fertile years, at least one
//          year), 'old' (too old to breed), 'sterile' (infertile for
//          another reason)
//   yearsLeft: fertile years left (null: unknown, or the species never
//          becomes infertile); yearsToMature: years until it can breed;
//   elderly: the game's 'elderly' age group.
export function fertilityOf(a, f) {
    const age = a && typeof a.age === 'number' ? a.age : null;
    const mat = f && typeof f.maturity === 'number' ? f.maturity : null;
    const inf = f && typeof f.infertility === 'number' && f.infertility < 900 ? f.infertility : null;
    const out = {
        state: 'fertile', yearsLeft: null, yearsToMature: null, elderly: !!a && a.ageQ === 3,
        forLife: !!f && typeof f.infertility === 'number' && f.infertility >= 900,
    };
    if (!a) return out;
    if (age != null && inf != null) out.yearsLeft = Math.max(0, inf - age);
    if (a.juv) {
        out.state = 'juvenile';
        if (age != null && mat != null) out.yearsToMature = Math.max(0, mat - age);
        return out;
    }
    const pastAge = age != null && inf != null && age >= inf;
    if (a.infertile) {
        if (age != null && mat != null && age < mat) {
            out.state = 'young';
            out.yearsToMature = mat - age;
        }
        else out.state = pastAge || out.elderly ? 'old' : 'sterile';
        return out;
    }
    if (pastAge) {
        out.state = 'old';
        return out;
    }
    if (out.yearsLeft != null && mat != null && out.yearsLeft <= Math.max(1, (inf - mat) * 0.2)) out.state = 'ending';
    return out;
}

function yearsText(n) {
    if (n < 1) return 'under a year';
    const r = Math.round(n);
    return `about ${r} year${r === 1 ? '' : 's'}`;
}

// A short phrase for cards: 'too old to breed', 'fertile for about 2 more
// years', 'breeds in about 1 year'... ('' when there is nothing to say).
export function fertilityText(a) {
    const f = a && a.fert;
    if (!f) return a && a.juv ? 'too young to breed' : a && a.infertile ? 'infertile' : '';
    switch (f.state) {
        case 'juvenile':
        case 'young':
            return f.yearsToMature != null ? (f.yearsToMature < 0.05 ? 'can breed soon' : `breeds in ${yearsText(f.yearsToMature)}`) : 'too young to breed';
        case 'old': return 'too old to breed';
        case 'sterile': return 'infertile';
        case 'ending': return f.yearsLeft < 1 ? 'fertile for under a year more' : `fertile for ${yearsText(f.yearsLeft)} more`;
        default:
            if (f.yearsLeft != null) return `fertile for ${yearsText(f.yearsLeft)} more`;
            return f.forLife ? 'fertile for life' : '';
    }
}

// A small tag for animal lists: { cls, text, title } or null.
//   young (juvenile / not yet mature), old (too old to breed), infertile,
//   ending (last fertile years), elderly (fertile, but in the game's
//   elderly age group)
export function fertilityTag(a) {
    const f = a && a.fert;
    const say = fertilityText(a);
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    if (!f) {
        if (a && a.juv) return { cls: 'young', text: 'young', title: 'Too young to breed' };
        if (a && a.infertile) return { cls: 'infertile', text: 'infertile', title: 'Infertile' };
        return null;
    }
    switch (f.state) {
        case 'juvenile': return { cls: 'young', text: 'young', title: cap(say) };
        case 'young': return { cls: 'young', text: 'not mature', title: `Adult, but not mature yet: ${say}` };
        case 'old': return { cls: 'old', text: 'too old', title: 'Too old to breed' + (f.elderly ? ' (elderly)' : '') };
        case 'sterile': return { cls: 'infertile', text: 'infertile', title: 'Infertile' };
        case 'ending': return { cls: 'ending', text: f.yearsLeft < 1 ? '<1y fertile' : `${Math.round(f.yearsLeft)}y fertile`, title: cap(say) };
        default: return f.elderly ? { cls: 'ending', text: 'elderly', title: say ? `Elderly, ${say}` : 'Elderly' } : null;
    }
}

// Breeds now, as far as age and fertility go (contraception aside).
export function fertileNow(a) {
    if (!a || a.juv || a.infertile) return false;
    const s = a.fert && a.fert.state;
    return s !== 'old' && s !== 'young' && s !== 'sterile';
}

// ------------------------------------------------------------- pedigree

export class Pedigree {
    // prev: an earlier Pedigree. When the parentage is the same (every scan
    // without a birth, death or arrival; every simulated plan), its
    // ancestor and kinship caches are taken over: they depend on nothing else.
    constructor(snapshot, prev = null) {
        this.parents = new Map();   // guid -> [guid...]
        this.byGuid = new Map();    // guid -> animal (present ones)
        this.names = new Map();     // guid -> name (present + known ancestors)
        for (const g in snapshot.anc) this.parents.set(g, snapshot.anc[g]);
        for (const g in snapshot.names || {}) this.names.set(g, String(snapshot.names[g]));
        for (const a of snapshot.animals) {
            if (!a.guid) continue;
            this.parents.set(a.guid, a.par);
            this.byGuid.set(a.guid, a);
            this.names.set(a.guid, a.name);
        }
        this._ancRef = snapshot.anc;
        this._sig = null;
        if (prev instanceof Pedigree && this.sameParentage(prev)) {
            this._anc = prev._anc;
            this._kin = prev._kin;
            this._sig = prev._sig;
            this.reused = true;
        }
        else {
            this._anc = new Map();
            this._kin = new Map();
            this.reused = false;
        }
    }

    // Every guid's parent list, in one string (sorted, so order never matters).
    parentage() {
        if (this._sig == null) {
            const parts = [];
            for (const [g, p] of this.parents) parts.push(g + ':' + (Array.isArray(p) ? p.join(',') : ''));
            parts.sort();
            this._sig = parts.join(';');
        }
        return this._sig;
    }

    sameParentage(prev) {
        if (prev.parents.size !== this.parents.size) return false;
        // fast: the same ancestor table and the very same parent lists
        if (prev._ancRef === this._ancRef) {
            let same = true;
            for (const [g, p] of this.parents) {
                if (prev.parents.get(g) !== p) {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return prev.parentage() === this.parentage();
    }

    parentsOf(g) {
        return known(g) ? (this.parents.get(g) || []) : [];
    }

    // guid -> generations up (1 = parent). Nearest generation wins.
    ancestors(g) {
        let m = this._anc.get(g);
        if (m) return m;
        m = new Map();
        let frontier = [g];
        for (let gen = 1; gen <= MAX_GENERATIONS && frontier.length; gen++) {
            const nextFrontier = [];
            for (const x of frontier) {
                for (const p of this.parentsOf(x)) {
                    if (p === g || m.has(p)) continue;
                    m.set(p, gen);
                    nextFrontier.push(p);
                }
            }
            frontier = nextFrontier;
        }
        this._anc.set(g, m);
        return m;
    }

    isAncestor(a, b) {
        return this.ancestors(b).has(a);
    }

    // Coefficient of kinship: the chance that an allele picked from each is
    // identical by descent. Parent/child and full siblings 1/4, half siblings
    // and grandparents 1/8, first cousins 1/16. Unknown parents count as
    // unrelated founders.
    kinship(a, b, depth = 0) {
        if (!known(a) || !known(b)) return 0;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const cached = this._kin.get(key);
        if (cached !== undefined) return cached;
        if (depth > 2 * MAX_GENERATIONS) return 0;
        // guards against a malformed (cyclic) pedigree
        this._kin.set(key, 0);
        let value;
        if (a === b) {
            const [p, q] = this.parentsOf(a);
            value = 0.5 * (1 + (p && q ? this.kinship(p, q, depth + 1) : 0));
        }
        else {
            // expand the one that is not an ancestor of the other
            let x = a, y = b;
            if (this.isAncestor(a, b)) {
                x = b;
                y = a;
            }
            const [p, q] = this.parentsOf(x);
            value = 0.5 * ((p ? this.kinship(p, y, depth + 1) : 0) + (q ? this.kinship(q, y, depth + 1) : 0));
        }
        this._kin.set(key, value);
        return value;
    }

    // The game's own rule, exactly (CompareParentsForInbreeding).
    gameInbred(a, b) {
        if (!known(a) || !known(b)) return false;
        const pa = this.parentsOf(a);
        const pb = this.parentsOf(b);
        if (pa.includes(b) || pb.includes(a)) return true;
        return pa.some(p => pb.includes(p));
    }

    // How y is related to x, from x's point of view ("y is x's ...").
    // { code, full, kinship, game, via: [guid] }
    relation(x, y) {
        if (!known(x) || !known(y) || x === y) return null;
        const ax = this.ancestors(x);
        const ay = this.ancestors(y);
        // fast path: no direct line and no common ancestor
        if (!ax.has(y) && !ay.has(x)) {
            let common = false;
            const [small, big] = ax.size <= ay.size ? [ax, ay] : [ay, ax];
            for (const g of small.keys()) {
                if (big.has(g)) {
                    common = true;
                    break;
                }
            }
            if (!common) return null;
        }
        const kinship = this.kinship(x, y);
        const game = this.gameInbred(x, y);
        const px = this.parentsOf(x);
        const py = this.parentsOf(y);
        const shared = px.filter(p => py.includes(p));
        let code = null, full = false, via = [];
        if (px.includes(y)) code = 'parent';
        else if (py.includes(x)) code = 'child';
        else if (shared.length) {
            code = 'sibling';
            full = shared.length >= 2;
            via = shared;
        }
        else if (ax.get(y) === 2) {
            code = 'grandparent';
            via = px.filter(p => this.parentsOf(p).includes(y));
        }
        else if (ay.get(x) === 2) {
            code = 'grandchild';
            via = py.filter(p => this.parentsOf(p).includes(x));
        }
        else {
            // y is a sibling of one of x's parents, or the other way round
            for (const p of px) {
                const s = this.parentsOf(p).filter(g => py.includes(g));
                if (s.length && p !== y) {
                    code = 'auntUncle';
                    full = s.length >= 2;
                    via = [p];
                    break;
                }
            }
            if (!code) {
                for (const p of py) {
                    const s = this.parentsOf(p).filter(g => px.includes(g));
                    if (s.length && p !== x) {
                        code = 'nieceNephew';
                        full = s.length >= 2;
                        via = [p];
                        break;
                    }
                }
            }
            if (!code && ax.get(y) === 3) code = 'greatGrandparent';
            if (!code && ay.get(x) === 3) code = 'greatGrandchild';
            if (!code) {
                const commonGrand = [];
                for (const [g, gen] of ax) if (gen === 2 && ay.get(g) === 2) commonGrand.push(g);
                if (commonGrand.length) {
                    code = 'cousin';
                    full = commonGrand.length >= 2;
                    via = commonGrand;
                }
            }
            if (!code) {
                for (const g of ax.keys()) {
                    if (ay.has(g)) {
                        code = 'distant';
                        via = [g];
                        break;
                    }
                }
            }
        }
        if (!code && !game && kinship <= 0) return null;
        return { code: code || 'distant', full, kinship, game, via };
    }

    nameOf(g) {
        return this.names.get(g) || null;
    }
}

// ----------------------------------------------------------- relation text

const WORDS = {
    parent: ['father', 'mother', 'parent'],
    child: ['son', 'daughter', 'offspring'],
    sibling: ['brother', 'sister', 'sibling'],
    grandparent: ['grandfather', 'grandmother', 'grandparent'],
    grandchild: ['grandson', 'granddaughter', 'grandchild'],
    auntUncle: ['uncle', 'aunt', 'parent\'s sibling'],
    nieceNephew: ['nephew', 'niece', 'sibling\'s offspring'],
    greatGrandparent: ['great-grandfather', 'great-grandmother', 'great-grandparent'],
    greatGrandchild: ['great-grandson', 'great-granddaughter', 'great-grandchild'],
    cousin: ['cousin', 'cousin', 'cousin'],
    distant: ['relative', 'relative', 'relative'],
};

// "half-sister", "mother", "cousin": what y is to x. ySex picks the word.
export function relationWord(rel, ySex) {
    if (!rel) return '';
    const words = WORDS[rel.code] || WORDS.distant;
    const i = ySex === Sex.Male ? 0 : ySex === Sex.Female ? 1 : 2;
    let w = words[i];
    if (!rel.full && (rel.code === 'sibling' || rel.code === 'auntUncle' || rel.code === 'nieceNephew' || rel.code === 'cousin')) {
        w = 'half-' + w;
    }
    return w;
}

export function percent(k) {
    if (!(k > 0)) return '0%';
    return String(Number((k * 100).toFixed(2))) + '%';
}

// ------------------------------------------------------------ genetics

const STATS = [
    { id: 'fertility', key: 'F', hetero: true },
    { id: 'immunity', key: 'I', hetero: true },
    { id: 'size', key: 'S', hetero: false },
    { id: 'longevity', key: 'L', hetero: false },
];

function strands(genes, key) {
    const s = genes && genes[key];
    if (typeof s !== 'string') return null;
    const list = s.length === 12 ? s.split('') : s.split('.');
    if (list.length !== 12) return null;
    return [list.slice(0, 6), list.slice(6, 12)];
}

function diffCount(a, b) {
    let n = 0;
    for (let i = 0; i < 6; i++) if (a[i] !== b[i]) n++;
    return n;
}

function goodCount(strand) {
    let n = 0;
    for (const c of strand) if (c === 'A' || c === 'B') n++;
    return n;
}

// An animal's own gene grades from its alleles (0..1), as the game shows them.
export function ownGrades(genes) {
    const out = {};
    for (const st of STATS) {
        const s = strands(genes, st.key);
        if (!s) continue;
        out[st.id] = st.hetero ? diffCount(s[0], s[1]) / 6 : (goodCount(s[0]) + goodCount(s[1])) / 12;
    }
    return out;
}

// The game's offspring prediction (CompareMatesUIUtils.GetMinMaxGeneGrades):
// the young get one strand from each parent. Fertility and immunity are the
// number of loci where the two inherited strands differ (so related parents,
// who share strands, have less fertile and less healthy young); size and
// longevity count the good alleles (A, B). Each of the four strand
// combinations is equally likely, so mean is the expected value.
// Returns { fertility: { min, max, mean }, ... } in 0..1, or null.
export function predictOffspring(genesA, genesB) {
    if (!genesA || !genesB) return null;
    const out = {};
    let any = false;
    for (const st of STATS) {
        const a = strands(genesA, st.key);
        const b = strands(genesB, st.key);
        if (!a || !b) continue;
        const values = [];
        for (const sa of a) {
            for (const sb of b) {
                values.push(st.hetero ? diffCount(sa, sb) / 6 : (goodCount(sa) + goodCount(sb)) / 12);
            }
        }
        out[st.id] = {
            min: Math.min(...values),
            max: Math.max(...values),
            mean: values.reduce((s, v) => s + v, 0) / values.length,
        };
        any = true;
    }
    return any ? out : null;
}

// One number for ranking mates: mean of the predicted means (0..100).
export function offspringScore(pred) {
    if (!pred) return null;
    const vals = STATS.map(s => pred[s.id] && pred[s.id].mean).filter(v => typeof v === 'number');
    if (!vals.length) return null;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100);
}

// A breeder's calves with each of `mates` (gene sets) as one score: a male's
// average over them (in a harem he fathers every litter,
// so he has to suit them all), a female's best (she joins the pride whose
// male suits her); best is its best young. -> { score, best, mates } | null
export function calfScores(genes, mates, male) {
    const each = (mates || []).map(m => offspringScore(predictOffspring(genes, m))).filter(v => v != null);
    if (!each.length) return null;
    const best = Math.max(...each);
    const score = male ? Math.round(each.reduce((s, v) => s + v, 0) / each.length) : best;
    return { score, best, mates: each.length };
}

// The best calf score `genes` could have with one of `mates` (gene sets). -> 0..100 or null
export function bestOffspringScore(genes, mates) {
    let best = null;
    for (const m of mates || []) {
        const s = offspringScore(predictOffspring(genes, m));
        if (s != null && (best == null || s > best)) best = s;
    }
    return best;
}

// ---------------------------------------------------------------- model

function compatibleSexes(a, b) {
    if (a.sex === Sex.Unisex || b.sex === Sex.Unisex) return true;
    return a.sex !== b.sex;
}

function canBreedNow(a) {
    return !a.contra && fertileNow(a);
}

// Not breeding yet, but will: a juvenile, or an adult not yet mature (the
// game reports both as infertile).
function notYet(a) {
    return !!a.juv || !!(a.fert && a.fert.state === 'young');
}

// Contraception, adult infertility or old age stops this one breeding.
// Juveniles (and not yet mature adults) are reported as infertile because
// of their age; that is a later risk, not a cover.
function isCovered(a) {
    if (a.contra) return true;
    const s = a.fert && a.fert.state;
    if (s === 'old') return true;
    return !!a.infertile && !notYet(a);
}

// `other` is too old to breed by the time `young` can.
function agesOutFirst(young, other) {
    const yf = young.fert, of = other.fert;
    return !!(yf && of && yf.yearsToMature != null && of.yearsLeft != null && yf.yearsToMature >= of.yearsLeft);
}

export function pairSeverity(x, y, tier) {
    if (tier === 'distant') return 'distant';
    if (isCovered(x) || isCovered(y)) return 'covered';
    if (notYet(x) || notYet(y)) {
        if ((notYet(x) && agesOutFirst(x, y)) || (notYet(y) && agesOutFirst(y, x))) return 'covered';
        return 'future';
    }
    return tier === 'game' ? 'risk' : 'kin';
}

// Why a covered pair cannot breed, in words ('' when it is not covered).
export function coverReason(x, y) {
    for (const a of [x, y]) if (a.contra) return `${a.name} is on contraception`;
    for (const a of [x, y]) if (a.fert && a.fert.state === 'old') return `${a.name} is too old to breed`;
    for (const a of [x, y]) if (a.infertile && !notYet(a)) return `${a.name} is infertile`;
    if (notYet(x) && agesOutFirst(x, y)) return `${y.name} will be too old to breed by the time ${x.name} can`;
    if (notYet(y) && agesOutFirst(y, x)) return `${x.name} will be too old to breed by the time ${y.name} can`;
    return '';
}

// The game's own monogamy rule (CompareMatesPopup: "IconLock" either way
// means no conception): x and y are held apart when one of them is locked
// against the other in this scan (or the check failed: unknown, as the
// alerts read it) AND its bonded mate is alive, in the model
// and in the same habitat (not the other one). A dead or absent mate (the
// bond is broken, the animal mourns) does not hold: the lock may lift at any
// time, so the pair is warned about as before. Moves in a plan clear the
// bond (kinboardcore plannedSnapshot). -> { by, mate, fragile } or null
export function bondHold(animals, x, y) {
    for (const [self, other] of [[x, y], [y, x]]) {
        const b = self.bond;
        if (!b || !(b.lock.includes(other.id) || b.unk.includes(other.id))) continue;
        const mate = animals.get(b.mate);
        if (!bondIntact(self, mate) || mate.id === other.id) continue;
        // an elderly or too old mate: the bond will likely end with its life
        const fragile = mate.ageQ === 3 || !!(mate.fert && mate.fert.state === 'old');
        return { by: self, mate, fragile };
    }
    return null;
}

// self's bond to `mate` still holds: the mate is alive and lives with it,
// or is briefly away (vet, transport: in no habitat, but the game still
// assigns it to self's habitat).
function bondIntact(self, mate) {
    const b = self && self.bond;
    if (!b || !mate || mate.id !== b.mate || !mate.alive || !self.hab) return false;
    return mate.hab === self.hab || (!mate.hab && b.here && mate.lt !== 'trade');
}

// Why a held pair cannot breed, in words ('' when it is not held).
export function holdReason(p) {
    const h = p && p.held;
    if (!h) return '';
    const other = h.by === p.a ? p.b : p.a;
    let s = `${h.by.name} is bonded to ${h.mate.name} (monogamy): the game won't pair ${h.by.name} with ${other.name} while ${h.mate.name} is there`;
    if (h.fragile) s += `. ${h.mate.name} is elderly: when the bond ends, this becomes ${p.unheld === 'risk' ? 'an inbreeding risk' : 'close kin'}`;
    return s;
}

function pairKeyOf(x, y) {
    const a = x.guid || 'e' + x.id;
    const b = y.guid || 'e' + y.id;
    return a < b ? `${a}~${b}` : `${b}~${a}`;
}

// Orders a pair male first, so text reads "♂ Kito – ♀ Zuri".
function ordered(x, y) {
    if (x.sex === Sex.Female && y.sex !== Sex.Female) return [y, x];
    return [x, y];
}

// The park counts overcrowding (false only when its sandbox switch is off:
// then a habitat holds any number of adults).
export function overcrowdingOn(model) {
    return !model || !model.rules || model.rules.overcrowding !== false;
}

// Shoals (boids) and colonies, by the game's own species checks.
export function isCollective(model, species) {
    const f = model && model.speciesFacts && model.speciesFacts[species];
    return !!(f && f.collective);
}

export function buildKinModel(raw, opts = {}) {
    const snap = raw && raw.normalized ? raw : normalizeSnapshot(raw);
    const closeKinship = opts.closeKinship != null ? opts.closeKinship : DEFAULT_CLOSE_KINSHIP;
    // pair bonds count as protection (the player's switch); only with this
    // scan's bond data
    const bondHolds = opts.bondHolds !== false;
    const useBonds = bondHolds && snap.bondsOk === true;
    const ped = new Pedigree(snap, opts.ped || null);
    const animals = new Map();
    const byKey = new Map();
    const byGuid = ped.byGuid;
    for (const a of snap.animals) {
        animals.set(a.id, a);
        byKey.set(a.key, a);
    }
    const habitats = new Map();
    for (const h of snap.habitats) habitats.set(h.id, { id: h.id, name: h.name, kind: h.kind });
    // groups: habitat id -> species -> animals
    // Shoals and colonies (fish, butterflies...) are left out: they breed as
    // one group, so nearly every pair in it is related.
    const groups = new Map();
    for (const a of snap.animals) {
        if (!a.hab || !a.alive) continue;
        if (!habitats.has(a.hab)) habitats.set(a.hab, { id: a.hab, name: a.loc || a.hab, kind: a.exhibit ? 'exhibit' : 'habitat' });
        const h = habitats.get(a.hab);
        if (!h.name && a.loc) h.name = a.loc;
        if (isCollective(snap, a.species)) continue;
        let bySpecies = groups.get(a.hab);
        if (!bySpecies) groups.set(a.hab, bySpecies = new Map());
        if (!bySpecies.has(a.species)) bySpecies.set(a.species, []);
        bySpecies.get(a.species).push(a);
    }
    const pairs = [];
    const byAnimal = new Map();
    const addTo = (id, p) => {
        if (!byAnimal.has(id)) byAnimal.set(id, []);
        byAnimal.get(id).push(p);
    };
    for (const [hab, bySpecies] of groups) {
        for (const [species, list] of bySpecies) {
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const x = list[i], y = list[j];
                    if (!compatibleSexes(x, y) || !x.guid || !y.guid) continue;
                    // one relation per pair, already male first (kinship and
                    // the game's rule are the same both ways)
                    const [m, f] = ordered(x, y);
                    const rel = ped.relation(m.guid, f.guid);
                    if (!rel) continue;
                    const tier = kinTier({ closeKinship }, rel);
                    const relMF = rel;
                    const base = pairSeverity(m, f, tier);
                    const held = useBonds && (base === 'risk' || base === 'kin') ? bondHold(animals, m, f) : null;
                    const p = {
                        key: pairKeyOf(m, f),
                        a: m,
                        b: f,
                        hab,
                        species,
                        rel: relMF,               // f is m's <relation>
                        tier,
                        severity: held ? 'held' : base,
                        cover: base === 'covered' ? coverReason(m, f) : '',
                        kinship: rel.kinship,
                        mated: m.mates.includes(f.id) || f.mates.includes(m.id),
                    };
                    if (held) {
                        p.held = held;
                        p.unheld = base;         // what it is again when the bond ends
                    }
                    pairs.push(p);
                    addTo(m.id, p);
                    addTo(f.id, p);
                }
            }
        }
    }
    const sortPairs = list => list.sort((p, q) => severityRank(q.severity) - severityRank(p.severity)
        || severityRank(q.unheld) - severityRank(p.unheld)
        || (q.mated - p.mated) || q.kinship - p.kinship);
    sortPairs(pairs);
    for (const list of byAnimal.values()) sortPairs(list);
    const counts = { risk: 0, kin: 0, future: 0, held: 0, covered: 0, distant: 0 };
    for (const p of pairs) counts[p.severity]++;
    const model = {
        seq: snap.seq,
        scope: snap.scope,
        snapshot: snap,
        park: snap.park,
        mode: snap.mode,
        rules: snap.rules || { socialGroups: true, overcrowding: true },
        reserve: snap.reserve,
        tradeCentre: snap.tradeCentre,
        speciesFacts: snap.speciesFacts || {},
        ped,
        animals,
        byKey,
        byGuid,
        habitats,
        groups,
        pairs,
        byAnimal,
        counts,
        closeKinship,
        bondHolds,
        // what a rebuild of this model (a simulated plan) must use too
        opts: { closeKinship, bondHolds },
    };
    model.habitatSummaries = summarizeHabitats(model);
    return model;
}

// ----------------------------------------------------------- per animal

// Pairs that count on the animal's own badge (not the distant ones).
export function animalPairs(model, id, { includeDistant = false } = {}) {
    const list = (model && model.byAnimal.get(String(id))) || [];
    return includeDistant ? list : list.filter(p => p.severity !== 'distant');
}

export function animalSeverity(model, id) {
    const list = animalPairs(model, id);
    return list.length ? list[0].severity : null;
}

// The other animal of a pair.
export function partnerOf(pair, id) {
    return pair.a.id === String(id) ? pair.b : pair.a;
}

// What `other` is to `self` ("half-sister"), with the right sex word.
export function relationFor(model, self, other) {
    if (!self.guid || !other.guid) return null;
    return model.ped.relation(self.guid, other.guid);
}

export function describeRelation(model, self, other) {
    const rel = relationFor(model, self, other);
    return rel ? relationWord(rel, other.sex) : '';
}

// A sentence on how two animals are related, naming the link if known.
export function explainRelation(model, x, y) {
    const rel = relationFor(model, x, y);
    if (!rel) return `${x.name} and ${y.name} are not related as far as the game records.`;
    const name = g => {
        const n = model.ped.nameOf(g);
        return n ? n : 'an animal no longer in the zoo';
    };
    const word = relationWord(rel, y.sex);
    switch (rel.code) {
        case 'parent':
        case 'child':
        case 'grandparent':
        case 'grandchild':
        case 'greatGrandparent':
        case 'greatGrandchild':
            return `${y.name} is ${x.name}'s ${word}${rel.via.length ? ` (through ${name(rel.via[0])})` : ''}.`;
        case 'sibling':
            return rel.full
                ? `${x.name} and ${y.name} are full siblings (same mother and father).`
                : `${x.name} and ${y.name} are half-siblings: they share ${name(rel.via[0])}.`;
        case 'auntUncle':
            return `${y.name} is ${x.name}'s ${word}: a ${rel.full ? '' : 'half-'}sibling of ${name(rel.via[0])}.`;
        case 'nieceNephew':
            return `${y.name} is ${x.name}'s ${word}: ${name(rel.via[0])} is ${x.name}'s ${rel.full ? '' : 'half-'}sibling.`;
        case 'cousin':
            return `${x.name} and ${y.name} are ${rel.full ? 'first' : 'half'} cousins: they share grandparent${rel.via.length > 1 ? 's' : ''} ${rel.via.map(name).join(' and ')}.`;
        default:
            return `${x.name} and ${y.name} share an ancestor${rel.via.length ? ` (${name(rel.via[0])})` : ''}.`;
    }
}

// Related animals as connected groups (over the counted pairs), so a list
// can be sorted with relatives next to each other. id -> group key.
export function kinClusters(model) {
    const parent = new Map();
    const find = x => {
        while (parent.get(x) !== x) {
            parent.set(x, parent.get(parent.get(x)));
            x = parent.get(x);
        }
        return x;
    };
    for (const p of (model && model.pairs) || []) {
        if (p.severity === 'distant') continue;
        for (const id of [p.a.id, p.b.id]) if (!parent.has(id)) parent.set(id, id);
        const ra = find(p.a.id), rb = find(p.b.id);
        if (ra !== rb) parent.set(ra, rb);
    }
    const out = new Map();
    for (const id of parent.keys()) out.set(id, find(id));
    return out;
}

// --------------------------------------------------------- per habitat

function summarizeHabitats(model) {
    const out = new Map();
    for (const [hab, bySpecies] of model.groups) {
        const h = model.habitats.get(hab) || { id: hab, name: hab, kind: 'habitat' };
        const entry = { id: hab, name: h.name, kind: h.kind, counts: { risk: 0, kin: 0, future: 0, held: 0, covered: 0 }, species: [] };
        for (const [species, list] of bySpecies) {
            const sp = {
                species,
                animals: list,
                males: list.filter(a => a.sex === Sex.Male),
                females: list.filter(a => a.sex === Sex.Female),
                counts: { risk: 0, kin: 0, future: 0, held: 0, covered: 0 },
                pairs: [],
            };
            entry.species.push(sp);
        }
        out.set(hab, entry);
    }
    for (const p of model.pairs) {
        const entry = out.get(p.hab);
        if (!entry || p.severity === 'distant') continue;
        entry.counts[p.severity]++;
        const sp = entry.species.find(s => s.species === p.species);
        if (sp) {
            sp.counts[p.severity]++;
            sp.pairs.push(p);
        }
    }
    return out;
}

export function habitatSummary(model, habId) {
    return model ? model.habitatSummaries.get(String(habId)) || null : null;
}

// By the location text the game shows ("Savannah Habitat").
export function habitatByName(model, name) {
    if (!model || !name) return null;
    for (const h of model.habitatSummaries.values()) if (h.name === name) return h;
    return null;
}

// Habitats with problems, worst first.
export function habitatsAtRisk(model) {
    if (!model) return [];
    return Array.from(model.habitatSummaries.values())
        .filter(h => h.counts.risk + h.counts.kin + h.counts.future > 0)
        .sort((x, y) => y.counts.risk - x.counts.risk || y.counts.kin - x.counts.kin || y.counts.future - x.counts.future
            || (x.name < y.name ? -1 : 1));
}

// --------------------------------------------------------- mate finder

// ------------------------------------------------- stored adults (Franchise)

// The game's EAnimalMaturity on a stored animal: 0 infant, 1 young adult,
// 2 adult, 3 elderly, 4/5/6 the same but infertile.
function storedFert(maturity) {
    const m = typeof maturity === 'number' ? maturity : 2;
    const state = m === 4 ? 'young' : m === 5 ? 'sterile' : m === 6 ? 'old' : m === 0 ? 'juvenile' : 'fertile';
    return { state, yearsLeft: null, yearsToMature: null, elderly: m === 3 || m === 6, forLife: false };
}

// The player's stored adults of one species, as Lua sends them
// (Kin.StoredAdults: PZ2QoL_KinStored). They are never put in model.animals
// (the board, programme, Thin out, badges and alerts all loop over that);
// only the mate finder looks at them, through withStored().
// -> { species, animals, anc, error, capped }
export function normalizeStored(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const animals = asArray(r.animals).filter(a => a && known(a.guid)).map(a => {
        const maturity = typeof a.maturity === 'number' ? a.maturity : null;
        const g = a.grades && typeof a.grades === 'object' ? a.grades : null;
        return {
            id: a.id != null ? String(a.id) : 's' + a.guid,
            key: a.id != null ? String(a.id) : 's' + a.guid,
            guid: String(a.guid),
            name: a.name != null && a.name !== '' ? String(a.name) : '?',
            species: a.species != null ? String(a.species) : String(r.species || ''),
            sex: typeof a.sex === 'number' ? a.sex : Sex.Unisex,
            juv: maturity === 0,
            // the game reports no contraception for stored animals (type 2)
            contra: false,
            infertile: maturity != null && maturity >= 4,
            preg: false,
            alive: true,
            hab: '',
            loc: 'Animal Storage',
            exhibit: false,
            lt: 'storage',
            moving: false,
            stored: true,
            maturity,
            forSale: a.forSale === true,
            rating: a.rating != null ? String(a.rating) : null,
            par: asArray(a.par).filter(known).map(String),
            mates: [],
            bond: null,
            genes: a.genes && typeof a.genes === 'object' ? a.genes : null,
            grades: g,
            fert: storedFert(maturity),
        };
    });
    const anc = {};
    if (r.anc && typeof r.anc === 'object') {
        for (const g in r.anc) if (known(g)) anc[String(g)] = asArray(r.anc[g]).filter(known).map(String);
    }
    return {
        species: r.species != null ? String(r.species) : '',
        animals,
        anc,
        error: r.error ? String(r.error) : null,
        capped: r.capped === true,
        time: typeof r.time === 'number' ? r.time : 0,
    };
}

// A read-only view of the model that also knows the stored adults: a
// pedigree over park + stored animals (park data wins), `stored` (id ->
// animal) and a merged `byGuid`. model.animals is unchanged. Cached per
// model and stored answer.
const storedViews = new WeakMap();
export function withStored(model, stored) {
    if (!model || !stored || !stored.animals || !stored.animals.length) return model;
    let per = storedViews.get(model);
    if (!per) storedViews.set(model, per = new WeakMap());
    const hit = per.get(stored);
    if (hit) return hit;
    const snap = model.snapshot || { anc: {}, names: {}, animals: Array.from(model.animals.values()) };
    const parkGuids = new Set();
    for (const a of snap.animals) if (a.guid) parkGuids.add(a.guid);
    const extra = stored.animals.filter(a => !parkGuids.has(a.guid));
    const ped = new Pedigree({
        anc: Object.assign({}, stored.anc, snap.anc),
        names: snap.names || {},
        animals: snap.animals.concat(extra),
    });
    const view = Object.assign({}, model, {
        ped,
        byGuid: ped.byGuid,
        stored: new Map(extra.map(a => [a.id, a])),
        storedInfo: stored,
    });
    per.set(stored, view);
    return view;
}

// Every possible mate for `id` in the zoo: same species, compatible sex,
// alive, not itself. Ranked: safest relation first, then the best expected
// offspring genes. { animal, rel, kinship, game, pred, score, sameHabitat }
// With `stored` (normalizeStored), the player's stored adults count too
// (stored: true); on a tie a park animal comes first.
export function mateCandidates(model, id, { includeJuveniles = false, stored = null } = {}) {
    const self = model && model.animals.get(String(id));
    if (!self) return [];
    const out = [];
    const view = stored ? withStored(model, stored) : model;
    const pool = view.stored ? Array.from(model.animals.values()).concat(Array.from(view.stored.values())) : model.animals.values();
    for (const other of pool) {
        if (other === self || other.species !== self.species || !other.alive) continue;
        if (!compatibleSexes(self, other)) continue;
        if (other.juv && !includeJuveniles) continue;
        const rel = self.guid && other.guid ? view.ped.relation(self.guid, other.guid) : null;
        const kinship = rel ? rel.kinship : 0;
        const game = rel ? rel.game : false;
        const tier = kinTier(model, rel);
        const pred = predictOffspring(self.genes, other.genes);
        out.push({
            animal: other,
            rel,
            kinship,
            game,
            tier: !tier || (tier === 'distant' && !(kinship > 0)) ? 'none' : tier,
            pred,
            score: offspringScore(pred),
            sameHabitat: !!self.hab && self.hab === other.hab,
            // 'now' | 'later' (young) | 'never' (too old or infertile)
            breeds: fertileNow(other) ? 'now' : notYet(other) ? 'later' : 'never',
            // in the player's Animal Storage (only with `stored`)
            ...(other.stored ? { stored: true } : {}),
        });
    }
    const tierRank = { none: 0, distant: 1, close: 2, game: 3 };
    const breedRank = { now: 0, later: 1, never: 2 };
    out.sort((p, q) => tierRank[p.tier] - tierRank[q.tier]
        || breedRank[p.breeds] - breedRank[q.breeds]
        || (q.score ?? -1) - (p.score ?? -1)
        || (q.sameHabitat - p.sameHabitat)
        || (!!p.stored - !!q.stored)
        || (p.animal.name < q.animal.name ? -1 : 1));
    return out;
}

// --------------------------------------------------------------- alerts

// Pairs that are at risk now and were not at risk before (or did not
// exist). With `includeKin`, close-kin pairs count too.
export function newRisks(prev, next, { includeKin = false, muted = null } = {}) {
    if (!next) return [];
    const watched = s => s === 'risk' || (includeKin && s === 'kin');
    // by pair, not by habitat: a pair that moves together is not new
    const before = new Map();
    const heldBefore = new Map();
    if (prev) {
        for (const p of prev.pairs) {
            if (!watched(before.get(p.key))) before.set(p.key, p.severity);
            if (p.severity === 'held') heldBefore.set(p.key, p);
        }
    }
    // a held pair whose hold went away without its bond ending: the bond
    // pass failed this scan, or the player turned the bond switch off
    const noBondNews = !!prev && ((next.snapshot && next.snapshot.bondsOk === false && prev.snapshot && prev.snapshot.bondsOk === true)
        || (prev.bondHolds !== undefined && next.bondHolds !== undefined && prev.bondHolds !== next.bondHolds));
    const out = [];
    for (const p of next.pairs) {
        if (!watched(p.severity)) continue;
        if (muted && muted.has(p.species)) continue; // the player muted this species' alerts
        const was = before.get(p.key);
        if (watched(was)) continue;
        if (was === 'held' && noBondNews) continue;
        if (was === 'held') {
            // the bond still looks whole (same mate, alive, with it): the
            // game's lock was just not reported this scan. Not news.
            const h = heldBefore.get(p.key).held;
            const by = next.animals.get(h.by.id);
            if (bondIntact(by, next.animals.get(h.mate.id))) continue;
            p.bondEnded = true;
        }
        out.push(p);
    }
    return out;
}

// Pair counts like model.counts, without the species in `muted` (a Set):
// what the alerts talk about. Badges and panels keep model.counts.
export function countsExcluding(model, muted) {
    const counts = { risk: 0, kin: 0, future: 0, held: 0, covered: 0, distant: 0 };
    if (!model) return counts;
    for (const p of model.pairs) {
        if (muted && muted.has(p.species)) continue;
        counts[p.severity] = (counts[p.severity] || 0) + 1;
    }
    return counts;
}

// Habitats with inbreeding risks among species not in `muted`, most first:
// [{ id, name, risk }].
export function riskHabitatsExcluding(model, muted) {
    if (!model) return [];
    const by = new Map();
    for (const p of model.pairs) {
        if (p.severity !== 'risk' || (muted && muted.has(p.species))) continue;
        let e = by.get(p.hab);
        if (!e) {
            const h = model.habitats.get(p.hab);
            by.set(p.hab, e = { id: p.hab, name: (h && h.name) || p.hab, risk: 0 });
        }
        e.risk++;
    }
    return Array.from(by.values()).sort((x, y) => y.risk - x.risk || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

// ------------------------------------------------------- storage (hub)

// All relatives of one animal among the given set.
export function relativesOf(model, id, pool) {
    const self = model && model.animals.get(String(id));
    if (!self || !self.guid) return [];
    const out = [];
    for (const other of pool || model.animals.values()) {
        if (other === self || !other.guid) continue;
        const rel = model.ped.relation(self.guid, other.guid);
        if (!rel) continue;
        out.push({ animal: other, rel, tier: kinTier(model, rel), kinship: rel.kinship });
    }
    return out.sort((p, q) => (q.tier === 'game') - (p.tier === 'game') || q.kinship - p.kinship);
}

// Locate needs the animal out in the park: in a habitat, not an exhibit
// animal (the Lua side refuses those and anything without a transform).
export function canLocate(a) {
    return !!(a && a.hab && !a.exhibit && !/^x/.test(String(a.id)));
}

export { canBreedNow, isCovered, compatibleSexes, notYet };
