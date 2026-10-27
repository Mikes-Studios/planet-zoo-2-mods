import { test } from 'node:test';
import fc from 'fast-check';
import { buildWorld, worldArb } from './sim/gen.js';
import { lifeArb, liveYears } from './sim/life.js';
import { autoPass } from './sim/world.js';
import { RULES } from './sim/rules.js';

const report = broken => broken.map(v => `${v.year != null ? `year ${v.year} ` : ''}${v.species} ${v.rule}: ${v.text}`).join('\n');

// zoos that broke a rule once (tools/sim.mjs), kept so they stay fixed
const CASES = {
    // a breeder held at the trade centre to leave set the standard: the only usable male counted as weak
    leavingSetsTheStandard: '{"habs":2,"species":1,"assign":[0,0,0,0],"assigned":false,"sandbox":false,"sexMax":null,"thin":false,"trade":true,"level":{"fi":1,"sl":0},"animals":[{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":3,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":31,"preg":true,"contra":true,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":3,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":31,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true}],"stored":[]}',
    // a cooled female kept beside a weak male: the run sent him away and asked for partners the zoo had
    lockOutlivesItsPartner: '{"habs":2,"species":1,"assign":[0,0,0,0],"assigned":false,"sandbox":false,"sexMax":null,"thin":false,"trade":false,"level":{"fi":1,"sl":0},"animals":[{"sp":0,"sex":1,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":false,"contra":false,"hands":false,"lock":"cooled","leaving":true},{"sp":0,"sex":0,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":3,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true}],"stored":[]}',
    // a daughter sent out from her contracepted father: the pair-every-habitat step put her back beside him
    pairBesideKin: '{"habs":1,"species":1,"assign":[0,0,0,0],"assigned":false,"sandbox":false,"sexMax":null,"thin":false,"level":{"fi":2,"sl":1},"trade":false,"animals":[{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":4,"preg":false,"contra":false,"hands":false,"lock":"none","leaving":true}],"stored":[]}',
    // a weak daughter beside her father in a habitat not set aside for the species: never moved
    weakBesideKinElsewhere: '{"habs":2,"species":1,"assign":[3,0,0,0],"assigned":true,"sandbox":false,"sexMax":null,"thin":false,"level":{"fi":2,"sl":1},"trade":false,"animals":[{"sp":0,"sex":0,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":0,"preg":false,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":1,"stage":"prime","fi":3,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true}],"stored":[]}',
    // the last male sent away (and held back by Auto mode) while the females moved as if he left
    lastBreederHeld: '{"habs":3,"species":1,"assign":[1,3,0,0],"assigned":false,"sandbox":false,"sexMax":null,"thin":false,"level":{"fi":2,"sl":1},"trade":false,"animals":[{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":4,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":0,"sl":0,"mum":14,"dad":null,"preg":true,"contra":false,"hands":false,"lock":"manual","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":0,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":1,"stage":"prime","fi":0,"sl":0,"mum":14,"dad":null,"preg":false,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":4,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":false,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":2,"stage":"prime","fi":0,"sl":0,"mum":7,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":4,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":4,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":true,"hands":true,"lock":"none","leaving":true}],"stored":[]}',
    // the only free female paired with the weaker of two lone males, the habitat first in line
    pairTheBestHabitat: '{"habs":4,"species":1,"assign":[0,0,0,0],"assigned":false,"sandbox":false,"sexMax":null,"thin":false,"level":{"fi":2,"sl":1},"trade":false,"animals":[{"sp":0,"sex":0,"place":4,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":1,"stage":"prime","fi":1,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":2,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":false,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":0,"place":4,"stage":"prime","fi":0,"sl":1,"mum":null,"dad":null,"preg":true,"contra":false,"hands":false,"lock":"none","leaving":true},{"sp":0,"sex":1,"place":1,"stage":"prime","fi":0,"sl":0,"mum":null,"dad":null,"preg":true,"contra":false,"hands":true,"lock":"none","leaving":true}],"stored":[]}',
};

for (const [name, json] of Object.entries(CASES)) {
    test(`rules: ${name}`, () => {
        const broken = autoPass(buildWorld(JSON.parse(json)), { only: RULES });
        if (broken.length) throw new Error(report(broken));
    });
}

test('rules: Auto mode keeps the breeding rules on 300 random zoos', () => {
    fc.assert(fc.property(worldArb, desc => {
        const broken = autoPass(buildWorld(desc), { only: RULES });
        if (broken.length) throw new Error(report(broken));
    }), { seed: 1, numRuns: 300 });
});

test('rules: and over 40 random park lives', () => {
    fc.assert(fc.property(lifeArb, life => {
        const broken = liveYears(life).filter(v => RULES.includes(v.rule));
        if (broken.length) throw new Error(report(broken));
    }), { seed: 1, numRuns: 40 });
});
