import assert from 'node:assert/strict';
import {emit, engine} from '../../harness/lib.mjs';
import {api} from './api.mjs';
import {graph} from './graph.mjs';

const [K, M] = process.argv.slice(2, 4).map(Number);
const layout = process.argv[4] ?? 'aliases';
const f = graph(await api(layout === 'mixed'), K, M, layout);
const snapshots = f.inputs.map(input => engine(input, 'versions'));
const targets = new Set(snapshots);
const rawKeys = Object.keys;
const count = body => {
    const result = {calls: 0, entries: 0, uids: 0, edges: 0};
    const holders = [...f.sources, ...f.inputs];
    const descriptors = holders.map(holder => Object.getOwnPropertyDescriptor(holder, 'getUID'));
    const methods = holders.map(holder => holder.getUID);
    Object.keys = object => {
        const keys = rawKeys(object);
        if (targets.has(object)) { result.calls++; result.entries += keys.length; }
        return keys;
    };
    holders.forEach((holder, i) => {
        holder.getUID = function() {
            if (i < M) result.uids++; else result.edges++;
            return methods[i].call(this);
        };
    });
    try { body(); return result; }
    finally {
        Object.keys = rawKeys;
        holders.forEach((holder, i) => {
            if (descriptors[i]) Object.defineProperty(holder, 'getUID', descriptors[i]);
            else delete holder.getUID;
        });
    }
};
try {
    const initial = f.top.get();
    let checksum = initial;
    assert.equal(initial, f.initial);
    const empty = count(() => {});
    const cached = count(() => { for (let i = 0; i < 16; i++) assert.equal(f.top.get(), f.initial); });
    const positive = count(() => {
        snapshots.forEach(snapshot => Object.keys(snapshot));
        f.sources.forEach(source => source.getUID());
        for (let i = 0; i < K; i++) f.inputs[i % f.inputs.length].getUID();
    });
    assert.deepEqual(empty, {calls: 0, entries: 0, uids: 0, edges: 0});
    assert.deepEqual(cached, empty);
    assert.deepEqual(positive, {calls: snapshots.length, entries: snapshots.length * M, uids: M, edges: K});
    const before = structuredClone(f.runs);
    const update = count(() => {
        const current = f.bump();
        checksum += current;
        assert.equal(current, f.initial + 1);
    });
    assert.equal(f.runs.top, before.top + 1);
    assert.equal(f.runs.group, before.group);
    assert.deepEqual(f.runs.aliases, before.aliases);
    assert.deepEqual(f.events, [f.initial + 1]);
    assert.equal(f.top.getVersion(), 1);
    assert.equal(Object.keys(engine(f.top, 'dependencies')).length,
        (layout === 'direct' ? 1 : K) + 1 + (layout === 'external' ? 1 : 0));
    assert.ok(f.coverage());
    const leaves = Object.keys(engine(f.top, 'versions')).length;
    assert.equal(leaves, M + 1 + (layout === 'external' ? 1 : 0));
    const tickState = structuredClone(f.runs);
    const noise = count(() => { f.sources[0].update(draft => { draft.noise++; }); f.top.get(); });
    assert.deepEqual(noise, empty);
    assert.deepEqual(f.runs, tickState);
    f.sources[0].update(draft => { draft.n++; });
    const final = f.top.get();
    checksum += final;
    assert.equal(final, f.initial + 1 + K);
    assert.equal(checksum, 3 * f.initial + 2 + K);
    assert.deepEqual(f.events, [f.initial + 1, f.initial + 1 + K]);
    assert.equal(f.top.getVersion(), 2);
    assert.ok(f.intact());
    assert.ok(f.coverage());
    if (layout === 'external') {
        assert.equal(f.silent(), f.initial + 2 + K);
        assert.equal(f.top.getVersion(), 2);
        assert.deepEqual(f.events, [f.initial + 1, f.initial + 1 + K]);
    }
    emit({K, M, layout, initial, checksum,
        inputEdges: update.edges, keyCalls: update.calls, keyEntries: update.entries, leafUIDs: update.uids,
        positiveCalls: positive.calls, positiveEntries: positive.entries, positiveUIDs: positive.uids,
        positiveEdges: positive.edges, emptyEntries: empty.entries, cachedEntries: cached.entries,
        noiseEntries: noise.entries, leaves,
        callbacks: f.events.length, publicVersion: f.top.getVersion(),
        snapshotsIntact: f.intact(), coverage: f.coverage(), semanticsCorrect: true, done: true});
} finally { f.close(); }
