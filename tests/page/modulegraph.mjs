// a /js/ path is the mod's file when the mod ships one (its own modules and its overrides), else the game's
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [modRoot, gameRoot, ...entries] = process.argv.slice(2);
const context = vm.createContext({});
const modules = new Map();
const failures = [];

function resolveSpecifier(specifier, fromPath) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) return resolve(dirname(fromPath), specifier);
    if (!specifier.startsWith('/js/')) return null;
    const modFile = join(modRoot, specifier);
    return existsSync(modFile) ? modFile : join(gameRoot, specifier);
}

function load(path) {
    if (!modules.has(path)) {
        const source = existsSync(path) ? readFileSync(path, 'utf8') : null;
        modules.set(path, source === null ? null : new vm.SourceTextModule(source, { identifier: path, context }));
    }
    return modules.get(path);
}

function shown(path) {
    return path.startsWith(modRoot) ? relative(modRoot, path) : `<game>/${relative(gameRoot, path)}`;
}

for (const entry of entries) {
    const module = load(entry);
    if (module.status !== 'unlinked') continue;
    try {
        await module.link((specifier, referencing) => {
            const target = resolveSpecifier(specifier, referencing.identifier);
            const linked = target && load(target);
            if (!linked) throw new Error(`${shown(referencing.identifier)} imports '${specifier}', which is neither in the mod nor in the game's UI`);
            return linked;
        });
    } catch (error) {
        failures.push(`${shown(entry)}: ${error.message}`);
        modules.clear();
    }
}
process.stdout.write(JSON.stringify(failures));
