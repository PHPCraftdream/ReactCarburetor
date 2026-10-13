import assert from 'node:assert/strict';
import {emit, engine} from '../../harness/lib.mjs';
import {api} from './api.mjs';

const libraries = await api(true);
const {primary: {Carburetor, computed, transaction}, peer} = libraries;
const {computedDependencies} = await libraries.module('Carburetor/Derived/computedDependencies');
let cases = 0;
for (const observed of [false, true]) {
    const store = new Carburetor({a: 1, b: 2, noise: 0});
    const branch = new Carburetor({right: false});
    const left = computed(read => read(store).a);
    const right = peer.computed(read => read(store).a + read(store).b);
    const total = peer.computed(read => read(branch).right ? read(right) : read(left));
    const events = [];
    const id = observed ? total.subscribe(() => events.push(total.get())) : undefined;
    try {
        assert.equal(total.get(), 1);
        let eager;
        transaction(() => {
            branch.update(draft => { draft.right = true; });
            eager = total.get();
            assert.deepEqual(events, []);
        });
        assert.equal(eager, 3);
        assert.equal(total.get(), 3);
        assert.deepEqual(events, observed ? [3] : []);
        store.update(draft => { draft.b++; });
        assert.equal(total.get(), 4);
        assert.deepEqual(events, observed ? [3, 4] : []);
        const count = events.length;
        store.update(draft => { draft.noise++; });
        assert.equal(total.get(), 4);
        assert.equal(events.length, count);
        const overlap = computed(read => read(left) + read(right));
        assert.equal(overlap.get(), 5);
        const record = Object.values(engine(overlap, 'versions')).find(item => item.source === store);
        assert.equal(record.parts.length, 2);
        assert.ok(record.parts.every(part => part.reads instanceof Set));
        cases++;
    } finally { if (id !== undefined) total.unsubscribe(id); }
}
const source = new Carburetor({n: 1});
const inner = computed(read => read(source).n);
const outer = peer.computed(read => read(inner));
assert.equal(outer.get(), 1);
const version = source.getVersion;
let silentVersion = 0;
const own = Object.getOwnPropertyDescriptor(source, 'getVersion');
source.getVersion = function() { return version.call(this) + silentVersion; };
try {
    const tick = new Carburetor({n: 0});
    const consumer = computed(read => read(outer) + read(tick).n);
    assert.equal(consumer.get(), 1);
    tick.update(draft => { draft.n++; });
    assert.equal(consumer.get(), 2);
    assert.equal(engine(consumer, 'allNativeSources'), false);
    silentVersion++;
    assert.equal(consumer.get(), 2);
    assert.equal(engine(consumer, 'allNativeSources'), false);
    cases++;
} finally {
    if (own) Object.defineProperty(source, 'getVersion', own); else delete source.getVersion;
}
const collisionSource = new Carburetor({n: 1});
const reads = new Set(['n']);
const versions = [0, 1];
const foreign = versions.map((version, index) => ({
    get: () => index + 1, getUID: () => 'r44-foreign-' + index, getVersion: () => 0,
    subscribe: () => 'foreign', unsubscribe: () => {},
    snapshot: {arbitraryPublicKey: {source: collisionSource, version, reads, data: {n: index + 1}}},
}));
foreign.forEach(producer => computedDependencies.versions.set(producer, () => producer.snapshot));
try {
    const combined = peer.computed(read => read(foreign[0]) + read(foreign[1]) + read(foreign[0]));
    assert.equal(combined.get(), 4);
    const record = engine(combined, 'versions')[':' + collisionSource.getUID()];
    assert.deepEqual(record.parts.map(part => part.version), versions);
    assert.ok(record.parts.every(part => part.reads === reads));
    assert.equal(record.version, 1);
    assert.equal(record.data, foreign[1].snapshot.arbitraryPublicKey.data);
    const {captureLeafVersions} = await libraries.module('Carburetor/Derived/Freshness/captureLeafVersions');
    const destination = {};
    const result = captureLeafVersions({
        first: {source: foreign[0], reads: new Set()},
        second: {source: foreign[1], reads: new Set()},
        last: {source: foreign[0], reads: new Set()},
    }, destination);
    const snapshot = result && typeof result === 'object' ? result.versions : destination;
    const ordered = snapshot[':' + collisionSource.getUID()];
    assert.deepEqual(ordered.parts.map(part => part.version), versions);
    assert.ok(ordered.parts.every(part => part.reads === reads));
    assert.equal(ordered.version, 0);
    assert.equal(ordered.data, foreign[0].snapshot.arbitraryPublicKey.data);
    assert.deepEqual(foreign.map(producer => producer.snapshot.arbitraryPublicKey.version), versions);
    assert.deepEqual(Array.from(reads), ['n']);
    cases++;
} finally { foreign.forEach(producer => computedDependencies.versions.delete(producer)); }
emit({cases, mixedFormats: true, branchMigration: true, eagerTransaction: true,
    overlapPreserved: true, changedProtocol: true, capturedVersions: true, correct: true, done: true});
