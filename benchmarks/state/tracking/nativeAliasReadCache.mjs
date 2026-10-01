// A/B over prebuilt distributions; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node --expose-gc benchmarks/state/tracking/nativeAliasReadCache.mjs
// Gates for the per-opaque-read alias cache: (a) a repeated read of a class instance with a
// 10000-row payload <= 2 us after the first read; (b) iterating Map(10000) through a view
// <= 1.5x the raw iteration; (c) the first read after a topology change <= 1.1x baseline.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
const implementations = {};
for (const [label, root] of Object.entries(roots)) {
    const module = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    implementations[label] = module.Carburetor;
}
const ROWS = 10000;
const READS = 100000;
const SAMPLES = 9;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Measures one build's cached and first-after-write opaque reads.
 *
 * @param Carburetor - the built store class
 */
function measure(Carburetor) {
    class Payload {
        /**
         * Holds an opaque payload.
         *
         * @param items - the plain rows the instance carries
         */
        constructor(items) { this.items = items; }
    }

    class BenchStore extends Carburetor {
        /**
         * Replaces the plain row: a topological write.
         *
         * @param row - the new row
         */
        replaceRow(row) { this.update(draft => { draft.row = row; }); }
    }

    const makeState = currentRows => ({
        row: currentRows[0], model: new Payload(currentRows),
        byId: new Map(currentRows.map((row, index) => [index, row])),
    });

    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    let start = process.hrtime.bigint();
    const store = new BenchStore(makeState(rows));

    const view = store.read(() => undefined);
    if (view.model.items.length !== ROWS) throw new Error('payload lost');
    void view.model;
    start = process.hrtime.bigint();
    let reads = 0;
    do {
        for (let index = 0; index < 100; index++) void view.model;
        reads += 100;
    } while (Number(process.hrtime.bigint() - start) < 2e8 && reads < READS);
    const cachedReadUs = Number(process.hrtime.bigint() - start) / 1e3 / reads;

    const mapView = store.read(() => undefined);
    const rawMap = store.getData().byId;
    const iterate = map => {
        let count = 0;
        for (const row of map.values()) count += row.n;
        return count;
    };
    const check = iterate(mapView.byId);
    if (check !== iterate(rawMap)) throw new Error('view iteration diverged from raw');
    start = process.hrtime.bigint();
    const viewTotal = iterate(mapView.byId);
    const viewIterateUs = Number(process.hrtime.bigint() - start) / 1e3;
    start = process.hrtime.bigint();
    const rawTotal = iterate(rawMap);
    const rawIterateUs = Number(process.hrtime.bigint() - start) / 1e3;
    if (viewTotal !== rawTotal) throw new Error('iteration totals diverged');

    let freshMs;
    {
        const fresh = new BenchStore(makeState(rows));
        void fresh.read(() => undefined).model;
        fresh.replaceRow({n: -1});
        start = process.hrtime.bigint();
        void fresh.read(() => undefined).model;
        freshMs = Number(process.hrtime.bigint() - start) / 1e6;
    }

    return {cachedReadUs, viewIterateUs, rawIterateUs, iterateRatio: viewIterateUs / rawIterateUs, freshMs};
}

const results = {baseline: [], fixed: []};
for (let round = -2; round < SAMPLES; round++) {
    for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
        const result = measure(implementations[label]);
        if (round >= 0) results[label].push(result);
        globalThis.gc?.();
    }
}
const gates = {cachedReadUs: 2, iterateRatio: 1.5, freshRatio: 1.1};
const summary = {};
for (const label of ['baseline', 'fixed']) {
    const samples = results[label];
    summary[label] = {
        cachedReadUs: median(samples.map(sample => sample.cachedReadUs)),
        iterateRatio: median(samples.map(sample => sample.iterateRatio)),
        rawIterateUs: median(samples.map(sample => sample.rawIterateUs)),
        freshMs: median(samples.map(sample => sample.freshMs)),
    };
}
summary.gates = {
    cachedReadUs: {value: summary.fixed.cachedReadUs, limit: gates.cachedReadUs,
        pass: summary.fixed.cachedReadUs <= gates.cachedReadUs},
    iterateRatio: {value: summary.fixed.iterateRatio, limit: gates.iterateRatio,
        pass: summary.fixed.iterateRatio <= gates.iterateRatio},
    freshRatio: {value: summary.fixed.freshMs / summary.baseline.freshMs, limit: gates.freshRatio,
        pass: summary.fixed.freshMs / summary.baseline.freshMs <= gates.freshRatio},
};
console.log(JSON.stringify(summary, null, 2));
