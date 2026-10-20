/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Uninstrumented warm read batches. No GC, descriptor taps, subscriptions or writes.
import assert from 'node:assert/strict';
import {emit, load, median} from './fixture.mjs';
const {Carburetor} = await load();
const width = Number(process.argv[2] ?? 32);
assert.ok(Number.isInteger(width) && width > 0 && width <= 4096);
const store = new Carburetor({stamp: new Date(1000), scalar: 7,
    map: new Map(Array.from({length: width}, (_, i) => [i, i]))});
const view = store.read(() => {}), raw = store.getData();
const batch = 4096, iterationBatch = 32, samples = 9;
const operations = {
    leaf: () => { let sum = 0; for (let i = 0; i < batch; i++) sum += view.stamp.getTime(); return sum; },
    scalar: () => { let sum = 0; for (let i = 0; i < batch; i++) sum += view.scalar; return sum; },
    iteration: () => { let sum = 0; for (let i = 0; i < iterationBatch; i++) for (const n of view.map.values()) sum += n; return sum; },
    rawIteration: () => { let sum = 0; for (let i = 0; i < iterationBatch; i++) for (const n of raw.map.values()) sum += n; return sum; },
};
const expected = {leaf: batch * 1000, scalar: batch * 7,
    iteration: iterationBatch * width * (width - 1) / 2, rawIteration: iterationBatch * width * (width - 1) / 2};
for (let warm = 0; warm < 8; warm++) {
    for (const [name, operation] of Object.entries(operations)) assert.equal(operation(), expected[name]);
}
const times = Object.fromEntries(Object.keys(operations).map(name => [name, []]));
for (let sample = 0; sample < samples; sample++) {
    const names = Object.keys(operations);
    if (sample % 2) names.reverse();
    for (const name of names) {
        const start = performance.now();
        const checksum = operations[name]();
        times[name].push(performance.now() - start);
        assert.equal(checksum, expected[name]);
    }
}
emit({width, samples, batch, iterationBatch, leafReadMs: median(times.leaf), scalarReadMs: median(times.scalar),
    nativeIterationMs: median(times.iteration), rawIterationMs: median(times.rawIteration), checksumsCorrect: true});
