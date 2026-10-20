/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Distinct multi-id exact Set buckets, not the bare-string disjoint control in controls.mjs.
// Runs unchanged against either DIST_ROOT. Constructor counts are calls, never heap bytes.
import assert from 'node:assert/strict';
import {emit, load, median} from '../../harness/lib.mjs';
import {work} from './instrument.mjs';
const {Carburetor} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
const p = Number(process.argv[2] ?? 16), n = Number(process.argv[3] ?? 4);
const samples = Number(process.argv[4] ?? 7), publications = Number(process.argv[5] ?? 32);
assert.ok([p, n, samples, publications].every(Number.isInteger));
assert.ok(p >= 1 && n >= 2 && samples > 0 && publications > 0);
const paths = Array.from({length: p}, (_, i) => 'box.k' + i + '.n');
const make = () => {
    const store = new Store({box: Object.fromEntries(Array.from({length: p}, (_, i) => ['k' + i, {n: 0}])), spare: 0});
    const ids = new Set(), groups = Array.from({length: p}, () => []), wakes = Array(p * n).fill(0);
    let wildcard = 0, spare = 0, empty = 0, checksum = 0, events = [];
    // Registration order differs from forward writes: union order must follow first addition,
    // not the global subscriber registration order. Each leaf owns n different reader ids.
    for (let i = p - 1; i >= 0; i--) for (let j = 0; j < n; j++) {
        const id = 'leaf-' + i + '-reader-' + j;
        ids.add(id); groups[i].push(id);
        store.subscribe(() => {
            const value = store.getData().box['k' + i].n;
            wakes[i * n + j]++; checksum += value; events.push([id, value]);
        }, {id, reads: [paths[i]]});
    }
    store.subscribe(() => { wildcard++; events.push(['wildcard', store.getData().box.k0.n]); }, {id: 'wildcard'});
    store.subscribe(() => { spare++; }, {id: 'spare', reads: ['spare']});
    store.subscribe(() => { empty++; }, {id: 'empty', reads: []});
    return {store, ids, groups, wakes, clear: () => { events = []; }, counts: () => ({wildcard, spare, empty, checksum, events})};
};
const order = (fixture, reverse) => ['wildcard', ...Array.from({length: p}, (_, j) =>
    fixture.groups[reverse ? p - 1 - j : j]).flat()];
const write = (fixture, reverse = false) => {
    fixture.clear();
    fixture.store.run(d => { for (let j = 0; j < p; j++) d.box['k' + (reverse ? p - 1 - j : j)].n++; });
};
const verify = (fixture, rounds, reverse = false) => {
    assert.ok(fixture.wakes.every(count => count === rounds));
    for (let i = 0; i < p; i++) assert.equal(fixture.store.getData().box['k' + i].n, rounds);
    const counts = fixture.counts();
    assert.equal(counts.checksum, p * n * rounds * (rounds + 1) / 2);
    assert.equal(counts.wildcard, rounds); assert.equal(counts.spare, 0); assert.equal(counts.empty, 0);
    assert.equal(fixture.store.getData().spare, 0);
    if (rounds) assert.deepEqual(counts.events, order(fixture, reverse).map(id => [id, rounds]));
};
const fixture = make();
for (let i = 0; i < 16; i++) write(fixture);
verify(fixture, 16);
const empty = work(fixture.store, fixture.ids, () => fixture.store.run(d => { d.box.k0.n = 16; }), paths);
verify(fixture, 16);
// Probe all traversal APIs on EVERY actual bucket identity. A method-blind or first-bucket-only
// counter fails these positive gates; matched/delivery Sets must not inflate bucket visits.
const positive = work(fixture.store, fixture.ids, (_first, buckets) => {
    for (const bucket of buckets) {
        bucket.forEach(() => {});
        for (const id of bucket) assert.ok(fixture.ids.has(id));
        for (const id of bucket.values()) assert.ok(fixture.ids.has(id));
        for (const id of bucket.keys()) assert.ok(fixture.ids.has(id));
    }
    const candidates = new Set();
    for (const id of fixture.ids) candidates.add(id);
    assert.equal(candidates.size, p * n);
}, paths);
assert.equal(positive.visits, 4 * p * n); assert.equal(positive.forEachVisits, p * n);
assert.equal(positive.iteratorVisits, 3 * p * n); assert.equal(positive.adds, p * n);
const measured = work(fixture.store, fixture.ids, () => write(fixture), paths);
verify(fixture, 17); assert.deepEqual(measured.matchOrder, order(fixture, false));
const shuffled = work(fixture.store, fixture.ids, () => write(fixture, true), paths);
verify(fixture, 18, true); assert.deepEqual(shuffled.matchOrder, order(fixture, true));
// Separate fresh fixture, warmed with the same whole operation; no counter patches in this lane.
const timed = make();
let rounds = 0;
for (let i = 0; i < 16; i++) { write(timed); rounds++; }
verify(timed, rounds);
const times = [];
for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < publications; i++) { write(timed, i % 2 === 0); rounds++; }
    times.push(performance.now() - start);
    verify(timed, rounds, (publications - 1) % 2 === 0);
}
emit({p, n, bucketCount: p, readersPerBucket: n,
    metadataType: measured.metadataType, metadataSets: measured.metadataSets,
    metadataAdds: measured.metadataAdds, metadataChecks: measured.metadataChecks,
    matchWeakMaps: measured.matchWeakMaps, matchWeakSets: measured.matchWeakSets,
    wholeWeakMaps: measured.wholeWeakMaps, wholeWeakSets: measured.wholeWeakSets,
    shuffledMetadataSets: shuffled.metadataSets, shuffledMetadataAdds: shuffled.metadataAdds,
    shuffledMetadataChecks: shuffled.metadataChecks,
    emptyMetadataSets: empty.metadataSets, positiveMetadataSets: positive.metadataSets,
    memberVisits: measured.visits, candidateAdds: measured.adds,
    forEachVisits: measured.forEachVisits, iteratorVisits: measured.iteratorVisits,
    matchSets: measured.matchSets, matchMaps: measured.matchMaps,
    wholeSets: measured.wholeSets, wholeMaps: measured.wholeMaps,
    shuffledVisits: shuffled.visits, shuffledAdds: shuffled.adds,
    shuffledMatchSets: shuffled.matchSets, shuffledMatchMaps: shuffled.matchMaps,
    shuffledWholeSets: shuffled.wholeSets, shuffledWholeMaps: shuffled.wholeMaps,
    emptyVisits: empty.visits, emptyAdds: empty.adds, emptyMatchSets: empty.matchSets,
    emptyMatchMaps: empty.matchMaps, emptyWholeSets: empty.wholeSets, emptyWholeMaps: empty.wholeMaps,
    positiveVisits: positive.visits, positiveForEach: positive.forEachVisits,
    positiveIterator: positive.iteratorVisits, positiveAdds: positive.adds,
    positiveMatchSets: positive.matchSets, positiveMatchMaps: positive.matchMaps,
    positiveWholeSets: positive.wholeSets, positiveWholeMaps: positive.wholeMaps,
    callbacks: fixture.wakes.reduce((sum, count) => sum + count, 0),
    callbackChecksum: fixture.counts().checksum,
    sourceChecksum: Object.values(fixture.store.getData().box).reduce((sum, row) => sum + row.n, 0),
    wildcardCallbacks: fixture.counts().wildcard, spareCallbacks: fixture.counts().spare,
    emptyCallbacks: fixture.counts().empty, unionCorrect: true, firstAddOrderCorrect: true,
    callbackValuesCorrect: true, sourceValuesCorrect: true,
    timingCallbacks: timed.wakes.reduce((sum, count) => sum + count, 0),
    timingChecksum: timed.counts().checksum, timingRounds: rounds, publications,
    distinctMultiIdMs: median(times), done: true});
