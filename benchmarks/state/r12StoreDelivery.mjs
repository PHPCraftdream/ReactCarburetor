// Paired single-store notification workload with the same observable delivery on both sides.
// BASELINE_DIST=/path/to/baseline/dist AFTER_DIST=/path/to/fixed/dist \
//   node benchmarks/state/r12StoreDelivery.mjs
// Built distributions are supplied by the integration owner; this driver does not build them.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) {
    throw new Error('Set BASELINE_DIST to a built baseline distribution');
}

const variant = process.env.DIST_VARIANT ?? 'esm-prod';
const roots = {
    baseline: resolve(process.env.BASELINE_DIST),
    fixed: resolve(process.env.AFTER_DIST ?? 'dist'),
};
const implementations = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([name, root]) => {
    const source = resolve(root, `${variant}/Carburetor/Store/Carburetor.mjs`);
    const module = await import(pathToFileURL(source).href);
    return [name, module.Carburetor];
})));
const subscribers = 64;
const writes = 500;
const samples = 7;
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/** Emits real changed state to registered subscribers and checks delivered callback counts.
 *
 * @param Carburetor - store constructor from one built variant
 */
function measure(Carburetor) {
    const store = new Carburetor({n: 0});
    let deliveries = 0;
    const ids = [];
    for (let index = 0; index < subscribers; index++) {
        ids.push(store.subscribe(() => { deliveries++; }, {id: `subscriber-${index}`}));
    }
    const begin = process.hrtime.bigint();
    for (let index = 1; index <= writes; index++) {
        store.setData({n: index});
    }
    const ms = Number(process.hrtime.bigint() - begin) / 1e6;
    if (deliveries !== subscribers * writes) {
        throw new Error(`Lost callbacks: ${deliveries}, expected ${subscribers * writes}`);
    }
    for (const id of ids) store.unsubscribe(id);
    return {ms, deliveries};
}

const results = {baseline: [], fixed: []};
for (let round = -2; round < samples; round++) {
    const order = round % 2 ? ['fixed', 'baseline'] : ['baseline', 'fixed'];
    for (const side of order) {
        const result = measure(implementations[side]);
        if (round >= 0) results[side].push(result);
    }
}
for (const side of ['baseline', 'fixed']) {
    const measurements = results[side].map((row) => row.ms);
    console.log(`${side}: median=${median(measurements).toFixed(3)}ms`
        + ` range=${Math.min(...measurements).toFixed(3)}-${Math.max(...measurements).toFixed(3)}ms`
        + ` deliveries=${results[side][0].deliveries}`);
}
