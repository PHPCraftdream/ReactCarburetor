// A/B benchmark for the R6-02/R6-03 state model (own enumerable string-keyed data; an array's
// state is its elements and length): symbols, accessors, non-enumerable properties and a
// non-index array key are no longer part of state, and diff/clone/tracking no longer pay to
// weigh them. Runs the current build against a pre-change build side by side, in one process:
//
//   cp -r dist .bench-baseline-dist   # BEFORE any change (dist in git = the pre-fix build)
//   npm run build                     # produces the AFTER build in dist/
//   BASELINE_DIST=.bench-baseline-dist node benchmarks/state/stateModel.mjs
//
// Kept out of the test suite on purpose — the rstest run must stay fast.
//
// Style follows pathsIntersect.mjs/restoreArrayLength.mjs: measure the timed body alone, a
// fresh store per iteration for anything that mutates (a repeat of the same write would be a
// SameValue no-op past the first call, understating the real cost), and >=9 alternating A/B
// rounds so neither side runs solely warm/cold or solely first/last; the reported number is the
// per-round median, not the mean of one long run.

import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const AFTER_DIST = resolve('dist');
const BEFORE_DIST = process.env.BASELINE_DIST ? resolve(process.env.BASELINE_DIST) : undefined;

if (!BEFORE_DIST) {
    console.error(
        'BASELINE_DIST env var required: path to a dist/ build from before the change ' +
        '(e.g. BASELINE_DIST=.bench-baseline-dist node benchmarks/state/stateModel.mjs).'
    );
    process.exit(1);
}

const importFrom = (root, relPath) => import(pathToFileURL(resolve(root, relPath)).href);

const loadBuild = async (root) => {
    const [{Carburetor: prodCarburetor}, {deepClone: prodDeepClone}, {CarburetorHistory}, {diffPaths}] =
        await Promise.all([
            importFrom(root, 'esm-prod/Carburetor/Store/Carburetor.mjs'),
            importFrom(root, 'esm-prod/Carburetor/Store/Utils/deepClone.mjs'),
            importFrom(root, 'esm-prod/Carburetor/Tooling/CarburetorHistory.mjs'),
            importFrom(root, 'esm-prod/Carburetor/Store/Paths/Diff/diffPaths.mjs'),
        ]);
    const {Carburetor: devCarburetor} = await importFrom(root, 'esm/Carburetor/Store/Carburetor.mjs');

    return {
        prod: {Carburetor: prodCarburetor, deepClone: prodDeepClone, CarburetorHistory, diffPaths},
        dev: {Carburetor: devCarburetor},
    };
};

const before = await loadBuild(BEFORE_DIST);
const after = await loadBuild(AFTER_DIST);

// ---- fixtures: 4000 rows, an array field, `ids` and `filter` (R6-02/R6-03's test domain) ----

const ROW_COUNT = 4000;

const buildRoot = () => {
    const items = {};
    const ids = [];

    for (let i = 0; i < ROW_COUNT; i++) {
        const id = 'row' + i;

        ids.push(id);
        items[id] = {title: 'title-' + i, tags: ['a', 'b', 'c'], done: i % 2 === 0};
    }

    return {items, ids, filter: ''};
};

const ROW_SAMPLE = () => ({title: 'title-7', tags: ['a', 'b', 'c'], done: false});

// ---- measuring: alternating A/B rounds, median per side, gated on the after/before ratio ----

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** One side's ms/op over `iterations`: `setup()` is untimed, only `body(ctx)` is measured. */
const timeOnce = (iterations, setup, body) => {
    body(setup()); // warm up module/JIT paths once, outside every timed sample

    let totalNs = 0n;

    for (let i = 0; i < iterations; i++) {
        const ctx = setup();
        const started = process.hrtime.bigint();

        body(ctx);

        totalNs += process.hrtime.bigint() - started;
    }

    return Number(totalNs) / 1e6 / iterations;
};

const ROUNDS = 9;
const results = [];

/**
 * Times `beforeSetup`/`beforeBody` against `afterSetup`/`afterBody` over `ROUNDS` alternating
 * rounds, prints the before/after/ratio line, and records whether `ratio <= gate` passed.
 */
const runAB = (name, iterations, beforeSetup, beforeBody, afterSetup, afterBody, gate) => {
    const beforeSamples = [];
    const afterSamples = [];

    for (let round = 0; round < ROUNDS; round++) {
        beforeSamples.push(timeOnce(iterations, beforeSetup, beforeBody));
        afterSamples.push(timeOnce(iterations, afterSetup, afterBody));
    }

    const beforeMs = median(beforeSamples);
    const afterMs = median(afterSamples);
    const ratio = afterMs / beforeMs;
    const pass = ratio <= gate;

    results.push({name, pass});
    console.log(
        `${name.padEnd(56)} before=${beforeMs.toFixed(5)}ms after=${afterMs.toFixed(5)}ms `
        + `ratio=${ratio.toFixed(3)} gate<=${gate}  ${pass ? 'PASS' : 'FAIL'}`
    );
};

/** A same-build, cross-operation ratio: no BASELINE_DIST side, just `a` vs `b` on `after`. */
const runSelf = (name, iterations, setupA, bodyA, setupB, bodyB, gate) => {
    const aMs = median(Array.from({length: ROUNDS}, () => timeOnce(iterations, setupA, bodyA)));
    const bMs = median(Array.from({length: ROUNDS}, () => timeOnce(iterations, setupB, bodyB)));
    const ratio = aMs / bMs;
    const pass = ratio <= gate;

    results.push({name, pass});
    console.log(
        `${name.padEnd(56)} a=${aMs.toFixed(5)}ms b=${bMs.toFixed(5)}ms `
        + `ratio=${ratio.toFixed(3)} gate<=${gate}  ${pass ? 'PASS' : 'FAIL'}`
    );
};

// ---- correctness, checked once against the after-build before trusting any timing above it ----

console.log('correctness checks (after build, production)');
{
    const store = new after.prod.Carburetor(buildRoot());
    const reads = new Set();
    const view = store.read((path) => reads.add(path));

    void view.items.row7.title;

    let wakes = 0;

    store.subscribe(() => wakes++, {id: 'row7-title', reads});
    store.update((draft) => {
        draft.items.row7.title = 'changed';
    });

    const status = wakes === 1 ? 'PASS' : 'FAIL (' + wakes + ')';

    console.log(`  replacing items.row7.title wakes its own reader exactly once: ${status}`);
}
{
    const store = new after.prod.Carburetor(buildRoot());
    let wakes = 0;

    store.subscribe(() => wakes++, {id: 'watcher'});
    store.restore(store.snapshot());

    const status = wakes === 0 ? 'PASS' : 'FAIL (' + wakes + ')';

    console.log(`  restore(snapshot()) on unchanged state wakes nobody: ${status}`);
}
console.log('');

// ---- 1. deepClone(row) ----

runAB(
    'deepClone(row)', 100000,
    () => ROW_SAMPLE(), (row) => before.prod.deepClone(row),
    () => ROW_SAMPLE(), (row) => after.prod.deepClone(row),
    0.60
);

// ---- 2. snapshot() over 4000 rows (read-only: one store per side, reused across iterations) ----

{
    const beforeStore = new before.prod.Carburetor(buildRoot());
    const afterStore = new after.prod.Carburetor(buildRoot());

    runAB(
        'snapshot() 4000 rows', 150,
        () => beforeStore, (store) => store.snapshot(),
        () => afterStore, (store) => store.snapshot(),
        1.03
    );
}

// ---- 3. replace one row's title through draft (fresh store per iteration: a real write every time) ----

runAB(
    'draft: replace one row\'s title (4000 rows)', 300,
    () => new before.prod.Carburetor(buildRoot()), (store) => store.update((draft) => {
        draft.items.row7.title = 'changed';
    }),
    () => new after.prod.Carburetor(buildRoot()), (store) => store.update((draft) => {
        draft.items.row7.title = 'changed';
    }),
    1.03
);

// ---- 4. the same write, with a CarburetorHistory attached ----

runAB(
    'draft: replace one row\'s title, with CarburetorHistory attached', 300,
    () => {
        const store = new before.prod.Carburetor(buildRoot());

        return {store, history: new before.prod.CarburetorHistory(store)};
    },
    ({store}) => store.update((draft) => {
        draft.items.row7.title = 'changed';
    }),
    () => {
        const store = new after.prod.Carburetor(buildRoot());

        return {store, history: new after.prod.CarburetorHistory(store)};
    },
    ({store}) => store.update((draft) => {
        draft.items.row7.title = 'changed';
    }),
    0.90
);

// ---- 5. setData with one changed row, as a deep copy (the fromJSON shape: every row a fresh object) ----

runAB(
    'setData: one changed row, deep-copied root (fromJSON shape)', 60,
    () => new before.prod.Carburetor(buildRoot()), (store) => {
        const next = buildRoot();

        next.items.row7.title = 'changed';
        store.setData(next);
    },
    () => new after.prod.Carburetor(buildRoot()), (store) => {
        const next = buildRoot();

        next.items.row7.title = 'changed';
        store.setData(next);
    },
    1.03
);

// ---- 6. restore with one row changed (siblings share their old reference: the applyDiff fast path) ----

const restoreOneRowSetup = (Carburetor) => () => {
    const store = new Carburetor(buildRoot());
    const snapshot = store.snapshot();

    snapshot.items.row7.title = 'changed';

    return {store, snapshot};
};

runAB(
    'restore: one row changed (4000 rows)', 150,
    restoreOneRowSetup(before.prod.Carburetor), ({store, snapshot}) => store.restore(snapshot),
    restoreOneRowSetup(after.prod.Carburetor), ({store, snapshot}) => store.restore(snapshot),
    1.03
);

// ---- 7. restore(snapshot()) — a no-op restore ----

const restoreSnapshotSetup = (Carburetor) => () => {
    const store = new Carburetor(buildRoot());

    return {store, snapshot: store.snapshot()};
};

runAB(
    'restore: restore(snapshot()) (no-op, 4000 rows)', 150,
    restoreSnapshotSetup(before.prod.Carburetor), ({store, snapshot}) => store.restore(snapshot),
    restoreSnapshotSetup(after.prod.Carburetor), ({store, snapshot}) => store.restore(snapshot),
    1.03
);

// ---- 8. draft.ids 4000 -> 4001 ----

runAB(
    'draft: ids.push (4000 -> 4001)', 300,
    () => new before.prod.Carburetor(buildRoot()), (store) => store.update((draft) => {
        draft.ids.push('row4000');
    }),
    () => new after.prod.Carburetor(buildRoot()), (store) => store.update((draft) => {
        draft.ids.push('row4000');
    }),
    1.03
);

// ---- 9. view.ids.map(id => view.items[id].title) over 4000, through a fresh read view each time ----
// One store per side, built once (read-only, so nothing here needs a fresh tree per iteration):
// only the read view itself — a fresh Proxy, the real per-render cost — is rebuilt each call.

const mapIdsReused = (Carburetor) => {
    const store = new Carburetor(buildRoot());

    return () => ({store});
};

runAB(
    'read: view.ids.map(id => view.items[id].title) (4000)', 300,
    mapIdsReused(before.prod.Carburetor), ({store}) => {
        const view = store.read(() => undefined);

        view.ids.map((id) => view.items[id].title);
    },
    mapIdsReused(after.prod.Carburetor), ({store}) => {
        const view = store.read(() => undefined);

        view.ids.map((id) => view.items[id].title);
    },
    0.95
);

// ---- 10. dev-only: the construction-time validator vs a full production diff of the same shape ----
// Same (after) build both sides — the validator is new, so there is no "before" to compare it
// against; it is bounded instead against an operation of comparable shape that already existed.

process.env.NODE_ENV = 'development';

runSelf(
    'dev: construction validator (4000) vs prod: full diff (4000)', 150,
    () => buildRoot(), (root) => new after.dev.Carburetor(root),
    () => [buildRoot(), buildRoot()], ([a, b]) => after.prod.diffPaths(a, b),
    1.0
);

// ---- 11. dev-only: replace one row's title through draft, before vs after (the actual regression) ----
// One store per side, built once (not per iteration): a fresh 4000-row store per write would
// mix construction's own dev-mode validation cost into this measurement — that cost is what
// case 10 above already isolates and bounds on its own. Toggling the title between two values
// keeps every write a real change (never a same-value no-op) without rebuilding the tree.

const draftReplaceReused = (Carburetor) => {
    const store = new Carburetor(buildRoot());

    return () => store;
};

runAB(
    'dev: draft replace one row\'s title (reused store)', 2000,
    draftReplaceReused(before.dev.Carburetor), (store) => store.update((draft) => {
        draft.items.row7.title = draft.items.row7.title === 'flip-a' ? 'flip-b' : 'flip-a';
    }),
    draftReplaceReused(after.dev.Carburetor), (store) => store.update((draft) => {
        draft.items.row7.title = draft.items.row7.title === 'flip-a' ? 'flip-b' : 'flip-a';
    }),
    1.25
);

// ---- summary ----

console.log('');

const failed = results.filter((result) => !result.pass);

if (failed.length > 0) {
    const names = failed.map((result) => result.name).join(', ');

    console.error(`${failed.length}/${results.length} gate(s) failed: ${names}`);
    process.exit(1);
}

console.log(`All ${results.length} gates passed.`);
