import {EResourceStatus, ResourceCache, getInitialCacheEntry} from '@/Carburetor';
import {IResourceEntry} from '@/Carburetor/Models/Resource';

const lock = (owner: object, key: string): void => {
    const value = (owner as Record<string, unknown>)[key];
    Object.defineProperty(owner, key, {value, enumerable: true, writable: false, configurable: false});
};

const successful = (data: unknown): IResourceEntry<unknown> => ({
    ...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success,
    data, updatedAt: Date.now(),
});

const nativeLinks = (root: object, entries: object, surviving: object) => {
    const links = new Map<object, object>([[root, entries], [entries, surviving], [surviving, root]]);
    let getterCalls = 0;
    const get = () => { getterCalls++; throw new Error('native metadata must not be read'); };
    const set = (_value: unknown) => { throw new Error('native metadata must not be written'); };
    Object.defineProperty(links, 'metadata', {get, set, enumerable: true, configurable: false});
    return {links, get, set, reads: () => getterCalls};
};

const expectNativeLinks = (
    root: {entries: Record<string, {data: unknown}>}, key: string,
    get: () => never, set: (_value: unknown) => void
): void => {
    const links = root.entries[key].data as Map<object, object>;
    expect(links.get(root)).toBe(root.entries);
    expect(links.get(root.entries)).toBe(root.entries[key]);
    expect(links.get(root.entries[key])).toBe(root);
    expect(Object.getOwnPropertyDescriptor(links, 'metadata')).toEqual({
        get, set, enumerable: true, configurable: false,
    });
};

describe('cache operations with native accessor metadata and readonly slots', () => {
    test.each(['load', 'refresh'] as const)('%s preserves native metadata and held slots', async method => {
        const pending = Promise.withResolvers<unknown>();
        let calls = 0;
        const cache = new ResourceCache<unknown, string>(() => {
            calls++;
            return pending.promise;
        }, {ttl: 0});
        const a = cache.keyOf('a');
        const b = cache.keyOf('b');
        const target = successful('prior');
        if (method === 'load') target.status = EResourceStatus.Idle;
        lock(target, 'status');
        const surviving = successful(undefined);
        const entries = {[a]: target, [b]: surviving};
        lock(entries, a);
        const root = {entries};
        const {links, get, set, reads} = nativeLinks(root, entries, surviving);
        surviving.data = links;
        cache.setData(root);

        const request = cache[method]('a');
        expect(cache[method]('a')).toBe(request);
        expect(calls).toBe(1);
        pending.resolve('answer');
        await request;

        const live = cache.getData();
        expect(live.entries[a]).toMatchObject({status: EResourceStatus.Success, data: 'answer'});
        expectNativeLinks(live, b, get, set);
        expect(reads()).toBe(0);
        expect(root.entries[a].status).toBe(method === 'load' ? EResourceStatus.Idle : EResourceStatus.Success);
        expect(root.entries[a].data).toBe('prior');
        expect(Object.getOwnPropertyDescriptor(root.entries, a)).toMatchObject({
            writable: false, configurable: false,
        });
        expect(Object.getOwnPropertyDescriptor(target, 'status')).toMatchObject({
            writable: false, configurable: false,
        });
    });

    test('failed readonly load preserves the raw rejection beside native-linked entries', async () => {
        const raw = new Error('loader failed');
        const cache = new ResourceCache<unknown, string>(() => Promise.reject(raw));
        const a = cache.keyOf('a');
        const b = cache.keyOf('b');
        const target = {...getInitialCacheEntry<unknown>()};
        lock(target, 'status');
        const surviving = successful(undefined);
        const entries = {[a]: target, [b]: surviving};
        lock(entries, a);
        const root = {entries};
        const {links, get, set, reads} = nativeLinks(root, entries, surviving);
        surviving.data = links;
        cache.setData(root);

        await cache.load('a');
        const live = cache.getData();
        expect(live.entries[a].status).toBe(EResourceStatus.Error);
        let caught: unknown;
        try { cache.suspend('a'); } catch (error) { caught = error; }
        expect(caught).toBe(raw);
        expectNativeLinks(live, b, get, set);
        expect(reads()).toBe(0);
        expect(target.status).toBe(EResourceStatus.Idle);
        expect(Object.getOwnPropertyDescriptor(entries, a)?.configurable).toBe(false);
    });

    test('abort frees a readonly native-linked request for a new settled load', async () => {
        const oldAnswer = Promise.withResolvers<unknown>();
        const newAnswer = Promise.withResolvers<unknown>();
        let calls = 0;
        const cache = new ResourceCache<unknown, string>(() =>
            ++calls === 1 ? oldAnswer.promise : newAnswer.promise);
        const a = cache.keyOf('a');
        const b = cache.keyOf('b');
        const target = {...getInitialCacheEntry<unknown>()};
        lock(target, 'status');
        const surviving = successful(undefined);
        const entries = {[a]: target, [b]: surviving};
        lock(entries, a);
        const root = {entries};
        const {links, get, set, reads} = nativeLinks(root, entries, surviving);
        surviving.data = links;
        cache.setData(root);

        const oldRequest = cache.load('a');
        cache.abort('a');
        expect(cache.getData().entries[a].status).toBe(EResourceStatus.Idle);
        const newRequest = cache.load('a');
        expect(newRequest).not.toBe(oldRequest);
        oldAnswer.resolve('late');
        await oldRequest;
        newAnswer.resolve('current');
        await newRequest;

        const live = cache.getData();
        expect(calls).toBe(2);
        expect(live.entries[a]).toMatchObject({status: EResourceStatus.Success, data: 'current'});
        expectNativeLinks(live, b, get, set);
        expect(reads()).toBe(0);
        expect(target.status).toBe(EResourceStatus.Idle);
    });

    test('forget actually removes a locked key without disturbing a native-linked surviving entry', () => {
        const cache = new ResourceCache<unknown, string>(async () => 'answer');
        const a = cache.keyOf('a');
        const b = cache.keyOf('b');
        const surviving = successful(undefined);
        const entries = {[a]: successful('a'), [b]: surviving};
        lock(entries, a);
        const root = {entries};
        const {links, get, set, reads} = nativeLinks(root, entries, surviving);
        surviving.data = links;
        cache.setData(root);
        cache.forget('a');

        const live = cache.getData();
        expect(Object.keys(live.entries)).toEqual([b]);
        expectNativeLinks(live, b, get, set);
        expect(reads()).toBe(0);
        expect(Object.keys(root.entries)).toEqual([a, b]);
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Idle);
    });

    test('maxEntries evicts a locked key while keeping a watched native-linked sibling', async () => {
        const cache = new ResourceCache<unknown, string>(async key => key, {ttl: Infinity, maxEntries: 2});
        const a = cache.keyOf('a');
        const b = cache.keyOf('b');
        const c = cache.keyOf('c');
        const surviving = successful(undefined);
        const removed = successful('a');
        const entries = {[a]: removed, [b]: surviving};
        lock(entries, a);
        const root = {entries};
        const {links, get, set, reads} = nativeLinks(root, entries, surviving);
        surviving.data = links;
        cache.setData(root);
        const watcher = cache.subscribe(() => undefined, {reads: new Set([cache.pathOf('b')])});
        try {
            await cache.load('c');
            const live = cache.getData();
            expect(Object.keys(live.entries)).toEqual([b, c]);
            expect(live.entries[c].data).toBe('c');
            expectNativeLinks(live, b, get, set);
            expect(reads()).toBe(0);
            expect(root.entries[a]).toBe(removed);
            expect(Object.getOwnPropertyDescriptor(root.entries, a)).toMatchObject({
                writable: false, configurable: false,
            });
        } finally {
            cache.unsubscribe(watcher);
        }
    });
});
