// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   node benchmarks/state/tracking/consumers/r32/readsEnumeration.mjs
// Gates (R32-06 / R32-04): (a) retained heap per enumerated 10k-key view <= 0.75x baseline;
// (b) fresh-view Object.keys time <= 1.0x baseline; (c) rolling 100-key window over 200k
// writes against one persistent read view grows <= 1024 KB of heap between the 50k and 200k
// key checkpoints.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KEYS = 10000;
const WINDOW_ITERS = 200000;
const WINDOW_SIZE = 100;
const CHECKPOINTS = [50000, 200000];
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Runs the read-view probes on one build.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);

    const gc = globalThis.gc;
    const views = [];
    const heapUsed = () => {
        gc();
        gc();

        return process.memoryUsage().heapUsed;
    };
    const rows = Object.fromEntries(
        Array.from({length: KEYS}, (_, n) => ['k' + n, {title: 't' + n, done: n % 2 === 0}])
    );
    const store = new Carburetor({byId: rows});

    // Fresh-view enumeration: a new view per pass; the median skips JIT warm-up rounds.
    const freshSamples = [];
    let freshRetained = 0;
    for (let round = 0; round < 8; round++) {
        const before = heapUsed();
        const start = process.hrtime.bigint();
        const view = store.read(() => undefined);
        const keys = Object.keys(view.byId);
        freshSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (keys.length !== KEYS) throw new Error('fresh enumeration missed keys');
        views.push(view);
        if (round === 7) freshRetained = (heapUsed() - before) / 1024;
    }

    // Warm-view enumeration: every wrapper already cached.
    const warmView = store.read(() => undefined);
    Object.keys(warmView.byId);
    const start = process.hrtime.bigint();
    for (let round = 0; round < 10; round++) Object.keys(warmView.byId);
    const warmMs = Number(process.hrtime.bigint() - start) / 1e6 / 10;

    // Rolling key window against one persistent read view: heap drift across checkpoints.
    // The write side of the same churn (draft trees, write-handler state) is R32-04's other
    // half and is not fixed here, so the drift is reported alongside the read view's own,
    // deterministic footprint: the byId handler's memo map sizes at both checkpoints.
    const {PROXY_CACHE, RAW_TARGET} = await import(
        pathToFileURL(resolve(root, 'esm/Carburetor/Store/Tracking/Models.mjs')).href
    );
    class WindowStore extends Carburetor {
        /**
         * Adds one key and drops the oldest, keeping the window flat.
         *
         * @param index - the iteration index naming the key
         */
        churn(index) {
            this.update(draft => {
                draft.byId['m' + index] = {n: index};
                if (index >= WINDOW_SIZE) delete draft.byId['m' + (index - WINDOW_SIZE)];
            });
        }
    }
    const windowStore = new WindowStore({byId: {}});
    const record = () => undefined;
    const persistentView = windowStore.read(record);
    const iterations = index => {
        windowStore.churn(index);
        return persistentView.byId['m' + (index - WINDOW_SIZE + 1)]?.n;
    };
    const drift = [];
    let memoSizes = [];
    let baselineHeap = 0;
    let verified = 0;
    for (let index = 0; index < WINDOW_ITERS; index++) {
        if (iterations(index) !== undefined) verified++;
        if (CHECKPOINTS.includes(index + 1)) {
            const heap = heapUsed();
            const byId = persistentView.byId;
            const entry = byId[PROXY_CACHE].entries.get(byId[RAW_TARGET]);
            const memo = entry?.memos ?? entry;
            memoSizes.push({
                at: index + 1,
                childPaths: memo?.childPaths?.size ?? 0,
                branchMarkers: memo?.branchMarkers?.size ?? 0,
            });
            if (index + 1 === CHECKPOINTS[0]) baselineHeap = heap;
            else drift.push((heap - baselineHeap) / 1024);
        }
    }
    if (verified === 0) throw new Error('persistent view never saw a value');

    return {
        freshMs: median(freshSamples),
        retainedKB: freshRetained,
        warmMs,
        windowDriftKB: drift[0],
        windowMemoEntries: memoSizes[1].childPaths + memoSizes[1].branchMarkers,
    };
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
            freshMs: median(results[label].map(sample => sample.freshMs)),
            warmMs: median(results[label].map(sample => sample.warmMs)),
            retainedKB: median(results[label].map(sample => sample.retainedKB)),
            windowDriftKB: median(results[label].map(sample => sample.windowDriftKB)),
            windowMemoEntries: median(results[label].map(sample => sample.windowMemoEntries)),
        };
    }
    const retained = summary.fixed.retainedKB / summary.baseline.retainedKB;
    const fresh = summary.fixed.freshMs / summary.baseline.freshMs;
    summary.gates = {
        retainedRatio: {value: retained, limit: 0.75, pass: retained <= 0.75},
        freshTimeRatio: {value: fresh, limit: 1.0, pass: fresh <= 1.0},
        // The full-churn drift carries R32-04's unfixed write half (draft trees grow the same
        // in both builds); the read view's own footprint is gated by windowMemoEntries.
        windowDriftKB: {
            value: summary.fixed.windowDriftKB, limit: 1024, pass: summary.fixed.windowDriftKB <= 1024,
        },
        windowMemoEntries: {
            value: summary.fixed.windowMemoEntries, limit: 512,
            pass: summary.fixed.windowMemoEntries <= 512,
        },
    };
    console.log(JSON.stringify(summary, null, 2));
}
