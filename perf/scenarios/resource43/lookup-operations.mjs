/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, dimension, entry} from './fixture.mjs';

const iterations = dimension('iterations', 1024, 65536);
let loaderCalls = 0;
const loader = () => {
    loaderCalls++;
    throw new Error('lookup called loader');
};
const objectCache = new api.ResourceCache(loader, {ttl: Infinity});
const primitiveCache = new api.ResourceCache(loader, {ttl: Infinity});
const objectQuery = {id: 'hit'};
const primitiveQuery = 'hit';
objectCache.setData({entries: {'{"id":"hit"}': entry('answer')}});
primitiveCache.setData({entries: {'"hit"': entry('answer')}});
let checksum = 0;

let start = performance.now();
for (let i = 0; i < iterations; i++) {
    const r = objectCache.resolve(objectQuery);
    assert.equal(r.present, true);
    assert.equal(r.view.data, 'answer');
    assert.equal(r.key, '{"id":"hit"}');
    checksum += r.view.data.length;
}
const objectHitMs = performance.now() - start;

start = performance.now();
for (let i = 0; i < iterations; i++) {
    const r = objectCache.resolve({id: 'miss'});
    assert.equal(r.present, false);
    assert.equal(r.view.data, undefined);
    assert.equal(r.key, '{"id":"miss"}');
    checksum += r.key.length;
}
const objectMissMs = performance.now() - start;

start = performance.now();
for (let i = 0; i < iterations; i++) {
    const r = primitiveCache.resolve(primitiveQuery);
    assert.equal(r.present, true);
    assert.equal(r.view.data, 'answer');
    assert.equal(r.key, '"hit"');
    checksum += r.view.data.length;
}
const primitiveHitMs = performance.now() - start;

start = performance.now();
for (let i = 0; i < iterations; i++) {
    const r = primitiveCache.resolve('miss');
    assert.equal(r.present, false);
    assert.equal(r.view.data, undefined);
    assert.equal(r.key, '"miss"');
    checksum += r.key.length;
}
const primitiveMissMs = performance.now() - start;

assert.equal(checksum, 31 * iterations);
assert.equal(loaderCalls, 0);
emit({objectHitMs, objectMissMs, primitiveHitMs, primitiveMissMs,
    operations: 4 * iterations, checksum, loaderCalls, done: true});
