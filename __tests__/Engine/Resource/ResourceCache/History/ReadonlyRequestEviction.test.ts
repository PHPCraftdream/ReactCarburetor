import {CarburetorHistory, EResourceStatus, ResourceCache, getInitialCacheEntry} from '@/Carburetor';

const lock = (owner: object, key: string): void => {
    const value = (owner as Record<string, unknown>)[key];
    Object.defineProperty(owner, key, {value, enumerable: true, writable: false, configurable: false});
};

describe('cache request restart and immutable-slot removal', () => {
    test('owned readonly Pending replay starts and settles a request without changing captured history', async () => {
        const cache = new ResourceCache<string, string>(async (key) => key + '!');
        const history = new CarburetorHistory(cache);
        const key = cache.keyOf('a');
        const entry = {...getInitialCacheEntry<string>(), status: EResourceStatus.Pending, updatedAt: 7};
        lock(entry, 'status');
        lock(entry, 'updatedAt');
        const root = {entries: {[key]: entry}};
        const links = new Map<object, object>([[root, entry], [entry, root]]);
        entry.data = links as unknown as string;
        cache.setData(root);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const captured = cache.getData();
        expect(captured.entries[key].status).toBe(EResourceStatus.Idle);
        expect(Object.getOwnPropertyDescriptor(captured.entries[key], 'status')?.writable).toBe(false);
        await cache.load('a');
        const current = cache.getData();
        expect(current.entries[key]).toMatchObject({status: EResourceStatus.Success, data: 'a!'});
        expect(current.entries[key].updatedAt).toBeGreaterThan(7);
        expect(captured.entries[key].status).toBe(EResourceStatus.Idle);
        const capturedData = captured.entries[key].data as unknown as Map<object, object>;
        expect(capturedData.get(captured)).toBe(captured.entries[key]);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        history.disconnect();
    });

    test('readonly Success refresh settles both a new answer and a raw failed refresh', async () => {
        const raw = new Error('raw refresh');
        let calls = 0;
        const cache = new ResourceCache<string, string>(async () => {
            if (++calls === 1) throw raw;
            return 'new';
        });
        const history = new CarburetorHistory(cache);
        const key = cache.keyOf('a');
        const entry = {...getInitialCacheEntry<string>(), status: EResourceStatus.Success,
            data: 'saved', updatedAt: 1, refreshing: true};
        lock(entry, 'refreshing');
        lock(entry, 'error');
        lock(entry, 'failed');
        lock(entry, 'updatedAt');
        cache.setData({entries: {[key]: entry}});
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(cache.getEntry('a').refreshing).toBe(false);
        await cache.refresh('a');
        expect(cache.getEntry('a')).toMatchObject({status: EResourceStatus.Success, data: 'saved',
            refreshing: false, failed: true, error: raw.message});
        expect(() => cache.suspend('a')).not.toThrow();
        await cache.refresh('a');
        expect(cache.getEntry('a')).toMatchObject({status: EResourceStatus.Success, data: 'new',
            refreshing: false, failed: false, error: undefined});
        expect(calls).toBe(2);
        history.disconnect();
    });

    test('a throwing prepublication observer cannot leave a joinable ghost', async () => {
        const cache = new ResourceCache<string, string>(async () => 'answer');
        const key = cache.keyOf('a');
        const entry = {...getInitialCacheEntry<string>()};
        lock(entry, 'status');
        cache.setData({entries: {[key]: entry}});
        const thrown = new Error('prepublication');
        let once = true;
        const dispose = cache.attachPatchListener({patch: () => {
            if (once) { once = false; throw thrown; }
        }});
        expect(() => cache.load('a')).toThrow(thrown);
        expect(cache.getEntry('a').status).not.toBe(EResourceStatus.Pending);
        dispose();
        await cache.load('a');
        expect(cache.getEntry('a').data).toBe('answer');
    });

    test('locked eviction, forget and native backlinks remove real keys without losing retained entries', async () => {
        const cache = new ResourceCache<unknown, string>(async (key) => key, {ttl: Infinity, maxEntries: 1});
        const a = cache.keyOf('a');
        const entry = {...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success,
            data: 'prior', updatedAt: Date.now()};
        const entries = {[a]: entry};
        lock(entries, a);
        const root = {entries};
        const links = new Map<object, object>([[root, entries], [entries, root]]);
        entry.data = links;
        cache.setData(root);
        const history = new CarburetorHistory(cache);
        const version = cache.getVersion();
        await cache.load('b');
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('b')]);
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Idle);
        expect(cache.getVersion()).toBeGreaterThan(version);
        while (cache.getData().entries[cache.keyOf('b')] && history.canUndo()) {
            expect(history.undo()).toBe(true);
        }
        expect(Object.keys(cache.getData().entries)).toEqual([a]);
        const restored = cache.getData();
        const restoredLinks = restored.entries[a].data as Map<object, object>;
        expect(restoredLinks.get(restored)).toBe(restored.entries);
        expect(Object.getOwnPropertyDescriptor(restored.entries, a)?.configurable).toBe(false);
        cache.forget('a');
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        await cache.load('b');
        cache.forgetAll();
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        history.disconnect();
    });
    test('eviction retains watched siblings and their native root aliases', async () => {
        const cache = new ResourceCache<unknown, string>(async (key) => key, {ttl: Infinity, maxEntries: 2});
        const a = cache.keyOf('a');
        const retained = cache.keyOf('retained');
        const entries = {
            [a]: {...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success,
                data: 'a', updatedAt: Date.now()},
            [retained]: {...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success,
                data: undefined, updatedAt: Date.now()},
        };
        lock(entries, a);
        const root = {entries};
        const links = new Map<object, object>([[root, entries], [entries, root]]);
        entries[retained].data = links;
        cache.setData(root);
        const notifications: string[][] = [];
        const id = cache.subscribe(() => {
            notifications.push(Object.keys(cache.getData().entries));
        }, {reads: new Set([cache.pathOf('retained')])});
        await cache.load('b');
        const live = cache.getData();
        expect(Object.keys(live.entries)).toEqual([retained, cache.keyOf('b')]);
        expect((live.entries[retained].data as Map<object, object>).get(live)).toBe(live.entries);
        expect((live.entries[retained].data as Map<object, object>).get(live.entries)).toBe(live);
        expect(notifications).toEqual([[retained, cache.keyOf('b')]]);
        cache.unsubscribe(id);
        cache.forget('retained');
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('b')]);
    });

    test('a deletion observer replacing its key keeps only the new ledger owner', async () => {
        const cache = new ResourceCache<string, string>(async (key) => key, {ttl: Infinity, maxEntries: 1});
        const a = cache.keyOf('a');
        cache.setData({entries: {[a]: {...getInitialCacheEntry<string>(), status: EResourceStatus.Success,
            data: 'old', updatedAt: Date.now()}}});
        let replacement: Promise<void> | undefined;
        const stop = cache.attachPatchListener({patch: () => {
            if (!replacement && !cache.getData().entries[a]) replacement = cache.load('a');
        }});
        cache.forget('a');
        stop();
        expect(replacement).toBeDefined();
        await replacement;
        await cache.load('b');
        expect(Object.keys(cache.getData().entries)).toEqual([cache.keyOf('b')]);
        expect(cache.getEntry('b').data).toBe('b');
    });

    test('locked eviction retains the raw failure owner of an unrelated Error entry', async () => {
        const raw = new Error('raw identity');
        const cache = new ResourceCache<string, string>(async (key) => {
            if (key === 'failed') throw raw;
            return key;
        }, {ttl: Infinity, maxEntries: 2});
        await cache.load('failed');
        const failed = cache.keyOf('failed');
        const old = cache.keyOf('old');
        const entries = {[failed]: cache.getData().entries[failed]};
        Object.defineProperty(entries, old, {
            value: {...getInitialCacheEntry<string>(), status: EResourceStatus.Success,
                data: 'old', updatedAt: Date.now()},
            enumerable: true, writable: false, configurable: false,
        });
        cache.setData({entries});
        const id = cache.subscribe(() => undefined, {reads: new Set([cache.pathOf('failed')])});
        await cache.load('new');
        expect(Object.keys(cache.getData().entries)).toEqual([failed, cache.keyOf('new')]);
        let caught: unknown;
        try { cache.suspend('failed'); } catch (error) { caught = error; }
        expect(caught).toBe(raw);
        cache.unsubscribe(id);
    });

});
