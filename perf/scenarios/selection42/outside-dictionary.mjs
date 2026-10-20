/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// R42-S01. Args: [width=128] [samples=7] [cycles=16]. Counters and timing use different stores.
import assert from 'node:assert/strict';
import {emit, load, median} from '../../harness/lib.mjs';
const {Carburetor} = await load();
class Store extends Carburetor {
    recorded = 0;
    run(fn) { this.update(fn); }
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
}
const width = Number(process.argv[2] ?? 128);
const samples = Number(process.argv[3] ?? 7);
const cycles = Number(process.argv[4] ?? 16);
assert.ok(Number.isInteger(width) && width >= 2 && samples > 0 && cycles > 0);
const dictionary = () => Object.fromEntries(Array.from({length: width}, (_, i) => ['k' + i, {n: i}]));
const sum = box => Object.values(box).reduce((total, row) => total + row.n, 0);
const originalSum = width * (width - 1) / 2;
const enumerate = fn => {
    const original = Object.keys;
    let calls = 0, keys = 0;
    Object.keys = value => {
        const result = original(value);
        if (!Array.isArray(value) && result.length === width && result[0] === 'k0'
            && result[width - 1] === 'k' + (width - 1)) { calls++; keys += result.length; }
        return result;
    };
    try { fn(); } finally { Object.keys = original; }
    return {calls, keys};
};
const store = new Store({box: dictionary(), tick: 0});
const seen = [], before = [];
let selectors = 0;
const stop = store.watch(d => { selectors++; void d.tick; return d.box; },
    (next, previous) => { seen.push(next); before.push(previous); });
store.run(d => { d.box.k0.n = -1; });
assert.equal(seen.length, 1);
const held = seen[0];
const empty = enumerate(() => store.run(d => { d.tick = 0; }));
const positive = enumerate(() => { assert.equal(Object.keys(held).length, width); });
const selectorStart = selectors;
store.recorded = 0;
const outside = enumerate(() => { for (let i = 0; i < 8; i++) store.run(d => { d.tick++; }); });
const trackedReads = store.recorded, outsideSelectors = selectors - selectorStart;
const outsideDeliveries = seen.length - 1;
const selected = enumerate(() => store.run(d => { d.box.k0.n = -2; }));
assert.equal(seen.length, 2);
assert.equal(before[1], held);
assert.equal(held.k0.n, -1);
assert.equal(seen[1].k0.n, -2);
assert.equal(seen[1].k1, held.k1);
assert.equal(sum(before[0]), originalSum);
assert.equal(sum(held), originalSum - 1);
assert.equal(sum(seen[1]), originalSum - 2);
stop();
// Array route: same public watch and detached baseline, but no dictionary size enumeration.
const arrayStore = new Store({tick: 0, box: Array.from({length: width}, (_, n) => ({n}))});
const arraySeen = [], arrayBefore = [];
const closeArray = arrayStore.watch(d => (void d.tick, d.box), (next, previous) => {
    arraySeen.push(next); arrayBefore.push(previous);
});
arrayStore.run(d => { d.box[0].n = -1; });
const arrayHeld = arraySeen[0];
const array = enumerate(() => { for (let i = 0; i < 8; i++) arrayStore.run(d => { d.tick++; }); });
assert.equal(arraySeen.length, 1);
arrayStore.run(d => { d.box[0].n = -2; });
assert.equal(arraySeen.length, 2);
assert.equal(arrayBefore[1], arrayHeld);
assert.equal(arraySeen[1][1], arrayHeld[1]);
assert.equal(sum(arrayHeld), originalSum - 1);
assert.equal(sum(arraySeen[1]), originalSum - 2);
closeArray();
// Uninstrumented warmed whole update -> selector/reuse/completion -> delivery lane.
class TimingStore extends Carburetor { run(fn) { this.update(fn); } }
const timed = new TimingStore({box: dictionary(), tick: 0});
let timedCallbacks = 0, callbackChecksum = 0, latest, prior;
const closeTimed = timed.watch(d => (void d.tick, d.box), (next, previous) => {
    timedCallbacks++; callbackChecksum += next.k0.n; latest = next; prior = previous;
});
let edits = 0;
const operation = () => {
    timed.run(d => { d.box.k0.n = -(++edits); });
    for (let i = 0; i < 8; i++) timed.run(d => { d.tick++; });
    timed.run(d => { d.box.k0.n = -(++edits); });
};
// Exclude short-window startup effects before timing steady completed operations.
const warmCycles = 512;
for (let i = 0; i < warmCycles; i++) operation();
const times = [];
for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < cycles; i++) operation();
    times.push(performance.now() - start);
    assert.equal(timedCallbacks, edits);
    assert.equal(callbackChecksum, -edits * (edits + 1) / 2);
    assert.equal(sum(latest), originalSum - edits);
    assert.equal(prior.k0.n, -(edits - 1));
    assert.equal(latest.k1, prior.k1);
}
assert.equal(timed.getData().tick, 8 * (warmCycles + samples * cycles));
closeTimed();
emit({width, outsideCalls: outside.calls, outsideKeys: outside.keys, trackedReads, outsideSelectors,
    outsideDeliveries, selectedEdits: seen.length, heldIdentity: before[1] === held,
    historyCorrect: held.k0.n === -1, untouchedShared: seen[1].k1 === held.k1,
    heldChecksum: sum(held), finalChecksum: sum(seen[1]),
    emptyCalls: empty.calls, positiveCalls: positive.calls, positiveKeys: positive.keys,
    selectedCalls: selected.calls, selectedKeys: selected.keys, arrayCalls: array.calls, arrayKeys: array.keys,
    arrayEdits: arraySeen.length, arrayChecksum: sum(arraySeen[1]), timingCallbacks: timedCallbacks,
    timingChecksum: callbackChecksum, outsideWatchMs: median(times), timingCycles: cycles, done: true});
