// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/consumers/r32/write-normalize.mjs
// R32-01 normalization overhead: assigning raw rows (all reference-equal, no views) must stay
// <= 1.3x baseline; rebuilding rows from draft branches (views everywhere) is reported as info.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 20;
const OPS = 100;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Times both assignment shapes on one build, steady state.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/Store/Carburetor.mjs')).href);

    const makeRows = () => Array.from({length: ROWS}, (_, index) => ({id: index, title: 't' + index, done: false}));

    class BenchStore extends Carburetor {
        /** Reassigns a prepared rows array. */
        assign(rows) {
            this.update(draft => { draft.rows = rows; });
        }
    }

    const rawStore = new BenchStore({rows: makeRows()});
    const rawMs = [];
    for (let round = 0; round < WARMUP + OPS; round++) {
        const rows = round % 3 === 0 ? makeRows() : rawStore.data.rows;
        const start = process.hrtime.bigint();
        rawStore.assign(rows);
        if (round >= WARMUP) rawMs.push(Number(process.hrtime.bigint() - start) / 1e6);
    }

    const viewStore = new BenchStore({rows: makeRows()});
    const viewMs = [];
    for (let round = 0; round < WARMUP + OPS; round++) {
        const start = process.hrtime.bigint();
        viewStore.assign(viewStore.data.rows.map(row => row));
        if (round >= WARMUP) viewMs.push(Number(process.hrtime.bigint() - start) / 1e6);
    }

    return {rawMs: median(rawMs), viewMs: median(viewMs)};
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
            rawMs: median(results[label].map(sample => sample.rawMs)),
            viewMs: median(results[label].map(sample => sample.viewMs)),
        };
    }
    const rawRatio = summary.fixed.rawMs / summary.baseline.rawMs;
    summary.gates = {
        rawAssignRatio: {value: rawRatio, limit: 1.3, pass: rawRatio <= 1.3},
        viewAssignMs: {value: summary.fixed.viewMs, limit: null, pass: true, note: 'info only: map rebuild normalizes 10k views'},
    };
    console.log(JSON.stringify(summary, null, 2));
}
