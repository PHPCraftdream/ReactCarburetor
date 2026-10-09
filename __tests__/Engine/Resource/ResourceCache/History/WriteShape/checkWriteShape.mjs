import assert from 'node:assert/strict';

/** R40-05: exercise public cache operations while observing their write mechanism. */
export async function checkWriteShape(api, WriteLog, mode, optimized = false) {
    const {ResourceCache, CarburetorHistory, EResourceStatus: Status} = api;
    const OriginalProxy = globalThis.Proxy;
    const originalRecord = WriteLog.prototype.record;
    const paths = [];
    const patches = [];
    const publications = [];
    let gets = 0;
    let sets = 0;
    let counting = false;
    function SpyProxy(target, handler) {
        const observed = Object.create(handler);
        if (handler.set && handler.get) {
            observed.get = function (source, key, receiver) {
                if (counting && typeof key === 'string') gets++;
                return handler.get.call(handler, source, key, receiver);
            };
            observed.set = function (source, key, value, receiver) {
                if (counting && typeof key === 'string') sets++;
                return handler.set.call(handler, source, key, value, receiver);
            };
        }
        return new OriginalProxy(target, observed);
    }
    globalThis.Proxy = SpyProxy;
    WriteLog.prototype.record = function (version, writes, ...rest) {
        paths.push([...writes]);
        return originalRecord.call(this, version, writes, ...rest);
    };
    let dispose;
    let history;
    try {
        let resolve;
        let reject;
        let calls = 0;
        const cache = new ResourceCache(() => {
            calls++;
            return new Promise((yes, no) => { resolve = yes; reject = no; });
        }, {ttl: Infinity});
        const {key, path} = cache.resolve('a.b~c');
        const field = name => `${path}.${name}`;
        let throwPending = false;
        const failure = new Error('publication refused');
        dispose = cache.attachPatchListener({
            patch: patch => {
                patches.push(patch);
                if (throwPending) {
                    throwPending = false;
                    throw failure;
                }
            },
            publication: () => { publications.push(cache.snapshot()); },
        });
        if (mode === 'rollback' || mode === 'refresh-failure') {
            const first = cache.load('a.b~c');
            resolve('old');
            await first;
        }
        paths.length = 0;
        patches.length = 0;
        publications.length = 0;
        history = new CarburetorHistory(cache);
        const before = cache.snapshot();
        if (mode === 'rollback') {
            throwPending = true;
            counting = true;
            assert.throws(() => cache.refresh('a.b~c'), error => error === failure);
            counting = false;
            assert.equal(calls, 1);
            assert.deepEqual(cache.snapshot(), before);
            assert.deepEqual(paths, [[field('refreshing')]]);
            assert.deepEqual(patches, [
                {segments: ['entries', key, 'refreshing'], previousExists: true,
                    previous: false, nextExists: true, next: true},
                {segments: ['entries', key, 'refreshing'], previousExists: true,
                    previous: true, nextExists: true, next: false},
            ]);
            assert.equal(history.canUndo(), false);
            assert.equal(sets, 4);
            if (optimized) assert.equal(gets, 4);
            return {gets, sets, traps: gets + sets};
        }
        const request = mode === 'refresh-failure' ? cache.refresh('a.b~c') : cache.load('a.b~c');
        const pending = cache.snapshot();
        assert.equal(cache.getEntry('a.b~c').status,
            mode === 'refresh-failure' ? Status.Success : Status.Pending);
        const pendingPatches = [...patches];
        assert.deepEqual(paths[0], mode === 'refresh-failure'
            ? [field('refreshing')] : ['entries.~k', path]);
        assert.deepEqual(pendingPatches, mode === 'refresh-failure' ? [
            {segments: ['entries', key, 'refreshing'], previousExists: true,
                previous: false, nextExists: true, next: true},
        ] : [
            {segments: ['entries', key], previousExists: false, previous: undefined,
                nextExists: true, next: pending.entries[key]},
        ]);
        patches.length = 0;
        gets = 0;
        sets = 0;
        counting = true;
        const now = Date.now;
        Date.now = () => 123456;
        try {
            if (mode === 'success') resolve('answer');
            else reject(new Error('offline'));
            await request;
        } finally {
            Date.now = now;
            counting = false;
        }
        const fields = mode === 'success' ? ['status', 'data', 'updatedAt']
            : mode === 'refresh-failure' ? ['error', 'refreshing', 'failed']
                : ['error', 'failed', 'status'];
        const after = cache.snapshot();
        assert.deepEqual(paths[1], fields.map(field));
        assert.deepEqual(patches, fields.map(name => ({
            segments: ['entries', key, name], previousExists: true,
            previous: pending.entries[key][name], nextExists: true, next: after.entries[key][name],
        })));
        assert.equal(publications.length, 2);
        assert.deepEqual(publications, [pending, after]);
        assert.equal(cache.getEntry('a.b~c').status, mode === 'failure' ? Status.Error : Status.Success);
        assert.equal(cache.getEntry('a.b~c').data, mode === 'success' ? 'answer'
            : mode === 'refresh-failure' ? 'old' : undefined);
        if (mode !== 'success') assert.equal(cache.getFailure('a.b~c').message, 'offline');
        assert.equal(history.undo(), true);
        const undone = cache.getEntry('a.b~c');
        assert.equal(undone.status, mode === 'refresh-failure' ? Status.Success : Status.Idle);
        assert.equal(undone.data, pending.entries[key].data);
        assert.equal(history.redo(), true);
        assert.deepEqual(cache.snapshot(), after);
        if (optimized) {
            assert.equal(sets, mode === 'success' ? 7 : mode === 'failure' ? 4 : 3);
            assert.equal(gets + sets, mode === 'success' ? 9 : mode === 'failure' ? 6 : 5);
            assert.equal(gets, 2);
        }
        return {gets, sets, traps: gets + sets};
    } finally {
        dispose?.();
        history?.disconnect();
        WriteLog.prototype.record = originalRecord;
        globalThis.Proxy = OriginalProxy;
    }
}
