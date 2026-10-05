import {CarburetorHistory, EResourceStatus} from '@/Carburetor';
import {TestCache} from '../Helpers/TestCache';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {normalizeOwnedCacheReplay} from '@/Carburetor/Resource/Cache/State/normalizeOwnedCacheReplay';

const entry = (status: EResourceStatus, data: unknown, refreshing = false): IResourceEntry<unknown> => ({
    status, data, refreshing, error: undefined, updatedAt: 17, invalidated: false, failed: false,
});

const lock = (owner: object, key: string, configurable: boolean): void => {
    const value = (owner as Record<string, unknown>)[key];
    Object.defineProperty(owner, key, {value, enumerable: true, configurable, writable: false});
};

const descriptor = (owner: object, key: string): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(owner, key);

describe('owned cache replay of readonly transient entries', () => {
    test('mixed entries normalize only entry fields and keep a single native-linked graph', () => {
        const cache = new TestCache<unknown, string>(async () => undefined);
        const firstHistory = new CarburetorHistory(cache);
        const otherHistory = new CarburetorHistory(cache);
        const a = cache.exposeKeyOf('a');
        const b = cache.exposeKeyOf('b');
        const payload = {status: EResourceStatus.Pending, refreshing: true, tag: 'payload'};
        lock(payload, 'status', false);
        const first = entry(EResourceStatus.Pending, payload);
        lock(first, 'status', false);
        const second = entry(EResourceStatus.Success, undefined, true);
        lock(second, 'refreshing', false);
        const entries = {[a]: first, [b]: second};
        const root: IResourceCacheData<unknown> = {entries};
        const map = new Map<object, unknown>();
        const set = new Set<object>([root, entries, first, second, payload]);
        const shared = {marker: 3};
        map.set(root, entries);
        map.set(first, payload);
        map.set(shared, shared);
        first.data = {payload, map, set, shared};
        second.data = first.data;
        Object.defineProperty(map, 'owner', {value: root, writable: false, configurable: false});
        Object.defineProperty(root, 'shared', {
            value: shared, writable: false, configurable: false, enumerable: true,
        });
        cache.setData(root);
        expect(firstHistory.undo()).toBe(true);
        for (let replay = 0; replay < 2; replay++) {
            expect(firstHistory.redo()).toBe(true);
            const restored = cache.getData();
            const left = restored.entries[a];
            const right = restored.entries[b];
            expect(restored).not.toBe(root);
            expect(left).toMatchObject({status: EResourceStatus.Idle, updatedAt: 17});
            expect(right).toMatchObject({status: EResourceStatus.Success, refreshing: false, updatedAt: 17});
            expect(descriptor(left, 'status')).toMatchObject({writable: false, configurable: false});
            expect(descriptor(right, 'refreshing')).toMatchObject({writable: false, configurable: false});
            expect(left.data).toBe(right.data);
            const data = left.data as {
                payload: typeof payload; map: typeof map; set: typeof set; shared: typeof shared
            };
            expect(data.payload.status).toBe(EResourceStatus.Pending);
            expect(data.payload.refreshing).toBe(true);
            expect(data.map.get(restored)).toBe(restored.entries);
            expect(data.map.get(left)).toBe(data.payload);
            expect(data.map.get(data.shared)).toBe(data.shared);
            expect(data.set.has(restored)).toBe(true);
            expect(data.set.has(restored.entries)).toBe(true);
            expect(data.set.has(left)).toBe(true);
            expect(data.set.has(right)).toBe(true);
            expect(descriptor(data.map, 'owner')?.value).toBe(restored);
            expect(descriptor(restored, 'shared')?.value).toBe(data.shared);
            expect(first.status).toBe(EResourceStatus.Pending);
            expect(second.refreshing).toBe(true);
            expect(firstHistory.canUndo()).toBe(true);
            expect(firstHistory.canRedo()).toBe(false);
            if (replay === 0) expect(firstHistory.undo()).toBe(true);
        }
        expect(otherHistory.canUndo()).toBe(true);
        otherHistory.clear();
        expect(otherHistory.canUndo()).toBe(false);
        expect(firstHistory.undo()).toBe(true);
        expect(firstHistory.redo()).toBe(true);
        firstHistory.disconnect();
        otherHistory.disconnect();
    });

    test.each([true, false])('readonly refreshing and status keep flags, configurable=%s', configurable => {
        const cache = new TestCache<unknown, string>(async () => 'new');
        const history = new CarburetorHistory(cache);
        const key = cache.exposeKeyOf('a');
        const saved = entry(EResourceStatus.Success, 'saved', true);
        lock(saved, 'refreshing', configurable);
        lock(saved, 'status', configurable);
        const snapshot = {entries: {[key]: saved}};
        cache.setData(snapshot);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const restored = cache.getData().entries[key];
        expect(restored).toMatchObject({data: 'saved', status: EResourceStatus.Success,
            refreshing: false, updatedAt: 17});
        expect(descriptor(restored, 'refreshing')).toMatchObject({configurable, writable: false});
        expect(descriptor(restored, 'status')).toMatchObject({configurable, writable: false});
        expect(saved.refreshing).toBe(true);
        expect(history.canUndo()).toBe(true);
        history.disconnect();
    });

    test.each([true, false])('readonly Pending replays as Idle, configurable=%s', configurable => {
        const cache = new TestCache<unknown, string>(async () => 'new');
        const history = new CarburetorHistory(cache);
        const key = cache.exposeKeyOf('a');
        const saved = entry(EResourceStatus.Pending, 'saved');
        lock(saved, 'status', configurable);
        cache.setData({entries: {[key]: saved}});
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const restored = cache.getData().entries[key];
        expect(restored).toMatchObject({status: EResourceStatus.Idle, data: 'saved', updatedAt: 17});
        expect(descriptor(restored, 'status')).toMatchObject({configurable, writable: false});
        expect(saved.status).toBe(EResourceStatus.Pending);
        history.disconnect();
    });

    test('an abort listener owns its new finite request through readonly sibling normalization', async () => {
        const oldAnswer: {resolve?: (value: string) => void} = {};
        const newAnswer: {resolve?: (value: string) => void} = {};
        let pending: Promise<void> | undefined;
        let calls = 0;
        const cache = new TestCache<unknown, string>(async (_key, signal) => {
            calls++;
            if (calls === 1) {
                signal.addEventListener('abort', () => {
                    cache.setData({entries: {[cache.exposeKeyOf('a')]: entry(EResourceStatus.Success, 'live')}});
                    pending = cache.refresh('a');
                });
                return new Promise<string>(resolve => { oldAnswer.resolve = resolve; });
            }
            return new Promise<string>(resolve => { newAnswer.resolve = resolve; });
        });
        const history = new CarburetorHistory(cache);
        const key = cache.exposeKeyOf('a');
        const other = cache.exposeKeyOf('b');
        const saved = entry(EResourceStatus.Success, 'saved');
        const locked = entry(EResourceStatus.Pending, 'other');
        lock(locked, 'status', false);
        const entries = {[key]: saved, [other]: locked};
        lock(entries, key, false);
        const root = {entries};
        const backlink = new Map<object, unknown>([[root, locked], [locked, root]]);
        locked.data = backlink;
        Object.defineProperty(backlink, 'owner', {value: root, writable: false, configurable: false});
        cache.setData(root);
        const stale = cache.load('old');
        expect(history.undo()).toBe(true);
        expect(pending).toBeDefined();
        expect(history.canRedo()).toBe(false);
        expect(cache.getData().entries[key]).toMatchObject({status: EResourceStatus.Success,
            refreshing: true, data: 'live'});
        expect(cache.getData().entries[other].status).toBe(EResourceStatus.Idle);
        expect(descriptor(cache.getData().entries[other], 'status')).toMatchObject({
            writable: false, configurable: false,
        });
        expect(descriptor(cache.getData().entries, key)).toMatchObject({
            writable: true, configurable: true,
        });
        const replayed = cache.getData();
        const replayedMap = replayed.entries[other].data as Map<object, unknown>;
        expect(replayedMap.get(replayed)).toBe(replayed.entries[other]);
        expect(replayedMap.get(replayed.entries[other])).toBe(replayed);
        expect(descriptor(replayedMap, 'owner')?.value).toBe(replayed);
        if (!oldAnswer.resolve) throw new Error('old request did not begin');
        oldAnswer.resolve('late');
        await stale;
        expect(cache.getData().entries[key].data).toBe('live');
        if (!newAnswer.resolve || !pending) throw new Error('replacement did not begin');
        newAnswer.resolve('fresh');
        await pending;
        expect(cache.getData().entries[key]).toMatchObject({data: 'fresh', status: EResourceStatus.Success});
        expect(calls).toBe(2);
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
        history.disconnect();
    });

    test('locked dictionary replacement retains the newer entry without severing sibling native backlinks', () => {
        const saved = entry(EResourceStatus.Success, 'saved');
        const locked = entry(EResourceStatus.Pending, undefined);
        lock(locked, 'status', false);
        const live = entry(EResourceStatus.Success, 'live');
        const entries = {a: saved, b: locked};
        lock(entries, 'a', false);
        const root = {entries};
        const map = new Map<object, unknown>([[root, locked]]);
        locked.data = map;
        const result = normalizeOwnedCacheReplay(root, {a: live}, new Map([['a', live]]));
        expect(result).not.toBe(root);
        expect(result.entries.a).toBe(live);
        expect(descriptor(result.entries, 'a')).toMatchObject({writable: true, configurable: true});
        expect(descriptor(entries, 'a')).toMatchObject({writable: false, configurable: false});
        expect(result.entries.b.status).toBe(EResourceStatus.Idle);
        expect(descriptor(result.entries.b, 'status')).toMatchObject({writable: false, configurable: false});
        expect((result.entries.b.data as Map<object, unknown>).get(result)).toBe(result.entries.b);
        expect(locked.status).toBe(EResourceStatus.Pending);
    });

    test('ordinary restore clones and normalizes without modifying its caller', () => {
        const cache = new TestCache<unknown, string>(async () => 'new');
        const key = cache.exposeKeyOf('a');
        const saved = entry(EResourceStatus.Pending, 'saved', true);
        const snapshot = {entries: {[key]: saved}};
        cache.restore(snapshot);
        expect(cache.getData().entries[key]).toMatchObject({status: EResourceStatus.Idle,
            refreshing: false, data: 'saved', updatedAt: 17});
        expect(saved).toMatchObject({status: EResourceStatus.Pending, refreshing: true});
    });
});
