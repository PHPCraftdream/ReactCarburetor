// Paired built ESM implementations; no build is performed here.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> node --expose-gc benchmarks/state/persistenceDateAliases.mjs
// Time is wall CPU-adjacent elapsed time, not allocated bytes; semantic Date identities and
// snapshot invocations are allocation/work proxies, not heap measurements.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const baseline = process.env.BASELINE_DIST;
const after = process.env.AFTER_DIST ?? 'dist';
if (!baseline) throw new Error('Set BASELINE_DIST to the baseline built dist path');

const load = (root, relative) => import(pathToFileURL(resolve(root, relative)).href);
const roots = {baseline, fixed: after};
const modules = {};
for (const [label, root] of Object.entries(roots)) {
    const [store, persist, detach] = await Promise.all([
        load(root, 'esm/Carburetor/Store/Carburetor.mjs'),
        load(root, 'esm/Carburetor/Tooling/persist.mjs'),
        load(root, label === 'baseline' ? 'esm/Carburetor/Store/Utils/detachOpaque.mjs'
            : 'esm/Carburetor/Store/Utils/Selection/detachOpaque.mjs'),
    ]);
    modules[label] = {Carburetor: store.Carburetor, persist: persist.persist, detachOpaque: detach.detachOpaque};
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rounds = {baseline: [], fixed: []};
const stats = {};
const ROWS = 2500;
const WRITES = 100;
const REFS = 500;
const COPIES = 100;

const ordinary = ({Carburetor, persist}) => {
    class BenchStore extends Carburetor {
        /** Publishes a real counter write.
         *
         * @param value - next counter
         */
        setCounter(value) {
            this.draft.counter = value;
            this.emitUpdate();
        }
    }
    const store = new BenchStore({counter: 0, rows: Array.from({length: ROWS}, (_, id) => ({id, title: `row-${id}`}))});
    let snapshots = 0;
    const oldSnapshot = store.snapshot.bind(store);
    store.snapshot = () => { snapshots++; return oldSnapshot(); };
    let writes = 0;
    let chars = 0;
    const storage = {
        getItem: () => null,
        setItem: (_key, value) => { writes++; chars += value.length; },
        removeItem: () => undefined,
    };
    const stop = persist(store, {key: 'bench', storage});
    const start = process.hrtime.bigint();
    for (let i = 1; i <= WRITES; i++) store.setCounter(i);
    const ns = process.hrtime.bigint() - start;
    stop();
    if (writes !== WRITES) throw new Error(`Expected ${WRITES} serialized writes, got ${writes}`);
    return {ms: Number(ns) / 1e6, writes, snapshots, chars};
};

const repeatedDate = ({detachOpaque}) => {
    const date = new Date(1000);
    const source = {
        key: date,
        index: new Map([[date, date]]),
        set: new Set([date]),
        references: Array.from({length: REFS}, () => date),
    };
    let distinct = 0;
    let successfulLookups = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < COPIES; i++) {
        const copy = detachOpaque(source);
        const copies = new Set([
            copy.key, ...copy.index.keys(), ...copy.index.values(), ...copy.set, ...copy.references,
        ]);
        distinct += copies.size;
        if (copy.index.get(copy.key) === copy.key) successfulLookups++;
    }
    return {ms: Number(process.hrtime.bigint() - start) / 1e6, distinct, successfulLookups,
        references: (REFS + 4) * COPIES};
};

const repeatedTrackedKey = ({Carburetor, detachOpaque}, mapFirst) => {
    const key = {id: 1};
    const store = new Carburetor({key, index: new Map([[key, key]])});
    const view = store.read(() => undefined);
    const selectedKey = view.key;
    const references = Array.from({length: REFS}, () => selectedKey);
    const source = mapFirst
        ? {index: view.index, key: selectedKey, references}
        : {key: selectedKey, index: view.index, references};
    let distinct = 0;
    let successfulLookups = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < COPIES; i++) {
        const copy = detachOpaque(source);
        distinct += new Set([copy.key, ...copy.index.keys(), ...copy.index.values(), ...copy.references]).size;
        if (copy.index.get(copy.key) === copy.key) successfulLookups++;
        copy.key.id = 99;
        if (store.getData().key.id !== 1) throw new Error('Detached tracked key mutated source');
    }
    return {ms: Number(process.hrtime.bigint() - start) / 1e6, distinct, successfulLookups,
        references: (REFS + 3) * COPIES};
};

for (let round = 0; round < 7; round++) {
    for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
        global.gc?.();
        ordinary(modules[label]); // warm JIT + storage subscription outside timed sample
        repeatedDate(modules[label]);
        repeatedTrackedKey(modules[label], false);
        repeatedTrackedKey(modules[label], true);
        global.gc?.();
        const serialization = ordinary(modules[label]);
        const detachment = repeatedDate(modules[label]);
        const keyFirst = repeatedTrackedKey(modules[label], false);
        const mapFirst = repeatedTrackedKey(modules[label], true);
        if (round > 0) rounds[label].push({serialization, detachment, keyFirst, mapFirst});
    }
}
for (const label of ['baseline', 'fixed']) {
    const samples = rounds[label];
    stats[label] = {
        serialization: {
            medianMs: median(samples.map(x => x.serialization.ms)),
            writes: samples[0].serialization.writes,
            snapshots: samples[0].serialization.snapshots,
            chars: samples[0].serialization.chars,
        },
        detachment: {
            medianMs: median(samples.map(x => x.detachment.ms)),
            distinctDateCopies: samples[0].detachment.distinct,
            internalMapLookups: samples[0].detachment.successfulLookups,
            references: samples[0].detachment.references,
        },
    };
    for (const order of ['keyFirst', 'mapFirst']) {
        stats[label][order] = {
            medianMs: median(samples.map(x => x[order].ms)),
            distinctPlainKeyCopies: samples[0][order].distinct,
            internalMapLookups: samples[0][order].successfulLookups,
            references: samples[0][order].references,
        };
    }
}
console.log(JSON.stringify({rows: ROWS, storeWrites: WRITES, graphCopies: COPIES, runs: 6, stats}, null, 2));
