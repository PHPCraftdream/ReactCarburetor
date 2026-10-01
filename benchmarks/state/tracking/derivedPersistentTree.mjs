// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/derivedPersistentTree.mjs
// Gates for the persistent read tree (R30-05): (a) an observed computed recompute after one
// write at 4000 rows <= 0.5x baseline; (b) a watch fire after one write at 4000 rows <= 0.6x.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 4000;
const WARMUP = 3;
const WRITES = 15;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Times single writes on one build: observed computed recompute and watch fire, steady state.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    const {computed} = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Derived/computedFactory.mjs')).href);

    class BenchStore extends Carburetor {
        /**
         * Bumps one row's field.
         *
         * @param index - the row to write
         */
        bump(index) { this.update(draft => { draft.rows[index].v++; }); }
    }

    const makeStore = () => new BenchStore({rows: Array.from({length: ROWS}, (_, n) => ({n, v: n % 7}))});
    const time = (store, run) => {
        const samples = [];
        for (let index = 0; index < WARMUP + WRITES; index++) {
            const start = process.hrtime.bigint();
            run(store, ROWS - 1 - index);
            if (index >= WARMUP) samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        return median(samples);
    };

    const computedStore = makeStore();
    let checksum = 0;
    const total = computed(read => {
        checksum = 0;
        for (const row of read(computedStore).rows) checksum += row.v;
        return checksum;
    });
    total.subscribe(() => undefined);
    total.get();
    // The observed computed settles inside the write's notification pass; get() is a cache hit.
    const recomputeMs = time(computedStore, (store, index) => { store.bump(index); total.get(); });
    if (checksum === 0) throw new Error('computed did not walk the rows');

    const watchStore = makeStore();
    let fired = 0;
    watchStore.watch(data => {
        let sum = 0;
        for (const row of data.rows) sum += row.v;
        return sum;
    }, () => { fired++; });
    const fireMs = time(watchStore, (store, index) => store.bump(index));
    if (fired === 0) throw new Error('watch never fired');

    return {recomputeMs, fireMs};
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measureChild(process.env.BENCH_ROOT)));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const results = {baseline: [], fixed: []};
    const script = fileURLToPath(import.meta.url);

    for (let round = -1; round < CHILDREN; round++) {
        for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
            const child = spawnSync(process.execPath, ['--expose-gc', script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: resolve(roots[label])},
            });
            if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
            if (round >= 0) results[label].push(JSON.parse(child.stdout));
        }
    }

    const summary = {};
    for (const label of ['baseline', 'fixed']) {
        summary[label] = {
            recomputeMs: median(results[label].map(sample => sample.recomputeMs)),
            fireMs: median(results[label].map(sample => sample.fireMs)),
        };
    }
    const recompute = summary.fixed.recomputeMs / summary.baseline.recomputeMs;
    const fire = summary.fixed.fireMs / summary.baseline.fireMs;
    summary.gates = {
        recomputeRatio: {value: recompute, limit: 0.5, pass: recompute <= 0.5},
        fireRatio: {value: fire, limit: 0.6, pass: fire <= 0.6},
    };
    console.log(JSON.stringify(summary, null, 2));
}
