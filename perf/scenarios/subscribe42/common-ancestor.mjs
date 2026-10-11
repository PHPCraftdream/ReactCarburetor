/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R42-S02. Independent args: [writes=16] [readers=16] [samples=7] [publications=32].
import assert from 'node:assert/strict';
import {emit, load, median} from '../../harness/lib.mjs';
import {work} from './instrument.mjs';
const {Carburetor} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
const p = Number(process.argv[2] ?? 16), n = Number(process.argv[3] ?? 16);
const samples = Number(process.argv[4] ?? 7), publications = Number(process.argv[5] ?? 32);
assert.ok(Number.isInteger(p) && p > 0 && Number.isInteger(n) && n >= 2 && samples > 0 && publications > 0);
const make = () => {
    const store = new Store({box: Object.fromEntries(Array.from({length: p}, (_, i) => ['k' + i, {n: 0}])), spare: {n: 0}});
    const wakes = Array(n).fill(0), ids = new Set();
    let spare = 0, wildcard = 0, checksum = 0;
    for (let i = 0; i < n; i++) {
        const id = 'R42-reader-' + i; ids.add(id);
        store.subscribe(() => { wakes[i]++; checksum += store.getData().box.k0.n; }, {id, reads: ['box']});
    }
    store.subscribe(() => { spare++; }, {id: 'spare', reads: ['spare.n']});
    store.subscribe(() => { wildcard++; }, {id: 'wildcard'});
    return {store, ids, wakes, counts: () => ({spare, wildcard, checksum})};
};
const write = (fixture, shuffled = false) => fixture.store.run(d => {
    for (let j = 0; j < p; j++) { const i = shuffled ? p - 1 - j : j; d.box['k' + i].n++; }
});
const verify = (fixture, rounds, spareRounds = 0) => {
    assert.ok(fixture.wakes.every(count => count === rounds));
    for (let i = 0; i < p; i++) assert.equal(fixture.store.getData().box['k' + i].n, rounds);
    assert.equal(fixture.counts().checksum, n * rounds * (rounds + 1) / 2);
    assert.equal(fixture.counts().spare, spareRounds);
    assert.equal(fixture.counts().wildcard, rounds + spareRounds);
    assert.equal(fixture.store.getData().spare.n, spareRounds);
};
const fixture = make();
const empty = work(fixture.store, fixture.ids, () => fixture.store.run(d => { d.box.k0.n = 0; }));
verify(fixture, 0);
// Positive for every supported traversal API; iterator loops are deliberately exercised separately.
const positive = work(fixture.store, fixture.ids, bucket => {
    bucket.forEach(() => {});
    for (const id of bucket) assert.ok(fixture.ids.has(id));
    for (const id of bucket.values()) assert.ok(fixture.ids.has(id));
    for (const id of bucket.keys()) assert.ok(fixture.ids.has(id));
    const candidates = new Set();
    for (const id of fixture.ids) candidates.add(id);
    assert.equal(candidates.size, n);
});
assert.equal(positive.visits, 4 * n); assert.equal(positive.forEachVisits, n);
assert.equal(positive.iteratorVisits, 3 * n); assert.equal(positive.adds, n);
const measured = work(fixture.store, fixture.ids, () => write(fixture));
verify(fixture, 1);
fixture.store.run(d => { d.spare.n++; }); verify(fixture, 1, 1);
const shuffled = work(fixture.store, fixture.ids, () => write(fixture, true));
verify(fixture, 2, 1);
const finalChecksum = Object.values(fixture.store.getData().box).reduce((sum, row) => sum + row.n, 0);
assert.equal(finalChecksum, 2 * p);
// Independent, uninstrumented warmed operation lane; no instrumentation survives into timing.
const timed = make();
let rounds = 0;
for (let i = 0; i < 16; i++) { write(timed, i % 2 === 0); rounds++; }
verify(timed, rounds);
const times = [];
for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < publications; i++) { write(timed, i % 2 === 0); rounds++; }
    times.push(performance.now() - start);
    verify(timed, rounds);
}
emit({p, n, metadataType: measured.metadataType, metadataSets: measured.metadataSets,
    metadataAdds: measured.metadataAdds, metadataChecks: measured.metadataChecks,
    matchWeakMaps: measured.matchWeakMaps, matchWeakSets: measured.matchWeakSets,
    wholeWeakMaps: measured.wholeWeakMaps, wholeWeakSets: measured.wholeWeakSets,
    shuffledMetadataSets: shuffled.metadataSets, emptyMetadataSets: empty.metadataSets,
    positiveMetadataSets: positive.metadataSets,
    memberVisits: measured.visits, candidateAdds: measured.adds,
    forEachVisits: measured.forEachVisits, iteratorVisits: measured.iteratorVisits,
    matchSets: measured.matchSets, matchMaps: measured.matchMaps,
    shuffledVisits: shuffled.visits, shuffledAdds: shuffled.adds,
    emptyVisits: empty.visits, emptyAdds: empty.adds, emptySets: empty.matchSets,
    positiveVisits: positive.visits, positiveForEach: positive.forEachVisits,
    positiveIterator: positive.iteratorVisits, positiveAdds: positive.adds,
    broadCallbacks: fixture.wakes.reduce((sum, count) => sum + count, 0),
    spareCallbacks: fixture.counts().spare, wildcardCallbacks: fixture.counts().wildcard,
    callbackChecksum: fixture.counts().checksum, finalChecksum, precisionCorrect: true,
    timingCallbacks: timed.wakes.reduce((sum, count) => sum + count, 0),
    timingChecksum: timed.counts().checksum, timingRounds: rounds, publications,
    commonAncestorMs: median(times), done: true});
