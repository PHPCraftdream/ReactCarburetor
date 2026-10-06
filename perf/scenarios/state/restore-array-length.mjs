/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R6-01: restore() keeps a sparse array's length-only growth (holes stay holes) at the root and
// one level down, next to dense growth and shrinkage. R7-03: work on a sparse array costs its
// own keys, not the hole count — truncating a 100k-long array wakes no absent-index reader and
// cloning it stays microseconds. Args: [iterations=100] [sparseLength=100000]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const iterations = Number(process.argv[2] ?? 100);
const sparseLength = Number(process.argv[3] ?? 100000);
const SMALL = 10;
const LARGE = 2000;
const denseRows = n => Array.from({length: n}, (_, i) => ({n: i}));

// A fresh store per restore: restore short-circuits an Object.is-equal repeat.
const sparseTimes = [];
let sparseLengthResult = 0;
for (let i = 0; i < iterations; i++) {
    const store = new Carburetor({rows: denseRows(SMALL)});
    const snap = {rows: denseRows(SMALL)};
    snap.rows.length = LARGE;
    const start = performance.now();
    store.restore(snap);
    sparseTimes.push(performance.now() - start);
    sparseLengthResult = store.getData().rows.length;
}
const nestedTimes = [];
let nestedSparseLength = 0;
for (let i = 0; i < iterations; i++) {
    const store = new Carburetor({wrapper: {rows: denseRows(SMALL)}});
    const snap = {wrapper: {rows: denseRows(SMALL)}};
    snap.wrapper.rows.length = LARGE;
    const start = performance.now();
    store.restore(snap);
    nestedTimes.push(performance.now() - start);
    nestedSparseLength = store.getData().wrapper.rows.length;
}
const denseTimes = [];
let denseLength = 0;
for (let i = 0; i < iterations; i++) {
    const store = new Carburetor({rows: denseRows(SMALL)});
    const start = performance.now();
    store.restore({rows: denseRows(LARGE)});
    denseTimes.push(performance.now() - start);
    denseLength = store.getData().rows.length;
}
const shrinkTimes = [];
let shrinkLength = 0;
for (let i = 0; i < iterations; i++) {
    const store = new Carburetor({rows: denseRows(LARGE)});
    const start = performance.now();
    store.restore({rows: denseRows(SMALL)});
    shrinkTimes.push(performance.now() - start);
    shrinkLength = store.getData().rows.length;
}

// R7-03: a sparse array with three widely spaced own rows and a 100k logical length. Truncation must not wake
// a reader of an absent index (the removed positions are holes, not state), and a snapshot must
// cost its own keys — well under the milliseconds a hole walk would take.
const sparseRows = length => {
    const list = [];
    list[0] = {n: 0};
    list[Math.floor(length / 2)] = {n: 1};
    list[length - 1] = {n: 2};
    return list;
};
const holeStore = new S({rows: sparseRows(sparseLength)});
let holeWakes = 0;
let lengthWakes = 0;
let removedKeyWakes = 0;
holeStore.subscribe(() => { holeWakes++; }, {reads: [`rows.${Math.floor(sparseLength / 2) - 1}`]});
holeStore.subscribe(() => { lengthWakes++; }, {reads: ['rows.length']});
holeStore.subscribe(() => { removedKeyWakes++; }, {reads: [`rows.${sparseLength - 1}`]});
holeStore.run(draft => { draft.rows.length = 1; });
const sparseHoleWakes = holeWakes;
const sparseLengthWakes = lengthWakes;
const sparseRemovedKeyWakes = removedKeyWakes;
const sparseLengthAfter = holeStore.getData().rows.length;

const cloneSparseTimes = [];
for (let round = 0; round < 7; round++) {
    const store = new Carburetor({rows: sparseRows(sparseLength)});
    const start = performance.now();
    for (let i = 0; i < 50; i++) store.snapshot();
    cloneSparseTimes.push((performance.now() - start) / 50);
}
const sparseCloneMs = median(cloneSparseTimes);

emit({
    sparseGrowthMs: median(sparseTimes), nestedSparseMs: median(nestedTimes),
    denseGrowthMs: median(denseTimes), shrinkMs: median(shrinkTimes),
    sparseLength: sparseLengthResult, nestedSparseLength, denseLength, shrinkLength,
    sparseHoleWakes, sparseLengthWakes, sparseRemovedKeyWakes, sparseLengthAfter, sparseCloneMs,
});
