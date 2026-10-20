/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot, emit} from '../../harness/lib.mjs';
const require = createRequire(import.meta.url);
const esm = resolve(distRoot, 'Carburetor/index.mjs');
const format = process.env.R43_FORMAT;
const useESM = format ? format === 'esm' || format === 'esm-prod' : existsSync(esm);
const api = useESM ? await import(pathToFileURL(esm).href)
    : require(resolve(distRoot, 'Carburetor/index.js'));
const {Carburetor, CarburetorHistory} = api;
class Store extends Carburetor { run(fn) { this.update(fn); } }
const kinds = ['scalar', 'flat', 'keyed', 'fresh', 'dense', 'sparse', 'map', 'freshDense', 'freshSparse'];
// A fresh wrapper and fresh nested array on every call bypass the live-selection patch lane.
// Primitive slots reach the dense-prefix and sparse-index content gates independently.
const projectArray = (kind, n) => {
    const slots = kind === 'freshDense' ? [n, {tag: 1}] : [];
    if (kind === 'freshSparse') { slots.length = 8; slots[3] = n; slots[6] = {tag: 1}; }
    return {slots, keep: {tag: 2}};
};
const make = (kind, n) => {
    let box = {n, keep: {tag: 1}};
    if (kind === 'dense') box = [n, {tag: 1}];
    if (kind === 'sparse') { box = []; box.length = 8; box[3] = n; box[6] = {tag: 1}; }
    if (kind === 'map') box = new Map([['n', n]]);
    return {value: n, box, unread: {n: 0}};
};
const select = kind => d => kind === 'freshDense' || kind === 'freshSparse' ? projectArray(kind, d.value)
    : kind === 'scalar' ? d.value : kind === 'flat' ? {n: d.value}
    : kind === 'fresh' ? {row: {n: d.value}, keep: {tag: 1}} : d.box;
const take = (kind, x) => kind === 'freshDense' ? x.slots[0] : kind === 'freshSparse' ? x.slots[3]
    : kind === 'scalar' ? x : kind === 'fresh' ? x.row.n
    : kind === 'dense' ? x[0] : kind === 'sparse' ? x[3] : kind === 'map' ? x.get('n') : x.n;
const put = (kind, d, n) => {
    if (['scalar', 'flat', 'fresh', 'freshDense', 'freshSparse'].includes(kind)) d.value = n;
    else if (kind === 'dense') d.box[0] = n;
    else if (kind === 'sparse') d.box[3] = n;
    else if (kind === 'map') d.box.set('n', n);
    else d.box.n = n;
};
let cases = 0, deliveries = 0, historyReplays = 0, unrelatedDeliveries = 0;
let freshArrayCases = 0, freshArrayDeliveries = 0, freshArraySharingChecks = 0;
for (const kind of kinds) {
    for (const [start, finish, canceled] of [[+0, -0, false], [-0, +0, false], [NaN, NaN, true], [1, 2, false], [2, 2, false]]) {
        const store = new Store(make(kind, start)), history = new CarburetorHistory(store);
        const selector = select(kind), events = [], reads = new Set();
        void store.read(path => reads.add(path)).unread.n;
        const id = store.subscribe(() => unrelatedDeliveries++, {reads});
        const stop = store.watch(selector, (next, previous) => events.push({next, previous}));
        const raw = () => take(kind, selector(store.getData()));
        try {
            store.run(d => { if (canceled) put(kind, d, 1); put(kind, d, finish); });
            assert.ok(Object.is(raw(), finish));
            const changed = !Object.is(start, finish);
            assert.equal(events.length, changed ? 1 : 0);
            deliveries += events.length;
            if (changed) {
                assert.ok(Object.is(take(kind, events[0].previous), start));
                assert.ok(Object.is(take(kind, events[0].next), finish));
                assert.equal(history.undo(), true); assert.ok(Object.is(raw(), start));
                assert.equal(history.redo(), true); assert.ok(Object.is(raw(), finish));
                assert.equal(events.length, 3);
                assert.equal(events[1].previous, events[0].next);
                assert.equal(events[2].previous, events[1].next);
                assert.ok(Object.is(take(kind, events[1].next), start));
                assert.ok(Object.is(take(kind, events[2].next), finish));
                assert.ok(Object.is(take(kind, events[0].previous), start));
                assert.ok(Object.is(take(kind, events[0].next), finish));
                historyReplays += 2;
            } else assert.equal(history.canUndo(), false);
            if (kind === 'sparse') {
                for (const box of [store.getData().box, ...events.flatMap(e => [e.previous, e.next])]) {
                    assert.equal(box.length, 8); assert.equal(Object.hasOwn(box, 0), false);
                    assert.equal(Object.hasOwn(box, 3), true); assert.equal(box[6].tag, 1);
                }
            }
            if (kind === 'freshDense' || kind === 'freshSparse') {
                freshArrayCases++; freshArrayDeliveries += events.length;
                for (const event of events) {
                    const index = kind === 'freshDense' ? 1 : 6;
                    assert.equal(event.next.slots[index], event.previous.slots[index]);
                    assert.equal(event.next.keep, event.previous.keep);
                    freshArraySharingChecks += 2;
                    if (kind === 'freshSparse') for (const snapshot of [event.previous, event.next]) {
                        assert.equal(snapshot.slots.length, 8);
                        assert.deepEqual(Object.keys(snapshot.slots), ['3', '6']);
                    }
                }
                const projected = selector(store.getData());
                if (kind === 'freshSparse') assert.deepEqual(Object.keys(projected.slots), ['3', '6']);
            }
            cases++;
        } finally { stop(); store.unsubscribe(id); history.disconnect(); }
    }
}
// Count actual cloneSpine primitives, not estimated allocation or callback counts.
// Only the known detached baseline is charged; the stack must name the patch module.
// Both branches have a positive finite edit, so a lost/minified hook cannot pass silently.
const countSpines = (baseline, operation) => {
    const assign = Object.assign, slice = Array.prototype.slice;
    let copies = 0;
    const charge = () => {
        assert.match(new Error().stack, /patchSelection/);
        copies++;
    };
    Object.assign = function(target, ...sources) {
        if (sources.includes(baseline)) charge();
        return assign(target, ...sources);
    };
    Array.prototype.slice = function(...args) {
        if (this === baseline) charge();
        return Reflect.apply(slice, this, args);
    };
    try { operation(); } finally { Object.assign = assign; Array.prototype.slice = slice; }
    return copies;
};
let positiveSpines = 0, canceledSpines = 0, canceledDeliveries = 0;
for (const kind of ['keyed', 'dense', 'sparse']) {
    const store = new Store(make(kind, 0)), events = [];
    const stop = store.watch(select(kind), (next, previous) => events.push({next, previous}));
    try {
        store.run(d => put(kind, d, 1));
        assert.equal(events.length, 1);
        const held = events[0].next;
        const positive = countSpines(held, () => store.run(d => put(kind, d, 2)));
        assert.equal(positive, 1); positiveSpines += positive;
        assert.equal(events[1].previous, held);
        assert.equal(take(kind, held), 1);
        store.run(d => put(kind, d, NaN));
        const baseline = events.at(-1).next, before = events.length;
        const canceled = countSpines(baseline, () => store.run(d => { put(kind, d, 1); put(kind, d, NaN); }));
        assert.equal(canceled, 0); canceledSpines += canceled;
        canceledDeliveries += events.length - before;
        assert.equal(events.length, before);
        assert.ok(Number.isNaN(take(kind, baseline)));
    } finally { stop(); }
}
emit({cases, deliveries, historyReplays, unrelatedDeliveries, freshArrayCases, freshArrayDeliveries,
    freshArraySharingChecks, positiveSpines, canceledSpines,
    canceledDeliveries, historyCorrect: true, sparseShape: true, done: true});
