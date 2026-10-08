import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {id: number; title: string; done: boolean}
interface IData {tick: number; items: IRow[]}

class CountingStore extends Carburetor<IData> {
    public recorded = 0;
    public edit(fn: (draft: IData) => void): void { this.update(fn); }
    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read(path => { this.recorded++; record(path); });
    }
}

const makeStore = (): CountingStore => new CountingStore({
    tick: 0,
    items: Array.from({length: 2000}, (_, id) => ({id, title: `T${id}`, done: false})),
});
const selectItems = (data: IData): IRow[] => data.items;

/** Exercises the public routes with identical snapshots, DOM and read instrumentation. */
const checkRoute = (route: string, count: number, disableLog = false): void => {
    const store = makeStore();
    if (disableLog) Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
    const seen: IRow[][] = [];
    let previous: IRow[] | undefined;
    const stops: Array<() => void> = [];
    let container: HTMLElement | undefined;
    if (route === 'watch') {
        stops.push(store.watch(selectItems, (next, before) => { seen.push(next); previous = before; }));
    } else if (route === 'hook') {
        const List = (): React.ReactElement => {
            const items = useCarburetorValue(store, selectItems);
            // Test instrumentation, not render state.
            // oxlint-disable-next-line react/immutability, react/globals
            seen.push(items);
            return <p>{items[7].title}:{items.length}</p>;
        };
        const view = render(<List />);
        container = view.container;
        stops.push(() => view.unmount());
    } else {
        class Owner extends AntiHookComponent {
            private readonly items = this.connectSelection(() => store, selectItems);
            public override render(): React.ReactElement {
                const items = this.items();
                seen.push(items);
                return <p>{items[7].title}:{items.length}</p>;
            }
        }
        const view = render(<Owner />);
        container = view.container;
        stops.push(() => view.unmount());
    }
    try {
        expect(store.recorded).toBeGreaterThan(2000);
        const initial = seen.length;
        const held = seen[0];
        for (let k = 0; k < count; k++) act(() => store.edit(d => { d.tick++; }));
        expect(seen).toHaveLength(initial);
        store.recorded = 0;
        act(() => store.edit(d => { d.items[7].title = 'edited'; }));
        const reads = store.recorded;
        expect(seen).toHaveLength(initial + 1);
        const latest = seen[seen.length - 1];
        expect(latest).toEqual(store.getData().items);
        const before = route === 'watch' ? previous : held;
        expect(before?.[7].title).toBe('T7');
        expect(latest).not.toBe(before);
        if (!disableLog) expect(latest[8]).toBe(before?.[8]);
        if (container) expect(container.textContent).toBe('edited:2000');
        if (disableLog) expect(reads).toBeGreaterThan(2000);
        else expect(reads).toBeLessThanOrEqual(4);
    } finally {
        for (const stop of stops) stop();
    }
};

describe('public list selections retain the patch route across interleaving (R39-01)', () => {
    for (const route of ['watch', 'hook', 'connectSelection']) {
        test(`${route}: K=0 uses the leaf patch`, () => checkRoute(route, 0));
        test.each([2, 8, 64])(`${route}: K=%i records at most four paths`, count => checkRoute(route, count));
        test(`${route}: positive control without path history walks the selection`, () => checkRoute(route, 2, true));
    }
});

interface IPeer {n: number}
interface IAliasRow {id: number; n: number; link: Map<string, IPeer> | null}
interface IAliasData {tick: number; items: IAliasRow[]; peer: IPeer}
class AliasStore extends Carburetor<IAliasData> {
    public recorded = 0;
    public edit(fn: (draft: IAliasData) => void): void { this.update(fn); }
    public override read(record: Parameters<Carburetor<IAliasData>['read']>[0]): ReturnType<Carburetor<IAliasData>['read']> {
        return super.read(path => { this.recorded++; record(path); });
    }
}
const select = (d: IAliasData): IAliasRow[] => d.items;
const makeAliasStore = (alias: boolean): AliasStore => {
    const peer = {n: 1};
    const items: IAliasRow[] = Array.from({length: 2000}, (_, id) => ({id, n: 0, link: null}));
    if (alias) items[0].link = new Map([['peer', peer]]);
    return new AliasStore({tick: 0, items, peer});
};

/** Native aliases must wake a lagging public consumer without subscribing to tick. */
const checkAlias = (route: string, count: number): void => {
    const store = makeAliasStore(true);
    const seen: IAliasRow[][] = [];
    let previous: IAliasRow[] | undefined;
    let container: HTMLElement | undefined;
    let stop: () => void;
    const text = (items: IAliasRow[]): string => `${items[0].link?.get('peer')?.n}:${items.length}`;
    if (route === 'watch') {
        stop = store.watch(select, (next, before) => { seen.push(next); previous = before; });
    } else {
        const Hook = (): React.ReactElement => {
            const items = useCarburetorValue(store, select);
            // oxlint-disable-next-line react/immutability, react/globals
            seen.push(items);
            return <output>{text(items)}</output>;
        };
        class Owner extends AntiHookComponent {
            private readonly items = this.connectSelection(() => store, select);
            public override render(): React.ReactElement {
                const items = this.items();
                seen.push(items);
                return <output>{text(items)}</output>;
            }
        }
        const view = render(route === 'hook' ? <Hook /> : <Owner />);
        container = view.container;
        stop = () => view.unmount();
    }
    try {
        const initial = seen.length;
        const held = seen[0];
        expect(store.recorded).toBeGreaterThanOrEqual(2000);
        store.recorded = 0;
        for (let k = 0; k < count; k++) act(() => store.edit(d => { d.tick++; }));
        expect(seen).toHaveLength(initial);
        expect(store.recorded).toBe(0);
        act(() => store.edit(d => { d.peer.n = 2; }));
        expect(store.recorded).toBeGreaterThanOrEqual(2000);
        expect(seen).toHaveLength(initial + 1);
        const next = seen[seen.length - 1];
        const before = route === 'watch' ? previous : held;
        expect(next).toEqual(store.getData().items);
        expect(next[0].link?.get('peer')?.n).toBe(2);
        expect(before?.[0].link?.get('peer')?.n).toBe(1);
        if (held) expect(held[0].link?.get('peer')?.n).toBe(1);
        if (container) expect(container.textContent).toBe('2:2000');
    } finally { stop(); }
};

describe('public accumulated ownership proof controls (R39-01)', () => {
    for (const route of ['watch', 'hook', 'connectSelection']) {
        test.each([2, 8, 64])(`${route}: native alias K=%i forces a safe full walk`, count => checkAlias(route, count));
    }

    test('accumulated pairs overflow once; direct and interleaved leaf writes recover', () => {
        const store = makeAliasStore(false);
        const seen: IAliasRow[][] = [];
        const before: IAliasRow[][] = [];
        const stop = store.watch(select, (next, previous) => { seen.push(next); before.push(previous); });
        try {
            store.recorded = 0;
            // Same paths, two targets per publication; only peer.n gains unique raw targets.
            for (let k = 0; k < 4100; k++) store.edit(d => { d.peer = {n: 0}; d.peer.n = k + 1; });
            expect(seen).toHaveLength(0);
            expect(store.recorded).toBe(0);
            store.edit(d => { d.items[7].n = 1; });
            expect(store.recorded).toBeGreaterThanOrEqual(2000);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toEqual(store.getData().items);
            expect(before[0][7].n).toBe(0);
            store.recorded = 0;
            store.edit(d => { d.items[7].n = 2; });
            expect(store.recorded).toBeLessThanOrEqual(4);
            expect(seen).toHaveLength(2);
            expect(seen[1]).toEqual(store.getData().items);
            expect(before[1]).toBe(seen[0]);
            for (let k = 0; k < 8; k++) store.edit(d => { d.tick++; });
            expect(seen).toHaveLength(2);
            store.recorded = 0;
            store.edit(d => { d.items[7].n = 3; });
            expect(store.recorded).toBeLessThanOrEqual(4);
            expect(seen).toHaveLength(3);
            expect(seen[2]).toEqual(store.getData().items);
            expect(seen.map(items => items[7].n)).toEqual([1, 2, 3]);
            expect(before.map(items => items[7].n)).toEqual([0, 1, 2]);
        } finally { stop(); }
    });
});
