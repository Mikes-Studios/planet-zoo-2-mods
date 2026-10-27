// Node module hooks for tests: resolves the game UI's absolute imports
// ('/js/...') to the mod's files. A '?query' on the importing module is
// passed on to its '/js/' imports, so importing a module with a new query
// gives a fresh copy of it and everything it imports (a "restart"). A game
// module the mod imports is page/pagehooks.js's stand-in.
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { load, resolve as resolveGameModule } from './page/pagehooks.js';

export { load };

const JS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mods', 'PZ2QoL', 'UI', 'UIGameface', 'js');

export async function resolve(specifier, context, next) {
    if (specifier.startsWith('/js/')) {
        if (!existsSync(path.join(JS_ROOT, specifier.slice(4)))) return resolveGameModule(specifier, context, next);
        const query = context.parentURL ? new URL(context.parentURL).search : '';
        return { url: pathToFileURL(path.join(JS_ROOT, specifier.slice(4))).href + query, shortCircuit: true };
    }
    if (specifier.startsWith('./') && context.parentURL && context.parentURL.includes('/UIGameface/js/')) {
        const query = new URL(context.parentURL).search;
        return { url: new URL(specifier, context.parentURL).href.split('?')[0] + query, shortCircuit: true };
    }
    return next(specifier, context);
}
