// Client-side filtering and sorting of game lists (Animal Storage, and the
// zoo management Animals list).
//
// The lists are fed by DataStoreCollection instances bound to the list
// contexts; ManagementListComponent reads `collection.source`. We patch
// that getter so collections bound to a registered list return the
// filtered/sorted rows, and re-dispatch a "reset" when filters change.
import { DataStoreCollection } from '/js/common/data/DataStoreCollection.js';
import { applyStorageFilters, DEFAULT_STORAGE_FILTERS, storageFiltersActive } from '/js/mods/pz2qol/scores.js';
import { contextKey, get, readAnimal, STORAGE_LIST_KEY } from '/js/mods/pz2qol/game.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

// key -> { filter(contexts) -> contexts, active() -> bool, selectAll: {...}, selection: {...} }
const registry = new Map();
const liveCollections = new Map(); // key -> Set<collection>

// A list's select-all must only pick the rows the player can see while a
// filter is active, or a bulk action would include hidden animals.
//   selectAll: { event, matches(args) -> bool, clear(trigger), select(trigger, ctx) }
// And a row the filter hides must not stay ticked either, whatever hid it:
//   selection: { isSelected(ctx) -> bool, deselect(ctx) }
export function registerListFilter(key, spec) {
    registry.set(key, spec);
}

export function refreshList(key) {
    for (const col of liveCollections.get(key) || []) {
        try {
            col._onChange.dispatch({ target: col, changeKind: 'reset', index: -1, item: col.source, replacedItem: [] });
        }
        catch (e) {
            reportError('ui', 'List filter refresh failed', e);
        }
    }
}

// Binds the list's collections to their context afresh: the data store then
// sends the rows it holds now. A screen the game builds again under the same
// context (Management after the Zoopedia) leaves the list bound to the rows
// it had, and empty.
export function rebindList(key) {
    for (const col of Array.from(liveCollections.get(key) || [])) {
        if (!col._context) continue;
        try {
            col.bindToContext(col._context, col._sortField, col._interval);
        }
        catch (e) {
            reportError('ui', 'List rebind failed', e, { silent: true });
        }
    }
}

// How many of the game's collections show a registered list (a screen built
// again leaves its old one here until it binds elsewhere).
export function liveListCount(key) {
    return (liveCollections.get(key) || new Set()).size;
}

// Unfiltered rows (contexts) of a registered list, from any live collection.
export function getListSource(key) {
    for (const col of liveCollections.get(key) || []) {
        return col._source;
    }
    return [];
}

// the game's bulk Sell, Release and Rehome act on every ticked animal, shown or not
function untickHidden(selection, source, shown) {
    if (shown.length === source.length) return;
    const visible = new Set(shown);
    for (const ctx of source) {
        if (!visible.has(ctx) && selection.isSelected(ctx)) selection.deselect(ctx);
    }
}

function filtered(key, source) {
    const spec = registry.get(key);
    if (!spec || !spec.active() || source.length == 0) return source;
    const shown = spec.filter(source);
    if (spec.selection) untickHidden(spec.selection, source, shown);
    return shown;
}

// ------------------------------------------------------------- storage

let storageFilters = Object.assign({}, DEFAULT_STORAGE_FILTERS);
const listeners = new Set();

// Filters other modules contribute (Kin: `related`): key -> predicate(animal)
// on readAnimal() objects. Each applies while storageFilters[key] is on.
const storagePredicates = {};

export function addStorageFilter(key, predicate) {
    storagePredicates[key] = predicate;
    return () => {
        if (storagePredicates[key] === predicate) delete storagePredicates[key];
    };
}

export function getStoragePredicates() {
    return storagePredicates;
}

// The game's verdict on a storage animal where one is known (the Market
// desk's): animal -> listercore verdictOf, or null. The Sell advice chip
// sorts by it (scores.js SELL_ADVICE_WAYS).
let storageVerdictOf = null;

export function setStorageVerdicts(fn) {
    storageVerdictOf = fn;
    if (storageFilters.sellAdvice) refreshList(STORAGE_LIST_KEY);
}

export function getStorageVerdicts() {
    return storageVerdictOf;
}

export function getStorageFilters() {
    return storageFilters;
}

export function setStorageFilters(patch) {
    storageFilters = Object.assign({}, storageFilters, patch);
    breadcrumb('storage_filter');
    // Hidden rows must never stay selected for a bulk action.
    try {
        engine.trigger('AnimalStorage_SelectAllToggled', false);
    }
    catch (e) {
        reportError('ui', 'Could not clear storage selection', e);
    }
    refreshList(STORAGE_LIST_KEY);
    callAll(listeners, storageFilters);
}

export function resetStorageFilters() {
    setStorageFilters(DEFAULT_STORAGE_FILTERS);
}

export function onStorageFiltersChanged(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getStorageSource() {
    return getListSource(STORAGE_LIST_KEY);
}

registerListFilter(STORAGE_LIST_KEY, {
    active: () => storageFiltersActive(storageFilters),
    filter: source => {
        const animals = source.map(ctx => Object.assign(readAnimal(ctx), { _ctx: ctx }));
        return applyStorageFilters(animals, storageFilters, storagePredicates, storageVerdictOf).map(a => a._ctx);
    },
    selectAll: {
        matches: (name, args) => name === 'AnimalStorage_SelectAllToggled' && args[0] === true,
        clear: trigger => trigger('AnimalStorage_SelectAllToggled', false),
        select: (trigger, ctx) => {
            const id = readAnimal(ctx).id;
            if (id != undefined) trigger('AnimalStorage_ItemCheckboxToggled', id, true);
        },
    },
    selection: {
        isSelected: ctx => !!get(ctx, 'multiSelected'),
        deselect: ctx => engine.trigger('AnimalStorage_ItemCheckboxToggled', get(ctx, 'id'), false),
    },
});

// ---------------------------------------------------------------- hooks

export function installSelectAllGuard() {
    if (typeof engine === 'undefined' || engine.__pz2qolGuard) {
        return false;
    }
    engine.__pz2qolGuard = true;
    const trigger = engine.trigger.bind(engine);
    engine.trigger = function (name, ...args) {
        for (const [key, spec] of registry) {
            const sa = spec.selectAll;
            if (!sa || !sa.matches(name, args) || !spec.active()) continue;
            try {
                breadcrumb('selectall_filtered');
                const visible = filtered(key, getListSource(key));
                sa.clear(trigger);
                for (const ctx of visible) sa.select(trigger, ctx);
                return;
            }
            catch (e) {
                reportError('ui', 'Filtered select-all failed; selection cleared for safety', e);
                return sa.clear(trigger);
            }
        }
        return trigger(name, ...args);
    };
    return true;
}

export function installListFilter() {
    const proto = DataStoreCollection.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'source');
    if (!desc || !desc.get || proto.__pz2qolPatched) {
        return false;
    }
    proto.__pz2qolPatched = true;
    Object.defineProperty(proto, 'source', {
        configurable: true,
        get() {
            const source = desc.get.call(this);
            const key = this._context ? contextKey(this._context) : null;
            if (key && registry.has(key)) {
                try {
                    return filtered(key, source);
                }
                catch (e) {
                    reportError('ui', 'List filter failed', e);
                }
            }
            return source;
        },
    });
    const bind = proto.bindToContext;
    proto.bindToContext = function (context, ...rest) {
        const ret = bind.call(this, context, ...rest);
        for (const set of liveCollections.values()) set.delete(this);
        const key = context ? contextKey(context) : null;
        if (key && registry.has(key)) {
            if (!liveCollections.has(key)) liveCollections.set(key, new Set());
            liveCollections.get(key).add(this);
        }
        return ret;
    };
    return true;
}
