// Write-path memo bound and positional writes under a rolling key window (R32-04): heap drift
// A/B over prebuilt distributions, one child process per measurement.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> NODE_ENV=production \
//   node benchmarks/state/tracking/consumers/r32/array-memoWindow.mjs
// Gates: the 100-key rolling window over 200k add/delete cycles drifts at most 1 MB of heap
// between the 50k and 200k samples, with and without a persistent read view attached.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KEYS = 100;
const TOTAL = 200000;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Runs the rolling-window probe on one build and reports heap drift.
 *
 * @param root - the built distribution directory
 * @param withView - whether a persistent read view walks every written key
 */
const measureChild = async (root, withView) => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/index.mjs')).href);

    class Store extends Carburetor {
        /** Adds key `m<index>` and drops the key falling out of the window. */
        churn(index) {
            this.update(draft => {
                draft.byId['m' + index] = {n: index};
                delete draft.byId['m' + (index - KEYS)];
            });
        }
    }

    const store = new Store({byId: {}});
    const view = withView ? store.read(() => undefined) : undefined;
    global.gc();
    const small = process.memoryUsage().heapUsed;
    for (let index = 0; index < TOTAL; index++) {
        store.churn(index);
    }
    global.gc();
    const large = process.memoryUsage().heapUsed;
    if (Object.keys(store.getData().byId).length !== KEYS) throw new Error('window did not hold');
    if (view === null) throw new Error('unreachable');
    return large - small;
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify({drift: await measureChild(process.env.BENCH_ROOT, process.env.BENCH_VIEW === '1')}));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const script = fileURLToPath(import.meta.url);
    const results = {};

    for (const view of ['0', '1']) {
        for (const label of ['baseline', 'fixed']) {
            const samples = [];
            for (let round = 0; round < CHILDREN; round++) {
                const child = spawnSync(process.execPath, ['--expose-gc', script], {
                    encoding: 'utf8', timeout: 300000,
                    env: {...process.env, BENCH_ROOT: resolve(roots[label]),
                        BENCH_VIEW: view, NODE_ENV: 'production'},
                });
                if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
                samples.push(JSON.parse(child.stdout).drift);
            }
            results[`${view === '1' ? 'view' : 'plain'}.${label}`] = median(samples);
        }
    }

    const LIMIT = 1024 * 1024;
    console.log(JSON.stringify({
        results,
        gates: {
            plainDrift: {baseline: results['plain.baseline'], fixed: results['plain.fixed'],
                limit: LIMIT, pass: results['plain.fixed'] <= LIMIT},
            viewDrift: {baseline: results['view.baseline'], fixed: results['view.fixed'],
                limit: LIMIT, pass: results['view.fixed'] <= LIMIT},
        },
    }, null, 2));
}
