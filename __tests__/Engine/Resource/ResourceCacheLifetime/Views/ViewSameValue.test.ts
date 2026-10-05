import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {TestCache} from '../../ResourceCache/Helpers/TestCache';
import {IResourceEntry} from '@/Carburetor/Models/Resource';

const ready = <T>(data: T): IResourceEntry<T> => ({
    status: EResourceStatus.Success,
    data,
    error: undefined,
    updatedAt: 100,
    refreshing: false,
    invalidated: false,
    failed: false,
});

describe('resource cache view SameValue data', () => {
    test.each([
        [-0, +0], [+0, -0],
    ])('replacement publishes and reads a signed-zero change from %s to %s', (before, after) => {
        const cache = new TestCache<number, string>(() => Promise.resolve(1), {ttl: Infinity});
        const key = cache.exposeKeyOf('a');
        cache.setData({entries: {[key]: ready(before)}});
        const first = cache.getEntry('a');
        const version = cache.getVersion();
        const notify = rstest.fn();
        const id = cache.subscribe(notify);

        cache.setData({entries: {[key]: ready(after)}});

        const current = cache.getEntry('a');
        expect(Object.is(first.data, before)).toBe(true);
        expect(Object.is(cache.getData().entries[key].data, after)).toBe(true);
        expect(Object.is(current.data, after)).toBe(true);
        expect(current).not.toBe(first);
        expect(cache.resolve('a').view).toBe(current);
        expect(cache.getVersion()).toBe(version + 1);
        expect(notify).toHaveBeenCalledTimes(1);
        cache.unsubscribe(id);
    });

    test('unchanged NaN and ordinary primitive replacements keep views and skip publication', () => {
        const cache = new TestCache<number, string>(() => Promise.resolve(NaN), {ttl: Infinity});
        const key = cache.exposeKeyOf('a');
        cache.setData({entries: {[key]: ready(NaN)}});
        const first = cache.resolve('a').view;
        const notify = rstest.fn();
        const id = cache.subscribe(notify);
        const version = cache.getVersion();

        for (let n = 0; n < 12; n++) {
            expect(cache.getEntry('a')).toBe(first);
            expect(cache.resolve('a').view).toBe(first);
            cache.setData({entries: {[key]: ready(NaN)}});
            expect(cache.getEntry('a')).toBe(first);
        }
        expect(cache.getVersion()).toBe(version);
        expect(notify).not.toHaveBeenCalled();

        cache.setData({entries: {[key]: ready(7)}});
        const seven = cache.getEntry('a');
        expect(seven).not.toBe(first);
        expect(seven.data).toBe(7);
        expect(notify).toHaveBeenCalledTimes(1);
        cache.setData({entries: {[key]: ready(7)}});
        expect(cache.resolve('a').view).toBe(seven);
        expect(notify).toHaveBeenCalledTimes(1);
        cache.unsubscribe(id);
    });

    test('object data uses identity while equal-content replacements preserve the lazy view cache', () => {
        const cache = new TestCache<{value: number}, string>(() => Promise.resolve({value: 1}), {ttl: Infinity});
        const a = cache.exposeKeyOf('a');
        const b = cache.exposeKeyOf('b');
        const data = {value: 1};
        const entries = {[a]: ready(data), [b]: ready({value: 2})};
        cache.setData({entries});
        const first = cache.getEntry('a');
        const untouched = cache.getEntry('b');
        const notify = rstest.fn();
        const id = cache.subscribe(notify);
        const version = cache.getVersion();

        cache.setData({entries: {[a]: ready(data), [b]: ready(entries[b].data)}});
        expect(cache.resolve('a').view).toBe(first);
        expect(cache.getEntry('b')).toBe(untouched);

        const other = {value: 1};
        cache.setData({entries: {[a]: ready(other), [b]: ready(entries[b].data)}});
        expect(cache.getEntry('a')).not.toBe(first);
        expect(cache.resolve('a').view.data).toBe(other);
        expect(cache.getEntry('b')).toBe(untouched);
        expect(cache.getVersion()).toBe(version);
        expect(notify).not.toHaveBeenCalled();
        cache.unsubscribe(id);
    });

    test('load and refresh settle NaN with a fixed timestamp and stable repeated views', async () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(100);
        try {
            const values = [NaN, NaN, -0, +0];
            const loader = rstest.fn(() => Promise.resolve(values.shift() as number));
            const cache = new TestCache<number, string>(loader, {ttl: Infinity});
            const notifications = rstest.fn();
            const id = cache.subscribe(notifications);
            const key = cache.exposeKeyOf('a');

            await cache.load('a');
            const loaded = cache.resolve('a').view;
            expect(loaded.status).toBe(EResourceStatus.Success);
            expect(Number.isNaN(loaded.data)).toBe(true);
            expect(loaded.updatedAt).toBe(100);
            expect(cache.getEntry('a')).toBe(loaded);
            expect(cache.resolve('a').view).toBe(loaded);

            await cache.refresh('a');
            const refreshed = cache.getEntry('a');
            expect(Number.isNaN(refreshed.data)).toBe(true);
            expect(refreshed.updatedAt).toBe(100);
            expect(cache.resolve('a').view).toBe(refreshed);
            const afterNaN = notifications.mock.calls.length;

            await cache.refresh('a');
            const minus = cache.resolve('a').view;
            expect(Object.is(minus.data, -0)).toBe(true);
            expect(Object.is(cache.getData().entries[key].data, -0)).toBe(true);
            expect(minus).not.toBe(refreshed);
            expect(notifications).toHaveBeenCalledTimes(afterNaN + 2);

            await cache.refresh('a');
            const plus = cache.getEntry('a');
            expect(Object.is(plus.data, +0)).toBe(true);
            expect(plus).not.toBe(minus);
            expect(cache.resolve('a').view).toBe(plus);
            expect(plus.updatedAt).toBe(100);
            expect(notifications).toHaveBeenCalledTimes(afterNaN + 4);
            expect(loader).toHaveBeenCalledTimes(4);
            cache.unsubscribe(id);
        } finally {
            now.mockRestore();
        }
    });
});
