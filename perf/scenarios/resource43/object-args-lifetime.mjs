/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setImmediate as turn} from 'node:timers/promises';
import {emit} from '../../harness/lib.mjs';
import {api, entry, root, format} from './fixture.mjs';
if (!process.argv.includes('--child')) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url),
        ...process.argv.slice(2), '--child'], {
        encoding: 'utf8', env: {...process.env, DIST_ROOT: root},
        timeout: 60000, maxBuffer: 1024 * 1024,
    });
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
    process.stderr.write(child.stderr);
    process.stdout.write(child.stdout);
} else {
    assert.equal(typeof globalThis.gc, 'function');
    let loaderCalls = 0;
    function unusedLoader() { loaderCalls++; throw new Error('no-loader route invoked loader'); }
    const graph = label => ({id: label, filters: Array.from({length: 16}, (_, i) => ({field: label + i, values: [i, i + 1]}))});
    const refs = query => ({root: new WeakRef(query), subtree: new WeakRef(query.filters)});
    const makeCache = () => new api.ResourceCache(unusedLoader, {ttl: Infinity, maxEntries: 0, keyCacheSize: 0});
    function prepare(route) {
        const cache = makeCache(), query = graph(route), weak = refs(query);
        const key = cache.resolve(query).key;
        if (route !== 'miss' && route !== 'turnover') {
            cache.setData({entries: {[key]: entry('hydrated-' + route)}});
            assert.equal(cache.resolve(query).view.data, 'hydrated-' + route);
            if (route === 'forget') cache.forget(query);
            else if (route === 'clear') cache.clear();
            else if (route === 'restore') cache.restore({entries: {}});
            else cache.setData({entries: {}});
        }
        if (route === 'turnover') cache.resolve({id: 'replacement'});
        for (const id of ['primitive-a', 'primitive-b', 'primitive-c']) assert.equal(cache.resolve(id).present, false);
        assert.equal(Object.keys(cache.getData().entries).length, 0);
        return {route, cache, weak};
    }
    function controls() {
        const caller = graph('caller'), callerCache = makeCache();
        callerCache.resolve(caller);
        // Captured resolution holds DATA, not args: use disjoint small objects with no backlink.
        const query = graph('captured-args'), capturedCache = makeCache();
        const key = capturedCache.resolve(query).key;
        const data = {label: 'captured-data', values: [1, 2]};
        capturedCache.setData({entries: {[key]: entry(data)}});
        const captured = capturedCache.resolve(query);
        capturedCache.forget(query);
        capturedCache.resolve('primitive');
        const liveQuery = graph('live-args'), liveCache = makeCache();
        const liveKey = liveCache.resolve(liveQuery).key;
        const liveData = {label: 'live-data'};
        liveCache.setData({entries: {[liveKey]: entry(liveData)}});
        liveCache.resolve(liveQuery);
        liveCache.resolve('primitive');
        return {caller, callerCache, callerWeak: refs(caller), capturedCache, captured,
            capturedArgs: refs(query), capturedData: new WeakRef(data), liveCache, liveKey,
            liveArgs: refs(liveQuery), liveData: new WeakRef(liveData)};
    }
    function unreachable() { return refs(graph('unrelated')); }
    const fixtures = ['miss', 'forget', 'clear', 'restore', 'setData', 'turnover'].map(prepare);
    const held = controls(), empty = unreachable();
    async function collect() {
        for (let i = 0; i < 12; i++) { await turn(); globalThis.gc(); }
        await turn();
    }
    // Never dereference targets before collection, and never allocate fake pressure.
    await collect();
    const absent = weak => weak.root.deref() === undefined && weak.subtree.deref() === undefined;
    assert.ok(absent(empty), 'GC inconclusive: unrelated target did not collect');
    assert.ok(absent(fixtures[5].weak), 'GC inconclusive: object-turnover control did not collect');
    assert.equal(held.callerWeak.root.deref(), held.caller);
    assert.equal(held.callerWeak.subtree.deref(), held.caller.filters);
    assert.equal(held.capturedData.deref()?.label, 'captured-data');
    assert.equal(held.captured.view.data.label, 'captured-data');
    assert.equal(held.liveData.deref()?.label, 'live-data');
    // Raw root/subtree counts survive in output even when the mechanism gate rejects a baseline.
    const raw = fixtures.map(f => ({route: f.route, rootCollected: f.weak.root.deref() === undefined,
        subtreeCollected: f.weak.subtree.deref() === undefined}));
    const rootsCollected = raw.slice(0, 5).filter(f => f.rootCollected).length;
    const subtreesCollected = raw.slice(0, 5).filter(f => f.subtreeCollected).length;
    const capturedArgsCollected = absent(held.capturedArgs), liveArgsCollected = absent(held.liveArgs);
    // Actual public reads AFTER GC keep all caches strongly live.
    const caches = [...fixtures.map(f => f.cache), held.callerCache, held.capturedCache, held.liveCache];
    for (const cache of caches) assert.equal(cache.resolve('post-gc-miss').present, false);
    assert.equal(held.liveCache.getData().entries[held.liveKey].data.label, 'live-data');
    assert.equal(held.caller.filters[0].field, 'caller0');
    assert.equal(held.captured.view.data.label, 'captured-data');
    held.captured = undefined;
    await collect();
    const capturedDataReleased = held.capturedData.deref() === undefined;
    assert.equal(held.liveCache.getData().entries[held.liveKey].data.label, 'live-data');
    assert.ok(caches.every(cache => cache.getData().entries !== undefined));
    emit({root, format, cases: 5, rootsCollected, subtreesCollected, capturedArgsCollected,
        liveArgsCollected, capturedDataReleased, callerAlive: true, liveDataAlive: true,
        capturedDataAlive: true, unrelatedCollected: true, turnoverCollected: true,
        cachesAlive: caches.length, loaderCalls, raw, done: true});
}
