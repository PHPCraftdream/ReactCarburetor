// Measures what useCarburetor's read-tracking proxy costs per render, by store shape.
// Runs against the built ESM output, so it measures shipped code:
//   npm run build && node benchmarks/useCarburetorProxy.mjs
// Kept out of the test suite on purpose — the rstest run must stay fast.
//
// Why carburetor.read() and not a rendered component: a render's useCarburetor call is
// track() — a record swap plus a fresh reads Set — followed by carburetor.read(recorder),
// and read() is where every proxy lives. Measuring read() through the store's public API
// isolates the proxy machinery without dragging React into the loop; the fresh Set and
// recorder closure per iteration mirror what track() hands each render.
//
// The shapes separate the three suspects: shallow asks whether the root proxy alone costs
// anything, deep asks whether one nested proxy per level compounds with depth, wide asks
// whether having many keys matters or only the keys actually read. "create" rows isolate
// allocation; nested proxies are built lazily, so they only appear in "read" rows.

import {Carburetor} from '../dist/esm/Carburetor/Store/Carburetor.mjs';

// Every read feeds this accumulator and the total is checked once at the end: with the
// result unconsumed, V8 hoists loop-invariant plain-object reads out of the timed loop
// and the baselines collapse to near zero.
let sink = 0;

const measure = (label, iterations, body) => {
    body();

    const started = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
        body();
    }

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
        `${label.padEnd(52)} ${(elapsedMs / iterations).toFixed(4)} ms/op`
        + `   (${iterations} ops in ${elapsedMs.toFixed(1)} ms)`
    );
};

const keys = (prefix, count) => Array.from({length: count}, (unused, index) => prefix + index);

// The stores and their plain twins: the same underlying object, with and without tracking.

const shallowData = {count: 0, name: 1, flag: 2, step: 3, min: 4, max: 5, cur: 6, prev: 7};
const shallowKeys = Object.keys(shallowData);
const shallowStore = new Carburetor(shallowData);

const deepLeaves = keys('l', 64);
const buildDeepLeaves = () => {
    const leaves = {};

    deepLeaves.forEach((key, index) => {
        leaves[key] = index;
    });

    return leaves;
};

// A scalar at every level keeps the depth ladder reading one leaf at each depth, rather
// than one leaf at the bottom only.
const deepData = {a: {ka: 1, b: {kb: 2, c: {kc: 3, d: {kd: 4, ...buildDeepLeaves()}}}}};
const deepStore = new Carburetor(deepData);

const wideData = {};
keys('w', 400).forEach((key, index) => {
    wideData[key] = index;
});
const wideKeys = Object.keys(wideData);
const wideStore = new Carburetor(wideData);

const noReads = () => undefined;

/** Reads `count` keys off `source`, cycling through `keyList` when count exceeds it. */
const readKeys = (source, keyList, count) => {
    const total = keyList.length;

    for (let i = 0; i < count; i++) {
        sink += source[keyList[i % total]];
    }
};

const readShallow = (source, count) => readKeys(source, shallowKeys, count);
const readDeepLeaves = (source, count) => readKeys(source, deepLeaves, count);
const readWide = (source, count) => readKeys(source, wideKeys, count);

/** One leaf at each depth: every extra level crosses one more lazily built proxy. */
const readDeepLeaf = (source, depth) => {
    if (depth === 1) {
        sink += source.a.ka;
    } else if (depth === 2) {
        sink += source.a.b.kb;
    } else if (depth === 3) {
        sink += source.a.b.c.kc;
    } else if (depth === 4) {
        sink += source.a.b.c.d.kd;
    } else {
        sink += source.a.b.c.d.l0;
    }
};

/** One render's worth of tracked reading: fresh reads Set and recorder, proxy, reads. */
const trackedRead = (store, n, reader) => {
    const reads = new Set();
    const proxy = store.read((path) => reads.add(path));

    reader(proxy, n);
};

console.log('useCarburetor proxy: per-render cost by store shape');

console.log('\nshallow: 8 top-level keys, reads at depth 1');

measure('create proxy only', 1000000, () => shallowStore.read(noReads));
measure('create + read 1', 500000, () => trackedRead(shallowStore, 1, readShallow));
measure('create + read 8 (all keys)', 500000, () => trackedRead(shallowStore, 8, readShallow));
measure('create + read 50 (8 keys revisited)', 100000, () => trackedRead(shallowStore, 50, readShallow));
measure('plain read 1', 2000000, () => readShallow(shallowData, 1));
measure('plain read 8', 1000000, () => readShallow(shallowData, 8));
measure('plain read 50 (revisited)', 200000, () => readShallow(shallowData, 50));

console.log('\ndeep: leaf five segments down (a.b.c.d.l0), 64 leaves at the bottom');

measure('create proxy only', 1000000, () => deepStore.read(noReads));
measure('create + read leaf at depth 1', 500000, () => trackedRead(deepStore, 1, readDeepLeaf));
measure('create + read leaf at depth 2', 500000, () => trackedRead(deepStore, 2, readDeepLeaf));
measure('create + read leaf at depth 3', 500000, () => trackedRead(deepStore, 3, readDeepLeaf));
measure('create + read leaf at depth 4', 500000, () => trackedRead(deepStore, 4, readDeepLeaf));
measure('create + read leaf at depth 5', 500000, () => trackedRead(deepStore, 5, readDeepLeaf));
measure('create + read 10 deep leaves', 200000, () => trackedRead(deepStore, 10, readDeepLeaves));
measure('create + read 50 deep leaves', 100000, () => trackedRead(deepStore, 50, readDeepLeaves));
measure('plain read leaf at depth 1', 1000000, () => readDeepLeaf(deepData, 1));
measure('plain read leaf at depth 2', 1000000, () => readDeepLeaf(deepData, 2));
measure('plain read leaf at depth 3', 1000000, () => readDeepLeaf(deepData, 3));
measure('plain read leaf at depth 4', 1000000, () => readDeepLeaf(deepData, 4));
measure('plain read leaf at depth 5', 1000000, () => readDeepLeaf(deepData, 5));
measure('plain read 10 deep leaves', 500000, () => readDeepLeaves(deepData, 10));
measure('plain read 50 deep leaves', 200000, () => readDeepLeaves(deepData, 50));

console.log('\nwide: 400 top-level keys, reads at depth 1');

measure('create proxy only', 1000000, () => wideStore.read(noReads));
measure('create + read 1', 500000, () => trackedRead(wideStore, 1, readWide));
measure('create + read 10', 200000, () => trackedRead(wideStore, 10, readWide));
measure('create + read 50', 100000, () => trackedRead(wideStore, 50, readWide));
measure('plain read 1', 2000000, () => readWide(wideData, 1));
measure('plain read 10', 500000, () => readWide(wideData, 10));
measure('plain read 50', 200000, () => readWide(wideData, 50));

// Keeps the accumulator observable, so no read above can be optimized away.
if (sink === -1) {
    console.log(sink);
}
