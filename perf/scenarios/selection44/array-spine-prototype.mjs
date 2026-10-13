import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot, emit} from '../../harness/lib.mjs';
const esm = resolve(distRoot, 'Carburetor/index.mjs');
let countedSpine, slotVisits = 0;
const savedOwn = Object.prototype.hasOwnProperty;
Object.prototype.hasOwnProperty = function(key) {
    if (this === countedSpine && String(Number(key)) === String(key)) slotVisits++;
    return savedOwn.call(this, key);
};
const probeOwn = Object.prototype.hasOwnProperty;
let api;
try {
    api = existsSync(esm) ? await import(pathToFileURL(esm).href)
        : createRequire(import.meta.url)(resolve(distRoot, 'Carburetor/index.js'));
} finally { Object.prototype.hasOwnProperty = savedOwn; }
class Store extends api.Carburetor {
    /** Completes a public update. */
    run(fn) { this.update(fn); }
}
let cases = 0, deliveries = 0, scalarDeliveries = 0, projectedDeliveries = 0, unrelatedDeliveries = 0;
let ownKeyEntries = 0, positiveArrays = 0, diagnostics = 0;
let positiveSlotVisits = 0, positiveOwnKeyEntries = 0;
let sliceCalls = 0, sliceLengthSum = 0, assignCalls = 0;
const [occupied = 8, length = 64] = process.argv.slice(2).map(Number);
for (const prototype of [Array.prototype, null, Object.prototype]) {
    for (const shape of ['dense', 'sparse']) for (const nested of [false, true]) {
        const rows = [];
        rows.length = shape === 'dense' ? occupied : length;
        for (let i = 0; i < occupied; i++) rows[shape === 'dense' ? i : i * Math.floor(length / occupied)] = {n: i};
        Object.setPrototypeOf(rows, prototype);
        const last = shape === 'dense' ? occupied - 1 : (occupied - 1) * Math.floor(length / occupied);
        const store = new Store({box: {rows, keep: {n: 7}}, spare: 0});
        const events = [];
        const stops = [store.watch(d => nested ? d.box : d.box.rows, (next, previous) => events.push({next, previous})),
            store.watch(d => d.box.rows[0].n, () => scalarDeliveries++),
            store.watch(d => ({rows: d.box.rows}), () => projectedDeliveries++),
            store.watch(d => d.spare, () => unrelatedDeliveries++)];
        const ownKeys = Reflect.ownKeys, own = Object.prototype.hasOwnProperty, error = console.error;
        let known, savedSlice, savedAssign;
        const rowsOf = value => nested ? value.rows : value;
        try {
            // Capture a detached baseline via the first delivery, outside the counted window.
            store.run(d => { d.box.rows[0].n = 1; });
            assert.equal(events.length, 1);
            known = rowsOf(events[0].next);
            Reflect.ownKeys = value => {
                const keys = ownKeys(value);
                if (value === known) ownKeyEntries += keys.length;
                return keys;
            };
            countedSpine = known;
            const beforeSlots = slotVisits, beforeKeys = ownKeyEntries;
            assert.equal(probeOwn.call(known, '0'), true);
            assert.ok(Reflect.ownKeys(known).includes('length'));
            positiveSlotVisits += slotVisits - beforeSlots;
            positiveOwnKeyEntries += ownKeyEntries - beforeKeys;
            slotVisits = beforeSlots; ownKeyEntries = beforeKeys;
            console.error = (...args) => { diagnostics++; error(...args); };
            savedSlice = Array.prototype.slice;
            savedAssign = Object.assign;
            Array.prototype.slice = function(...args) {
                sliceCalls++; sliceLengthSum += this.length;
                return savedSlice.apply(this, args);
            };
            Object.assign = (target, ...sources) => (assignCalls++, savedAssign.call(Object, target, ...sources));
            store.run(d => { d.box.rows[0].n = 2; });
        } finally {
            countedSpine = undefined;
            Reflect.ownKeys = ownKeys; Object.prototype.hasOwnProperty = own; console.error = error;
            if (savedSlice) { Array.prototype.slice = savedSlice; Object.assign = savedAssign; }
        }
        try {
            assert.equal(events.length, 2);
            const before = rowsOf(events[1].previous), after = rowsOf(events[1].next);
            assert.equal(before, known); assert.equal(before[0].n, 1); assert.equal(after[0].n, 2);
            assert.equal(after[last], before[last]);
            assert.equal(after.length, rows.length); assert.equal(Object.getPrototypeOf(after), prototype);
            assert.deepEqual(Object.keys(after), Object.keys(before));
            if (nested) assert.equal(events[1].next.keep, events[1].previous.keep);
            store.run(d => { d.box.rows[0].n = 2; });
            assert.equal(events.length, 2);
            deliveries += events.length; positiveArrays++; cases++;
        } finally { stops.forEach(stop => stop()); }
    }
}
// Counts are real own-key entries and own-slot tests on the held spine only, not estimated L visits.
assert.equal(positiveSlotVisits, cases);
assert.ok(positiveOwnKeyEntries >= cases * (occupied + 1));
assert.equal(diagnostics, 0);
emit({cases, deliveries, scalarDeliveries, projectedDeliveries, unrelatedDeliveries,
    slotVisits, ownKeyEntries, positiveSlotVisits, positiveOwnKeyEntries, sliceCalls, sliceLengthSum, assignCalls,
    positiveArrays, diagnostics, occupied, length, correct: true});
