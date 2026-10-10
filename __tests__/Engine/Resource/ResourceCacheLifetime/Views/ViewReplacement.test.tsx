import {R} from "@/Carburetor/Store/Diagnostics/Internal/ResourceSymbols";
import * as React from 'react';
import {TestCache} from '../../ResourceCache/Helpers/TestCache';
import {render} from '@testing-library/react';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceEntry, IResourceView} from '@/Carburetor/Models/Resource';

interface IValue {
    label: string;
}

const ready = (label: string): IResourceEntry<IValue> => ({
    status: EResourceStatus.Success, data: {label}, error: undefined, updatedAt: 100,
    refreshing: false, invalidated: false, failed: false,
});
const prepare = (ttl = Infinity) => {
    const cache = new TestCache<IValue, string>(() => Promise.resolve({label: 'loaded'}), {ttl});
    const [a, b] = ['a', 'b'].map((key) => cache.exposeKeyOf(key));
    const entries = {[a]: ready('a'), [b]: ready('b')};

    cache.setData({entries});

    return {cache, a, b, entries};
};

describe('ResourceCache replacement views (R10-06)', () => {
    test('same-root replacement retains views without publishing', () => {
        const {cache} = prepare();
        const views = ['a', 'b'].map((key) => cache.getEntry(key));
        const version = cache.getVersion();
        const notify = rstest.fn();
        const id = cache.subscribe(notify);

        cache.setData(cache.getData());

        expect(cache.getEntry('a')).toBe(views[0]);
        expect(cache.getEntry('b')).toBe(views[1]);
        expect(cache.getVersion()).toBe(version);
        expect(notify).not.toHaveBeenCalled();
        cache.unsubscribe(id);
    });

    test('new roots, dictionaries and equal entry records retain views and data identities', () => {
        const {cache, entries, a, b} = prepare();
        const viewA = cache.getEntry('a');
        const viewB = cache.getEntry('b');
        const version = cache.getVersion();

        cache.setData({entries});
        expect(cache.getEntry('a')).toBe(viewA);
        expect(cache.getEntry('b')).toBe(viewB);

        cache.setData({entries: {[a]: {...entries[a]}, [b]: {...entries[b]}}});

        expect(cache.getEntry('a')).toBe(viewA);
        expect(cache.getEntry('b')).toBe(viewB);
        expect(cache.getEntry('a').data).toBe(entries[a].data);
        expect(cache.getVersion()).toBe(version);
    });

    test.each([
        {status: EResourceStatus.Error}, {data: {label: 'changed'}}, {error: 'failure'},
        {updatedAt: 101}, {refreshing: true}, {invalidated: true}, {failed: true},
    ] as Partial<IResourceEntry<IValue>>[])('reads rebuild only views with changed fields: %j', (change) => {
        const {cache, entries, a} = prepare();
        const viewA = cache.getEntry('a');
        const viewB = cache.getEntry('b');
        const notify = rstest.fn();
        const id = cache.subscribe(notify);
        const changed = {...entries[a], ...change};

        cache.setData({entries: {...entries, [a]: changed}});

        expect(cache.getEntry('a')).not.toBe(viewA);
        expect(cache.getEntry('a')).toEqual({...changed, stale: changed.invalidated});
        expect(cache.getEntry('b')).toBe(viewB);
        expect(notify).toHaveBeenCalledTimes(1);
        cache.unsubscribe(id);
    });

    test('prunes removed keys before delivery and does not revive a removed view on re-addition', () => {
        const {cache, entries, a, b} = prepare();
        const viewA = cache.getEntry('a');
        const viewB = cache.getEntry('b');
        let absentAtDelivery = false;
        const id = cache.subscribe(() => { absentAtDelivery = cache.getEntry('a').data === undefined; });

        cache.setData({entries: {[b]: entries[b]}});

        expect(absentAtDelivery).toBe(true);
        expect(cache.getEntry('a').data).toBeUndefined();
        expect(cache.getEntry('b')).toBe(viewB);

        cache.setData({entries: {[a]: entries[a], [b]: entries[b]}});

        expect(cache.getEntry('a')).not.toBe(viewA);
        expect(cache.getEntry('a').data).toBe(viewA.data);
        expect(cache.getEntry('b')).toBe(viewB);
        cache.unsubscribe(id);
    });

    test('equal data with a new reference changes its view independently of publications', () => {
        const {cache, entries, a} = prepare();
        const viewA = cache.getEntry('a');
        const viewB = cache.getEntry('b');
        const data = {label: 'a'};
        const version = cache.getVersion();
        const notify = rstest.fn();
        const id = cache.subscribe(notify);

        cache.setData({entries: {...entries, [a]: {...entries[a], data}}});

        expect(cache.getEntry('a')).not.toBe(viewA);
        expect(cache.getEntry('a').data).toBe(data);
        expect(cache.getEntry('b')).toBe(viewB);
        expect(cache.getVersion()).toBe(version);
        expect(notify).not.toHaveBeenCalled();
        cache.unsubscribe(id);
    });

    test('same-root replacement invalidates TTL transitions and retains already-stale views', () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(110);

        try {
            const {cache} = prepare(10);
            const fresh = cache.getEntry('a');
            const version = cache.getVersion();

            expect(fresh.stale).toBe(false);
            cache.setData(cache.getData());
            expect(cache.getEntry('a')).toBe(fresh);

            now.mockReturnValue(111);
            cache.setData(cache.getData());

            const stale = cache.getEntry('a');

            expect(stale).not.toBe(fresh);
            expect(stale.stale).toBe(true);
            cache.setData(cache.getData());
            expect(cache.getEntry('a')).toBe(stale);

            now.mockReturnValue(110);
            cache.setData(cache.getData());

            expect(cache.getEntry('a')).not.toBe(stale);
            expect(cache.getEntry('a').stale).toBe(false);
            expect(cache.getVersion()).toBe(version);
        } finally {
            now.mockRestore();
        }
    });

    test('read-time freshness changes still rebuild a retained view after replacement', () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(110);

        try {
            const {cache} = prepare(10);
            const fresh = cache.getEntry('a');

            cache.setData(cache.getData());
            expect(cache.getEntry('a')).toBe(fresh);
            now.mockReturnValue(111);
            expect(cache.getEntry('a')).not.toBe(fresh);
            expect(cache.getEntry('a').stale).toBe(true);
        } finally {
            now.mockRestore();
        }
    });

    test('synchronous subscriber reads see changed views while untouched views stay stable', () => {
        const {cache, entries, a} = prepare();
        const viewA = cache.getEntry('a');
        const viewB = cache.getEntry('b');
        const delivered: IResourceView<IValue>[] = [];
        const id = cache.subscribe(() => {
            delivered.push(cache.getEntry('a'), cache.getEntry('b'));
        });

        cache.setData({entries: {...entries, [a]: {...entries[a], data: {label: 'updated'}}}});

        expect(delivered[0]).not.toBe(viewA);
        expect(delivered[0].data?.label).toBe('updated');
        expect(delivered[1]).toBe(viewB);
        expect(cache.getEntry('a')).toBe(delivered[0]);
        cache.unsubscribe(id);
    });

    test('synchronous subscriber reads validate TTL after an unrelated entry changes', () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(110);

        try {
            const {cache, entries, b} = prepare(10);
            const fresh = cache.getEntry('a');
            const delivered: IResourceView<IValue>[] = [];
            const id = cache.subscribe(() => { delivered.push(cache.getEntry('a')); });

            now.mockReturnValue(111);
            cache.setData({entries: {...entries, [b]: {...entries[b], data: {label: 'updated'}}}});

            expect(delivered).toHaveLength(1);
            expect(delivered[0]).not.toBe(fresh);
            expect(delivered[0].stale).toBe(true);
            expect(delivered[0].data).toBe(fresh.data);
            expect(cache.getEntry('a')).toBe(delivered[0]);
            cache.unsubscribe(id);
        } finally {
            now.mockRestore();
        }
    });

    test('unread replacements expose the latest value and preserve untouched views until removal', () => {
        const {cache, entries, a, b} = prepare();
        const viewB = cache.getEntry('b');

        cache.getEntry('a');
        for (let revision = 0; revision < 100; revision++) {
            cache.setData({entries: {[a]: ready(`revision-${revision}`), [b]: entries[b]}});
        }

        expect(cache.getEntry('a').data?.label).toBe('revision-99');
        expect(cache.getEntry('b')).toBe(viewB);
        cache.setData({entries: {[b]: entries[b]}});
        expect(cache.getEntry('a').data).toBeUndefined();
        cache.setData({entries: {}});
        expect(cache.getEntry('b').data).toBeUndefined();
    });

    test('same-root replacement still reconciles an adopted dictionary mutated by its owner', () => {
        const {cache, entries, a, b} = prepare();
        const root = cache.getData();
        const c = cache.exposeKeyOf('c');
        const viewB = cache.getEntry('b');
        const ledger = (cache as unknown as {[R.eviction]: {count: number; lastUsed: Map<string, number>}})[R.eviction];

        cache.getEntry('a');
        delete entries[a];
        entries[c] = ready('c');
        cache.setData(root);

        expect(cache.getEntry('a').data).toBeUndefined();
        expect(cache.getEntry('b')).toBe(viewB);
        expect(cache.getEntry('c').data?.label).toBe('c');
        expect(ledger.count).toBe(2);
        expect(new Set(ledger.lastUsed.keys())).toEqual(new Set([b, c]));
    });

    test('memoized children skip unchanged views during real parent updates', () => {
        const {cache, entries, a} = prepare();
        const renders = {a: 0, b: 0};
        const recordRender = (name: 'a' | 'b') => { renders[name]++; };
        const Row = React.memo(({name, view}: {name: 'a' | 'b'; view: IResourceView<IValue>}) => {
            recordRender(name);

            return <span data-testid={name}>{view.data?.label}</span>;
        });
        const Parent = ({tick}: {tick: number}) => <div data-tick={tick}>
            <Row name="a" view={cache.getEntry('a')}/>
            <Row name="b" view={cache.getEntry('b')}/>
        </div>;
        const {rerender, getByTestId, unmount} = render(<Parent tick={0}/>);

        expect(renders).toEqual({a: 1, b: 1});
        cache.setData(cache.getData());
        rerender(<Parent tick={1}/>);
        cache.setData({entries});
        rerender(<Parent tick={2}/>);
        expect(renders).toEqual({a: 1, b: 1});

        cache.setData({entries: {...entries, [a]: {...entries[a], data: {label: 'updated'}}}});
        rerender(<Parent tick={3}/>);

        expect(renders).toEqual({a: 2, b: 1});
        expect(getByTestId('a').textContent).toBe('updated');
        expect(getByTestId('b').textContent).toBe('b');
        unmount();
    });
});
