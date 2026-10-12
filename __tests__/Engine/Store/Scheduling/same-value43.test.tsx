import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, CarburetorHistory} from '@/Carburetor';
import type {TReadonly} from '@/Carburetor/Models/Base';
import {useCarburetorValue} from '@/Interop';

interface IData {
    value: number;
    box: {n: number; keep: {tag: number}};
    dense: (number | {tag: number})[];
    sparse: (number | {tag: number})[];
    map: Map<string, number>;
    unread: {n: number};
}
class Store extends Carburetor<IData> {
    public run(fn: (data: IData) => void): void { this.update(fn); }
}
const make = (n: number): IData => {
    const sparse: IData['sparse'] = [];
    sparse.length = 8; sparse[3] = n; sparse[6] = {tag: 1};
    return {value: n, box: {n, keep: {tag: 1}}, dense: [n, {tag: 1}], sparse,
        map: new Map([['n', n]]), unread: {n: 0}};
};
const projectArray = (sparse: boolean, n: number): {slots: IData['dense']; keep: {tag: number}} => {
    const slots: IData['dense'] = sparse ? [] : [n, {tag: 1}];
    if (sparse) { slots.length = 8; slots[3] = n; slots[6] = {tag: 1}; }
    return {slots, keep: {tag: 2}};
};
const selectors = {
    scalar: (d: TReadonly<IData>) => d.value,
    flat: (d: TReadonly<IData>) => ({n: d.value}),
    keyed: (d: TReadonly<IData>) => d.box,
    fresh: (d: TReadonly<IData>) => ({row: {n: d.value}, keep: {tag: 1}}),
    dense: (d: TReadonly<IData>) => d.dense,
    sparse: (d: TReadonly<IData>) => d.sparse,
    freshDense: (d: TReadonly<IData>) => projectArray(false, d.value),
    freshSparse: (d: TReadonly<IData>) => projectArray(true, d.value),
    map: (d: TReadonly<IData>) => d.map,
};
type TKind = keyof typeof selectors;
const take = (kind: TKind, x: unknown): number => {
    if (kind === 'freshDense' || kind === 'freshSparse') {
        return (x as ReturnType<typeof projectArray>).slots[kind === 'freshDense' ? 0 : 3] as number;
    }
    if (kind === 'scalar') return x as number;
    if (kind === 'fresh') return (x as {row: {n: number}}).row.n;
    if (kind === 'dense') return (x as number[])[0];
    if (kind === 'sparse') return (x as number[])[3];
    if (kind === 'map') return (x as Map<string, number>).get('n')!;
    return (x as {n: number}).n;
};
// Keep ordinary patch lanes free of opaque Map writes.
const put = (kind: TKind, d: IData, n: number): void => {
    if (kind === 'keyed') d.box.n = n;
    else if (kind === 'dense') d.dense[0] = n;
    else if (kind === 'sparse') d.sparse[3] = n;
    else if (kind === 'map') d.map.set('n', n);
    else d.value = n;
};
const phases = [[+0, -0, false], [-0, +0, false], [NaN, NaN, true],
    [1, 2, false], [2, 2, false]] as const;

describe('R43-S01 public SameValue content gates', () => {
    for (const kind of Object.keys(selectors) as TKind[]) {
        for (const [start, finish, canceled] of phases) {
            const label = `${kind}: ${Object.is(start, -0) ? '-0' : String(start)} to `
                + `${Object.is(finish, -0) ? '-0' : String(finish)}`;
            test(label, () => {
                const store = new Store(make(start));
                const history = new CarburetorHistory(store);
                const reads = new Set<string>();
                void store.read(p => reads.add(p)).unread.n;
                let unrelated = 0;
                const id = store.subscribe(() => unrelated++, {reads});
                const events: {next: unknown; previous: unknown}[] = [];
                const stop = store.watch(d => selectors[kind](d), (next, previous) => events.push({next, previous}));
                try {
                    store.run(d => { if (canceled) put(kind, d, 1); put(kind, d, finish); });
                    expect(Object.is(take(kind, selectors[kind](store.getData())), finish)).toBe(true);
                    expect(unrelated).toBe(0);
                    const changed = !Object.is(start, finish);
                    expect(events).toHaveLength(changed ? 1 : 0);
                    if (changed) {
                        expect(Object.is(take(kind, events[0].next), finish)).toBe(true);
                        expect(Object.is(take(kind, events[0].previous), start)).toBe(true);
                        if (kind === 'keyed') {
                            expect((events[0].next as IData['box']).keep)
                                .toBe((events[0].previous as IData['box']).keep);
                        } else if (kind === 'dense' || kind === 'sparse') {
                            const keep = kind === 'dense' ? 1 : 6;
                            expect((events[0].next as IData['dense'])[keep])
                                .toBe((events[0].previous as IData['dense'])[keep]);
                        }
                        expect(history.undo()).toBe(true);
                        expect(Object.is(take(kind, selectors[kind](store.getData())), start)).toBe(true);
                        expect(events).toHaveLength(2);
                        expect(events[1].previous).toBe(events[0].next);
                        expect(Object.is(take(kind, events[1].next), start)).toBe(true);
                        expect(history.redo()).toBe(true);
                        expect(Object.is(take(kind, selectors[kind](store.getData())), finish)).toBe(true);
                        expect(events).toHaveLength(3);
                        expect(events[2].previous).toBe(events[1].next);
                        expect(Object.is(take(kind, events[2].next), finish)).toBe(true);
                        expect(Object.is(take(kind, events[0].next), finish)).toBe(true);
                        expect(Object.is(take(kind, events[0].previous), start)).toBe(true);
                    } else expect(history.canUndo()).toBe(false);
                    if (kind === 'sparse') {
                        for (const snapshot of events.flatMap(event => [event.previous, event.next])) {
                            const sparse = snapshot as IData['sparse'];
                            expect(sparse.length).toBe(8);
                            expect(Object.hasOwn(sparse, 0)).toBe(false);
                            expect(Object.hasOwn(sparse, 3)).toBe(true);
                            expect(Object.hasOwn(sparse, 6)).toBe(true);
                        }
                    }
                    if (kind === 'freshDense' || kind === 'freshSparse') {
                        for (const event of events) {
                            const next = event.next as ReturnType<typeof projectArray>;
                            const previous = event.previous as ReturnType<typeof projectArray>;
                            const keep = kind === 'freshDense' ? 1 : 6;
                            expect(next.slots[keep]).toBe(previous.slots[keep]);
                            expect(next.keep).toBe(previous.keep);
                        }
                    }
                    if (kind === 'freshSparse') {
                        for (const snapshot of [selectors.freshSparse(store.getData()),
                            ...events.flatMap(event => [event.previous, event.next])]) {
                            const slots = (snapshot as ReturnType<typeof projectArray>).slots;
                            expect(slots.length).toBe(8);
                            expect(Object.keys(slots)).toEqual(['3', '6']);
                        }
                    }
                    expect(store.getData().sparse.length).toBe(8);
                    expect(Object.hasOwn(store.getData().sparse, 0)).toBe(false);
                    expect(Object.hasOwn(store.getData().sparse, 3)).toBe(true);
                } finally { stop(); store.unsubscribe(id); history.disconnect(); }
            });
        }
    }

    test('graph, scalar, raw class and flat hook consumers commit SameValue to DOM', () => {
        const store = new Store(make(+0));
        const renders = {graphHook: 0, scalarHook: 0, flatHook: 0, graphClass: 0, scalarClass: 0, rawClass: 0};
        const GraphHook = (): React.ReactElement => {
            // oxlint-disable-next-line react/immutability -- Render-count regression probe.
            renders.graphHook++;
            const box = useCarburetorValue(store, selectors.keyed);
            return <output data-testid="graphHook">{String(1 / box.n)}</output>;
        };
        const ScalarHook = (): React.ReactElement => {
            // oxlint-disable-next-line react/immutability -- Render-count regression probe.
            renders.scalarHook++;
            const n = useCarburetorValue(store, selectors.scalar);
            return <output data-testid="scalarHook">{String(1 / n)}</output>;
        };
        const FlatHook = (): React.ReactElement => {
            // oxlint-disable-next-line react/immutability -- Render-count regression probe.
            renders.flatHook++;
            const flat = useCarburetorValue(store, selectors.flat);
            return <output data-testid="flatHook">{String(1 / flat.n)}</output>;
        };
        class GraphClass extends AntiHookComponent {
            private readonly box = this.connectSelection(() => store, selectors.keyed);
            public render(): React.ReactNode {
                renders.graphClass++;
                const box = this.box();
                return <output data-testid="graphClass">{String(1 / box.n)}</output>;
            }
        }
        class ScalarClass extends AntiHookComponent {
            public render(): React.ReactNode {
                renders.scalarClass++;
                const n = this.useCarburetor(store).value;
                return <output data-testid="scalarClass">{String(1 / n)}</output>;
            }
        }
        class RawClass extends AntiHookComponent {
            private readonly live = this.connect(() => store);
            public render(): React.ReactNode {
                renders.rawClass++;
                return <output data-testid="rawClass">{String(1 / this.live.value)}</output>;
            }
        }
        const view = render(<><GraphHook /><ScalarHook /><FlatHook /><GraphClass /><ScalarClass /><RawClass /></>);
        const expectDOM = (text: string): void => {
            for (const id of Object.keys(renders)) expect(view.getByTestId(id).textContent).toBe(text);
        };
        try {
            expectDOM('Infinity');
            for (const [n, text] of [[-0, '-Infinity'], [+0, 'Infinity'], [2, '0.5'], [NaN, 'NaN']] as const) {
                act(() => { store.run(d => { d.value = n; d.box.n = n; }); });
                expectDOM(text);
            }
            const before = {...renders};
            act(() => { store.run(d => { d.value = 1; d.box.n = 1; d.value = NaN; d.box.n = NaN; }); });
            expectDOM('NaN');
            // Hook selection gates must suppress extra work. Raw class reads are
            // path-wake controls, not a promise of selection-gated render suppression.
            expect(renders.graphHook).toBe(before.graphHook);
            expect(renders.scalarHook).toBe(before.scalarHook);
            expect(renders.flatHook).toBe(before.flatHook);
        } finally { view.unmount(); }
    });
});
