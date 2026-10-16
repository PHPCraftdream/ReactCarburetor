/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, ready, gate, rejected} from './fixture.mjs';
const {ResourceCache, ResourceCarburetor, EResourceStatus: S} = api;
let lanes = 0, descriptions = 0, loaderCalls = 0, replacementLoaders = 0, capturedControls = 0;
for (const kind of ['cache', 'slot']) for (const style of ['object', 'getter']) {
    for (const action of ['plain', 'restore-ready', 'restore-empty', 'start', 'forget-load']) {
        if (kind === 'slot' && action === 'forget-load') continue;
        const requests = [], promises = [], keys = [], states = [];
        const loader = (key, signal) => {
            const g = gate(); requests.push({...g, signal}); keys.push(key); loaderCalls++;
            return g.promise;
        };
        const owner = kind === 'cache' ? new ResourceCache(loader, {ttl: Infinity}) : new ResourceCarburetor(loader);
        const first = owner.load('a'); promises.push(first);
        const captured = kind === 'cache' ? owner.resolve('a') : undefined;
        const key = captured?.key ?? JSON.stringify('a');
        const read = () => kind === 'cache' ? owner.getEntry('a') : owner.getData();
        const rawOwner = () => kind === 'cache' ? owner.getFailure('a') : owner.getLastError();
        const id = owner.subscribe(() => states.push(read().error));
        const raw = rejected(style, () => {
            descriptions++;
            if (action.startsWith('restore')) {
                const data = action === 'restore-ready' ? ready('restored') : undefined;
                owner.restore(kind === 'cache' ? {entries: data ? {[key]: data} : {}}
                    : data ? {...data, key} : {status: S.Idle, data: undefined, error: undefined, updatedAt: undefined});
            } else if (action === 'start' || action === 'forget-load') {
                if (action === 'forget-load') owner.forget('a');
                promises.push(kind === 'cache' ? owner.refresh('a') : owner.load('b'));
            }
            return 'obsolete';
        });
        try {
            requests[0].no(raw); await first;
            if (action === 'plain') {
                assert.equal(read().status, S.Error); assert.equal(rawOwner(), raw);
            } else {
                assert.equal(read().error, undefined); assert.notEqual(rawOwner(), raw);
                assert.ok(!states.includes('obsolete'));
                if (action.startsWith('restore')) {
                    assert.equal(read().status, action === 'restore-ready' ? S.Success : S.Idle);
                    assert.equal(read().data, action === 'restore-ready' ? 'restored' : undefined);
                    if (kind === 'cache') assert.equal(owner.resolve('a').present, action === 'restore-ready');
                    else assert.equal(owner.snapshot().key, action === 'restore-ready' ? key : undefined);
                } else {
                    assert.equal(requests.length, 2); replacementLoaders++;
                    assert.deepEqual(keys, kind === 'cache' ? ['a', 'a'] : ['a', 'b']);
                    assert.notEqual(promises[1], first);
                    assert.equal(owner.load(kind === 'cache' ? 'a' : 'b'), promises[1]);
                    assert.equal(read().status, S.Pending);
                    requests[1].yes('current'); await promises[1];
                    assert.equal(read().data, 'current'); assert.equal(read().status, S.Success);
                }
            }
            if (captured) {
                assert.equal(captured.view.status, S.Pending); assert.equal(captured.view.error, undefined);
                capturedControls++;
            }
            await Promise.all(promises); lanes++;
        } finally { owner.unsubscribe(id); }
        if (kind === 'cache') owner.clear(); else owner.abort();
    }
}
emit({lanes, descriptions, loaderCalls, replacementLoaders, capturedControls, done: true});
