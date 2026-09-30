// Bounded, paired benchmark of built history implementations and real complete-state captures.
// BASELINE_DIST=/path/to/baseline/dist AFTER_DIST=/path/to/fixed/dist \
//   node benchmarks/state/resourceHistory.mjs
// Snapshot counts include the legacy snapshot API and the owned producer capture hook;
// they count capture calls, not internal clones. Pure-tree history should remain patch-based.

import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) {
    throw new Error('Set BASELINE_DIST to a built baseline distribution; AFTER_DIST defaults to ./dist');
}

const variant = process.env.DIST_VARIANT ?? 'esm-prod';
const load = async (root, file) => import(pathToFileURL(resolve(root, file)).href);
const roots = {
    baseline: resolve(process.env.BASELINE_DIST),
    fixed: resolve(process.env.AFTER_DIST ?? 'dist'),
};
const implementations = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([name, root]) => {
    const [store, history, resource] = await Promise.all([
        load(root, `${variant}/Carburetor/Store/Carburetor.mjs`),
        load(root, `${variant}/Carburetor/Tooling/CarburetorHistory.mjs`),
        load(root, `${variant}/Carburetor/Resource/ResourceCarburetor.mjs`),
    ]);
    return [name, {store: store.Carburetor, history: history.CarburetorHistory,
        resource: resource.ResourceCarburetor}];
})));

const samples = 7;
const rows = Array.from({length: 128}, (_, index) => ({id: index, title: `row-${index}`}));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Measures real ordinary draft writes whose history should remain patch-based.
 *
 * @param implementation - one built variant
 */
function ordinary(implementation) {
    class Store extends implementation.store {
        /** Counts complete history capture calls. */
        snapshots = 0;
        /** Counts legacy captures in the baseline implementation. */
        snapshot() { this.snapshots++; return super.snapshot(); }
        /** Counts owned captures in the repaired implementation.
         *
         * @param own - history's graph copier
         */
        captureHistory(own) { this.snapshots++; return super.captureHistory(own); }
        /** Publishes one counter write.
         *
         * @param value - next counter
         */
        change(value) { this.draft.count = value; this.emitUpdate(); }
    }
    const store = new Store({count: 0, rows});
    const history = new implementation.history(store);
    const start = process.hrtime.bigint();
    for (let n = 1; n <= 128; n++) store.change(n);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (store.getData().count !== 128 || !history.canUndo()) throw new Error('Ordinary history lost writes');
    history.disconnect();
    return {ms, writes: 128, snapshots: store.snapshots};
}

/** Measures actual resource loads, pending/settled history, and detached wire snapshots.
 *
 * @param implementation - one built variant
 */
async function resource(implementation) {
    class Resource extends implementation.resource {
        /** Counts complete wire history capture calls. */
        snapshots = 0;
        /** Counts legacy captures in the baseline implementation. */
        snapshot() { this.snapshots++; return super.snapshot(); }
        /** Counts owned captures in the repaired implementation.
         *
         * @param own - history's graph copier
         */
        captureHistory(own) { this.snapshots++; return super.captureHistory(own); }
    }
    const store = new Resource(async key => ({key, rows}));
    const history = new implementation.history(store);
    const start = process.hrtime.bigint();
    for (let n = 0; n < 64; n++) await store.load(String(n));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (store.getData().data.key !== '63' || !history.canUndo()) throw new Error('Resource history lost writes');
    history.disconnect();
    return {ms, loads: 64, transitions: 128, snapshots: store.snapshots};
}

for (const [name, scenario] of [['ordinary patch history', ordinary], ['resource snapshot history', resource]]) {
    const results = {baseline: [], fixed: []};
    for (let round = -2; round < samples; round++) {
        const order = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];
        for (const side of order) {
            const result = await scenario(implementations[side]);
            if (round >= 0) results[side].push(result);
        }
    }
    console.log(name);
    for (const side of ['baseline', 'fixed']) {
        const measurements = results[side];
        const work = measurements[0];
        console.log(`  ${side}: median=${median(measurements.map(result => result.ms)).toFixed(3)}ms`
            + ` range=${Math.min(...measurements.map(result => result.ms)).toFixed(3)}`
            + `-${Math.max(...measurements.map(result => result.ms)).toFixed(3)}ms`
            + ` writes=${work.writes ?? '-'} loads=${work.loads ?? '-'}`
            + ` transitions=${work.transitions ?? '-'} snapshots=${work.snapshots}`);
    }
}
