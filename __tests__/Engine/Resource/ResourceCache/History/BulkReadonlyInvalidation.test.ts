import {CarburetorHistory, EResourceStatus} from '@/Carburetor';
import {getInitialCacheEntry} from '@/Carburetor/Resource/Cache/State/getInitialCacheEntry';
import {TestCache} from '../Helpers/TestCache';
import {IResourceEntry} from '@/Carburetor/Models/Resource';

const ready = (data: unknown): IResourceEntry<unknown> => ({
    ...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success, data, updatedAt: Date.now(),
});

const lock = (owner: object, key: string): void => {
    Object.defineProperty(owner, key, {
        value: (owner as Record<string, unknown>)[key], enumerable: true,
        writable: false, configurable: false,
    });
};

describe('bulk invalidation across readonly cache entries', () => {
    test('publishes all stale flags together without loading, retaining readonly history and native aliases', () => {
        let loads = 0;
        const cache = new TestCache<unknown, string>(async () => { loads++; return 'loaded'; }, {ttl: Infinity});
        const history = new CarburetorHistory(cache);
        const goodKey = cache.exposeKeyOf('good');
        const lockedKey = cache.exposeKeyOf('locked');
        const good = ready('good');
        const locked = ready(undefined);
        lock(locked, 'invalidated');
        lock(locked, 'failed');
        const entries = {[goodKey]: good, [lockedKey]: locked};
        lock(entries, lockedKey);
        const root = {entries};
        const links = new Map<object, object>([[root, entries], [entries, locked], [locked, root]]);
        locked.data = links;
        Object.defineProperty(links, 'owner', {value: root, writable: false, configurable: false});
        cache.setData(root);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const held = cache.getData();
        const notifications = {good: 0, locked: 0, unchanged: 0};
        let reentered = false;
        const goodReader = cache.subscribe(() => {
            notifications.good++;
            expect(cache.getEntry('good').stale).toBe(true);
            expect(cache.getEntry('locked').stale).toBe(true);
            if (!reentered) {
                reentered = true;
                cache.invalidateAll();
            }
        }, {reads: new Set([`entries.${goodKey}.invalidated`])});
        const lockedReader = cache.subscribe(() => { notifications.locked++; }, {
            reads: new Set([`entries.${lockedKey}.invalidated`]),
        });
        const dataReader = cache.subscribe(() => { notifications.unchanged++; }, {
            reads: new Set([`entries.${goodKey}.data`]),
        });
        const version = cache.getVersion();
        cache.invalidateAll();
        const current = cache.getData();
        expect(cache.getVersion()).toBe(version + 1);
        expect(notifications).toEqual({good: 1, locked: 1, unchanged: 0});
        expect(loads).toBe(0);
        for (const key of [goodKey, lockedKey]) {
            expect(current.entries[key]).toMatchObject({invalidated: true, failed: false});
        }
        expect(cache.getEntry('good').stale).toBe(true);
        expect(cache.getEntry('locked').stale).toBe(true);
        expect(held.entries[lockedKey].invalidated).toBe(false);
        expect(Object.getOwnPropertyDescriptor(held.entries[lockedKey], 'invalidated')?.writable).toBe(false);
        const nextLinks = current.entries[lockedKey].data as Map<object, object>;
        expect(nextLinks.get(current)).toBe(current.entries);
        expect(nextLinks.get(current.entries)).toBe(current.entries[lockedKey]);
        expect(nextLinks.get(current.entries[lockedKey])).toBe(current);
        expect(Object.getOwnPropertyDescriptor(nextLinks, 'owner')?.value).toBe(current);
        expect(Object.getOwnPropertyDescriptor(held.entries, lockedKey)?.writable).toBe(false);
        cache.invalidateAll();
        expect(cache.getVersion()).toBe(version + 1);
        expect(notifications).toEqual({good: 1, locked: 1, unchanged: 0});
        cache.unsubscribe(goodReader);
        cache.unsubscribe(lockedReader);
        cache.unsubscribe(dataReader);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(cache.getEntry('locked').stale).toBe(true);
        history.disconnect();
    });

    test('preparation failure leaves sibling state and pending request epoch unchanged', async () => {
        const deferred = Promise.withResolvers<unknown>();
        const cache = new TestCache<unknown, string>(() => deferred.promise, {ttl: Infinity});
        const pending = cache.load('good');
        const goodKey = cache.exposeKeyOf('good');
        const lockedKey = cache.exposeKeyOf('locked');
        const locked = ready('locked');
        lock(locked, 'invalidated');
        const hidden = {};
        Object.defineProperty(hidden, 'unsupported', {get: () => 'value', enumerable: true});
        locked.data = new Map<unknown, unknown>([[hidden, 'native payload']]);
        cache.setData({entries: {[goodKey]: cache.getData().entries[goodKey], [lockedKey]: locked}});
        const before = cache.getData();
        const version = cache.getVersion();
        expect(() => cache.invalidateAll()).toThrow(Error);
        expect(cache.getData()).toBe(before);
        expect(cache.getVersion()).toBe(version);
        expect(cache.getData().entries[goodKey].invalidated).toBe(false);
        expect(cache.getData().entries[lockedKey].invalidated).toBe(false);
        deferred.resolve('settled');
        await pending;
        expect(cache.getEntry('good')).toMatchObject({data: 'settled', stale: false});
    });

    test('late success stays stale and invalidated failed entries retry after a replacement', async () => {
        const first = Promise.withResolvers<unknown>();
        const raw = new Error('offline');
        let failedCalls = 0;
        let runningCalls = 0;
        const cache = new TestCache<unknown, string>((key) => {
            if (key === 'running') { runningCalls++; return first.promise; }
            failedCalls++;
            return failedCalls === 1 ? Promise.reject(raw) : Promise.resolve('recovered');
        }, {ttl: Infinity});
        await cache.load('failed');
        const failedKey = cache.exposeKeyOf('failed');
        let thrown: unknown;
        try { cache.suspend('failed'); } catch (error) { thrown = error; }
        expect(thrown).toBe(raw);
        const locked = cache.getData().entries[failedKey];
        lock(locked, 'invalidated');
        lock(locked, 'failed');
        const old = cache.load('running');
        const runningKey = cache.exposeKeyOf('running');
        const pending = cache.getData().entries[runningKey];
        cache.setData({entries: {[runningKey]: pending, [failedKey]: locked}});
        cache.invalidateAll();
        expect(cache.getEntry('failed')).toMatchObject({invalidated: true, failed: false, stale: true});
        expect(failedCalls).toBe(1);
        expect(runningCalls).toBe(1);
        first.resolve('late');
        await old;
        expect(cache.getEntry('running')).toMatchObject({data: 'late', stale: true, invalidated: true});
        let retry: unknown;
        try { cache.suspend('failed'); } catch (error) { retry = error; }
        expect(retry).toBeInstanceOf(Promise);
        await retry;
        expect(cache.getEntry('failed')).toMatchObject({data: 'recovered', failed: false, stale: false});
        expect(failedCalls).toBe(2);
    });
});
