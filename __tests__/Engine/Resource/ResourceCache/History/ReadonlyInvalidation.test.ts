import {CarburetorHistory, EResourceStatus} from '@/Carburetor';
import {getInitialCacheEntry} from '@/Carburetor/Resource/Cache/State/getInitialCacheEntry';
import {TestCache} from '../Helpers/TestCache';

const locked = (owner: object, field: string, value: unknown): void => {
    Object.defineProperty(owner, field, {value, writable: false, configurable: false, enumerable: true});
};

const success = (data: string) => ({
    ...getInitialCacheEntry<string>(), status: EResourceStatus.Success, data,
    updatedAt: Date.now(), invalidated: false, failed: true,
});

describe('single invalidation of admitted readonly entries', () => {
    test('owned history endpoint stays intact while the operational graph becomes stale without loading', () => {
        let calls = 0;
        const cache = new TestCache<string, string>(async () => { calls++; return 'next'; }, {ttl: Infinity});
        const history = new CarburetorHistory(cache);
        const key = cache.exposeKeyOf('a');
        const saved = success('saved');
        locked(saved, 'invalidated', false);
        locked(saved, 'failed', true);
        const entries = {[key]: saved};
        locked(entries, key, saved);
        const endpoint = {entries};
        const backlink = new Map<object, object>([[endpoint, saved], [saved, endpoint]]);
        saved.data = 'saved';
        Object.defineProperty(endpoint, 'backlink', {value: backlink, enumerable: true, configurable: false});
        cache.setData(endpoint);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const held = cache.getData();
        const heldEntry = held.entries[key];
        cache.invalidate('a');
        const current = cache.getData();
        expect(cache.getEntry('a')).toMatchObject({data: 'saved', invalidated: true, failed: false, stale: true});
        expect(calls).toBe(0);
        expect(heldEntry).toMatchObject({invalidated: false, failed: true});
        expect(Object.getOwnPropertyDescriptor(heldEntry, 'invalidated')).toMatchObject({writable: false});
        expect(Object.getOwnPropertyDescriptor(held.entries, key)).toMatchObject({writable: false});
        const linked = current as unknown as {backlink: typeof backlink};
        expect(linked.backlink.get(current)).toBe(current.entries[key]);
        expect(linked.backlink.get(current.entries[key])).toBe(current);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        history.disconnect();
    });

    test('already-targeted readonly values need no publication, while direct draft writes still refuse changes', () => {
        class EditableCache extends TestCache<string, string> {
            /** Exercise an ordinary subclass draft action.
             *
             * @param key - encoded cache entry key.
             */
            public clearStale(key: string): void {
                this.update(draft => { draft.entries[key].invalidated = false; });
            }
        }
        const cache = new EditableCache(async () => 'answer', {ttl: Infinity});
        const key = cache.exposeKeyOf('a');
        const entry = success('saved');
        entry.invalidated = true;
        entry.failed = false;
        locked(entry, 'invalidated', true);
        locked(entry, 'failed', false);
        const entries = {[key]: entry};
        locked(entries, key, entry);
        const root = {entries};
        cache.setData(root);
        const version = cache.getVersion();
        cache.invalidate('a');
        expect(cache.getData()).toBe(root);
        expect(cache.getVersion()).toBe(version);
        expect(() => cache.clearStale(key)).toThrow(TypeError);
        expect(cache.getEntry('a').stale).toBe(true);
    });

    test('operational ownership retains native accessor metadata and a sibling raw failure', async () => {
        const raw = new Error('sibling rejection');
        const cache = new TestCache<unknown, string>(() => Promise.reject(raw), {ttl: Infinity});
        const a = cache.exposeKeyOf('a');
        const b = cache.exposeKeyOf('b');
        const target = success('saved');
        locked(target, 'invalidated', false);
        const sibling = {...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success,
            data: undefined as unknown, updatedAt: Date.now()};
        const entries = {[a]: target, [b]: sibling};
        const root = {entries};
        const links = new Map<object, object>([[root, entries], [entries, sibling], [sibling, root]]);
        let reads = 0;
        const get = () => { reads++; throw new Error('metadata getter called'); };
        Object.defineProperty(links, 'metadata', {get, configurable: false});
        sibling.data = links;
        cache.setData(root);
        await cache.refresh('b');
        expect(cache.getFailure('b')).toBe(raw);
        const held = cache.getData();
        cache.invalidate('a');
        const current = cache.getData();
        const mapped = current.entries[b].data as typeof links;
        expect(mapped.get(current)).toBe(current.entries);
        expect(mapped.get(current.entries)).toBe(current.entries[b]);
        expect(mapped.get(current.entries[b])).toBe(current);
        expect(Object.getOwnPropertyDescriptor(mapped, 'metadata')).toMatchObject({get, configurable: false});
        expect(reads).toBe(0);
        expect(cache.getFailure('b')).toBe(raw);
        expect(held.entries[a].invalidated).toBe(false);
    });

    test('raw failed retry stays owned and an in-flight old answer cannot consume a later invalidation', async () => {
        const pending: Array<PromiseWithResolvers<string>> = [];
        let calls = 0;
        const cache = new TestCache<string, string>(() => {
            calls++;
            const answer = Promise.withResolvers<string>();
            pending.push(answer);
            return answer.promise;
        }, {ttl: Infinity});
        const key = cache.exposeKeyOf('a');
        const original = success('saved');
        locked(original, 'invalidated', false);
        locked(original, 'failed', true);
        const raw = new Error('raw failure');
        cache.setData({entries: {[key]: original}});
        cache.invalidate('a');
        const first = cache.load('a');
        expect(calls).toBe(1);
        cache.invalidate('a');
        pending[0].resolve('older');
        await first;
        expect(cache.getEntry('a')).toMatchObject({data: 'older', stale: true, failed: false});
        const second = cache.load('a');
        pending[1].reject(raw);
        await second;
        expect(cache.getFailure('a')).toBe(raw);
        expect(cache.getEntry('a').failed).toBe(true);
        cache.invalidate('a');
        expect(cache.getEntry('a')).toMatchObject({stale: true, failed: false});
        const third = cache.load('a');
        pending[2].resolve('fresh');
        await third;
        expect(cache.getEntry('a')).toMatchObject({data: 'fresh', stale: false});
        expect(calls).toBe(3);
    });

    test('an older failed request does not disarm a later explicit invalidation', async () => {
        const pending = Promise.withResolvers<string>();
        let calls = 0;
        const cache = new TestCache<string, string>(() => { calls++; return pending.promise; },
            {ttl: Infinity});
        const key = cache.exposeKeyOf('a');
        const entry = success('saved');
        locked(entry, 'invalidated', false);
        cache.setData({entries: {[key]: entry}});
        const request = cache.refresh('a');
        cache.invalidate('a');
        const raw = new Error('older failure');
        pending.reject(raw);
        await request;
        expect(cache.getFailure('a')).toBe(raw);
        expect(cache.getEntry('a')).toMatchObject({data: 'saved', stale: true, failed: false});
        expect(calls).toBe(1);
    });
});
