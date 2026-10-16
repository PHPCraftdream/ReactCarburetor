import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, type TReadonly} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {createResourceReader} from '@/Interop/createResourceReader';
import {patchSelection} from '@/Carburetor/Store/Utils/Selection/Patch/patchSelection';
import {detachOpaque} from '@/Carburetor/Store/Utils/Selection/detachOpaque';

interface Data {rows: Array<{n: number} | undefined>; spare: number}
class Store extends Carburetor<Data> {
    /** Applies the fixture mutation. */
    edit(fn: (data: Data) => void): void { this.update(fn); }
}
const make = (prototype: object | null, sparse: boolean): Data => {
    const rows: Data['rows'] = [{n: 0}, {n: 7}, undefined];
    if (sparse) { rows.length = 32; Reflect.deleteProperty(rows, 1); rows[19] = {n: 7}; }
    Object.setPrototypeOf(rows, prototype);
    return {rows, spare: 0};
};
const select = (data: TReadonly<Data>) => data.rows;
const prototypes = [['array', Array.prototype], ['null', null], ['object', Object.prototype]] as const;
for (const [label, prototype] of prototypes) {
    for (const sparse of [false, true]) {
        test(`R44 watch ${label} sparse ${sparse}`, () => {
            const store = new Store(make(prototype, sparse));
            const events: Array<{next: TReadonly<Data['rows']>; previous: TReadonly<Data['rows']>}> = [];
            let scalar = 0, projected = 0, spare = 0;
            const stops = [store.watch(select, (next, previous) => events.push({next, previous})),
                store.watch(d => d.rows[0]!.n, () => scalar++),
                store.watch(d => ({rows: d.rows}), () => projected++), store.watch(d => d.spare, () => spare++)];
            try {
                store.edit(d => { d.rows[0]!.n = 0; }); expect(events).toHaveLength(0);
                store.edit(d => { d.rows[0]!.n = 1; }); expect(events).toHaveLength(1);
                const {next, previous} = events[0];
                expect(next[0]!.n).toBe(1); expect(previous[0]!.n).toBe(0);
                expect(next[sparse ? 19 : 1]).toBe(previous[sparse ? 19 : 1]);
                for (const snapshot of [next, previous]) {
                    expect(Object.getPrototypeOf(snapshot)).toBe(prototype);
                    expect(snapshot.length).toBe(sparse ? 32 : 3);
                    expect(Object.hasOwn(snapshot, 2)).toBe(true); expect(snapshot[2]).toBeUndefined();
                    if (sparse) expect(Object.hasOwn(snapshot, 1)).toBe(false);
                }
                store.edit(d => { d.rows[0]!.n = -0; });
                expect(Object.is(events[1].next[0]!.n, -0)).toBe(true);
                store.edit(d => { d.rows[0]!.n = +0; });
                expect(Object.is(events[2].next[0]!.n, +0)).toBe(true);
                store.edit(d => { d.rows[0]!.n = NaN; });
                const held = events[3].next;
                store.edit(d => { d.rows[0]!.n = 9; d.rows[0]!.n = NaN; });
                expect(events).toHaveLength(4); expect(events[3].next).toBe(held);
                store.edit(d => { Reflect.deleteProperty(d.rows, 2); });
                expect(Object.hasOwn(events[4].next, 2)).toBe(false);
                store.edit(d => { d.rows[2] = undefined; });
                expect(Object.hasOwn(events[5].next, 2)).toBe(true);
                expect([scalar, projected, spare]).toEqual([4, 6, 0]);
            } finally { stops.forEach(stop => stop()); }
        });
        test(`R44 committed hook/class ${label} sparse ${sparse}`, () => {
            const store = new Store(make(prototype, sparse));
            const seen: Array<TReadonly<Data['rows']>> = [];
            const Hook = () => {
                const rows = useCarburetorValue(store, select); seen.push(rows);
                return <p data-testid="hook">{rows[0]!.n}</p>;
            };
            class Owner extends AntiHookComponent {
                private readonly rows = this.connectSelection(() => store, select);
                /** Renders the committed selection. */
                render() { return <p data-testid="class">{this.rows()[0]!.n}</p>; }
            }
            const view = render(<><Hook /><Owner /></>);
            try {
                const held = seen[0];
                act(() => { store.edit(d => { d.rows[0]!.n = 1; }); });
                expect(view.getByTestId('hook').textContent).toBe('1');
                expect(view.getByTestId('class').textContent).toBe('1');
                expect(held[0]!.n).toBe(0);
                expect(Object.getPrototypeOf(seen[seen.length - 1])).toBe(prototype);
                expect(seen[seen.length - 1][sparse ? 19 : 1]).toBe(held[sparse ? 19 : 1]);
            } finally { view.unmount(); }
        });
        test(`R44 resource reader ${label} sparse ${sparse}`, async () => {
            class Cache extends ResourceCache<Data, [string]> {
                /** Mutates the loaded resource row. */
                edit(): void {
                    const key = this.resolve('rows').key;
                    this.update(d => { d.entries[key].data!.rows[0]!.n = 1; });
                }
            }
            const cache = new Cache(async () => make(prototype, sparse), {ttl: Infinity});
            await cache.load('rows');
            const resolution = cache.resolve('rows');
            const reader = createResourceReader<Data, [string], TReadonly<Data['rows']>>(cache, resolution.path);
            const candidate = reader.evaluate(['rows'], resolution, view => view.data!.rows);
            reader.commit(candidate);
            let notifications = 0;
            const stop = reader.subscribe(() => notifications++);
            try {
                cache.edit();
                const next = reader.evaluate('rows', cache.resolve('rows'), candidate.select);
                expect(notifications).toBe(1);
                expect(next.value[0]!.n).toBe(1); expect(candidate.value[0]!.n).toBe(0);
                expect(Object.getPrototypeOf(next.value)).toBe(prototype);
                expect(next.value[sparse ? 19 : 1]).toBe(candidate.value[sparse ? 19 : 1]);
            } finally { stop(); }
        });
    }
}

const leaf = {leaf: true, children: undefined};
const rowPlan = {leaf: false, children: new Map([['n', leaf]])};
test('R44 object __proto__ spine remains own data', () => {
    const previous = JSON.parse('{"__proto__":{"n":0},"keep":{"n":7}}') as Record<string, {n: number}>;
    const live = JSON.parse('{"__proto__":{"n":1},"keep":{"n":7}}');
    const plan = {leaf: false, children: new Map([['__proto__', rowPlan]])};
    const result = patchSelection(previous, live, plan, new WeakMap(), undefined)!;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result.__proto__.n).toBe(1); expect(previous.__proto__.n).toBe(0);
    expect(result.keep).toBe(previous.keep);
});
test('R44 object-valued patch refuses partial topology and incomplete ledger', () => {
    const previous = {row: {n: 0}, keep: {n: 7}};
    const live = {row: previous.keep, keep: previous.keep};
    const ledger = new WeakMap<object, unknown>();
    const plan = {leaf: false, children: new Map([['row', leaf]])};
    expect(patchSelection(previous, live, plan, ledger, undefined)).toBeUndefined();
    expect(ledger.has(live)).toBe(false);
});
test('R44 copier does not forge array subclasses', () => {
    class Rows extends Array<{n: number}> {}
    const rows = new Rows({n: 0});
    const plan = {leaf: false, children: new Map([['0', rowPlan]])};
    expect(patchSelection(rows, rows, plan, new WeakMap(), undefined)).toBeUndefined();
    expect(() => detachOpaque(rows, undefined, () => { throw new Error('unsupported'); })).toThrow('unsupported');
});
test('R44 public shared/cyclic graph preserves topology', () => {
    // Raw state stays a tree; sharing and the cycle belong only to the selector projection.
    const store = new Store({rows: [{n: 0}, {n: 7}], spare: 0});
    const project = (data: TReadonly<Data>) => {
        const row = data.rows[0]!;
        const graph: {rows: Array<TReadonly<{n: number}>>; self?: unknown} = {
            rows: [row, row, data.rows[1]!],
        };
        graph.self = graph;
        return graph;
    };
    type Graph = TReadonly<ReturnType<typeof project>>;
    const events: Array<{next: Graph; previous: Graph}> = [];
    const stop = store.watch(project, (next, previous) => events.push({next, previous}));
    const check = (graph: Graph, n: number): void => {
        expect(graph.self).toBe(graph);
        expect(graph.rows[0]).toBe(graph.rows[1]);
        expect(graph.rows[1].n).toBe(n);
        expect(graph.rows[2].n).toBe(7);
    };
    try {
        store.edit(d => { d.rows[0]!.n = 1; });
        expect(events).toHaveLength(1);
        const held = events[0];
        check(held.previous, 0); check(held.next, 1);
        expect(held.next).not.toBe(held.previous);
        expect(held.next.rows[0]).not.toBe(held.previous.rows[0]);
        expect(held.next.rows[2]).toBe(held.previous.rows[2]);
        store.edit(d => { d.rows[0]!.n = 2; });
        expect(events).toHaveLength(2);
        expect(events[1].previous).toBe(held.next);
        check(events[1].next, 2);
        expect(events[1].next.rows[2]).toBe(held.next.rows[2]);
        check(held.previous, 0); check(held.next, 1);
        store.edit(d => { d.rows[0]!.n = 2; d.spare = 1; });
        expect(events).toHaveLength(2);
    } finally { stop(); }
});
