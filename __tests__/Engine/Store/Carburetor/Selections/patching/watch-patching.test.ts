import {Carburetor} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {
    id: number;
    title: string;
    tags: {a: number};
}

interface IData {
    items: IRow[];
    other: number;
}

const COUNT = 2000;

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

const makeStore = (): CountingCarburetor => new CountingCarburetor({
    items: Array.from({length: COUNT}, (_, id) => ({id, title: `t${id}`, tags: {a: id}})),
    other: 0,
});

const selectItems = (view: IData): IRow[] => view.items;

describe('watch() patches a live-list selection from the write log (R36-01)', () => {
    test('a one-field write reads a handful of paths and delivers the edited list', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });
        store.recorded = 0;

        store.edit((draft) => { draft.items[11].title = 'edited'; });

        expect(store.recorded).toBeLessThan(40);
        expect(seen).toHaveLength(1);
        expect(seen[0][11].title).toBe('edited');
        expect(seen[0]).toEqual(store.getData().items);
        stop();
    });

    test('an unrelated write delivers nothing, a later related one still does', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });

        store.edit((draft) => { draft.other = 3; });
        expect(seen).toHaveLength(0);
        store.edit((draft) => { draft.items[5].tags.a = 77; });

        expect(seen).toHaveLength(1);
        expect(seen[0][5].tags.a).toBe(77);
        stop();
    });

    test('a leaf the first walk never read still wakes the watch after a patch', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch(selectItems, (next) => { seen.push(next); });

        store.edit((draft) => { draft.items[2].title = 'a'; });
        store.edit((draft) => { draft.items[2].tags = {a: 5}; });
        store.edit((draft) => { draft.items[2].tags.a = 6; });

        expect(seen).toHaveLength(3);
        expect(seen[2][2].tags.a).toBe(6);
        stop();
    });

    test('a push and a key deletion fall back to the full walk and stay correct', () => {
        const store = makeStore();
        let latest: IRow[] = [];
        const stop = store.watch(selectItems, (next) => { latest = next; });

        store.edit((draft) => { draft.items.push({id: COUNT, title: 'n', tags: {a: 0}}); });
        expect(latest).toHaveLength(COUNT + 1);
        store.edit((draft) => { delete (draft.items[4] as Partial<IRow>).title; });
        expect('title' in latest[4]).toBe(false);
        expect(latest).toEqual(store.getData().items);
        stop();
    });

    test('control: without the log the same write walks the whole selection', () => {
        const store = makeStore();
        Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
        const stop = store.watch(selectItems, () => undefined);
        store.recorded = 0;

        store.edit((draft) => { draft.items[11].title = 'edited'; });

        expect(store.recorded).toBeGreaterThan(COUNT);
        stop();
    });
});

describe('R42-S01 public selection safety', () => {
    class Store<T extends object> extends Carburetor<T> {
        public change(fn: (draft: T) => void): void { this.update(fn); }
    }
    interface IBox {k0: {n: number}; k1: {n: number}}
    const box = (): IBox => ({k0: {n: 0}, k1: {n: 1}});

    test('two selected edits retain held history and branch sharing across equal tick selections', () => {
        const store = new Store({tick: 0, box: box()});
        const seen: TReadonly<IBox>[] = [];
        const before: TReadonly<IBox>[] = [];
        let selections = 0;
        const stop = store.watch(d => { selections++; void d.tick; return d.box; }, (next, previous) => {
            seen.push(next); before.push(previous);
        });
        try {
            store.change(d => { d.box.k0.n = -1; });
            expect(seen).toHaveLength(1);
            const held = seen[0];
            const calls = selections;
            for (let i = 0; i < 8; i++) store.change(d => { d.tick++; });
            expect(selections).toBe(calls + 8);
            expect(seen).toHaveLength(1);
            expect(held.k0.n).toBe(-1);
            store.change(d => { d.box.k0.n = -2; });
            expect(seen).toHaveLength(2);
            expect(before[1]).toBe(held);
            expect(before[0].k0.n).toBe(0);
            expect(held.k0.n).toBe(-1);
            expect(seen[1].k0.n).toBe(-2);
            expect(seen[1].k1).toBe(held.k1);
        } finally { stop(); }
    });

    test.each(['root', 'ancestor'])('%s replacement cannot reuse a stale selection', kind => {
        const store = new Store({tick: 0, group: {box: box()}});
        const seen: TReadonly<IBox>[] = [];
        const before: TReadonly<IBox>[] = [];
        const stop = store.watch(d => { void d.tick; return d.group.box; }, (next, previous) => {
            seen.push(next); before.push(previous);
        });
        try {
            store.change(d => { d.group.box.k0.n = -1; });
            store.change(d => { d.tick++; });
            store.change(d => {
                const next = {k0: {n: 7}, k1: {n: 8}};
                if (kind === 'root') d.group.box = next;
                else d.group = {box: next};
            });
            expect(seen).toHaveLength(2);
            expect(before[1]).toBe(seen[0]);
            expect(seen[0].k0.n).toBe(-1);
            expect(seen[1]).toEqual({k0: {n: 7}, k1: {n: 8}});
        } finally { stop(); }
    });

    test('outside native/plain alias in-place edits differ from ordinary edge replacement', () => {
        const peer = {n: 1};
        const node = {n: 0, link: new Map<string, unknown>()};
        node.link.set('self', node);
        node.link.set('peer', peer);
        const store = new Store({tick: 0, node, peer});
        const seen: TReadonly<typeof node>[] = [];
        const before: TReadonly<typeof node>[] = [];
        const stop = store.watch(d => { void d.tick; return d.node; }, (next, previous) => {
            seen.push(next); before.push(previous);
        });
        try {
            store.change(d => { d.tick++; });
            expect(seen).toHaveLength(0);
            store.change(d => { d.peer.n = 2; d.tick++; });
            expect(seen).toHaveLength(1);
            expect((before[0].link.get('peer') as {n: number}).n).toBe(1);
            expect((seen[0].link.get('peer') as {n: number}).n).toBe(2);
            store.change(d => { d.peer = {n: 3}; d.tick++; });
            expect(seen).toHaveLength(1);
            store.change(d => { d.node.n = 4; });
            expect(seen).toHaveLength(2);
            expect(before[1]).toBe(seen[0]);
            expect((seen[1].link.get('peer') as {n: number}).n).toBe(2);
            for (const snapshot of [...seen, ...before]) expect(snapshot.link.get('self')).toBe(snapshot);
        } finally { stop(); }
    });

    test('sparse own undefined and holes remain distinct after outside wakes', () => {
        const rows: Array<{n: number} | undefined> = [];
        rows.length = 64;
        rows[0] = {n: 0}; rows[63] = {n: 63};
        const store = new Store({tick: 0, rows});
        const seen: TReadonly<typeof rows>[] = [];
        const before: TReadonly<typeof rows>[] = [];
        const stop = store.watch(d => { void d.tick; return d.rows; }, (next, previous) => {
            seen.push(next); before.push(previous);
        });
        try {
            store.change(d => { d.rows[7] = undefined; });
            store.change(d => { d.tick++; });
            store.change(d => { delete d.rows[7]; });
            store.change(d => { d.rows[63]!.n = 64; });
            expect(seen).toHaveLength(3);
            expect(Object.hasOwn(before[0], 7)).toBe(false);
            expect(Object.hasOwn(seen[0], 7)).toBe(true);
            expect(seen[0][7]).toBeUndefined();
            expect(before[1]).toBe(seen[0]);
            expect(Object.hasOwn(seen[1], 7)).toBe(false);
            expect(seen[2].length).toBe(64);
            expect(Object.hasOwn(seen[2], 1)).toBe(false);
            expect(seen[1][63]!.n).toBe(63);
            expect(seen[2][63]!.n).toBe(64);
            expect(seen[2][0]).toBe(seen[1][0]);
        } finally { stop(); }
    });

    test('escaped dot and tilde keys patch only the selected branches', () => {
        const store = new Store({tick: 0, box: {'a.b': {n: 0}, 'a~b': {n: 1}, a: {b: {n: 2}}}});
        const seen: TReadonly<ReturnType<typeof store.getData>['box']>[] = [];
        const stop = store.watch(d => { void d.tick; return d.box; }, next => { seen.push(next); });
        try {
            store.change(d => { d.box['a.b'].n = 3; });
            store.change(d => { d.tick++; });
            store.change(d => { d.box['a~b'].n = 4; });
            expect(seen).toHaveLength(2);
            expect(seen[0]['a.b'].n).toBe(3);
            expect(seen[0]['a~b'].n).toBe(1);
            expect(seen[1]['a~b'].n).toBe(4);
            expect(seen[1]['a.b']).toBe(seen[0]['a.b']);
            expect(seen[1].a).toBe(seen[0].a);
            expect(seen[1].a.b.n).toBe(2);
        } finally { stop(); }
    });
});
