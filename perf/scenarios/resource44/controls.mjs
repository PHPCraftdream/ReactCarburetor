/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, ready, gate, rejected} from './fixture.mjs';
const {ResourceCache, ResourceCarburetor, EResourceStatus: S} = api;
let cowOwnershipAccepted = 0, cancelledGenerationProtected = 0;
let cowControls = 0, setDataControls = 0, falsyControls = 0, exceptionControls = 0;
let abortControls = 0, refreshControls = 0, terminalControls = 0, cheapLoaderCalls = 0, cheapVersionDelta = 0;
for (const style of ['object', 'getter']) {
    const g = gate(); let signal;
    const cache = new ResourceCache((_args, requestSignal) => {
        signal = requestSignal; return g.promise;
    }, {ttl: Infinity});
    const key = cache.resolve('a').key, entry = ready('held');
    cache.setData({entries: {[key]: entry}});
    const first = cache.refresh('a');
    const operationalEntry = cache.getData().entries[key];
    Object.defineProperty(operationalEntry, 'invalidated', {value: false, writable: false, configurable: false});
    const held = cache.getData(), captured = cache.resolve('a');
    const raw = rejected(style, () => { cache.invalidate('a'); return 'offline'; });
    g.no(raw); await first;
    assert.notEqual(cache.getData(), held); assert.equal(held.entries[key].invalidated, false);
    assert.equal(held.entries[key], operationalEntry);
    assert.notEqual(cache.getData().entries[key], operationalEntry);
    assert.deepEqual(held.entries[key], {...ready('held'), updatedAt: entry.updatedAt, refreshing: true});
    assert.equal(Object.getOwnPropertyDescriptor(operationalEntry, 'invalidated').writable, false);
    assert.equal(Object.getOwnPropertyDescriptor(operationalEntry, 'invalidated').configurable, false);
    assert.equal(signal.aborted, false);
    assert.equal(cache.getEntry('a').invalidated, true);
    if (cache.getEntry('a').failed === true && cache.getFailure('a') === raw
        && cache.getEntry('a').error === 'offline') cowOwnershipAccepted++;
    assert.equal(cache.getEntry('a').data, 'held'); assert.equal(cache.getEntry('a').refreshing, false);
    assert.equal(captured.view.error, undefined); assert.equal(captured.view.invalidated, false);
    cowControls++; cache.forgetAll();
    {
        const requests = [gate(), gate()], signals = []; let calls = 0;
        const owner = new ResourceCache((_args, signal) => {
            signals.push(signal); return requests[calls++].promise;
        });
        const first = owner.load('a'); let second = first;
        const raw = rejected(style, () => {
            second = owner.refresh('a'); owner.abort('a'); return 'obsolete';
        });
        requests[0].no(raw);
        await first; assert.equal(calls, 2);
        assert.equal(signals[1].aborted, true);
        const protectedBeforeTail = owner.getEntry('a').status === S.Idle
            && owner.getEntry('a').error === undefined && owner.getFailure('a') === undefined;
        requests[1].yes('cancelled'); await second;
        assert.equal(calls, 2); assert.equal(signals[1].aborted, true);
        if (protectedBeforeTail && owner.getEntry('a').status === S.Idle
            && owner.getEntry('a').error === undefined && owner.getFailure('a') === undefined) {
            cancelledGenerationProtected++;
        }
        assert.equal(owner.getEntry('a').data, undefined); terminalControls++; owner.forgetAll();
    }
    for (const kind of ['cache', 'slot']) {
        const pending = gate();
        const owner = kind === 'cache' ? new ResourceCache(() => pending.promise) : new ResourceCarburetor(() => pending.promise);
        const loading = owner.load('a');
        owner.setData(kind === 'cache' ? {entries: {[owner.resolve('a').key]: ready('manual')}} : ready('manual'));
        const failure = rejected(style, () => 'offline'); pending.no(failure); await loading;
        const state = kind === 'cache' ? owner.getEntry('a') : owner.getData();
        assert.equal(state.data, 'manual'); assert.equal(state.error, 'offline');
        assert.equal(kind === 'cache' ? owner.getFailure('a') : owner.getLastError(), failure);
        setDataControls++;
        if (kind === 'cache') owner.forgetAll(); else owner.abort();
    }
    for (const kind of ['cache', 'slot']) {
        const pending = gate(), thrown = new Error('description threw'); let calls = 0;
        const loader = () => ++calls === 1 ? pending.promise : Promise.resolve('next');
        const owner = kind === 'cache' ? new ResourceCache(loader) : new ResourceCarburetor(loader);
        const loading = owner.load('a');
        const observed = assert.rejects(loading, error => error === thrown);
        pending.no(rejected(style, () => { throw thrown; })); await observed;
        if (kind === 'slot') owner.abort();
        await owner.load('b'); assert.equal(calls, 2); exceptionControls++; terminalControls++;
        if (kind === 'cache') owner.forgetAll(); else owner.abort();
    }
}
for (const raw of [0, false, '', undefined]) for (const kind of ['cache', 'slot']) {
    const loader = () => Promise.reject(raw);
    const owner = kind === 'cache' ? new ResourceCache(loader) : new ResourceCarburetor(loader);
    await owner.load('a');
    assert.equal(kind === 'cache' ? owner.getFailure('a') : owner.getLastError(), raw);
    let threw = false;
    try { owner.suspend('a'); } catch (error) { threw = true; assert.equal(error, raw); }
    assert.equal(threw, true); falsyControls++;
    if (kind === 'cache') owner.forgetAll(); else owner.abort();
}
{
    const raw = new Error('offline'), cache = new ResourceCache(() => Promise.reject(raw), {ttl: Infinity});
    cache.setData({entries: {[cache.resolve('a').key]: ready('good')}});
    const captured = cache.resolve('a'); await cache.refresh('a');
    assert.equal(cache.getEntry('a').data, 'good'); assert.equal(cache.getEntry('a').failed, true);
    assert.equal(cache.getFailure('a'), raw); assert.equal(captured.view.error, undefined);
    refreshControls++; cache.forgetAll();
}
for (const shape of ['root', 'entry']) {
    const pending = gate(); let calls = 0;
    class EditableCache extends ResourceCache {
        replaceEntry(key) { this.update(draft => { draft.entries[key] = ready('replacement'); }); }
    }
    const cache = new EditableCache((_args, signal) => {
        calls++;
        if (calls !== 1) return Promise.resolve('next');
        signal.addEventListener('abort', () => {
            const key = cache.resolve('a').key;
            if (shape === 'root') cache.setData({entries: {[key]: ready('replacement')}});
            else cache.replaceEntry(key);
        }, {once: true});
        return pending.promise;
    }, {ttl: Infinity});
    const first = cache.load('a'); cache.abort('a'); pending.no(new Error('late')); await first;
    assert.equal(cache.getEntry('a').data, 'replacement'); assert.equal(cache.getEntry('a').error, undefined);
    assert.equal(cache.getEntry('a').failed, false);
    await cache.refresh('a'); assert.equal(calls, 2); assert.equal(cache.getEntry('a').data, 'next');
    abortControls++; terminalControls++; cache.forgetAll();
}
{
    const pending = gate();
    const slot = new ResourceCarburetor((_args, signal) => {
        signal.addEventListener('abort', () => slot.restore({...ready('replacement'), key: JSON.stringify('b')}), {once: true});
        return pending.promise;
    });
    const first = slot.load('a'); slot.abort(); pending.no(new Error('late')); await first;
    assert.equal(slot.getData().data, 'replacement'); assert.equal(slot.snapshot().key, JSON.stringify('b'));
    assert.equal(slot.getLastError(), undefined); abortControls++;
}
{
    const cache = new ResourceCache(() => { cheapLoaderCalls++; return Promise.resolve('unexpected'); });
    const before = cache.getVersion();
    cache.abort('absent'); cache.forget('absent'); cache.invalidate('unrelated');
    for (let i = 0; i < 8; i++) assert.equal(cache.resolve('cold-' + i).present, false);
    cheapVersionDelta = cache.getVersion() - before;
    assert.equal(Object.keys(cache.getData().entries).length, 0);
}
emit({cowOwnershipAccepted, cancelledGenerationProtected, cowControls, setDataControls, falsyControls, exceptionControls, abortControls,
    refreshControls, terminalControls, cheapLoaderCalls, cheapVersionDelta, done: true});
