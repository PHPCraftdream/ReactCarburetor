/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, ready, option} from './fixture.mjs';
const iterations = Number(option('iterations', 1024));
assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 65536);
let loaderCalls = 0, checksum = 0, operations = 0, awaitMs = 0, thenMs = 0;
for (const capacity of [8, Infinity]) for (const kind of ['primitive', 'object']) {
    const args = kind === 'primitive' ? 'a' : {id: 'a'};
    const cache = new api.ResourceCache(() => { loaderCalls++; throw new Error('fresh loader'); },
        {ttl: Infinity, maxEntries: capacity});
    cache.setData({entries: {[cache.resolve(args).key]: ready(7)}});
    await cache.load(args);
    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await cache.load(args);
        checksum += cache.getEntry(args).data;
    }
    awaitMs += performance.now() - start;
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await cache.load(args).then(() => { checksum += cache.getEntry(args).data; });
    }
    thenMs += performance.now() - start;
    operations += 2 * iterations;
    cache.clear();
}
assert.equal(checksum, 56 * iterations); assert.equal(loaderCalls, 0);
emit({operations, checksum, loaderCalls, awaitMs, thenMs, done: true});
