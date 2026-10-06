/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R11-05: detachOpaque keeps repeated Date identity — one Date shared by a Map, a Set and many
// references detaches to one copy whose Map key still looks up — and a detached tracked plain
// key stays one copy in either property order. persist() serializes each write without ever
// calling snapshot(). Args: [copies=100]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {persist} = await loadPath('Carburetor/Tooling/persist.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }
let detachOpaque;
for (const path of ['Carburetor/Store/Utils/Selection/detachOpaque.mjs', 'Carburetor/Store/Utils/detachOpaque.mjs']) {
    try {
        detachOpaque = (await loadPath(path)).detachOpaque;
        break;
    } catch {
        // older builds keep the module one directory higher
    }
}
if (!detachOpaque) {
    throw new Error('detachOpaque not found in the build under test');
}

const copies = Number(process.argv[2] ?? 100);
const REFS = 500;

// One Date as Map key and value, Set member and many references: one detached copy.
const date = new Date(1000);
const dateSource = {
    key: date,
    index: new Map([[date, date]]),
    set: new Set([date]),
    references: Array.from({length: REFS}, () => date),
};
let distinctDates = 0;
let dateLookups = 0;
const dateTimes = [];
global.gc?.();
for (let i = 0; i < copies; i++) {
    const start = performance.now();
    const copy = detachOpaque(dateSource);
    dateTimes.push(performance.now() - start);
    distinctDates += new Set([
        copy.key, ...copy.index.keys(), ...copy.index.values(), ...copy.set, ...copy.references,
    ]).size;
    if (copy.index.get(copy.key) === copy.key) {
        dateLookups++;
    }
}
const dateCopyMs = median(dateTimes);

// A tracked plain key used as Map key and many references: one copy in either order — the
// detached key still looks up and mutating it leaves the source alone.
const trackedKeyCopies = mapFirst => {
    const key = {id: 1};
    const store = new S({key, index: new Map()});
    store.run(draft => { draft.index.set(draft.key, draft.key); });
    const view = store.read(() => undefined);
    const references = Array.from({length: REFS}, () => view.key);
    const source = mapFirst
        ? {index: view.index, key: view.key, references}
        : {key: view.key, index: view.index, references};
    let keyCopies = 0;
    let lookups = 0;
    let isolated = true;
    for (let i = 0; i < copies; i++) {
        const copy = detachOpaque(source);
        keyCopies += new Set([
            copy.key, ...copy.index.keys(), ...copy.index.values(), ...copy.references,
        ]).size;
        if (copy.index.get(copy.key) === copy.key) {
            lookups++;
        }
        copy.key.id = 99;
        isolated &&= store.getData().key.id === 1;
    }
    return {keyCopies, lookups, isolated};
};
const keyFirst = trackedKeyCopies(false);
const mapFirst = trackedKeyCopies(true);

// persist(): one serialized write per store write, snapshot() never called.
class Bench extends S {
    /** Publishes one counter write. */
    setCounter(value) { this.update(draft => { draft.counter = value; }); }
}
const persistStore = new Bench({counter: 0, rows: Array.from({length: 2500}, (_, id) => ({id, title: `row-${id}`}))});
let snapshots = 0;
const originalSnapshot = persistStore.snapshot.bind(persistStore);
persistStore.snapshot = () => {
    snapshots++;
    return originalSnapshot();
};
let persistWrites = 0;
let persistChars = 0;
const storage = {
    getItem: () => null,
    setItem: (_key, value) => { persistWrites++; persistChars += value.length; },
    removeItem: () => undefined,
};
const stop = persist(persistStore, {key: 'perf-date-aliases', storage, coalesce: false});
for (let i = 1; i <= 100; i++) persistStore.setCounter(i);
stop();
emit({
    distinctDates, dateLookups, dateCopyMs,
    keyFirstCopies: keyFirst.keyCopies, keyFirstLookups: keyFirst.lookups,
    mapFirstCopies: mapFirst.keyCopies, mapFirstLookups: mapFirst.lookups,
    detachedKeyIsolated: keyFirst.isolated && mapFirst.isolated,
    persistWrites, persistSnapshots: snapshots, persistChars,
});
