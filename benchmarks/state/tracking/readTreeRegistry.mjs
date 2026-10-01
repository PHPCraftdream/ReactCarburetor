// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/readTreeRegistry.mjs
// R30-02: the per-proxy knownViews insert. Fresh-tree construction pays one extra ephemeron
// insert per proxy; a hatch lookup removes it. Gates: fresh walk <= 0.6x baseline,
// computed recompute <= 0.8x, cached re-walk <= 1.03x.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const CHILDREN = 7;
const ROWS = 4000;
const SAMPLES = 9;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

const getRows = () => Array.from({length: ROWS}, (_, n) => ({n}));

/** Median ms of a repeated body, one fresh store and view per iteration.
 *
 * @param Carburetor - the built store implementation.
 * @param body - the timed workload; receives the fresh read view each iteration.
 */
function time(Carburetor, body) {
    const times = [];
    const paths = new Set();
    const root = {rows: getRows()};
    for (let index = 0; index < SAMPLES + 2; index++) {
        const store = new Carburetor(root);
        globalThis.gc?.();
        const start = process.hrtime.bigint();
        const view = store.read(path => paths.add(path));
        body(view, store);
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return median(times.slice(2));
}

/** Fresh tree, walk every row: the per-proxy registry insert dominates here.
 *
 * @param Carburetor - the built store implementation.
 */
function freshWalk(Carburetor) {
    return time(Carburetor, view => {
        let total = 0;
        for (const row of view.rows) total += row.n;
        if (total !== (ROWS * (ROWS - 1)) / 2) throw new Error('fresh walk diverged');
    });
}

/** Computed recompute after one scalar write: rebuilds the whole read tree.
 *
 * @param Carburetor - the built store implementation.
 */
function computedRecompute(Carburetor) {
    const root = {rows: getRows()};
    const store = new Carburetor(root);
    const times = [];
    for (let index = 0; index < SAMPLES + 2; index++) {
        const paths = new Set();
        const view = store.read(path => paths.add(path));
        let total = 0;
        for (const row of view.rows) total += row.n;
        globalThis.gc?.();
        const start = process.hrtime.bigint();
        store.update(draft => {
            draft.rows[0].n = 1000 + index;
        });
        const next = store.read(path => paths.add(path));
        let recomputed = 0;
        for (const row of next.rows) recomputed += row.n;
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (recomputed !== (ROWS * (ROWS - 1)) / 2 + 1000 + index) {
            throw new Error('recompute diverged');
        }
    }
    return median(times.slice(2));
}

/** Cached view re-walk (control): no fresh proxies, must stay flat.
 *
 * @param Carburetor - the built store implementation.
 */
function cachedRewalk(Carburetor) {
    const root = {rows: getRows()};
    const store = new Carburetor(root);
    const paths = new Set();
    const view = store.read(path => paths.add(path));
    let total = 0;
    for (const row of view.rows) total += row.n;
    const times = [];
    for (let index = 0; index < SAMPLES + 2; index++) {
        globalThis.gc?.();
        const start = process.hrtime.bigint();
        let sum = 0;
        for (const row of view.rows) sum += row.n;
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (sum !== total) throw new Error('cached re-walk diverged');
    }
    return median(times.slice(2));
}

const workloads = {freshWalk, computedRecompute, cachedRewalk};
const gates = {freshWalk: 0.6, computedRecompute: 0.8, cachedRewalk: 1.03};

if (process.env.BENCH_ROOT) {
    const {Carburetor} = await import(
        pathToFileURL(resolve(process.env.BENCH_ROOT, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    const out = {};
    for (const [name, run] of Object.entries(workloads)) out[name] = run(Carburetor);
    console.log(JSON.stringify(out));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const script = fileURLToPath(import.meta.url);
    const samples = {baseline: [], fixed: []};

    for (let round = -1; round < CHILDREN; round++) {
        for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
            const child = spawnSync(process.execPath, ['--expose-gc', script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: resolve(roots[label])},
            });
            if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
            if (round >= 0) samples[label].push(JSON.parse(child.stdout));
        }
    }

    let failed = false;
    for (const name of Object.keys(workloads)) {
        const base = median(samples.baseline.map(sample => sample[name]));
        const after = median(samples.fixed.map(sample => sample[name]));
        const ratio = after / base;
        failed ||= ratio > gates[name];
        console.log(JSON.stringify({workload: name, baselineMs: base, afterMs: after,
            ratio: Number(ratio.toFixed(3)), gate: gates[name], pass: ratio <= gates[name]}));
    }
    if (failed) throw new Error('benchmark gate failed');
}
