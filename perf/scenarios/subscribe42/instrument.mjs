/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Counters observe the actual filed bucket, not matched/delivery Sets. All patches are finally-scoped.
import assert from 'node:assert/strict';
import {engine} from '../../harness/lib.mjs';
export const constructors = fn => {
    const originals = {Set: globalThis.Set, Map: globalThis.Map,
        WeakMap: globalThis.WeakMap, WeakSet: globalThis.WeakSet};
    const counts = {sets: 0, maps: 0, weakMaps: 0, weakSets: 0};
    const fields = {Set: 'sets', Map: 'maps', WeakMap: 'weakMaps', WeakSet: 'weakSets'};
    for (const name of Object.keys(originals)) globalThis[name] = new Proxy(originals[name], {
        construct(target, args, newTarget) {
            counts[fields[name]]++;
            return Reflect.construct(target, args, newTarget);
        },
    });
    try { fn(); } finally { for (const name of Object.keys(originals)) globalThis[name] = originals[name]; }
    return counts;
};
export const work = (store, ids, fn, paths = ['box']) => {
    const index = engine(store, 'subscriberIndex');
    assert.ok(index?.exact instanceof Map && typeof index.match === 'function');
    const buckets = paths.map(path => index.exact.get(path));
    assert.ok(buckets.every(bucket => bucket instanceof Set && bucket.size >= 2));
    assert.equal(new Set(buckets).size, paths.length);
    const members = new Set();
    for (const bucket of buckets) for (const id of bucket) {
        assert.ok(ids.has(id)); members.add(id);
    }
    assert.equal(members.size, ids.size);
    const proto = Set.prototype;
    const original = {add: proto.add, has: proto.has, forEach: proto.forEach,
        iterator: proto[Symbol.iterator], values: proto.values, keys: proto.keys};
    const counts = {visits: 0, adds: 0, forEachVisits: 0, iteratorVisits: 0,
        matchSets: 0, matchMaps: 0, wholeSets: 0, wholeMaps: 0,
        matchWeakMaps: 0, matchWeakSets: 0, wholeWeakMaps: 0, wholeWeakSets: 0,
        metadataSets: 0, metadataAdds: 0, metadataChecks: 0, metadataType: 'none', matchOrder: []};
    const metadata = new Set();
    const match = index.match;
    const visit = (receiver, id, lane) => {
        if (buckets.includes(receiver) && original.has.call(ids, id)) { counts.visits++; counts[lane]++; }
    };
    proto.add = function(id) {
        if (original.has.call(ids, id)) counts.adds++;
        if (buckets.includes(id)) {
            counts.metadataAdds++;
            if (!original.has.call(metadata, this)) {
                original.add.call(metadata, this); counts.metadataSets++;
            }
            counts.metadataType = 'Set';
        }
        return original.add.call(this, id);
    };
    proto.has = function(value) {
        if (buckets.includes(value)) counts.metadataChecks++;
        return original.has.call(this, value);
    };
    proto.forEach = function(callback, thisArg) {
        const receiver = this;
        return original.forEach.call(receiver, (id, key, set) => {
            visit(receiver, id, 'forEachVisits'); callback.call(thisArg, id, key, set);
        });
    };
    for (const [key, method] of [[Symbol.iterator, original.iterator], ['values', original.values], ['keys', original.keys]]) {
        proto[key] = function(...args) {
            const receiver = this, iterator = method.apply(receiver, args);
            return (function* () {
                for (let step = iterator.next(); !step.done; step = iterator.next()) {
                    visit(receiver, step.value, 'iteratorVisits'); yield step.value;
                }
            })();
        };
    }
    index.match = function(...args) {
        let result;
        const allocations = constructors(() => { result = match.apply(this, args); });
        counts.matchSets += allocations.sets; counts.matchMaps += allocations.maps;
        counts.matchWeakMaps += allocations.weakMaps; counts.matchWeakSets += allocations.weakSets;
        counts.matchOrder = Array.from(original.iterator.call(result));
        return result;
    };
    try {
        // Charge a real metadata add/check, then exclude the probe from production work.
        const probe = new Set();
        probe.add(buckets[0]);
        assert.equal(probe.has(buckets[0]), true);
        assert.deepEqual([counts.metadataSets, counts.metadataAdds, counts.metadataChecks], [1, 1, 1],
            'metadata instrumentation must detect one genuine add/check without self-charging');
        metadata.clear();
        counts.metadataSets = counts.metadataAdds = counts.metadataChecks = 0;
        counts.metadataType = 'none';
        const allocations = constructors(() => fn(buckets[0], buckets));
        counts.wholeSets = allocations.sets; counts.wholeMaps = allocations.maps;
        counts.wholeWeakMaps = allocations.weakMaps; counts.wholeWeakSets = allocations.weakSets;
    } finally {
        proto.add = original.add; proto.has = original.has; proto.forEach = original.forEach;
        proto[Symbol.iterator] = original.iterator; proto.values = original.values; proto.keys = original.keys;
        index.match = match;
    }
    return counts;
};
