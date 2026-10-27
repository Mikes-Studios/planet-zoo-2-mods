// Module hooks for pageloader.js.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const JS_ROOT = new URL('../../mods/PZ2QoL/UI/UIGameface/js/', import.meta.url);
const STUB_ROOT = new URL('./stubs/', import.meta.url);
const MOD_PREFIX = 'mods/pz2qol/';
const STUB = 'gamestub:';

let stubbedModules = new Set();

export function initialize({ stubs = [] } = {}) {
    stubbedModules = new Set(stubs);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importedNames(parentURL, specifier) {
    const source = readFileSync(fileURLToPath(parentURL), 'utf8');
    const names = new Set();
    const pattern = new RegExp(`import\\s+([^;]*?)\\s+from\\s+['"]${escapeRegExp(specifier)}['"]`, 'g');
    for (const match of source.matchAll(pattern)) {
        const clause = match[1].trim();
        const braces = clause.match(/\{([^}]*)\}/);
        if (braces) {
            for (const part of braces[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0].trim();
                if (name) names.add(name);
            }
        }
        if (/^[A-Za-z_$]/.test(clause)) names.add('default');
    }
    return Array.from(names);
}

export async function resolve(specifier, context, next) {
    if (!specifier.startsWith('/js/')) return next(specifier, context);
    const path = specifier.slice('/js/'.length);
    const stub = new URL(path, STUB_ROOT);
    if (path.startsWith(MOD_PREFIX) && stubbedModules.has(path.slice(MOD_PREFIX.length))) {
        if (!existsSync(stub)) throw new Error(`The test asks for a stand-in of ${specifier}, but there is none: add tests/stubs/${path}`);
        return { url: stub.href, shortCircuit: true };
    }
    const own = new URL(path, JS_ROOT);
    if (existsSync(own)) return { url: own.href, shortCircuit: true };
    if (existsSync(stub)) return { url: stub.href, shortCircuit: true };
    const names = context.parentURL ? importedNames(context.parentURL, specifier) : [];
    return { url: `${STUB}${specifier}?${names.join(',')}`, shortCircuit: true };
}

export async function load(url, context, next) {
    if (!url.startsWith(STUB)) return next(url, context);
    const names = (url.split('?')[1] || '').split(',').filter(Boolean);
    const lines = ["const stub = new Proxy(function () { return stub; }, { get: (target, key) => (key === Symbol.toPrimitive ? () => '' : stub) });"];
    for (const name of names) lines.push(name === 'default' ? 'export default stub;' : `export const ${name} = stub;`);
    return { format: 'module', source: lines.join('\n'), shortCircuit: true };
}
