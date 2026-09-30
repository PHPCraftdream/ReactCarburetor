// Paired real native-alias selection over prebuilt distributions; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   node benchmarks/state/tracking/nativeAliasSelection.mjs
// Descriptor visits measure reflection, not allocated bytes. Each selection makes 128 actual
// Map.get lookups against 128 distinct raw rows and records all writable ordinary paths.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
const implementations = {};
for (const [label, root] of Object.entries(roots)) {
    const module = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    implementations[label] = module.Carburetor;
}
const ROWS = 128;
const LOOKUPS = 128;
const SAMPLES = 7;
const expectedChecksum = ROWS * (ROWS - 1) / 2;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/** Measures one complete keyed selection and original-node reflection.
 *
 * @param Carburetor - the built store implementation.
 */
function select(Carburetor) {
    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    const root = {rows, map: new Map(rows.map((row, index) => [index, row]))};
    const store = new Carburetor(root);
    const originals = new Set(rows);
    const paths = new Set();
    const originalDescriptor = Reflect.getOwnPropertyDescriptor;
    let rootVisits = 0;
    let rowVisits = 0;
    let checksum = 0;
    Reflect.getOwnPropertyDescriptor = function (object, key) {
        if (object === root) rootVisits++;
        if (originals.has(object)) rowVisits++;
        return originalDescriptor(object, key);
    };
    let ms;
    try {
        const start = process.hrtime.bigint();
        const view = store.read(path => paths.add(path));
        for (let index = 0; index < LOOKUPS; index++) {
            const member = view.map.get(index);
            if (member !== rows[index]) throw new Error('Map.get lost raw row identity');
            checksum += member.n;
        }
        ms = Number(process.hrtime.bigint() - start) / 1e6;
    } finally {
        Reflect.getOwnPropertyDescriptor = originalDescriptor;
    }
    if (checksum !== expectedChecksum || paths.size !== ROWS + 1 || !paths.has('map')
        || rows.some((_, index) => !paths.has(`rows.${index}`))) {
        throw new Error(`Incorrect selection: ${JSON.stringify({checksum, paths: [...paths]})}`);
    }
    return {ms, checksum, lookups: LOOKUPS, paths: paths.size, rootVisits, rowVisits};
}

const results = {baseline: [], fixed: []};
for (let round = -2; round < SAMPLES; round++) {
    for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
        const result = select(implementations[label]);
        if (round >= 0) results[label].push(result);
    }
}
for (const label of ['baseline', 'fixed']) {
    const samples = results[label];
    const visits = samples.map(({rootVisits, rowVisits}) => ({rootVisits, rowVisits}));
    console.log(JSON.stringify({label, rows: ROWS, samples: SAMPLES, lookups: LOOKUPS,
        checksum: expectedChecksum, paths: ROWS + 1,
        medianMs: median(samples.map(sample => sample.ms)),
        timesMs: samples.map(sample => sample.ms), visits}));
}
