import assert from 'node:assert/strict';

export async function checkReentrant(api, mode, action) {
    const {ResourceCache, EResourceStatus: Status} = api;
    let resolve, reject;
    const cache = new ResourceCache(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const {key} = cache.resolve('probe');
    const request = cache.load('probe');
    const raw = cache.getData().entries[key];
    let fired = false;
    const replacement = {...raw, data: 'replacement'};
    const marker = new Error('observer failed');
    const dispose = cache.attachPatchListener({patch: patch => {
        if (fired || patch.segments?.at(-1) !== (mode === 'success' ? 'status' : 'error')) return;
        fired = true;
        if (action === 'throw') throw marker;
        // The same public mutation API used by application stores (protected only in TS).
        cache.update(draft => {
            if (action === 'delete') delete draft.entries[key];
            else if (action === 'dictionary') draft.entries = {[key]: replacement};
            else draft.entries[key] = replacement;
        });
    }});
    let error;
    if (mode === 'success') resolve('answer'); else reject(new Error('offline'));
    try { await request; } catch (caught) { error = caught; }
    dispose();
    assert.equal(fired, true);
    if (action === 'throw') assert.equal(error, marker);
    else if (action === 'delete') {
        assert.ok(error instanceof TypeError);
        assert.equal(cache.getData().entries[key], undefined);
    } else {
        assert.equal(error, undefined);
        const entry = cache.getData().entries[key];
        assert.notEqual(entry, raw);
        assert.equal(entry.data, mode === 'success' ? 'answer' : 'replacement');
        assert.equal(entry.status, mode === 'success' ? Status.Pending : Status.Error);
        assert.equal(entry.failed, mode === 'failure');
        assert.equal(entry.refreshing, false);
        assert.equal(entry.error, undefined);
    }
    return {mode, action, fired, error: error?.message ?? null, entry: cache.snapshot().entries[key]};
}
