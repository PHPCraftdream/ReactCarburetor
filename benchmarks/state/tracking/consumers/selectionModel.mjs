// A/B benchmark for the R30-03/R30-04 selection model: a selection is plain data in the
// state-model sense — own enumerable string keys, array elements and length, detached
// Date/Map/Set copies — compared with Object.keys and direct reads, copied by assignment.
// Descriptor walks (Reflect.ownKeys + getOwnPropertyDescriptor per key on both sides) are gone.
//
//   cp -r dist .bench-baseline-dist   # BEFORE any change
//   npm run build                     # produces the AFTER build in dist/
//   BASELINE_DIST=.bench-baseline-dist node benchmarks/state/tracking/consumers/selectionModel.mjs
//
// Gates: ratio AFTER/BASELINE per operation, plus an absolute per-op time cap on the after
// build (compare of a two-field selection <= 1 us; detach <= 6 us; a {title, at: Date}
// comparison must report EQUAL and take <= 2.5 us). Every timed body reads its result's
// fields into a sink, so the JIT cannot scalar-replace the detached copies away.

import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const AFTER_DIST = resolve('dist');
const BEFORE_DIST = process.env.BASELINE_DIST ? resolve(process.env.BASELINE_DIST) : undefined;

if (!BEFORE_DIST) {
    console.error(
        'BASELINE_DIST env var required: path to a dist/ build from before the change ' +
        '(e.g. BASELINE_DIST=.bench-baseline-dist node benchmarks/state/tracking/consumers/selectionModel.mjs).'
    );
    process.exit(1);
}

const importFrom = (root, relPath) => import(pathToFileURL(resolve(root, relPath)).href);

const loadBuild = async (root) => {
    const [{Carburetor}, {sameSelection}, {detachSelection}] = await Promise.all([
        importFrom(root, 'esm-prod/Carburetor/Store/Carburetor.mjs'),
        importFrom(root, 'esm-prod/Carburetor/Component/Connection/sameSelection.mjs'),
        importFrom(root, 'esm-prod/Carburetor/Component/Connection/detachSelection.mjs'),
    ]);

    return {Carburetor, sameSelection, detachSelection};
};

const before = await loadBuild(BEFORE_DIST);
const after = await loadBuild(AFTER_DIST);

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

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

const ROUNDS = 11;
const results = [];
// A sink the JIT cannot eliminate: every timed body folds its result's content into this.
let sink = 0;

/**
 * Times BASELINE vs AFTER over `ROUNDS` alternating rounds. Gates on both the after/before
 * ratio and an absolute cap on the after side (`afterCapUs`, in microseconds per op).
 */
const runAB = (name, iterations, beforeSetup, beforeBody, afterSetup, afterBody, gate, afterCapUs) => {
    const beforeSamples = [];
    const afterSamples = [];

    for (let round = 0; round < ROUNDS; round++) {
        beforeSamples.push(timeOnce(iterations, beforeSetup, beforeBody));
        afterSamples.push(timeOnce(iterations, afterSetup, afterBody));
    }

    const beforeUs = median(beforeSamples) * 1000;
    const afterUs = median(afterSamples) * 1000;
    const ratio = afterUs / beforeUs;
    const pass = ratio <= gate && afterUs <= afterCapUs;

    results.push({name, pass});
    console.log(
        `${name.padEnd(44)} before=${beforeUs.toFixed(3)}us after=${afterUs.toFixed(3)}us `
        + `ratio=${ratio.toFixed(3)} gate<=${gate} afterCap<=${afterCapUs}us  ${pass ? 'PASS' : 'FAIL'}`
    );
};

// ---- correctness on the after build before trusting any timing above it ----

console.log('correctness checks (after build)');
{
    const store = new after.Carburetor({title: 't', at: new Date(1000), payload: {n: 1}});
    const view = store.read(() => undefined);
    const select = (data) => ({title: data.title, payload: data.payload});
    const fresh = select(view);
    const same = after.sameSelection(after.detachSelection(fresh), select(store.read(() => undefined)));

    console.log(`  two-field selection compares equal after detach: ${same ? 'PASS' : 'FAIL'}`);
    results.push({name: 'correctness: plain compare', pass: same});

    const dateSame = after.sameSelection(
        after.detachSelection({title: 't', at: store.getData().at}),
        {title: 't', at: store.getData().at}
    );

    console.log(`  {title, at: Date} with an unchanged Date is EQUAL: ${dateSame ? 'PASS' : 'FAIL'}`);
    results.push({name: 'correctness: Date equality', pass: dateSame === true});
}
console.log('');

// ---- fixtures ----

const makeView = (Carburetor) => {
    const store = new Carburetor({title: 'title-7', at: new Date(1000), payload: {n: 1}});

    return {store, view: store.read(() => undefined)};
};

const twoFieldSelect = (view) => ({title: view.title, payload: view.payload});
const dateSelect = (data) => ({title: data.title, at: data.at});

// The model's own cost, against already-materialized plain selections (the review's
// comparison basis): the sides are detached once in the untimed setup, the timed body is
// the comparison itself. Reading fields of the previous side keeps the JIT honest.
{
    const beforeSides = (() => {
        const {store, view} = makeView(before.Carburetor);
        const previous = before.detachSelection(twoFieldSelect(view));

        return {previous, fresh: before.detachSelection(twoFieldSelect(store.read(() => undefined)))};
    })();
    const afterSides = (() => {
        const {store, view} = makeView(after.Carburetor);
        const previous = after.detachSelection(twoFieldSelect(view));

        return {previous, fresh: after.detachSelection(twoFieldSelect(store.read(() => undefined)))};
    })();

    runAB(
        'compare: 2-field detached selection', 200000,
        () => beforeSides,
        ({previous, fresh}) => {
            sink += (previous.title?.length ?? 0) + (previous.payload?.n ?? 0)
                + (before.sameSelection(previous, fresh) ? 1 : 0);
        },
        () => afterSides,
        ({previous, fresh}) => {
            sink += (previous.title?.length ?? 0) + (previous.payload?.n ?? 0)
                + (after.sameSelection(previous, fresh) ? 1 : 0);
        },
        0.6, 1
    );
}

// Detach of a plain 2-field selection — the review's copy basis (spread equivalent 305 ns).
const PLAIN_SOURCE = {title: 'title-7', payload: {n: 1}};
runAB(
    'detach: plain 2-field selection', 200000,
    () => ({source: PLAIN_SOURCE}),
    ({source}) => {
        const copy = before.detachSelection(source);

        sink += (copy.title?.length ?? 0) + (copy.payload?.n ?? 0);
    },
    () => ({source: PLAIN_SOURCE}),
    ({source}) => {
        const copy = after.detachSelection(source);

        sink += (copy.title?.length ?? 0) + (copy.payload?.n ?? 0);
    },
    0.6, 0.6
);

// A {title, at: Date} selection with an unchanged Date: the after build must answer EQUAL
// (the baseline always answers changed) and stay under its cap.
{
    const beforeSides = (() => {
        const {store, view} = makeView(before.Carburetor);
        const previous = before.detachSelection(dateSelect(view));

        return {previous, fresh: before.detachSelection(dateSelect(store.read(() => undefined)))};
    })();
    const afterSides = (() => {
        const {store, view} = makeView(after.Carburetor);
        const previous = after.detachSelection(dateSelect(view));

        return {previous, fresh: after.detachSelection(dateSelect(store.read(() => undefined)))};
    })();

    runAB(
        'compare: {title, at: Date} unchanged', 100000,
        () => beforeSides,
        ({previous, fresh}) => {
            sink += (previous.title?.length ?? 0) + (previous.at?.getTime() ?? 0)
                + (before.sameSelection(previous, fresh) ? 1 : 0);
        },
        () => afterSides,
        ({previous, fresh}) => {
            sink += (previous.title?.length ?? 0) + (previous.at?.getTime() ?? 0)
                + (after.sameSelection(previous, fresh) ? 1 : 0);
        },
        0.6, 1.5
    );

    const store = new after.Carburetor({title: 't', at: new Date(1000), payload: {n: 1}});
    const view = store.read(() => undefined);
    const afterEqual = after.sameSelection(
        after.detachSelection(dateSelect(view)), dateSelect(store.read(() => undefined))
    );

    console.log(
        `  after build reports {title, at: Date} unchanged as EQUAL: ${afterEqual ? 'PASS' : 'FAIL'}`
    );
    results.push({name: 'gate: Date selection is EQUAL', pass: afterEqual === true});
}

// Informational only (not a gate): the full per-render path — detach through a live view,
// whose proxy reads and path recording dominate and are identical work in both builds.
{
    const beforeCtx = makeView(before.Carburetor);
    const afterCtx = makeView(after.Carburetor);
    const beforeUs = median(Array.from({length: ROUNDS},
        () => timeOnce(100000, () => beforeCtx, ({view}) => {
            const copy = before.detachSelection(twoFieldSelect(view));

            sink += (copy.title?.length ?? 0) + (copy.payload?.n ?? 0);
        }))) * 1000;
    const afterUs = median(Array.from({length: ROUNDS},
        () => timeOnce(100000, () => afterCtx, ({view}) => {
            const copy = after.detachSelection(twoFieldSelect(view));

            sink += (copy.title?.length ?? 0) + (copy.payload?.n ?? 0);
        }))) * 1000;

    console.log(
        `[info] detach through live view (proxy reads dominate, no gate): `
        + `before=${beforeUs.toFixed(3)}us after=${afterUs.toFixed(3)}us`
    );
}

const failed = results.filter((entry) => !entry.pass);

console.log('');
console.log(`gates: ${results.length - failed.length}/${results.length} passed`);

console.error(`sink=${sink}`); // keeps the sink live

if (failed.length > 0) {
    process.exitCode = 1;
}
