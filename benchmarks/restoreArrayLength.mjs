// Measures restore() cost for an array's length changing (R6-01): growth via a sparse trailing
// gap (holes only, no new own index), growth via real appended values, and shrinkage — at the
// store root and one level nested. Runs against the built ESM output, so it measures shipped
// code:
//   npm run build && NODE_ENV=production node --expose-gc benchmarks/restoreArrayLength.mjs
// Kept out of the test suite on purpose — the rstest run must stay fast.

import {Carburetor} from '../dist/esm/Carburetor/Store/Carburetor.mjs';

class BenchCarburetor extends Carburetor {}

const R7_ONLY = process.argv.includes('--r7-only');
const denseRows = (n) => Array.from({length: n}, (_, i) => ({n: i}));

/**
 * Times `body(store)` alone, excluding `setup()`: restore() short-circuits a no-op write
 * (Object.is), so re-running the same body on the same store would measure almost nothing on
 * every call past the first — a fresh store per iteration keeps every call doing real work.
 */
const measure = (label, iterations, setup, body) => {
    if (R7_ONLY) {
        return;
    }

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

// R7 sparse-array A/B: BASELINE_DIST points to a pre-change dist copy.
if (process.env.BASELINE_DIST) {
    const {resolve} = await import('node:path');
    const {pathToFileURL} = await import('node:url');
    const load = async (root, name) => import(pathToFileURL(resolve(root, name)).href);
    const beforeRoot = resolve(process.env.BASELINE_DIST);
    const afterRoot = resolve('dist');
    const [beforeStore, afterStore, beforeClone, afterClone] = await Promise.all([
        load(beforeRoot, 'esm/Carburetor/Store/Carburetor.mjs'),
        load(afterRoot, 'esm/Carburetor/Store/Carburetor.mjs'),
        load(beforeRoot, 'esm/Carburetor/Store/Utils/deepClone.mjs'),
        load(afterRoot, 'esm/Carburetor/Store/Utils/deepClone.mjs'),
    ]);
    const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
    const dense = () => Array.from({length: 2000}, (_, i) => i);
    const sparse = () => {
        const rows = [];
        rows[0] = 0;
        rows[50_000] = 50_000;
        rows[99_999] = 99_999;
        return rows;
    };
    const sample = (setup, body) => {
        let elapsed = 0n;
        let allocated = 0;
        const retained = [];

        for (let i = 0; i < 4; i++) {
            const input = setup();
            global.gc?.();
            const bytes = process.memoryUsage().heapUsed;
            const start = process.hrtime.bigint();
            retained.push(body(input));
            elapsed += process.hrtime.bigint() - start;
            allocated += Math.max(0, process.memoryUsage().heapUsed - bytes);
        }

        return {ms: Number(elapsed) / 4e6, kb: allocated / 4096};
    };
    const pair = (name, shape, setup, body) => {
        const a = [];
        const b = [];

        for (let round = 0; round < 9; round++) {
            a.push(sample(() => setup(beforeStore.Carburetor, beforeClone.deepClone, shape), body));
            b.push(sample(() => setup(afterStore.Carburetor, afterClone.deepClone, shape), body));
        }

        console.log(`${name.padEnd(24)} before=${median(a.map((x) => x.ms)).toFixed(3)}ms`
            + ` after=${median(b.map((x) => x.ms)).toFixed(3)}ms`
            + ` heapΔ≈${median(a.map((x) => x.kb)).toFixed(0)}/${median(b.map((x) => x.kb)).toFixed(0)}KiB/op`);
    };
    const makeStore = (Carburetor) => class extends Carburetor {
        /** Truncates the measured rows.
         *
         * @param length - target array length
         */
        truncate(length) { this.update((draft) => { draft.rows.length = length; }); }
    };

    console.log('\nR7 array work (before/after, heap delta may miss allocations reclaimed by GC)');
    for (const {name, shape} of [{name: 'dense', shape: dense}, {name: 'sparse', shape: sparse}]) {
        pair(`clone ${name}`, shape, (_Carburetor, deepClone, fixture) => ({deepClone, rows: fixture()}),
            ({deepClone, rows}) => deepClone(rows));
        pair(`validator ${name}`, shape, (Carburetor, _deepClone, fixture) => ({Carburetor, rows: fixture()}),
            ({Carburetor, rows}) => new Carburetor({rows}));
        pair(`truncate ${name}`, shape, (Carburetor, _deepClone, fixture) => {
            const Store = makeStore(Carburetor);
            return new Store({rows: fixture()});
        }, (store) => { store.truncate(1); return store; });
    }
}
