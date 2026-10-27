// node tests/helpers/record_engines_golden.mjs  (after a deliberate change to what the engines answer)
import { writeFileSync } from 'node:fs';
import { digestAll } from './enginedigest.mjs';
writeFileSync(new URL('../fixtures/engines_golden.json', import.meta.url), JSON.stringify(digestAll()));
console.log('recorded');
