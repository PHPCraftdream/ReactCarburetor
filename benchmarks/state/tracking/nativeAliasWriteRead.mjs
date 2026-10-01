// A/B over prebuilt distributions; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node --expose-gc benchmarks/state/tracking/nativeAliasWriteRead.mjs
// One cycle = one draft scalar write into a 4000-row store, then a fresh read view that
// reads one Map member. Descriptor visits on the root measure ownership-index rebuilds,
// which walk the whole graph: a rebuild per cycle is the O(N) regression this bench hunts.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
const implementations = {};
for (const [label, root] of Object.entries(roots)) {
    const module = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    implementations[label] = module.Carburetor;
}
const ROWS = 4000;
const CYCLES = 64;
const SAMPLES = 9;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/** Measures write→native-read cycles and counts root descriptor reflection.
 *
 * @param Carburetor - the built store implementation.
 */
function cycle(Carburetor) {
    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    const root = {rows, map: new Map(rows.map((row, index) => [index, row]))};
    const store = new Carburetor(root);
    const paths = new Set();
    const originalDescriptor = Reflect.getOwnPropertyDescriptor;
    let rootVisits = 0;
    let value = 0;
    Reflect.getOwnPropertyDescriptor = function (object, key) {
        if (object === root) rootVisits++;
        return originalDescriptor(object, key);
    };
    let ms;
    try {
        const start = process.hrtime.bigint();
        for (let index = 0; index < CYCLES; index++) {
            store.update(draft => { draft.rows[0].n = ++value; });
            const view = store.read(path => paths.add(path));
            const member = view.map.get(1);
            if (member !== rows[1]) throw new Error('Map.get lost raw row identity');
            if (member.n !== rows[1].n) throw new Error('Map member diverged from rows');
        }
        ms = Number(process.hrtime.bigint() - start) / 1e6;
    } finally {
        Reflect.getOwnPropertyDescriptor = originalDescriptor;
    }
    if (!paths.has('map') || !paths.has('rows.1') || paths.size !== 2) {
        throw new Error(`Incorrect cycle: ${JSON.stringify({paths: [...paths].slice(0, 8)})}`);
    }
    if (rows[0].n !== value) throw new Error('Scalar write did not land');
    return {ms, rootVisits};
}

const results = {baseline: [], fixed: []};
for (let round = -2; round < SAMPLES; round++) {
    for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
        const result = cycle(implementations[label]);
        if (round >= 0) results[label].push(result);
        globalThis.gc?.();
    }
}
for (const label of ['baseline', 'fixed']) {
    const samples = results[label];
    console.log(JSON.stringify({label, rows: ROWS, cycles: CYCLES, samples: SAMPLES,
        medianMs: median(samples.map(sample => sample.ms)),
        timesMs: samples.map(sample => sample.ms),
        medianRootVisits: median(samples.map(sample => sample.rootVisits)),
        rootVisits: samples.map(sample => sample.rootVisits)}));
}
