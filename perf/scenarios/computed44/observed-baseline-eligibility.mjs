import assert from 'node:assert/strict';
import {emit, engine, engineKey} from '../../harness/lib.mjs';
import {api} from './api.mjs';

const {primary: {Carburetor, computed}} = await api();
const M = Number(process.argv[2]);
const lane = process.argv[3] ?? 'changed';
const equal = lane === 'equal';
const sources = Array.from({length: M}, () => new Carburetor({n: 1}));
let bodies = 0, phase;
const events = [];
const value = computed(read => {
    if (phase) phase.enteredBody = true;
    bodies++;
    const sum = sources.reduce((n, source) => n + read(source).n, 0);
    return equal ? 1 : sum;
});
const key = engineKey('recompute', value);
const original = value[key];
assert.equal(typeof original, 'function');
const own = Object.getOwnPropertyDescriptor(value, key);
value[key] = function(...args) {
    const previous = phase;
    phase = {snapshot: engine(this, 'versions'), enteredBody: false};
    try { return original.apply(this, args); }
    finally { phase = previous; }
};
const rawKeys = Object.keys;
const rawValues = Object.values;
const sourceSet = new Set(sources);
const valueWork = body => {
    const result = {calls: 0, entries: 0};
    Object.values = object => {
        const values = rawValues(object);
        if (phase?.enteredBody && values.length > 0
            && values.every(record => record !== null && typeof record === 'object'
                && sourceSet.has(Object.getOwnPropertyDescriptor(record, 'source')?.value))) {
            result.calls++; result.entries += values.length;
        }
        return values;
    };
    try { body(); return result; }
    finally { Object.values = rawValues; }
};
const count = body => {
    const result = {calls: 0, entries: 0};
    Object.keys = object => {
        const keys = rawKeys(object);
        if (phase && !phase.enteredBody && object === phase.snapshot) {
            result.calls++; result.entries += keys.length;
        }
        return keys;
    };
    try { body(); return result; }
    finally { Object.keys = rawKeys; }
};
const token = () => value[Symbol.for('react-carburetor/v1/computed-snapshot-version')]();
let observed, id, downstream, downstreamId;
let checksum = 0;
try {
    const cold = count(() => {
        if (lane === 'unobserved') value.get();
        else if (lane === 'downstream') {
            downstream = computed(read => read(value) * 2);
            downstreamId = downstream.subscribe(() => events.push(downstream.get()));
        } else id = value.subscribe(() => events.push(value.get()));
    });
    assert.deepEqual(cold, {calls: 1, entries: 0});
    const empty = count(() => {});
    const cached = count(() => { for (let i = 0; i < 16; i++) value.get(); });
    assert.deepEqual(empty, {calls: 0, entries: 0});
    assert.deepEqual(cached, empty);
    const positive = count(() => {
        phase = {snapshot: engine(value, 'versions'), enteredBody: false};
        try { Object.keys(phase.snapshot); }
        finally { phase = undefined; }
    });
    assert.deepEqual(positive, {calls: 1, entries: M});
    const valuePositive = valueWork(() => {
        phase = {snapshot: engine(value, 'versions'), enteredBody: true};
        try { Object.values(phase.snapshot); }
        finally { phase = undefined; }
    });
    assert.deepEqual(valuePositive, {calls: 1, entries: M});
    const before = bodies;
    const beforeToken = token();
    const captureValues = valueWork(() => {
        observed = count(() => {
            sources[0].update(draft => { draft.n++; });
            checksum += value.get();
        });
    });
    assert.equal(bodies, before + 1);
    assert.equal(value.get(), equal ? 1 : M + 1);
    assert.deepEqual(events, lane === 'unobserved' || equal ? [] : [lane === 'downstream' ? 2 * (M + 1) : M + 1]);
    assert.equal(value.getVersion(), lane === 'unobserved' || equal ? 0 : 1);
    assert.equal(token(), beforeToken + (equal ? 0 : 1));
    if (id !== undefined) { value.unsubscribe(id); id = undefined; }
    if (downstreamId !== undefined) { downstream.unsubscribe(downstreamId); downstreamId = undefined; }
    const releasedToken = token();
    const released = count(() => {
        sources[0].update(draft => { draft.n++; });
        checksum += value.get();
    });
    assert.equal(value.get(), equal ? 1 : M + 2);
    assert.equal(token(), releasedToken + (equal ? 0 : 1));
    assert.deepEqual(released, lane === 'unobserved' ? empty : positive);
    const valid = count(() => {
        sources[0].update(draft => { draft.n++; });
        checksum += value.get();
    });
    assert.deepEqual(valid, empty);
    assert.equal(value.get(), equal ? 1 : M + 3);
    assert.equal(token(), releasedToken + (equal ? 0 : 2));
    assert.equal(checksum, equal ? 3 : 3 * M + 6);
    emit({M, lane, preBodyCalls: observed.calls, preBodyEntries: observed.entries,
        positiveCalls: positive.calls, positiveEntries: positive.entries,
        captureValueCalls: captureValues.calls, captureValueEntries: captureValues.entries,
        positiveValueCalls: valuePositive.calls, positiveValueEntries: valuePositive.entries,
        coldCalls: cold.calls, coldEntries: cold.entries, cachedCalls: cached.calls, emptyCalls: empty.calls,
        releasedCalls: released.calls, releasedEntries: released.entries, validCalls: valid.calls,
        bodies: bodies - before, callbacks: events.length, publicVersion: value.getVersion(),
        checksum, semanticsCorrect: true, done: true});
} finally {
    if (id !== undefined) value.unsubscribe(id);
    if (downstreamId !== undefined) downstream.unsubscribe(downstreamId);
    if (own) Object.defineProperty(value, key, own); else delete value[key];
}
