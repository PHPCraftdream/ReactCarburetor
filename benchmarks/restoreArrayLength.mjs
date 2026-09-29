// Measures restore() cost for an array's length changing (R6-01): growth via a sparse trailing
// gap (holes only, no new own index), growth via real appended values, and shrinkage — at the
// store root and one level nested. Runs against the built ESM output, so it measures shipped
// code:
//   npm run build && NODE_ENV=production node --expose-gc benchmarks/restoreArrayLength.mjs
// Kept out of the test suite on purpose — the rstest run must stay fast.

import {Carburetor} from '../dist/esm/Carburetor/Store/Carburetor.mjs';

class BenchCarburetor extends Carburetor {}

const denseRows = (n) => Array.from({length: n}, (_, i) => ({n: i}));

/**
 * Times `body(store)` alone, excluding `setup()`: restore() short-circuits a no-op write
 * (Object.is), so re-running the same body on the same store would measure almost nothing on
 * every call past the first — a fresh store per iteration keeps every call doing real work.
 */
const measure = (label, iterations, setup, body) => {
    body(setup()); // warm up module/JIT paths once, outside the timed loop

    let totalNs = 0n;
    let lastStore;

    for (let i = 0; i < iterations; i++) {
        const store = setup();
        const started = process.hrtime.bigint();

        body(store);

        totalNs += process.hrtime.bigint() - started;
        lastStore = store;
    }

    const elapsedMs = Number(totalNs) / 1e6;
    const length = lastStore.getData().rows?.length ?? lastStore.getData().wrapper.rows.length;

    console.log(
        `${label.padEnd(58)} ${(elapsedMs / iterations).toFixed(4)} ms/op`
        + `   (${iterations} ops, resulting length=${length})`
    );
};

const SMALL_SIZE = 10;
const LARGE_SIZE = 2000;
const ITERATIONS = 500;

console.log('restore(): root array, growth');

measure(
    'sparse tail growth (holes only) 10 -> 2000',
    ITERATIONS,
    () => new BenchCarburetor({rows: denseRows(SMALL_SIZE)}),
    (store) => {
        const snapshot = {rows: denseRows(SMALL_SIZE)};
        snapshot.rows.length = LARGE_SIZE; // indices 10..1999 stay holes

        store.restore(snapshot);
    }
);

measure(
    'dense growth (real values) 10 -> 2000',
    ITERATIONS,
    () => new BenchCarburetor({rows: denseRows(SMALL_SIZE)}),
    (store) => store.restore({rows: denseRows(LARGE_SIZE)})
);

console.log('\nrestore(): root array, shrink');

measure(
    'dense shrink 2000 -> 10',
    ITERATIONS,
    () => new BenchCarburetor({rows: denseRows(LARGE_SIZE)}),
    (store) => store.restore({rows: denseRows(SMALL_SIZE)})
);

console.log('\nrestore(): nested array (one level deep), growth');

measure(
    'nested sparse tail growth (holes only) 10 -> 2000',
    ITERATIONS,
    () => new BenchCarburetor({wrapper: {rows: denseRows(SMALL_SIZE)}}),
    (store) => {
        const snapshot = {wrapper: {rows: denseRows(SMALL_SIZE)}};
        snapshot.wrapper.rows.length = LARGE_SIZE;

        store.restore(snapshot);
    }
);

console.log('\nrestore(): nested array (one level deep), shrink');

measure(
    'nested dense shrink 2000 -> 10',
    ITERATIONS,
    () => new BenchCarburetor({wrapper: {rows: denseRows(LARGE_SIZE)}}),
    (store) => store.restore({wrapper: {rows: denseRows(SMALL_SIZE)}})
);
