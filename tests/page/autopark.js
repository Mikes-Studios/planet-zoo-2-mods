// Auto mode on a test park: the Lua side's answers (the zoo's store, the
// game's gate, destinations, species facts, storage, moves) come from here,
// and the park scan is whatever the test hands loadPark().
import { triggered } from './fakepage.js';
import { HIPPO, HIPPO_INFO } from './zoo.js';

// the gate's answer (PZ2QoL_AutoGate); a test changes it: null sends none, a string is sent as is
export const gate = { value: { park: true, move: true, year: 3, month: 1, monthProp: 0, monthSec: 600, tcMax: 20, tcCount: 0 } };
// the game's answer to each move: (id, target) -> { ok, detail }
export const moves = { answer: () => ({ ok: true, detail: '' }) };

function answerLua(habitats) {
    engine.answer('PZ2QoL_StoreLoad', reqId => engine.emit('PZ2QoL_StoreData', reqId, true, 1, 1, '{}'));
    engine.answer('PZ2QoL_AutoGate', reqId => {
        if (gate.value) engine.emit('PZ2QoL_AutoGateResult', reqId, typeof gate.value === 'string' ? gate.value : JSON.stringify(gate.value));
    });
    engine.answer('PZ2QoL_KinDestinations', reqId => {
        const ok = Object.fromEntries(habitats().map(id => [id, { ok: true }]));
        engine.emit('PZ2QoL_KinDestinationsResult', reqId, JSON.stringify({ bySpecies: { [HIPPO]: ok }, habitats: habitats().map(id => ({ id, name: id })), tradeCentre: { id: 'tc' } }));
    });
    engine.answer('PZ2QoL_KinSpecies', reqId => engine.emit('PZ2QoL_KinSpeciesResult', reqId, JSON.stringify(HIPPO_INFO)));
    engine.answer('PZ2QoL_KinStored', reqId => engine.emit('PZ2QoL_KinStoredChunk', reqId, 1, 1, JSON.stringify({ species: HIPPO, animals: [] })));
    engine.answer('PZ2QoL_KinMove', (reqId, id, target) => {
        const r = moves.answer(id, target);
        engine.emit('PZ2QoL_KinMoveResult', reqId, r.ok, r.detail || '');
    });
}

// The page with Auto mode on for the hippos. -> { auto (kinauto.js), loadPark(animals) }
export async function autoPark() {
    let habitatIds = [];
    answerLua(() => habitatIds);
    const kin = await import('/js/mods/pz2qol/kin.js');
    const auto = await import('/js/mods/pz2qol/kinauto.js');
    const loadPark = animals => {
        habitatIds = [...new Set(animals.map(a => a.hab).filter(Boolean).concat(habitatIds))];
        return kin.applyKinSnapshot({ scope: 'park', animals, habitats: habitatIds.map(id => ({ id, name: id, kind: 'habitat' })), speciesFacts: {} });
    };
    auto.installAutopilot();
    return { auto, loadPark };
}

// the requests of one kind sent to the game since `from` (an index into the trigger log)
export function sentSince(from, event) {
    return triggered.slice(from).filter(call => call[0] === event);
}
