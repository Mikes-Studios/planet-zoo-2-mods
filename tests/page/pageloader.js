// Lets Node import the mod's page modules (hooks: pagehooks.js). A '/js/...'
// import is the repo's file under UI/UIGameface/js, else the stand-in at the
// same path under tests/stubs, else a stub exporting the names its importer
// asks for. stubs: mod modules ('kinhooks.js', under js/mods/pz2qol) the test
// wants as their stand-ins under tests/stubs/mods/pz2qol instead.
import { register } from 'node:module';

export function loadPages({ stubs = [] } = {}) {
    register('./pagehooks.js', import.meta.url, { data: { stubs } });
}
