/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, fixture, victimCounter, encoded} from './fixture.mjs';
const S = api.EResourceStatus;
const raw = [];
let lanes = 0, nextScans = 0, nextVisits = 0, eagerScans = 0, missedReclaims = 0;
async function lane(capacity, refresh, ttl, mode, protection = 'none') {
    const f = fixture({maxEntries: capacity, ttl});
    const counter = victimCounter(f.cache);
    const ids = Array.from({length: capacity + 1}, (_, i) => 'old-' + i);
    let held;
    try {
        // Hydrate only the next row, then give it request ownership before adding another.
        // setData preserves surviving LRU order but clears the skip hint; the final refresh
        // scans capacity + 1 request-owned rows and reinstates the all-retained hint.
        for (const id of ids) {
            if (refresh) f.cache.setData({entries: {...f.cache.getData().entries, [encoded(id)]: {
                status: S.Success, data: 'warm-' + id, updatedAt: 0,
                refreshing: false, invalidated: false, failed: false, error: undefined,
            }}});
            f.start(id, refresh);
        }
        assert.equal(f.requests.length, ids.length);
        assert.equal(Object.keys(f.cache.getData().entries).length, ids.length);
        if (protection === 'reader') {
            held = f.cache.subscribe(() => {}, {reads: new Set([f.cache.resolve(ids[0]).path + '.data'])});
        }
        if (protection === 'replacement') {
            f.requests[0].signal.addEventListener('abort', () => f.start(ids[0], refresh), {once: true});
        }
        const oldRequests = [...f.requests];
        const before = f.cache.getVersion();
        counter.reset();
        if (mode === 'abortAll') f.cache.abortAll();
        else f.cache.abort(ids[0]);
        eagerScans += counter.scans;
        assert.equal(counter.scans, 0, 'abort must not eagerly evict');
        assert.equal(Object.keys(f.cache.getData().entries).length, ids.length);
        // No entry-wide observer pins the candidate; version measures publication without retention.
        if (protection === 'none') assert.equal(f.cache.getVersion() - before, 1, 'one cancellation publication');
        if (protection !== 'replacement') {
            assert.equal(f.stored(ids[0]).status, refresh ? S.Success : S.Idle);
            assert.equal(f.stored(ids[0]).refreshing, false);
            assert.equal(f.stored(ids[0]).data, refresh ? 'warm-' + ids[0] : undefined);
        } else {
            assert.equal(f.stored(ids[0]).status, S.Pending);
        }
        assert.ok(oldRequests[0].signal.aborted);
        if (mode === 'abort') assert.ok(!oldRequests[1].signal.aborted);
        counter.reset();
        f.start('next'); // paused: current settlement cannot rescue the missing release signal
        const scans = counter.scans, visits = counter.visits;
        nextScans += scans; nextVisits += visits;
        const survivors = ids.filter(id => f.stored(id));
        const expected = mode === 'abort' ? ids.slice(protection === 'none' ? 1 : 0)
            : protection === 'none' ? ids.slice(2)
            : [ids[0], ...ids.slice(3)];
        // For capacity 1 with a protected key there is only one free victim.
        assert.deepEqual(survivors, expected);
        assert.equal(f.stored('next').status, S.Pending);
        if (protection === 'replacement') assert.equal(f.stored(ids[0]).status, S.Pending);
        assert.equal(f.requests.length, ids.length + 1 + Number(protection === 'replacement'));
        if (protection === 'none' && f.stored(ids[0])) missedReclaims++;
        // Retired success and failure both complete without overwriting the current root.
        const settledRoot = f.cache.getData();
        const version = f.cache.getVersion();
        for (let i = 0; i < oldRequests.length; i++) {
            if (oldRequests[i].signal.aborted) {
                if (i % 2) oldRequests[i].no(new Error('retired ordinary failure'));
                else oldRequests[i].yes('retired answer');
            }
        }
        await Promise.all(f.promises.slice(0, ids.length).filter((_p, i) => oldRequests[i].signal.aborted));
        assert.equal(f.cache.getData(), settledRoot);
        assert.equal(f.cache.getVersion(), version);
        if (protection === 'replacement') {
            assert.equal(f.stored(ids[0]).status, S.Pending);
            const p = f.promises[ids.length];
            f.requests[ids.length].yes('replacement answer');
            await p;
            // Settlement may evict an unobserved replacement. Hold its public result before next pressure
            // only where a reader is present; ownership while paused was asserted above.
        }
        raw.push({capacity, refresh, ttl: String(ttl), mode, protection, scans, visits, survivors});
        lanes++;
    } finally {
        if (held) f.cache.unsubscribe(held);
        counter.restore();
        await f.close();
    }
}
for (const capacity of [1, 2, 8]) for (const refresh of [false, true]) {
    for (const ttl of [Infinity, 0]) for (const mode of ['abort', 'abortAll']) {
        await lane(capacity, refresh, ttl, mode);
    }
}
for (const mode of ['abort', 'abortAll']) for (const protection of ['reader', 'replacement']) {
    await lane(1, false, Infinity, mode, protection);
}
let settlementControls = 0, departureControls = 0, cheapVisits = 0, positiveVisits = 0;
let controlScans = 0, controlVisits = 0;
for (const outcome of ['success', 'failure', 'departure']) {
    const f = fixture();
    const counter = victimCounter(f.cache);
    try {
        f.start('a'); f.start('b');
        positiveVisits += counter.visits;
        if (outcome === 'departure') {
            const id = f.cache.subscribe(() => {}, {reads: new Set([f.cache.resolve('a').path])});
            counter.reset();
            f.cache.abortAll();
            // Independent reader departure is an existing release route, not part of the bug gate.
            f.cache.unsubscribe(id);
            departureControls++;
        } else {
            counter.reset();
            if (outcome === 'success') f.requests[0].yes('success');
            else f.requests[0].no(new Error('failure'));
            await f.promises[0];
            settlementControls++;
        }
        f.start('c');
        controlScans += counter.scans; controlVisits += counter.visits;
        assert.equal(f.stored('a'), undefined);
        assert.equal(f.stored('c').status, S.Pending);
    } finally { counter.restore(); await f.close(); }
}
for (const maxEntries of [8, Infinity]) {
    const f = fixture({maxEntries});
    const counter = victimCounter(f.cache);
    try {
        f.cache.abort('missing'); f.cache.abortAll();
        assert.equal(f.cache.getVersion(), 0);
        assert.equal(f.requests.length, 0);
        f.start('a'); f.start('b');
        f.cache.abort('missing'); f.cache.abortAll(); f.start('c');
        assert.equal(Object.keys(f.cache.getData().entries).length, 3);
        assert.equal(f.stored('a').status, S.Idle);
        cheapVisits += counter.visits;
    } finally { counter.restore(); await f.close(); }
}
// Narrow unrelated observer must not be notified by cancelling other entries or pin them.
let unrelatedDeliveries = 0;
const precise = fixture({maxEntries: Infinity});
const unrelated = precise.cache.subscribe(() => unrelatedDeliveries++, {
    reads: new Set([precise.cache.resolve('unrelated').path + '.status']),
});
try {
    precise.start('a'); precise.start('b'); precise.cache.abortAll();
    assert.equal(unrelatedDeliveries, 0);
} finally { precise.cache.unsubscribe(unrelated); await precise.close(); }
// Failure identity and retryFailed cancellation guard, with exact public final data and calls.
const f = fixture({maxEntries: Infinity});
let retryControls = 0;
try {
    const failure = new Error('offline');
    f.start('failed'); f.requests[0].no(failure); await f.promises[0];
    assert.equal(f.cache.getFailure('failed'), failure);
    let thrown;
    try { f.cache.suspend('failed'); } catch (error) { thrown = error; }
    assert.equal(thrown, failure);
    f.cache.invalidate('failed'); f.start('failed');
    f.cache.abort('failed'); f.requests[1].yes('late'); await f.promises[1];
    assert.equal(f.cache.getEntry('failed').failed, true);
    f.cache.invalidate('failed'); f.start('failed'); f.requests[2].yes('fresh'); await f.promises[2];
    assert.equal(f.cache.getEntry('failed').data, 'fresh');
    assert.equal(f.cache.getEntry('failed').failed, false);
    assert.equal(f.requests.length, 3);
    retryControls++;
} finally { await f.close(); }
emit({lanes, missedReclaims, eagerScans, nextScans, nextVisits, settlementControls,
    departureControls, cheapVisits, positiveVisits, controlScans, controlVisits,
    unrelatedDeliveries, retryControls, raw, done: true});
