// Paired, bounded R11-06/R11-07 benchmark of built implementations. For example:
// BASELINE_DIST=/path/to/baseline/dist AFTER_DIST=/path/to/fixed/dist \
//   node benchmarks/state/r11DeliveryViews.mjs
// The delivery workload intentionally differs in useful work: baseline delivers cancelled callbacks.
// Times are not comparable as a speedup unless delivery and view-identity counts are also considered.

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
    const [throttle, cache, status] = await Promise.all([
        load(root, `${variant}/Carburetor/Store/Scheduling/ComponentUpdateThrottle.mjs`),
        load(root, `${variant}/Carburetor/Resource/Cache/ResourceCache.mjs`),
        load(root, `${variant}/Carburetor/Models/Enums/EResourceStatus.mjs`),
    ]);
    return [name, {throttle: throttle.ComponentUpdateThrottle,
        cache: cache.ResourceCache, status: status.EResourceStatus}];
})));

const rounds = 2_000;
const queuedPerRound = 64;
const keys = Array.from({length: queuedPerRound - 1}, (_, index) => `later-${index}`);
const viewReads = 30_000;
const samples = 7;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Measures actual scheduled callback delivery.
 *
 * @param Implementation - one prebuilt variant
 * @param cancelDuringFlush - whether the first callback cancels the rest
 */
function delivery(Implementation, cancelDuringFlush) {
    class ControlledThrottle extends Implementation.throttle {
        /** Uses explicit flushing rather than timers. */
        setupTimeout() {}
        /** Delivers one complete queue. */
        flush() { this.letsUpdate(); }
    }
    const scheduler = new ControlledThrottle();
    let delivered = 0;
    const later = () => { delivered++; };
    const first = () => {
        delivered++;
        if (cancelDuringFlush) {
            for (const key of keys) scheduler.cancel(key);
        }
    };
    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < rounds; iteration++) {
        scheduler.schedule('first', first);
        for (const key of keys) scheduler.schedule(key, later);
        scheduler.flush();
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return {ms, queued: rounds * queuedPerRound,
        cancelled: cancelDuringFlush ? rounds * keys.length : 0, delivered};
}

/** Measures unchanged NaN view reads.
 *
 * @param Implementation - one prebuilt variant
 */
function views(Implementation) {
    const cache = new Implementation.cache(() => Promise.resolve(NaN), {ttl: Infinity});
    const key = cache.keyOf('a');
    cache.setData({entries: {[key]: {status: Implementation.status.Success, data: NaN,
        error: undefined, updatedAt: 100, refreshing: false, invalidated: false, failed: false}}});
    let previous = cache.getEntry('a');
    let identities = 1;
    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < viewReads; iteration++) {
        const view = iteration % 2 === 0 ? cache.getEntry('a') : cache.resolve('a').view;
        if (view !== previous) identities++;
        previous = view;
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (!Number.isNaN(previous.data)) throw new Error('Resource view lost NaN data');
    return {ms, reads: viewReads, identities};
}

for (const [name, scenario] of [
    ['cancelled deliveries', (implementation) => delivery(implementation, true)],
    ['uncancelled deliveries (control)', (implementation) => delivery(implementation, false)],
    ['unchanged NaN views', views],
]) {
    const results = {baseline: [], fixed: []};
    for (let round = -2; round < samples; round++) {
        const order = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];
        for (const side of order) {
            const result = scenario(implementations[side]);
            if (round >= 0) results[side].push(result);
        }
    }
    console.log(name);
    for (const side of ['baseline', 'fixed']) {
        const rows = results[side];
        const [work] = rows;
        console.log(`  ${side}: median=${median(rows.map((row) => row.ms)).toFixed(3)}ms`
            + ` range=${Math.min(...rows.map((row) => row.ms)).toFixed(3)}`
            + `-${Math.max(...rows.map((row) => row.ms)).toFixed(3)}ms`
            + ` queued=${work.queued ?? '-'} cancelled=${work.cancelled ?? '-'} delivered=${work.delivered ?? '-'}`
            + ` reads=${work.reads ?? '-'} viewIdentities=${work.identities ?? '-'}`);
    }
}
