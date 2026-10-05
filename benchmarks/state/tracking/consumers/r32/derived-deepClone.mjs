// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/consumers/r32/derived-deepClone.mjs
// Gate for the deepClone literal fast path (R32-08): snapshot() of a 10k-row probe state is
// >= 1.25x faster than the baseline (fixed/baseline <= 0.8).
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 15;
const RUNS = 51;
const CHILDREN = 9;
const GATE_RATIO = 0.8;
const median = numbers => [...numbers].sort((x, y) => x - y)[Math.floor(numbers.length / 2)];

/**
 * Times snapshot() of a 10k-row state with a nested object per row.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/Store/Carburetor.mjs')).href);
    const cloneUrl = pathToFileURL(resolve(root, 'esm-prod/Carburetor/Store/Utils/deepClone.mjs'));
    const {deepClone} = await import(cloneUrl.href);

    const state = {
        rows: Array.from({length: ROWS}, (_, n) => ({id: n, nested: {v: n, tag: `row-${n}`}})),
    };
    // The store path exercises the same clone through snapshot().
    const store = new Carburetor(state);
    const storeSamples = [];
    for (let round = 0; round < WARMUP + RUNS; round++) {
        globalThis.gc?.();
        const start = process.hrtime.bigint();
        const snapshot = store.snapshot();
        if (round >= WARMUP) storeSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (snapshot.rows[0].nested.v !== 0) throw new Error('snapshot broken');
    }


    const samples = [];
    for (let round = 0; round < WARMUP + RUNS; round++) {
        globalThis.gc?.();
        const start = process.hrtime.bigint();
        const copy = deepClone(state);
        if (round >= WARMUP) samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (copy.rows.length !== ROWS) throw new Error('copy lost rows');
    }

    return {deepCloneMs: median(samples), snapshotMs: median(storeSamples)};
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measureChild(process.env.BENCH_ROOT)));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const script = fileURLToPath(import.meta.url);
    const results = {baseline: [], fixed: []};

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
            deepCloneMs: median(results[label].map(sample => sample.deepCloneMs)),
            snapshotMs: median(results[label].map(sample => sample.snapshotMs)),
        };
    }
    const ratio = summary.fixed.snapshotMs / summary.baseline.snapshotMs;
    summary.gate = {
        metric: 'snapshotMs',
        baselineMs: summary.baseline.snapshotMs,
        fixedMs: summary.fixed.snapshotMs,
        ratio,
        limitRatio: GATE_RATIO,
        pass: ratio <= GATE_RATIO,
    };
    console.log(JSON.stringify(summary, null, 2));
}
