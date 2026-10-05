// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> NODE_ENV=production \
//   node benchmarks/state/tracking/consumers/r33/keys-selection.mjs
// Gate for the internal keys hatch (R33-04): sameSelection and detachOpaque on 10 000 live
// view rows each >= 1.6x baseline.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 3;
const RUNS = 12;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const normalizeRoot = root => {
    const absolute = resolve(root);
    return absolute.endsWith('esm-prod') ? absolute : resolve(absolute, 'esm-prod');
};

/**
 * Times sameSelection and detachOpaque over one build's live view rows.
 *
 * @param root - the built distribution directory (esm-prod)
 */
async function measureChild(root) {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'Carburetor/Store/Carburetor.mjs')).href);
    const {sameSelection} = await import(
        pathToFileURL(resolve(root, 'Carburetor/Component/Connection/sameSelection.mjs')).href);
    const {detachOpaque} = await import(
        pathToFileURL(resolve(root, 'Carburetor/Store/Utils/Selection/detachOpaque.mjs')).href);

    const store = new Carburetor({
        rows: Array.from({length: ROWS}, (_, id) => ({id, title: 'title-0', done: false, tags: {a: 1}})),
    });

    // One read tree, warmed once: the persistent view the report's probe reuses.
    const view = store.read(() => undefined);
    void view.rows[0].id;

    const time = run => {
        const samples = [];
        for (let index = 0; index < WARMUP + RUNS; index++) {
            const start = process.hrtime.bigint();
            const verdict = run();
            if (index >= WARMUP) samples.push(Number(process.hrtime.bigint() - start) / 1e6);
            if (verdict === undefined) throw new Error('probe produced no verdict');
        }
        return median(samples);
    };

    // The detached snapshot is plain data with the same content as the live rows; the compare
    // reads every leaf of the fresh view either way.
    const snapshot = Array.from({length: ROWS}, (_, id) => ({id, title: 'title-0', done: false, tags: {a: 1}}));
    if (!sameSelection(snapshot, view.rows)) throw new Error('sameSelection verdict check failed');
    const sameMs = time(() => sameSelection(snapshot, view.rows));

    const detached = detachOpaque(view.rows);
    if (!Array.isArray(detached) || detached.length !== ROWS) throw new Error('detachOpaque did not run');
    const detachMs = time(() => detachOpaque(view.rows).length === ROWS);

    return {sameMs, detachMs};
}

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measureChild(normalizeRoot(process.env.BENCH_ROOT))));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: normalizeRoot(process.env.BASELINE_DIST), fixed: normalizeRoot(process.env.AFTER_DIST ?? 'dist')};
    const results = {baseline: [], fixed: []};
    const script = fileURLToPath(import.meta.url);

    for (let round = 0; round < CHILDREN; round++) {
        const labels = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];
        for (const label of labels) {
            const child = spawnSync(process.execPath, [script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: roots[label]},
            });
            if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
            results[label].push(JSON.parse(child.stdout));
        }
    }

    const summary = {};
    for (const label of ['baseline', 'fixed']) {
        summary[label] = {
            sameMs: median(results[label].map(sample => sample.sameMs)),
            detachMs: median(results[label].map(sample => sample.detachMs)),
        };
    }
    const same = summary.baseline.sameMs / summary.fixed.sameMs;
    const detach = summary.baseline.detachMs / summary.fixed.detachMs;
    summary.gates = {
        sameRatio: {value: same, limit: 1.6, pass: same >= 1.6},
        detachRatio: {value: detach, limit: 1.6, pass: detach >= 1.6},
    };
    console.log(JSON.stringify(summary, null, 2));
}
