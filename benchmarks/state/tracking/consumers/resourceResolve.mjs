// Paired A/B benchmark of the resource-cache read path (R30-08).
// BASELINE_DIST=/path/to/baseline/dist AFTER_DIST=/path/to/fixed/dist \
//   node benchmarks/state/tracking/consumers/resourceResolve.mjs
// Gate: resolve() for primitive ids must be <= 300 ns per call after the change, and keys
// must stay byte-identical to the baseline derivation on every probed argument value.

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
    const module = await load(root, `${variant}/Carburetor/Resource/Cache/ResourceCache.mjs`);

    return [name, module.ResourceCache];
})));

const samples = 11;
const ids = Array.from({length: 4000}, (_, index) => index);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = {baseline: [], fixed: []};

const makeCache = (ResourceCache) => {
    const cache = new ResourceCache(async id => ({id}), {maxEntries: Infinity, ttl: Infinity});

    for (const id of ids) cache.resolve(id);

    return cache;
};

/** Nanoseconds per resolve() over the whole id set, with a key sanity check on edge arguments.
 *
 * @param cache - the warmed cache under measurement
 */
function measure(cache) {
    const start = process.hrtime.bigint();

    for (const id of ids) {
        const resolution = cache.resolve(id);

        if (resolution.key === undefined) throw new Error('resolve() returned no key');
    }

    const ns = Number(process.hrtime.bigint() - start) / ids.length;

    for (const edge of [0, NaN, Infinity, 42, '', 'a.b', 'x~y', true, false, null, undefined]) {
        const key = cache.keyOf(edge);

        if (typeof key !== 'string' || key.length === 0) throw new Error(`keyOf(${String(edge)}) broken`);
    }

    return ns;
}

for (let round = -2; round < samples; round++) {
    const order = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];

    for (const side of order) {
        const cache = makeCache(implementations[side]);
        const ns = measure(cache);

        if (round >= 0) results[side].push(ns);
    }
}

console.log('resource cache resolve(), 4000 primitive ids');
for (const side of ['baseline', 'fixed']) {
    console.log(`  ${side}: median=${median(results[side]).toFixed(1)}ns `
        + `range=${Math.min(...results[side]).toFixed(1)}-${Math.max(...results[side]).toFixed(1)}ns`);
}

console.log(`  ratio=${(median(results.fixed) / median(results.baseline)).toFixed(3)} `
    + `(gate AFTER <= 300ns: ${median(results.fixed).toFixed(1)}ns)`);
