import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import type {TReadonly, IResourceView} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {createResourceReader} from '@/Interop/createResourceReader';

interface Data {nested: {name: string; unread: number}; alternate: string}
class Cache extends ResourceCache<Data, string> {
    public edit(field: 'name' | 'unread' | 'alternate', value: string | number): void {
        const key = this.resolve('user').key;
        this.update(draft => {
            const data = draft.entries[key].data!;
            if (field === 'name') data.nested.name = String(value);
            else if (field === 'alternate') data.alternate = String(value);
            else data.nested.unread = Number(value);
        });
    }
}
const selectName = (view: TReadonly<IResourceView<Data>>) => ({nested: {name: view.data!.nested.name}});
const selectData = (view: TReadonly<IResourceView<Data>>) => view.data!;
const loaded = async (name = 'Ada') => {
    const cache = new Cache(async () => ({nested: {name, unread: 0}, alternate: 'other'}), {ttl: Infinity});
    await cache.load('user');
    return cache;
};

describe('R41 captured resource data', () => {
    test('memo child bails out on parent props, adopts leaves, ignores nested unread writes', async () => {
        const cache = await loaded();
        const classCache = await loaded();
        let hook = 0;
        let control = 0;
        const Child = React.memo(({data, kind}: {
            data: {readonly nested: {readonly name: string}}; kind: 'hook' | 'class';
        }) => {
            // oxlint-disable-next-line react/immutability, react/globals -- Actual render counters.
            if (kind === 'hook') hook++; else control++;
            return <span>{data.nested.name}</span>;
        });
        const Parent = ({tick}: {tick: number}) => {
            void tick;
            return <Child kind="hook" data={useResourceValue(cache, 'user', selectName)}/>;
        };
        class Control extends AntiHookComponent<{tick: number}> {
            private readonly selected = this.connectSelection(classCache, view => ({
                nested: {name: view.entries[classCache.resolve('user').key].data!.nested.name},
            }));
            public render() {
                this.useResource(classCache, 'user');
                return <Child kind="class" data={this.selected()}/>;
            }
        }
        const mounted = render(<><Parent tick={0}/><Control tick={0}/></>);
        mounted.rerender(<><Parent tick={1}/><Control tick={1}/></>);
        expect([hook, control]).toEqual([1, 1]);
        await act(async () => { cache.edit('unread', 1); });
        expect([hook, control]).toEqual([1, 1]);
        await act(async () => { cache.edit('name', 'Grace'); classCache.edit('name', 'Grace'); });
        expect([hook, control]).toEqual([2, 2]);
        expect(mounted.container.textContent).toBe('GraceGrace');
        mounted.unmount();
    });

    test('old source snapshot stays captured and local override never changes cache', async () => {
        const first = await loaded();
        const second = await loaded('Grace');
        let retained: Data | undefined;
        const Parent = ({cache}: {cache: Cache}) => {
            const data = useResourceValue(cache, 'user', selectData);
            // oxlint-disable-next-line react/immutability, react/globals -- Retained-snapshot proof.
            retained ??= data;
            const local = {...data, nested: {...data.nested, name: 'local'}};
            expect(local.nested.name).toBe('local');
            return <span>{data.nested.name}</span>;
        };
        const mounted = render(<Parent cache={first}/>);
        mounted.rerender(<Parent cache={second}/>);
        expect(mounted.container.textContent).toBe('Grace');
        expect(retained!.nested.name).toBe('Ada');
        expect(first.getEntry('user').data!.nested.name).toBe('Ada');
        mounted.unmount();
    });

    test('closed collectors stay closed during a later real React render', async () => {
        const cache = await loaded();
        let retained: {readonly nested: {readonly name: string}} | undefined;
        let parents = 0;
        const Parent = ({alternate}: {alternate: boolean}) => {
            // oxlint-disable-next-line react/immutability, react/globals -- Intentional actual-render counter.
            parents++;
            const data = useResourceValue(cache, 'user', view => {
                if (alternate) {
                    // Touching an old detached result during selection records nothing.
                    expect(retained!.nested.name).toBe('Ada');
                    return {nested: {name: view.data!.alternate}};
                }
                return {nested: {name: view.data!.nested.name}};
            });
            retained ??= data;
            return <span>{data.nested.name}</span>;
        };
        const mounted = render(<Parent alternate={false}/>);
        mounted.rerender(<Parent alternate/>);
        const switched = parents;
        await act(async () => { cache.edit('name', 'retired'); cache.edit('unread', 1); });
        expect(parents).toBe(switched);
        expect(mounted.container.textContent).toBe('other');
        await act(async () => { cache.edit('alternate', 'visible'); });
        expect(parents).toBe(switched + 1);
        expect(mounted.container.textContent).toBe('visible');
        expect(retained!.nested.name).toBe('Ada');
        mounted.unmount();
    });

    test('exceptions close leaked inputs and exact candidate commit ignores a later candidate', async () => {
        const cache = await loaded();
        const resolution = cache.resolve('user');
        const reader = createResourceReader<Data, string, string>(cache, resolution.path);
        let leaked!: TReadonly<IResourceView<Data>>;
        expect(() => reader.evaluate('user', resolution, view => {
            leaked = view;
            void view.data!.nested.name;
            throw new Error('selector failed');
        })).toThrow('selector failed');
        let leakedUnread: number | undefined;
        const a = reader.evaluate('user', resolution, view => {
            // Borrowed inputs are closed recorders, not detached snapshots of raw data.
            leakedUnread = leaked!.data!.nested.unread;
            return view.data!.alternate;
        });
        expect(leakedUnread).toBe(0);
        const b = reader.evaluate('user', resolution, view => view.data!.nested.name);
        const deliveries: object[] = [];
        const unsubscribe = reader.subscribe(() => deliveries.push(reader.getSnapshot(a)));
        reader.commit(a);
        try {
            void b.value;
            void leaked!.data!.nested.unread;
            cache.edit('name', 'B-only');
            cache.edit('unread', 1);
            expect(deliveries).toEqual([]);
            cache.edit('alternate', 'A-visible');
            expect(deliveries).toHaveLength(1);
            expect(leakedUnread).toBe(1);
            const latest = reader.evaluate('user', cache.resolve('user'), view => view.data!.alternate);
            expect(latest.value).toBe('A-visible');
        } finally { unsubscribe(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('interleaved synchronous evaluations never retarget closed or outer input recorders', async () => {
        const cache = await loaded();
        const resolution = cache.resolve('user');
        const reader = createResourceReader<Data, string, string>(cache, resolution.path);
        let aInput!: TReadonly<IResourceView<Data>>;
        let bInput!: TReadonly<IResourceView<Data>>;
        let bCandidate!: ReturnType<typeof reader.evaluate>;
        let borrowedName: string | undefined;
        let borrowedUnread: number | undefined;
        const a = reader.evaluate('user', resolution, view => {
            aInput = view;
            bCandidate = reader.evaluate('user', resolution, nested => {
                bInput = nested;
                borrowedName = aInput!.data!.nested.name;
                return nested.data!.alternate;
            });
            // B has closed while A remains open. B's extra leaf belongs to neither later input.
            borrowedUnread = bInput!.data!.nested.unread;
            return view.data!.nested.name;
        });
        expect(borrowedName).toBe('Ada');
        expect(borrowedUnread).toBe(0);
        const notifications: object[] = [];
        reader.commit(bCandidate!);
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(bCandidate!)));
        try {
            expect(a.value).toBe('Ada');
            void aInput!.data!.nested.unread;
            cache.edit('name', 'A-only');
            cache.edit('unread', 1);
            expect(notifications).toEqual([]);
            cache.edit('alternate', 'B-visible');
            expect(notifications).toHaveLength(1);
            expect(borrowedName).toBe('A-only');
            expect(a.value).toBe('Ada');
        } finally { unsubscribe(); }
    });

    test('failed commit drift capture preserves the previous committed selector and subscription', async () => {
        const cache = await loaded();
        const resolution = cache.resolve('user');
        const reader = createResourceReader<Data, string, string>(cache, resolution.path);
        const current = reader.evaluate('user', resolution, view => view.data!.nested.name);
        reader.commit(current);
        const notifications: object[] = [];
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(current)));
        let fail = false;
        const candidate = reader.evaluate('user', resolution, view => {
            if (fail) throw new Error('commit drift failed');
            return view.data!.alternate;
        });
        try {
            cache.edit('alternate', 'candidate drift');
            fail = true;
            expect(() => reader.commit(candidate)).toThrow('commit drift failed');
            expect(notifications).toEqual([]);
            cache.edit('name', 'committed delivery');
            expect(notifications).toHaveLength(1);
            expect(Object.keys(cache[S.subscribers])).toHaveLength(1);
        } finally { unsubscribe(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test.each([false, true])(
        'subscribe-before-commit captures a synchronous attachment write (callback=%s)', async deliverCallback => {
        const cache = await loaded();
        const resolution = cache.resolve('user');
        const select = (view: TReadonly<IResourceView<Data>>) => view.data!.nested.name;
        const reader = createResourceReader<Data, string, string>(cache, resolution.path);
        const candidate = reader.evaluate('user', resolution, select);
        const original = cache.subscribe.bind(cache);
        let attaching = false;
        let attached = false;
        cache.subscribe = (callback, options) => {
            const id = original(() => {
                if (!attaching || deliverCallback) callback();
            }, options);
            if (!attached) {
                attached = true;
                attaching = true;
                try { cache.edit('name', 'written during attachment'); }
                finally { attaching = false; }
            }
            return id;
        };
        const notifications: object[] = [];
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(candidate)));
        try {
            expect(attached).toBe(false);
            reader.commit(candidate);
            expect(attached).toBe(true);
            expect(candidate.value).toBe('Ada');
            const latest = reader.evaluate('user', cache.resolve('user'), select);
            expect(latest.value).toBe('written during attachment');
            expect(reader.getSnapshot(candidate)).toBe(latest.token);
            expect(reader.getSnapshot(candidate)).not.toBe(candidate.token);
            expect(notifications).toEqual([latest.token]);
            expect(Object.keys(cache[S.subscribers])).toHaveLength(1);
        } finally { unsubscribe(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('failed subscription attachment releases ownership before propagating its error', async () => {
        const cache = await loaded();
        const resolution = cache.resolve('user');
        const reader = createResourceReader<Data, string, string>(cache, resolution.path);
        const candidate = reader.evaluate('user', resolution, view => view.data!.nested.name);
        reader.commit(candidate);
        const subscribe = cache.subscribe;
        cache.subscribe = (callback, options) => {
            subscribe.call(cache, callback, options);
            throw new Error('attachment failed');
        };
        try {
            expect(() => reader.subscribe(() => {})).toThrow('attachment failed');
            expect(Object.keys(cache[S.subscribers])).toEqual([]);
        } finally { cache.subscribe = subscribe; }
        reader.commit(candidate);
        const unsubscribe = reader.subscribe(() => {});
        expect(Object.keys(cache[S.subscribers])).toHaveLength(1);
        unsubscribe();
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('equal-result branch migration happens on notification without a React commit', async () => {
        const cache = await loaded('other');
        const key = cache.resolve('user').key;
        const reader = createResourceReader<Data, string, string>(cache, cache.resolve('user').path);
        const select = (view: TReadonly<IResourceView<Data>>) => view.data!.nested.unread === 0
            ? view.data!.nested.name : view.data!.alternate;
        const candidate = reader.evaluate('user', cache.resolve('user'), select);
        const notifications: object[] = [];
        reader.commit(candidate);
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(candidate)));
        try {
            cache.edit('unread', 1);
            expect(notifications).toEqual([]);
            cache.edit('name', 'retired');
            expect(notifications).toEqual([]);
            cache.edit('alternate', 'active');
            expect(notifications).toHaveLength(1);
            expect(cache.getData().entries[key].data!.alternate).toBe('active');
        } finally { unsubscribe(); }
    });
});
