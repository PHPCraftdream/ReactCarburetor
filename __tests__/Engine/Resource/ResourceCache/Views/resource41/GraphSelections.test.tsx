import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import type {IResourceView, TReadonly} from '@/Carburetor';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {useResourceValue} from '@/Interop';
import {createResourceReader} from '@/Interop/createResourceReader';

interface Graph {
    left: {name: string}; right: {name: string};
    sparse: Array<{name: string}>; flat: string[]; dictionary: Record<string, string>;
    date: Date; map: Map<string, {name: string}>; set: Set<string>;
    alias: {name: string}; cycle?: Graph;
}
class Cache extends ResourceCache<Graph, string> {
    public editDate(time: number): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data!.date.setTime(time); });
    }
    public editSparseName(name: string): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data!.sparse[2].name = name; });
    }
    public editFlatName(name: string): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data!.flat[0] = name; });
    }
    public editDictionary(name: string): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data!.dictionary.name = name; });
    }
    public edit(branch: 'left' | 'right', name: string): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data![branch].name = name; });
    }
}
const graph = (): Graph => {
    const left = {name: 'Ada'};
    const sparse: Array<{name: string}> = [];
    sparse.length = 3;
    sparse[2] = {name: 'Ada'};
    return {left, right: {name: 'Grace'}, alias: {name: 'Ada'}, sparse, flat: ['Ada'],
        dictionary: Object.assign(Object.create(null), {name: 'dictionary'}),
        date: new Date(123), map: new Map([['user', left]]), set: new Set(['user'])};
};
const selectGraph = (view: TReadonly<IResourceView<Graph>>) => view.data!;
const selectCyclicGraph = (view: TReadonly<IResourceView<Graph>>) => {
    const data = view.data!;
    const left = data.left;
    const sparse: Array<TReadonly<{name: string}>> = [];
    sparse.length = data.sparse.length;
    sparse[2] = left;
    interface SelectedGraph extends Omit<TReadonly<Graph>, 'cycle'> {
        cycle?: SelectedGraph;
    }
    const selected: SelectedGraph = {...data, left, alias: left, sparse,
        map: new Map([['user', left]]), cycle: undefined};
    selected.cycle = selected;
    return selected;
};

describe('R41 resource graph selections', () => {
    test('whole graphs detach cycles, aliases, sparse arrays, null prototypes and native values', async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        let retained!: TReadonly<Graph>;
        let latest!: TReadonly<Graph>;
        const Reader = () => {
            const selected = useResourceValue(cache, 'user', selectCyclicGraph);
            // oxlint-disable-next-line react/globals -- Retain the first actual selection for snapshot assertions.
            retained ??= selected;
            // oxlint-disable-next-line react/globals -- Capture the actual selection for identity assertions.
            latest = selected;
            return <span>{selected.left.name}:{selected.right.name}</span>;
        };
        const mounted = render(<Reader/>);
        try {
            expect(retained).not.toBe(cache.getEntry('user').data);
            expect(cache.getEntry('user').data!.cycle).toBeUndefined();
            expect(cache.getEntry('user').data!.alias).not.toBe(cache.getEntry('user').data!.left);
            expect(cache.getEntry('user').data!.sparse[2]).not.toBe(cache.getEntry('user').data!.left);
            expect(retained!.left).not.toBe(cache.getEntry('user').data!.left);
            expect(retained!.map).not.toBe(cache.getEntry('user').data!.map);
            expect(retained!.cycle).toBe(retained);
            expect(retained!.alias).toBe(retained!.left);
            expect(retained!.sparse[2]).toBe(retained!.left);
            expect(0 in retained!.sparse).toBe(false);
            expect(retained!.sparse).toHaveLength(3);
            expect(Object.getPrototypeOf(retained!.dictionary)).toBe(null);
            expect(retained!.date.getTime()).toBe(123);
            expect(retained!.map.get('user')).toBe(retained!.left);
            expect([...retained!.set]).toEqual(['user']);
            await act(async () => { cache.edit('right', 'whole graph observed'); });
            expect(mounted.container.textContent).toBe('Ada:whole graph observed');
            expect(retained!.right.name).toBe('Grace');
            expect(latest!.left).toBe(retained!.left);
            expect(latest!.cycle).toBe(latest);
            expect(latest!.alias).toBe(latest!.left);
            expect(latest!.sparse[2]).toBe(latest!.left);
            expect(latest!.map.get('user')).toBe(latest!.left);
        } finally { mounted.unmount(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('sparse native graph identities survive stable parents and in-place date changes retain old outputs',
        async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        let retained!: TReadonly<Graph>;
        const Reader = ({tick}: {tick: number}) => {
            const selected = useResourceValue(cache, 'user', selectGraph);
            // oxlint-disable-next-line react/globals -- Retain the first actual selection for snapshot assertions.
            retained ??= selected;
            return <span data-tick={tick}>{selected.date.getTime()}:{selected.map.get('user')!.name}</span>;
        };
        const mounted = render(<Reader tick={0}/>);
        try {
            mounted.rerender(<Reader tick={1}/>);
            expect(mounted.container.textContent).toBe('123:Ada');
            // Native mutations go through the draft so the real coarse native write is published.
            await act(async () => {
                cache.editDate(456);
            });
            expect(mounted.container.textContent).toBe('456:Ada');
            expect(retained!.date.getTime()).toBe(123);
        } finally { mounted.unmount(); }
    });

    test('comparator receives detached values and changed policy reconsiders the current source', async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        const comparisons: Array<[string, string]> = [];
        const equal = (a: TReadonly<{name: string}>, b: TReadonly<{name: string}>) => {
            comparisons.push([a.name, b.name]);
            expect(b).not.toBe(cache.getEntry('user').data!.left);
            return true;
        };
        const select = (view: TReadonly<IResourceView<Graph>>) => view.data!.left;
        const Reader = ({suppress}: {suppress: boolean}) => {
            const selected = useResourceValue(cache, 'user', select, suppress ? equal : undefined);
            return <span>{selected.name}</span>;
        };
        const mounted = render(<Reader suppress/>);
        try {
            await act(async () => { cache.edit('left', 'changed'); });
            expect(mounted.container.textContent).toBe('Ada');
            expect(comparisons).toContainEqual(['Ada', 'changed']);
            mounted.rerender(<Reader suppress={false}/>);
            expect(mounted.container.textContent).toBe('changed');
        } finally { mounted.unmount(); }
    });

    test.each(['class', 'array', 'date', 'map', 'set'] as const)(
        'unsupported %s subclass is rejected with default and custom equality', async kind => {
        class Domain {name = 'live';}
        class CustomArray extends Array<string> {}
        class CustomDate extends Date {}
        class CustomMap extends Map<string, string> {}
        class CustomSet extends Set<string> {}
        const unsupported = {class: new Domain(), array: new CustomArray(), date: new CustomDate(),
            map: new CustomMap(), set: new CustomSet()}[kind];
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        const resolution = cache.resolve('user');
        const reader = createResourceReader<Graph, string, unknown>(cache, resolution.path);
        expect(() => reader.evaluate('user', resolution, () => ({nested: unsupported}))).toThrow();
        expect(() => reader.evaluate('user', resolution, () => ({nested: unsupported}), () => true)).toThrow();
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('proof ownership belongs only to committed graph branches and releases on scalar selection', async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        const protocol = Symbol.for('react-carburetor/v1/store-track-targets');
        const internal = cache as unknown as Record<symbol, () => () => void>;
        const acquire = internal[protocol].bind(cache);
        let owners = 0;
        internal[protocol] = () => {
            owners++;
            const release = acquire();
            return () => { owners--; release(); };
        };
        const reader = createResourceReader<Graph, string, unknown>(cache, cache.resolve('user').path);
        const candidate = reader.evaluate('user', cache.resolve('user'), selectGraph);
        expect(owners).toBe(0);
        reader.commit(candidate);
        expect(owners).toBe(0);
        const unsubscribe = reader.subscribe(() => {});
        try {
            expect(owners).toBe(1);
            const scalar = reader.evaluate('user', cache.resolve('user'), view => view.data!.left.name);
            expect(owners).toBe(1);
            reader.commit(scalar);
            expect(owners).toBe(0);
        } finally { unsubscribe(); }
        expect(owners).toBe(0);
    });

    test.each(['scalar', 'flat', 'directflatobject', 'directflatarray', 'graph'] as const)(
        '%s selections retire dynamic reads even when the selected branch stays the same', async kind => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        let evaluations = 0;
        let leaked!: TReadonly<IResourceView<Graph>>;
        const select = (view: TReadonly<IResourceView<Graph>>) => {
            evaluations++;
            leaked = view;
            if (view.data!.right.name === 'Grace') void view.data!.dictionary.name;
            const left = view.data!.left;
            if (kind === 'graph') return view.data!.sparse;
            if (kind === 'directflatobject') return left;
            if (kind === 'directflatarray') return view.data!.flat;
            return kind === 'flat' ? {name: left.name} : left.name;
        };
        const reader = createResourceReader<Graph, string, unknown>(cache, cache.resolve('user').path);
        const candidate = reader.evaluate('user', cache.resolve('user'), select);
        const notifications: object[] = [];
        reader.commit(candidate);
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(candidate)));
        try {
            cache.edit('right', 'switched');
            expect(notifications).toEqual([]);
            const afterSwitch = evaluations;
            void leaked.data!.dictionary.name;
            cache.editDictionary('retired');
            expect(evaluations).toBe(afterSwitch);
            expect(notifications).toEqual([]);
            if (kind === 'graph') cache.editSparseName('active');
            else if (kind === 'directflatarray') cache.editFlatName('active');
            else cache.edit('left', 'active');
            expect(notifications).toHaveLength(1);
            const latest = reader.evaluate('user', cache.resolve('user'), select).value;
            if (kind === 'graph') {
                expect((latest as TReadonly<Graph['sparse']>)[2].name).toBe('active');
                expect((candidate.value as TReadonly<Graph['sparse']>)[2].name).toBe('Ada');
            } else if (kind === 'directflatarray') {
                expect(latest).toEqual(['active']);
                expect(candidate.value).toEqual(['Ada']);
            } else {
                expect(latest).toEqual(kind === 'scalar' ? 'active' : {name: 'active'});
                expect(candidate.value).toEqual(kind === 'scalar' ? 'Ada' : {name: 'Ada'});
            }
        } finally { unsubscribe(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('whole-entry fallback still detaches and observes native graph content', async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        const source = {
            getUID: () => cache.getUID(), getVersion: () => cache.getVersion(),
            subscribe: cache.subscribe.bind(cache), unsubscribe: cache.unsubscribe.bind(cache),
            load: cache.load.bind(cache),
            resolve: (args: string) => {
                const {key, path, view, present} = cache.resolve(args);
                return {key, path, view, present};
            },
        };
        let retained!: TReadonly<Graph>;
        const Reader = () => {
            const selected = useResourceValue(source, 'user', selectGraph);
            // oxlint-disable-next-line react/globals -- Retain the first actual selection for snapshot assertions.
            retained ??= selected;
            return <span>{selected.right.name}</span>;
        };
        const mounted = render(<Reader/>);
        try {
            await act(async () => { cache.edit('right', 'fallback delivered'); });
            expect(mounted.container.textContent).toBe('fallback delivered');
            expect(retained!.right.name).toBe('Grace');
            expect(retained!.map).not.toBe(cache.getEntry('user').data!.map);
        } finally { mounted.unmount(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });

    test('attachment drift rechecks a selected leaf before a committed load', async () => {
        const cache = new Cache(async () => graph(), {ttl: Infinity});
        await cache.load('user');
        const resolution = cache.resolve('user');
        const select = (view: TReadonly<IResourceView<Graph>>) => view.data!.left.name;
        const reader = createResourceReader<Graph, string, string>(cache, resolution.path);
        const candidate = reader.evaluate('user', resolution, select);
        cache.edit('left', 'between render and attachment');
        const notifications: object[] = [];
        reader.commit(candidate);
        const unsubscribe = reader.subscribe(() => notifications.push(reader.getSnapshot(candidate)));
        try {
            expect(reader.evaluate('user', cache.resolve('user'), select).value).toBe('between render and attachment');
            expect(reader.getSnapshot(candidate)).not.toBe(candidate.token);
            reader.load();
        } finally { unsubscribe(); }
        expect(Object.keys(cache[S.subscribers])).toEqual([]);
    });
});
