// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/consumers/r32/write-diffPaths.mjs
// R32-05 gates for the fixed build: (a) one changed row of 10 000 through setData <= 0.5 ms;
// (b) the same through raw diffPaths <= 0.5 ms; (c) heap growth per op <= 100 KB (diffPaths).
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 20;
const OPS = 200;
const ALLOC_OPS = 500;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Times and sizes a one-row change on one build, steady state.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const diffModule = resolve(root, 'esm-prod/Carburetor/Store/Paths/Diff/diffPaths.mjs');
    const {diffPaths} = await import(pathToFileURL(diffModule).href);
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/Store/Carburetor.mjs')).href);

    const makeRows = () => Array.from({length: ROWS}, (_, index) => ({id: index, title: 't' + index, done: false}));
    const replaceRow = rows => rows.map(row => row.id === 5000 ? {...row, done: true} : row);

    class BenchStore extends Carburetor {
        /** Replaces row 5000. */
        changeRow() {
            const rows = replaceRow(this.data.rows);
            this.update(draft => { draft.rows = rows; });
        }
    }

    const store = new BenchStore({rows: makeRows()});
    const timeMs = [];
    for (let round = 0; round < WARMUP + OPS; round++) {
        const start = process.hrtime.bigint();
        store.changeRow();
        if (round >= WARMUP) timeMs.push(Number(process.hrtime.bigint() - start) / 1e6);
    }

    const rawOld = {rows: makeRows()};
    const rawNew = {rows: replaceRow(rawOld.rows)};
    const diffMs = [];
    for (let round = 0; round < WARMUP + OPS; round++) {
        const start = process.hrtime.bigint();
        const changed = diffPaths(rawOld, rawNew);
        if (round >= WARMUP && changed.size !== 1) throw new Error('unexpected diff size ' + changed.size);
        if (round >= WARMUP) diffMs.push(Number(process.hrtime.bigint() - start) / 1e6);
    }

    const samplesKb = [];
    for (let round = 0; round < 5; round++) {
        global.gc();
        const before = process.memoryUsage().heapUsed;
        for (let op = 0; op < ALLOC_OPS; op++) diffPaths(rawOld, rawNew);
        samplesKb.push((process.memoryUsage().heapUsed - before) / ALLOC_OPS / 1024);
    }

    return {setDataMs: median(timeMs), diffMs: median(diffMs), allocKb: median(samplesKb)};
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
            setDataMs: median(results[label].map(sample => sample.setDataMs)),
            diffMs: median(results[label].map(sample => sample.diffMs)),
            allocKb: median(results[label].map(sample => sample.allocKb)),
        };
    }
    summary.gates = {
        setDataMs: {value: summary.fixed.setDataMs, limit: 0.5, pass: summary.fixed.setDataMs <= 0.5},
        diffMs: {value: summary.fixed.diffMs, limit: 0.5, pass: summary.fixed.diffMs <= 0.5},
        allocKb: {value: summary.fixed.allocKb, limit: 100, pass: summary.fixed.allocKb <= 100},
    };
    console.log(JSON.stringify(summary, null, 2));
}
