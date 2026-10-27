// The player's own PZ2QoL data that must outlast the game session (habitat
// assignments...), one set per zoo. Gameface keeps localStorage in memory
// only, and the game's file calls are retail stubs, so the Lua side keeps
// the data on this device in the game's player save (the mod's own PZ2QoL
// entry, keyed by zoo), in every zoo, Franchise included: that save is not
// the zoo's online save (PZ2QoL_StoreLoad / PZ2QoL_StoreSave;
// PZ2QoL_StoreReset when the zoo's data can be read, or a park starts or ends).
//
// localStorage stays a mirror for the session, and the fallback when the
// store cannot be used (status 'memory', reason from the Lua side; 'wait'
// means the zoo or the player profile is not known yet, and a
// PZ2QoL_StoreReset follows). The store is the truth once read: changes
// made before that are kept as operations and applied again on top of it.
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { asciiJson, readMirror as readMirrorKey, writeMirror as writeMirrorKey, parseStored, replayChanges, callAll } from '/js/mods/pz2qol/storecore.js';

export { asciiJson };

const MIRROR_KEY = 'PZ2QoL.userdata.v1';
const ANSWER_TIMEOUT_MS = 6000;
const SAVE_DELAY_MS = 400;

let data = readMirror();
let status = 'loading'; // 'loading' | 'file' (kept on this device) | 'memory'
let reason = ''; // why 'memory': wait | noplayer | nopark | failed | nolua
let installed = false;
let reqSeq = 0;
let loadReq = null;
let loadParts = [];
let loadTimer = null;
let saveTimer = null;
let reloadTimer = null; // set while a read of the store waits for the saves in flight
let pending = []; // [key, fn] changes not in the file yet, replayed on top of its next read
const savesInFlight = new Map(); // save request id -> the pending changes it carries
let epoch = 0; // counts reads of the store: a new zoo load gives a new one
const listeners = new Set();

function readMirror() {
    return readMirrorKey(MIRROR_KEY);
}

function writeMirror() {
    writeMirrorKey(MIRROR_KEY, data);
}

function notify() {
    callAll(listeners, status);
}

function setStatus(s) {
    if (status === s) return false;
    status = s;
    breadcrumb('store_' + s);
    notify();
    return true;
}

function finishLoad(ok, text) {
    clearTimeout(loadTimer);
    loadReq = null;
    epoch++;
    if (!ok) {
        reason = String(text || 'nopark');
        // a load tells the listeners once, also when the status stays
        if (!setStatus('memory')) notify();
        return;
    }
    reason = '';
    let fromFile = {};
    try {
        fromFile = parseStored(text);
    }
    catch (e) {
        reportError('mod', 'PZ2QoL park data could not be read; starting from this session\'s data', e, { silent: true });
    }
    // the store is this zoo's truth: what the session held before (another
    // zoo's data, a mirror) is not carried over, only this view's changes
    const needSave = pending.length > 0;
    // this session's changes, again on top of the file
    data = replayChanges(fromFile, pending);
    writeMirror();
    if (!setStatus('file')) notify();
    if (needSave) scheduleSave(0);
}

function install() {
    if (installed || typeof engine === 'undefined') return;
    installed = true;
    engine.on('PZ2QoL_StoreData', (reqId, ok, i, n, text) => {
        if (String(reqId) !== loadReq) return;
        if (ok !== true) return finishLoad(false, text);
        loadParts[Number(i) - 1] = String(text || '');
        const parts = Number(n) || 1;
        let have = 0;
        for (let k = 0; k < parts; k++) if (typeof loadParts[k] === 'string') have++;
        if (have >= parts) finishLoad(true, loadParts.slice(0, parts).join(''));
    });
    engine.on('PZ2QoL_StoreSaved', (reqId, ok) => {
        const carried = savesInFlight.get(String(reqId));
        // a save sent as its park ended answers for a zoo the view has left
        if (!carried) return;
        savesInFlight.delete(String(reqId));
        if (ok === true) {
            pending = pending.filter(change => !carried.includes(change));
        }
        else {
            reportError('mod', 'PZ2QoL could not keep its data; changes last until the game closes', 'PZ2QoL_StoreSave', { silent: true });
            reason = reason || 'failed';
            setStatus('memory');
        }
        if (reloadTimer && savesInFlight.size === 0) reloadNow();
    });
    // the Lua side (re)connected: read the store if we could not before
    engine.on('PZ2QoL_Hello', () => {
        if (status === 'file') return;
        reloadWhenSaved();
    });
    // a park started or ended, or its save was loaded: read the store again
    engine.on('PZ2QoL_StoreReset', why => {
        const saveWaiting = saveTimer !== null;
        clearTimeout(saveTimer);
        saveTimer = null;
        epoch++;
        if (!why || why === 'park') {
            // Lua has cleared its zoo key, so a save cannot land: a change made in the last 400 ms of a park is lost
            pending = [];
            savesInFlight.clear();
        }
        else if (saveWaiting) {
            sendSave();
        }
        if (status === 'file') status = 'loading';
        reloadWhenSaved();
    });
}

// a read while a save is unanswered could replay a change the file already holds
function reloadWhenSaved() {
    loadReq = null; // an earlier request's answer may predate the reset
    if (savesInFlight.size === 0) return reloadNow();
    if (!reloadTimer) reloadTimer = setTimeout(reloadNow, ANSWER_TIMEOUT_MS);
}

function reloadNow() {
    clearTimeout(reloadTimer);
    reloadTimer = null;
    loadUserData();
}

// Reads the file (again). Resolves when it is read or given up on.
export function loadUserData() {
    install();
    if (typeof engine === 'undefined') {
        setStatus('memory');
        return;
    }
    if (loadReq) return;
    loadReq = 'L' + (++reqSeq);
    loadParts = [];
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
        if (loadReq) {
            loadReq = null;
            // no answer: the Lua side is not there (yet); PZ2QoL_Hello retries
            if (status === 'loading') {
                reason = 'nolua';
                setStatus('memory');
            }
        }
    }, ANSWER_TIMEOUT_MS);
    try {
        engine.trigger('PZ2QoL_StoreLoad', loadReq);
    }
    catch (e) {
        clearTimeout(loadTimer);
        loadReq = null;
        setStatus('memory');
    }
}

function scheduleSave(delay = SAVE_DELAY_MS) {
    if (status !== 'file') {
        return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(sendSave, delay);
}

function sendSave() {
    saveTimer = null;
    const reqId = 'S' + (++reqSeq);
    try {
        engine.trigger('PZ2QoL_StoreSave', reqId, asciiJson(data));
        savesInFlight.set(reqId, pending.slice());
    }
    catch (e) {
        reportError('mod', 'PZ2QoL data could not be saved', e, { silent: true });
    }
}

export function getUserData(key) {
    return data[key];
}

// fn(old value) -> new value (undefined removes it). It must give the right
// result when applied again to newer data: a change made before the file
// was read is replayed on top of the file.
export function updateUserData(key, fn) {
    const v = fn(data[key]);
    if (v === undefined) delete data[key];
    else data[key] = v;
    pending.push([key, fn]);
    writeMirror();
    scheduleSave();
}

export function setUserData(key, value) {
    updateUserData(key, () => value);
}

// 'loading' | 'file' (kept on this device) | 'memory' (until the game closes)
export function userDataStatus() {
    return status;
}

// why the status is 'memory': wait, noplayer, nopark, failed, nolua ('' otherwise)
export function userDataReason() {
    return status === 'memory' ? reason : '';
}

// Changes each time the store is read again (a park started, ended or was
// loaded): entity ids seen under an older epoch may belong to another load.
export function userDataEpoch() {
    return epoch;
}

export function onUserData(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// test hook
export function _resetUserStoreForTests(value = {}) {
    data = value;
    status = 'loading';
    reason = '';
    pending = [];
    savesInFlight.clear();
    clearTimeout(saveTimer);
    saveTimer = null;
    clearTimeout(reloadTimer);
    reloadTimer = null;
    loadReq = null;
    epoch++;
}
