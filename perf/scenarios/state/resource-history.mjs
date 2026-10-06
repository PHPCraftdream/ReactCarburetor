/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History mechanism: ordinary draft writes stay patch-based (one baseline capture), actual
// ResourceCarburetor loads record every pending/settled transition, a populated cache
// replacement walks no owned endpoints, and native aliases survive undo/redo.
// Args: [writes=128] [samples=7]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');
const {ResourceCarburetor} = await loadPath('Carburetor/Resource/ResourceCarburetor.mjs');
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }

const writes = Number(process.argv[2] ?? 128);
const samples = Number(process.argv[3] ?? 7);
const rows = Array.from({length: 128}, (_, index) => ({id: index, title: 'row-' + index}));

// Counts capture calls without replacing the wire projection.
const observeCaptures = store => {
    const capture = store.captureHistory;
    store.snapshots = 0;
    store.captureHistory = function (own) {
        this.snapshots++;
        return capture.call(this, own);
    };
};

// Ordinary draft writes: patch-based history stays patch-based.
class CounterStore extends S {
    change(value) { this.update(draft => { draft.count = value; }); }
}
const ordinaryTimes = [];
let ordinarySnapshots = 0;
let ordinaryOk = true;
for (let round = 0; round < samples; round++) {
    const store = new CounterStore({count: 0, rows});
    observeCaptures(store);
    const history = new CarburetorHistory(store);
    const start = performance.now();
    for (let n = 1; n <= writes; n++) {
        store.change(n);
    }
    ordinaryTimes.push(performance.now() - start);
    ordinarySnapshots = store.snapshots;
    ordinaryOk &&= store.getData().count === writes && history.canUndo();
    history.disconnect();
}

// Actual resource loads: 64 sequential loads, each recording its pending and settled endpoint.
const resourceLoads = 64;
const resourceTimes = [];
let resourceSnapshots = 0;
let resourceOk = true;
for (let round = 0; round < samples; round++) {
    const resource = new ResourceCarburetor(async key => ({key, rows}));
    observeCaptures(resource);
    const history = new CarburetorHistory(resource);
    const start = performance.now();
    for (let n = 0; n < resourceLoads; n++) {
        await resource.load(String(n));
    }
    resourceTimes.push(performance.now() - start);
    resourceSnapshots = resource.snapshots;
    resourceOk &&= resource.getData().data.key === String(resourceLoads - 1) && history.canUndo();
    history.disconnect();
}

// Replacing one entry of a populated cache: no Object.keys walk over owned endpoints.
const cacheTimes = [];
let rootVisits = 0;
let dictionaryVisits = 0;
let entryVisits = 0;
let cacheOk = true;
for (let round = 0; round < samples; round++) {
    const cache = new ResourceCache(async key => key);
    const capture = cache.captureHistory;
    const roots = new WeakSet();
    const dictionaries = new WeakSet();
    const bodies = new WeakSet();
    cache.captureHistory = function (own) {
        return capture.call(this, value => {
            const state = own(value);
            roots.add(state);
            dictionaries.add(state.entries);
            for (const entry of Object.values(state.entries)) {
                bodies.add(entry);
            }
            return state;
        });
    };
    const history = new CarburetorHistory(cache);
    for (let n = 0; n < 8; n++) {
        await cache.load(n);
    }
    const key = cache.keyOf(0);
    const entries = cache.getData().entries;
    const replacement = {entries: {...entries, [key]: {...entries[key], data: 17}}};
    const originalKeys = Object.keys;
    Object.keys = function (value) {
        if (roots.has(value)) {
            rootVisits++;
        }
        if (dictionaries.has(value)) {
            dictionaryVisits++;
        }
        if (bodies.has(value)) {
            entryVisits++;
        }
        return originalKeys(value);
    };
    try {
        const start = performance.now();
        cache.setData(replacement);
        cacheTimes.push(performance.now() - start);
    } finally {
        Object.keys = originalKeys;
    }
    cacheOk &&= cache.getData().entries[key].data === 17 && history.undo()
        && cache.getData().entries[key].data === 0 && history.redo()
        && cache.getData().entries[key].data === 17;
    history.disconnect();
}

// A mixed native graph captured once: undo/redo keep the key alias and the root backlink.
const key = {id: 'key'};
const state = {key, rows: rows.map(row => ({...row})), last: new Map()};
state.last.set(key, 1);
state.last.set('root', state);
const mixed = new S(state);
const mixedHistory = new CarburetorHistory(mixed);
const mixedStart = performance.now();
new CarburetorHistory(mixed).disconnect();
const mixedMs = performance.now() - mixedStart;
mixed.run(draft => { draft.last.set(draft.key, 2); });
const undoOk = mixedHistory.undo() && mixed.getData().last.get(mixed.getData().key) === 1;
const redoOk = mixedHistory.redo() && mixed.getData().last.get(mixed.getData().key) === 2
    && mixed.getData().last.get('root') === mixed.getData();
mixedHistory.disconnect();
emit({
    ordinaryMs: median(ordinaryTimes), ordinarySnapshots, ordinaryOk,
    loadMs: median(resourceTimes), resourceLoads, resourceSnapshots, resourceOk,
    replaceMs: median(cacheTimes), rootVisits, dictionaryVisits, entryVisits, cacheOk,
    mixedMs, undoOk, redoOk,
});
