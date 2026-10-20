/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// No monkeypatches or history in the measured store; history controls run separately, untimed.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot, emit, median} from '../../harness/lib.mjs';
const require = createRequire(import.meta.url);
const esm = resolve(distRoot, 'Carburetor/index.mjs');
const format = process.env.R43_FORMAT;
const useESM = format ? format === 'esm' || format === 'esm-prod' : existsSync(esm);
const api = useESM ? await import(pathToFileURL(esm).href)
    : require(resolve(distRoot, 'Carburetor/index.js'));
const {Carburetor, CarburetorHistory} = api;
class Store extends Carburetor { run(fn) { this.update(fn); } }
const kind = process.argv[2] ?? 'keyed';
const width = Number(process.argv[3] ?? 128);
const samples = Number(process.argv[4] ?? 7), cycles = Number(process.argv[5] ?? 128);
assert.ok(['keyed', 'dense', 'sparse'].includes(kind));
assert.ok(Number.isInteger(width) && width >= 8 && Number.isInteger(samples) && samples > 0
    && Number.isInteger(cycles) && cycles > 0);
const make = n => {
    if (kind === 'keyed') {
        const box = Object.fromEntries(Array.from({length: width}, (_, i) => ['k' + i, i === 0 ? n : i]));
        box['k' + (width - 1)] = {tag: 1};
        return box;
    }
    const box = []; box.length = width; box[0] = n;
    for (let i = 1; i < width; i++) if (kind === 'dense' || i % 3 === 0) box[i] = i;
    box[width - 1] = {tag: 1};
    return box;
};
const key = kind === 'keyed' ? 'k0' : 0;
// Shared by baseline and fix: cancellation must leave no undo entry, but baseline
// selection callbacks are allowed. Finite edits and both replays have exact endpoints.
const historyControl = () => {
    const store = new Store({box: make(NaN)}), history = new CarburetorHistory(store);
    const events = [];
    const stop = store.watch(d => d.box, (next, previous) => events.push({next, previous}));
    const raw = expected => {
        assert.ok(Object.is(store.getData().box[key], expected));
        if (kind === 'sparse') {
            assert.equal(store.getData().box.length, width);
            assert.equal(Object.hasOwn(store.getData().box, 1), false);
        }
    };
    const endpoints = (event, previous, next) => {
        assert.ok(Object.is(event.previous[key], previous));
        assert.ok(Object.is(event.next[key], next));
    };
    try {
        store.run(d => { d.box[key] = 1; d.box[key] = NaN; });
        raw(NaN);
        for (const event of events) endpoints(event, NaN, NaN);
        assert.equal(history.canUndo(), false);
        assert.equal(history.undo(), false);
        assert.equal(history.canRedo(), false);
        raw(NaN);
        store.run(d => { d.box[key] = 0; });
        raw(0);
        events.length = 0;
        store.run(d => { d.box[key] = 2; });
        raw(2);
        assert.equal(events.length, 1); endpoints(events[0], 0, 2);
        assert.equal(history.undo(), true); raw(0);
        assert.equal(events.length, 2); endpoints(events[1], 2, 0);
        assert.equal(events[1].previous, events[0].next);
        assert.equal(history.redo(), true); raw(2);
        assert.equal(events.length, 3); endpoints(events[2], 0, 2);
        assert.equal(events[2].previous, events[1].next);
        // Held snapshots must retain their values through both replays.
        endpoints(events[0], 0, 2); endpoints(events[1], 2, 0);
        return {historyCancellationCorrect: true, historyEndpointsCorrect: true, historyReplays: 2};
    } finally { stop(); history.disconnect(); }
};
const controls = historyControl();
const run = mode => {
    const store = new Store({box: make(mode === 'canceled' ? NaN : 0)});
    let callbacks = 0, checksum = 0, edits = 0, selectorCalls = 0, operations = 0, held, prior;
    const stop = store.watch(d => { selectorCalls++; return d.box; }, (next, previous) => {
        callbacks++;
        if (mode === 'canceled') {
            assert.ok(Number.isNaN(next[key])); assert.ok(Number.isNaN(previous[key]));
        } else checksum += next[key];
        held = next; prior = previous;
    });
    const operation = () => store.run(d => {
        operations++;
        if (mode === 'canceled') { d.box[key] = 1; d.box[key] = NaN; }
        else d.box[key] = ++edits;
    });
    const times = [], warm = 512;
    try {
        for (let i = 0; i < warm; i++) operation();
        for (let sample = 0; sample < samples; sample++) {
            const start = performance.now();
            for (let i = 0; i < cycles; i++) operation();
            times.push(performance.now() - start);
            if (mode === 'canceled') assert.ok(Number.isNaN(store.getData().box[key]));
            else {
                assert.equal(callbacks, edits);
                assert.equal(store.getData().box[key], edits);
                assert.equal(checksum, edits * (edits + 1) / 2);
                assert.equal(held[key], edits); assert.equal(prior[key], edits - 1);
            }
        }
        if (kind === 'sparse') {
            assert.equal(Object.hasOwn(store.getData().box, 1), false);
            assert.equal(store.getData().box.length, width);
        }
        return {ms: median(times), callbacks, checksum, selectorCalls, operations};
    } finally { stop(); }
};
const canceled = run('canceled'), finite = run('finite');
emit({...controls, width, canceledCallbacks: canceled.callbacks, finiteCallbacks: finite.callbacks,
    canceledSelectorCalls: canceled.selectorCalls, canceledOperations: canceled.operations,
    finiteSelectorCalls: finite.selectorCalls, finiteOperations: finite.operations,
    finiteChecksum: finite.checksum, canceledWatchMs: canceled.ms, finiteWatchMs: finite.ms,
    timingCycles: cycles, done: true});
