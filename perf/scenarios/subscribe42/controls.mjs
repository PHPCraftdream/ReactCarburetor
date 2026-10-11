/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load, engine, median} from '../../harness/lib.mjs';
import {constructors, work} from './instrument.mjs';
const {Carburetor} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
// Match-local and whole-publication constructors reported separately: no inference from heap bytes.
const lane = (kind, instrumented) => {
    const width = 16, readers = kind === 'singleton' ? 1 : 16;
    const store = new Store({box: Object.fromEntries(Array.from({length: width}, (_, i) => ['k' + i, {n: 0}])), spare: 0});
    const wakes = Array(readers).fill(0);
    let wildcard = 0, spare = 0, checksum = 0, rounds = 0;
    for (let i = 0; i < readers; i++) store.subscribe(() => {
        wakes[i]++; checksum += store.getData().box['k' + (kind === 'disjoint' ? i : 0)].n;
    }, {id: 'lane-' + i, reads: [kind === 'disjoint' ? 'box.k' + i + '.n' : 'box']});
    store.subscribe(() => { wildcard++; }, {id: 'wildcard'});
    store.subscribe(() => { spare++; }, {id: 'spare', reads: ['spare']});
    const operation = () => {
        store.run(d => { for (let i = 0; i < (kind === 'single' ? 1 : width); i++) d.box['k' + i].n++; });
        rounds++;
    };
    const verify = () => {
        assert.ok(wakes.every(count => count === rounds));
        assert.equal(wildcard, rounds); assert.equal(spare, 0);
        assert.equal(checksum, readers * rounds * (rounds + 1) / 2);
        for (let i = 0; i < width; i++) assert.equal(store.getData().box['k' + i].n, kind === 'single' && i > 0 ? 0 : rounds);
    };
    for (let i = 0; i < 16; i++) operation(); verify();
    let matchSets = 0, matchMaps = 0, wholeSets = 0, wholeMaps = 0;
    const times = [];
    if (instrumented) {
        const index = engine(store, 'subscriberIndex'), original = index.match;
        index.match = function(...args) {
            let result;
            const count = constructors(() => { result = original.apply(this, args); });
            matchSets += count.sets; matchMaps += count.maps;
            return result;
        };
        try {
            const count = constructors(() => { for (let i = 0; i < 8; i++) operation(); });
            wholeSets = count.sets; wholeMaps = count.maps;
        } finally { index.match = original; }
        verify();
    } else {
        for (let sample = 0; sample < 7; sample++) {
            const start = performance.now();
            for (let i = 0; i < 64; i++) operation();
            times.push(performance.now() - start); verify();
        }
    }
    return {matchSets, matchMaps, wholeSets, wholeMaps, callbacks: wakes.reduce((a, b) => a + b, 0),
        checksum, sourceChecksum: Object.values(store.getData().box).reduce((a, row) => a + row.n, 0),
        ms: times.length ? median(times) : 0};
};
const single = lane('single', true), disjoint = lane('disjoint', true);
const singleton = lane('singleton', true), shared = lane('shared', true);
const singleTime = lane('single', false), disjointTime = lane('disjoint', false);
const singletonTime = lane('singleton', false);
// Overlapping ancestors, parent+child shaped writes, wildcard, empty reads and escaped prefixes.
const store = new Store({box: {'a.b': {n: 0}, 'a~b': {n: 0}, a: {b: {n: 0}}, k0: {n: 0}}, spare: 0});
const wakes = {broad: 0, overlap: 0, escaped: 0, tilde: 0, nested: 0, empty: 0, wildcard: 0};
let checksum = 0;
const register = (id, reads) => store.subscribe(() => {
    wakes[id]++; checksum += store.getData().box.k0.n;
}, {id, reads});
register('broad', ['box']); register('overlap', ['box', 'box.k0', 'box.a']);
register('escaped', ['box.a~1b.n']); register('tilde', ['box.a~0b.n']);
register('nested', ['box.a.b.n']); register('empty', []); register('wildcard', undefined);
store.run(d => { d.box['a.b'].n++; d.box['a~b'].n++; });
assert.deepEqual(wakes, {broad: 1, overlap: 1, escaped: 1, tilde: 1, nested: 0, empty: 0, wildcard: 1});
store.run(d => { delete d.box.k0; d.box.k0 = {n: 1}; d.box.k0.n = 2; d.box.a.b.n++; });
assert.deepEqual(wakes, {broad: 2, overlap: 2, escaped: 1, tilde: 1, nested: 1, empty: 0, wildcard: 2});
register('broad', ['spare']); // Refile the same id, not an additional subscriber.
store.run(d => { d.box.a.b.n++; });
assert.equal(wakes.broad, 2); assert.equal(wakes.overlap, 3); assert.equal(wakes.nested, 2);
store.run(d => { d.spare++; }); assert.equal(wakes.broad, 3);
store.unsubscribe('broad'); store.unsubscribe('overlap');
store.run(d => { d.box.a.b.n++; d.spare++; });
assert.deepEqual(wakes, {broad: 3, overlap: 3, escaped: 1, tilde: 1, nested: 3, empty: 0, wildcard: 5});
assert.equal(checksum, 22);
assert.equal(store.getData().box['a.b'].n, 1); assert.equal(store.getData().box['a~b'].n, 1);
assert.equal(store.getData().box.a.b.n, 3); assert.equal(store.getData().box.k0.n, 2);
assert.equal(store.getData().spare, 2);
// Isolated real filed-bucket work: exact/ancestor overlap, not a whole-operation timing claim.
const overlapIndexStore = new Store({box: {left: {n: 0}}});
const overlapIds = new Set(['overlap-0', 'overlap-1', 'overlap-2', 'overlap-3']);
for (const id of overlapIds) overlapIndexStore.subscribe(() => {}, {id, reads: ['box']});
const overlapIndex = engine(overlapIndexStore, 'subscriberIndex');
const overlapWork = [];
try {
    for (const paths of [['box', 'box.left.n'], ['box.left.n', 'box']]) {
        const writes = new Set(paths);
        const result = work(overlapIndexStore, overlapIds, () => {
            assert.deepEqual([...overlapIndex.match(writes)], [...overlapIds]);
        });
        overlapWork.push(result);
    }
} finally {
    for (const id of overlapIds) overlapIndexStore.unsubscribe(id);
}
emit({singleMatchSets: single.matchSets, singleMatchMaps: single.matchMaps,
    disjointMatchSets: disjoint.matchSets, disjointMatchMaps: disjoint.matchMaps,
    singletonMatchSets: singleton.matchSets, singletonMatchMaps: singleton.matchMaps,
    sharedMatchSets: shared.matchSets, sharedMatchMaps: shared.matchMaps,
    singleWholeSets: single.wholeSets, singleWholeMaps: single.wholeMaps,
    disjointWholeSets: disjoint.wholeSets, disjointWholeMaps: disjoint.wholeMaps,
    singletonWholeSets: singleton.wholeSets, singletonWholeMaps: singleton.wholeMaps,
    sharedWholeSets: shared.wholeSets, sharedWholeMaps: shared.wholeMaps,
    allocationWindow: 8, lazyMetadataCorrect: single.matchSets <= 8 && disjoint.matchSets <= 8 && singleton.matchSets <= 8,
    singleCallbacks: single.callbacks, disjointCallbacks: disjoint.callbacks, singletonCallbacks: singleton.callbacks,
    singleChecksum: single.checksum, disjointChecksum: disjoint.checksum, singletonChecksum: singleton.checksum,
    overlapCallbacks: Object.values(wakes).reduce((a, b) => a + b, 0), overlapChecksum: checksum,
    overlapSourceChecksum: store.getData().box['a.b'].n + store.getData().box['a~b'].n
        + store.getData().box.a.b.n + store.getData().box.k0.n + store.getData().spare,
    emptyCallbacks: wakes.empty, escapedCallbacks: wakes.escaped,
    tildeCallbacks: wakes.tilde, nestedCallbacks: wakes.nested, wildcardCallbacks: wakes.wildcard,
    refileRemoveCorrect: true, overlappingCorrect: true, singleWriteMs: singleTime.ms,
    overlapParentFirstVisits: overlapWork[0].visits, overlapParentFirstAdds: overlapWork[0].adds,
    overlapChildFirstVisits: overlapWork[1].visits, overlapChildFirstAdds: overlapWork[1].adds,
    disjointBucketsMs: disjointTime.ms, singletonBucketMs: singletonTime.ms,
    timingSingleChecksum: singleTime.checksum, timingDisjointChecksum: disjointTime.checksum,
    timingSingletonChecksum: singletonTime.checksum, done: true});
