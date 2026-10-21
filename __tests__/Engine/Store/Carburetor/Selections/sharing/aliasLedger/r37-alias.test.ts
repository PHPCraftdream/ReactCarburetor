import {Carburetor} from '@/Carburetor';
import {diagnostics} from '@/Carburetor/Store/Diagnostics/DiagnosticsInstance';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';


interface IRow {
    id: string;
    n: number;
    link: Map<string, unknown> | Set<unknown> | null;
}

interface IData {
    rows: IRow[];
    other: number;
}

class CountingCarburetor extends Carburetor<IData> {
    public recorded = 0;

    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read((path) => {
            this.recorded++;
            record(path);
        });
    }

    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

type TWake<R> = {next: R; previous: R};

const watchRows = (store: Carburetor<IData>): {wakes: Array<TWake<IRow[]>>; stop: () => void} => {
    const wakes: Array<TWake<IRow[]>> = [];
    const stop = store.watch((data: IData): IRow[] => data.rows, (next, previous) => {
        wakes.push({next, previous});
    });
    return {wakes, stop};
};

const expectAliasHolds = (snapshot: IRow[], n: number): void => {
    expect(snapshot[0].link).toBeInstanceOf(Map);
    const linked = (snapshot[0].link as Map<string, IRow>).get('row');
    expect(linked).toBe(snapshot[1]);
    expect(snapshot[1].n).toBe(n);
};

describe('watch preserves native/plain alias across snapshot updates (R37-01)', () => {
    test('initial sharing: both edits keep the alias and update the linked value', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        rows[0].link = new Map([['row', rows[1]]]);
        const store = new CountingCarburetor({rows, other: 0});
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(2);
        expectAliasHolds(wakes[0].next, 2);
        expectAliasHolds(wakes[1].next, 3);
        // Held previous snapshots are never mutated.
        expect(wakes[1].previous).toBe(wakes[0].next);
        expect(wakes[0].previous[1].n).toBe(1);
        expectAliasHolds(wakes[0].previous, 1);
        stop();
    });

    test('introduced sharing: the Map assignment itself and the next edit are both correct', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const rawRow = store.getData().rows[1];
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[0].link = new Map([['row', rawRow]]); });
        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(3);
        expectAliasHolds(wakes[1].next, 2);
        expectAliasHolds(wakes[2].next, 3);
        stop();
    });

    test('removed sharing: the snapshot becomes a tree again and keeps delivering', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        rows[0].link = new Map([['row', rows[1]]]);
        const store = new CountingCarburetor({rows, other: 0});
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[0].link = null; });
        store.edit((draft) => { draft.rows[1].n = 2; });

        expect(wakes).toHaveLength(2);
        expect(wakes[0].next[0].link).toBeNull();
        expect(wakes[1].next[1].n).toBe(2);
        expect(wakes[1].next[0].link).toBeNull();
        stop();
    });

    test('a native root backlink: the snapshot refers to itself', () => {
        const store = new CountingCarburetor({rows: [], other: 0});
        const wakes: Array<TWake<unknown>> = [];
        const stop = store.watch((data: IData) => data, (next, previous) => { wakes.push({next, previous}); });

        store.edit((draft) => {
            (draft as unknown as {link: unknown}).link = new Map([['self', draft]]);
        });
        store.edit((draft) => { draft.other = 5; });

        expect(wakes).toHaveLength(2);
        const snapshot = wakes[1].next as IData & {link: Map<string, unknown>};
        expect(snapshot.link.get('self')).toBe(snapshot);
        expect(snapshot.other).toBe(5);
        stop();
    });

    test('a raw row used as a Map key keeps its alias through both edits', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const rawRow = store.getData().rows[1];
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[0].link = new Map([[rawRow, 'flag']]); });
        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(3);
        for (const index of [1, 2]) {
            const keyed = wakes[index].next[0].link as Map<IRow, string>;
            const key = [...keyed.keys()][0];
            expect(key).toBe(wakes[index].next[1]);
            expect(key.n).toBe(index + 1);
            expect(keyed.get(key)).toBe('flag');
        }
        stop();
    });

    test('a raw row inside a Set keeps its alias through both edits', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const rawRow = store.getData().rows[1];
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[0].link = new Set([rawRow]); });
        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(3);
        for (const index of [1, 2]) {
            const members = wakes[index].next[0].link as Set<IRow>;
            const member = [...members][0];
            expect(member).toBe(wakes[index].next[1]);
            expect(member.n).toBe(index + 1);
        }
        stop();
    });

    test('a native two-row cycle: both back edges point into the new snapshot', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const rawRow = store.getData().rows[1];
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows[0].link = new Map([['peer', rawRow]]); });
        store.edit((draft) => {
            draft.rows[1].link = new Map([['peer', draft.rows[0]]]);
        });
        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(4);
        for (const index of [2, 3]) {
            const snapshot = wakes[index].next;
            expect((snapshot[0].link as Map<string, IRow>).get('peer')).toBe(snapshot[1]);
            expect((snapshot[1].link as Map<string, IRow>).get('peer')).toBe(snapshot[0]);
            expect(snapshot[1].n).toBe(index);
        }
        stop();
    });

    test('a reordered shared list stays aliased and delivers the edit after it', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        rows[0].link = new Map([['row', rows[1]]]);
        const store = new CountingCarburetor({rows, other: 0});
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => { draft.rows.reverse(); });
        store.edit((draft) => { draft.rows[1].n = 2; });

        expect(wakes).toHaveLength(2);
        const reordered = wakes[0].next;
        expect(reordered[0].id).toBe('b');
        expect((reordered[1].link as Map<string, IRow>).get('row')).toBe(reordered[0]);
        // After the reverse, index 1 holds row 'a' (the Map row); the n edit targets it.
        const mapRow = wakes[1].next.find((row) => row.id === 'a');
        const plainRow = wakes[1].next.find((row) => row.id === 'b');
        expect(mapRow).toBeDefined();
        expect(plainRow).toBeDefined();
        expect((mapRow!.link as Map<string, IRow>).get('row')).toBe(plainRow);
        expect(wakes[1].next[1].id).toBe('a');
        expect(wakes[1].next[1].n).toBe(2);
        stop();
    });

    test('a projected rows.map selector delivers both edits with the alias and updated values', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        rows[0].link = new Map([['row', rows[1]]]);
        const store = new CountingCarburetor({rows, other: 0});
        const wakes: Array<TWake<IRow[]>> = [];
        // A projection returning a fresh array each run must not hide the shared rows.
        const stop = store.watch((data: IData): IRow[] => data.rows.map((row) => row), (next, previous) => {
            wakes.push({next, previous});
        });

        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        // BOTH edits deliver — the projection is not mistaken for an unchanged verdict.
        expect(wakes).toHaveLength(2);
        expectAliasHolds(wakes[0].next, 2);
        expectAliasHolds(wakes[1].next, 3);
        // Held previous snapshots are never mutated by later edits.
        expect(wakes[0].previous[1].n).toBe(1);
        expect(wakes[1].previous).toBe(wakes[0].next);
        stop();
    });

    test('control: a plain list keeps the write-log patch path and publishes both edits', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const {wakes, stop} = watchRows(store);
        store.recorded = 0;

        store.edit((draft) => { draft.rows[1].n = 2; });
        store.edit((draft) => { draft.rows[1].n = 3; });

        expect(wakes).toHaveLength(2);
        expect(wakes[0].next[1].n).toBe(2);
        expect(wakes[1].next[1].n).toBe(3);
        // Still on the cheap patch route: the shared verdict never fired.
        expect(store.recorded).toBeLessThan(40);
        stop();
    });
});

describe('cycle revisits return the in-progress copy, never a stale snapshot', () => {
    test('a native root backlink keeps pointing at the newest snapshot across both edits', () => {
        const store = new CountingCarburetor({rows: [], other: 0});
        const wakes: Array<TWake<unknown>> = [];
        const stop = store.watch((data: IData) => data, (next, previous) => { wakes.push({next, previous}); });

        store.edit((draft) => {
            (draft as unknown as {link: unknown}).link = new Map([['self', draft]]);
        });
        store.edit((draft) => { draft.other = 5; });
        store.edit((draft) => { draft.other = 6; });

        expect(wakes).toHaveLength(3);
        for (const index of [1, 2]) {
            const snapshot = wakes[index].next as IData & {link: Map<string, unknown>};
            expect(snapshot.link.get('self')).toBe(snapshot);
            expect(snapshot.other).toBe(index + 4);
        }
        // Held previous snapshots are untouched.
        expect(wakes[1].next).not.toBe(wakes[2].next);
        expect((wakes[1].next as IData).other).toBe(5);
        expect((wakes[2].previous as IData).other).toBe(5);
        stop();
    });

    test('a two-node cycle introduced in one edit tracks the peer edit', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const store = new CountingCarburetor({rows, other: 0});
        const {wakes, stop} = watchRows(store);

        store.edit((draft) => {
            const a = draft.rows[0];
            const b = draft.rows[1];
            a.link = new Map([['peer', b]]);
            b.link = new Map([['peer', a]]);
        });
        store.edit((draft) => { draft.rows[1].n = 2; });

        expect(wakes).toHaveLength(2);
        const snapshot = wakes[1].next;
        expect((snapshot[0].link as Map<string, IRow>).get('peer')).toBe(snapshot[1]);
        expect((snapshot[1].link as Map<string, IRow>).get('peer')).toBe(snapshot[0]);
        expect(snapshot[1].n).toBe(2);
        stop();
    });

    test('a cycle that goes through an array member is remapped after a leaf edit', () => {
        const store = new CountingCarburetor({rows: [{id: 'a', n: 1, link: null}], other: 0});
        const wakes: Array<TWake<IRow[]>> = [];
        const stop = store.watch((data: IData) => data.rows, (next, previous) => { wakes.push({next, previous}); });

        // A plain array member cycle is read through the deep read proxy, so the dev alias
        // ledger unavoidably notes the row at both `rows.0` and `rows.0.items.0`; silence the
        // dev diagnostics for this fixture (the sanctioned pattern) and restore afterwards.
        diagnostics.setEnabled(false);
        try {
            // The cycle lives within ONE path (`rows[0].items[0]`, items inside the row), so
            // only the engine's own remap — not a second competing root path — closes the loop.
            store.edit((draft) => {
                (draft.rows[0] as unknown as {items: unknown[]}).items = [draft.rows[0]];
            });
            store.edit((draft) => { draft.rows[0].n = 7; });
        } finally {
            diagnostics.setEnabled(true);
        }

        expect(wakes).toHaveLength(2);
        const snapshot = wakes[1].next;
        expect((snapshot[0] as unknown as {items: IRow[]}).items[0]).toBe(snapshot[0]);
        expect(snapshot[0].n).toBe(7);
        expect(wakes[0].next[0].n).toBe(1);
        stop();
    });
});

describe('the initial detach reports sharing in the trace (R37-01)', () => {
    test('an initial pass over a shared graph sets trace.shared', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        rows[0].link = new Map([['row', rows[1]]]);
        const copies = new WeakMap<object, unknown>();
        const trace = {shared: false};

        const snapshot = reconcileSelection<IRow[]>(undefined, rows, undefined, undefined, undefined, copies, trace);

        expect(trace.shared).toBe(true);
        expect((snapshot[0].link as Map<string, IRow>).get('row')).toBe(snapshot[1]);
    });

    test('an initial pass over a tree leaves trace.shared false', () => {
        const rows: IRow[] = [
            {id: 'a', n: 1, link: null},
            {id: 'b', n: 1, link: null},
        ];
        const trace = {shared: false};

        reconcileSelection<IRow[]>(undefined, rows, undefined, undefined, undefined, undefined, trace);

        expect(trace.shared).toBe(false);
    });
});


interface INodeA {
    k: number;
    stale?: number;
    link: Map<string, INodeB> | null;
}

interface INodeB {
    n: number;
    link: Map<string, INodeA> | null;
}

interface ICrossData {
    a: INodeA;
    b: INodeB;
}

type TWakePair = {next: ICrossData; previous: ICrossData};

class CrossCarburetor extends Carburetor<ICrossData> {
    public edit = (fn: (draft: ICrossData) => void): void => {
        this.update(fn);
    };
}

const watchData = (store: Carburetor<ICrossData>): {wakes: Array<TWakePair>; stop: () => void} => {
    const wakes: Array<TWakePair> = [];
    const stop = store.watch((data: ICrossData) => data, (next, previous) => {
        wakes.push({next, previous});
    });
    return {wakes, stop};
};

/** Both back edges must point at the very nodes of the delivered snapshot, with fresh content. */
const expectCrossHolds = (snapshot: ICrossData, n: number): void => {
    expect(snapshot.a.link?.get('peer')).toBe(snapshot.b);
    expect(snapshot.b.link?.get('peer')).toBe(snapshot.a);
    expect(snapshot.a.k).toBe(1);
    expect(snapshot.b.n).toBe(n);
};

describe('two cross-references introduced across updates stay aliased (R37 residual)', () => {
    test('both backlinks in one edit: both directions alias into the same snapshot', () => {
        const store = new CrossCarburetor({
            a: {k: 1, link: null},
            b: {n: 1, link: null},
        });
        const {wakes, stop} = watchData(store);

        store.edit((draft) => {
            draft.a.link = new Map([['peer', draft.b]]);
            draft.b.link = new Map([['peer', draft.a]]);
        });
        store.edit((draft) => { draft.b.n = 2; });

        stop();

        expect(wakes).toHaveLength(2);
        expectCrossHolds(wakes[0].next, 1);
        expectCrossHolds(wakes[1].next, 2);
        // Held previous snapshots are never mutated.
        expect(wakes[1].previous).toBe(wakes[0].next);
    });

    test('the backlinks in successive edits: the second full reconcile reuses one copy per node', () => {
        const store = new CrossCarburetor({
            a: {k: 1, link: null},
            b: {n: 1, link: null},
        });
        const {wakes, stop} = watchData(store);

        store.edit((draft) => { draft.a.link = new Map([['peer', draft.b]]); });
        store.edit((draft) => { draft.b.link = new Map([['peer', draft.a]]); });
        store.edit((draft) => { draft.b.n = 2; });

        stop();

        expect(wakes).toHaveLength(3);
        expectCrossHolds(wakes[1].next, 1);
        expectCrossHolds(wakes[2].next, 2);
    });

    test('a replaced cross-referenced node with a changed key set keeps one copy, not two', () => {
        // Introduces both backlinks and a key-set mismatch on `a` in one update: the node copy is
        // registered before its subtree is walked, so `b`'s detached back edge must survive the
        // post-walk key reorder as the same object the snapshot holds.
        const store = new CrossCarburetor({
            a: {k: 1, stale: 9, link: null},
            b: {n: 1, link: null},
        });
        const {wakes, stop} = watchData(store);

        store.edit((draft) => {
            draft.a = {k: 1, link: new Map([['peer', draft.b]])};
            draft.b.link = new Map([['peer', draft.a]]);
        });
        store.edit((draft) => { draft.b.n = 2; });

        stop();

        expect(wakes).toHaveLength(2);
        expectCrossHolds(wakes[0].next, 1);
        expectCrossHolds(wakes[1].next, 2);
    });
});
