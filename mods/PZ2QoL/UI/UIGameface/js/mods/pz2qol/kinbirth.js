// Overdue births (park HUD): a mother still pregnant at twice her species'
// pregnancy gives birth once she is boxed and unboxed in place, so
// PZ2QoL.BoxRelease does Box Animal on her (PZ2QoL_Rebox) and unboxes her,
// once per pregnancy. The Kin setting overdueBox switches it on (Lua).
import { onKin } from '/js/mods/pz2qol/kin.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { overdueMothers } from '/js/mods/pz2qol/kinbirthcore.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

export function installKinBirth() {
    if (!isHudPage()) return true;
    const started = new Map();
    const boxed = new Set();
    onKin(model => {
        if (!model || !model.animals) return;
        for (const id of Array.from(boxed)) if (!started.has(id)) boxed.delete(id);
        for (const a of overdueMothers(model, started)) {
            if (boxed.has(a.id)) continue;
            boxed.add(a.id);
            try {
                engine.trigger('PZ2QoL_Rebox', String(a.id));
                dlog('kin', 'overdue_birth', { species: a.species, animal: a.name, age: a.age, since: started.get(a.id) });
            }
            catch (e) {
                reportError('ui', 'An overdue mother could not be boxed: the mod\'s Lua part did not answer.', e, { silent: true });
            }
        }
    });
    return true;
}
