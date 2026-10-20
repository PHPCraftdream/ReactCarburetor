/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, ready, gate} from './fixture.mjs';
let lanes = 0, identities = 0, reactions = 0, synchronousReactions = 0;
let loaderCalls = 0, callbacks = 0, versionDelta = 0, resolveCalls = 0, zeroHitResolveCalls = 0;
let independentChildren = 0, realWorkControls = 0, realLoaderCalls = 0, lookupMisses = 0;
const original = Promise.resolve;
for (const capacity of [8, Infinity]) for (const kind of ['primitive', 'object']) for (const hits of [0, 8, 32]) {
    const args = kind === 'primitive' ? 'a' : {id: 'a'}, payload = {answer: 7};
    let counted = 0, localReactions = 0;
    let cache, id, promises, children, before;
    Promise.resolve = function(...args) { counted++; return Reflect.apply(original, this, args); };
    try {
        cache = new api.ResourceCache(() => { loaderCalls++; throw new Error('fresh loader'); },
            {ttl: Infinity, maxEntries: capacity});
        cache.setData({entries: {[cache.resolve(args).key]: ready(payload)}});
        id = cache.subscribe(() => { callbacks++; }); before = cache.getVersion();
        promises = Array.from({length: hits}, () => cache.load(args));
        children = promises.map(p => p.then(value => { assert.equal(value, undefined); localReactions++; }));
        synchronousReactions += localReactions;
    } finally { Promise.resolve = original; }
    try {
        const distinct = new Set(promises).size;
        assert.equal(distinct, hits);
        assert.equal(counted, hits);
        assert.equal(new Set(children).size, hits);
        await Promise.all(children);
        assert.equal(localReactions, hits);
        assert.equal(cache.resolve(args).view.data, payload);
        versionDelta += cache.getVersion() - before;
        identities += distinct; resolveCalls += counted;
        if (hits === 0) zeroHitResolveCalls += counted;
        reactions += localReactions; independentChildren += children.length; lanes++;
    } finally { cache.unsubscribe(id); cache.clear(); }
}
const first = new api.ResourceCache(() => { throw new Error('unexpected'); }, {ttl: Infinity});
const second = new api.ResourceCache(() => { throw new Error('unexpected'); }, {ttl: Infinity});
const payload = {answer: 11}, args = {id: 'held'};
first.setData({entries: {[first.resolve(args).key]: ready(payload)}});
second.setData({entries: {[second.resolve(args).key]: ready(payload)}});
const captured = first.resolve(args), completion = first.load(args);
assert.notEqual(completion, second.load(args));
const thrown = new Error('caller callback'); let goodCalls = 0;
const bad = completion.then(() => { throw thrown; });
const good = completion.then(() => { goodCalls++; return 19; });
const observed = assert.rejects(bad, error => error === thrown);
assert.equal(goodCalls, 0); await observed; assert.equal(await good, 19);
assert.equal(await completion, undefined); assert.notEqual(first.load(args), completion);
first.clear(); assert.equal(captured.view.data, payload); assert.equal(args.id, 'held');
for (const lane of ['cold', 'forced', 'stale', 'invalidated']) {
    const requests = [gate(), gate()]; let calls = 0;
    const cache = new api.ResourceCache(() => requests[calls++].promise, {ttl: lane === 'stale' ? 0 : Infinity});
    const a = cache.resolve('a').key, b = cache.resolve('b').key;
    cache.setData({entries: {[a]: {...ready('a'), updatedAt: Date.now() + 60_000},
        [b]: {...ready('b'), updatedAt: Date.now() + 60_000}}});
    const readyPromise = cache.load('a'); await readyPromise;
    if (lane === 'cold') cache.clear();
    if (lane === 'stale') cache.setData({entries: {[a]: {...ready('a'), updatedAt: 0}, [b]: {...ready('b'), updatedAt: 0}}});
    if (lane === 'invalidated') cache.invalidateAll();
    const p = lane === 'forced' ? cache.refresh('a') : cache.load('a');
    const q = lane === 'forced' ? cache.refresh('b') : cache.load('b');
    assert.equal(calls, 2); assert.notEqual(p, q); assert.notEqual(p, readyPromise); assert.notEqual(q, readyPromise);
    // Refresh restarts under the unified handle-promise rule, so only load joins here; the
    // forced lane's entries are fresh, where load short-circuits instead of joining.
    if (lane !== 'forced') { assert.equal(cache.load('a'), p); assert.equal(cache.load('b'), q); }
    const raw = new Error('offline'); requests[0].no(raw); requests[1].yes('current');
    await Promise.all([p, q]); assert.equal(cache.getFailure('a'), raw);
    assert.equal(cache.getEntry('a').failed, true); assert.equal(cache.getEntry('b').data, 'current');
    realLoaderCalls += calls; realWorkControls++; cache.clear();
}
const lookup = new api.ResourceCache(() => { loaderCalls++; throw new Error('lookup loader'); });
const lookupVersion = lookup.getVersion();
for (let i = 0; i < 8; i++) { assert.equal(lookup.resolve('cold-' + i).present, false); lookupMisses++; }
assert.equal(lookup.getVersion(), lookupVersion); assert.equal(Object.keys(lookup.getData().entries).length, 0);
second.clear();
emit({lanes, identities, reactions, synchronousReactions, loaderCalls, callbacks, versionDelta,
    resolveCalls, zeroHitResolveCalls, independentChildren, realWorkControls, realLoaderCalls,
    lookupMisses, crossCacheSeparate: true, throwIsolated: true, capturedDataHeld: true, done: true});
