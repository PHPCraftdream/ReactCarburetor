import {Carburetor, CarburetorHistory, transaction} from "@/Carburetor";

interface IRow {
    title: string;
    done?: boolean;
}

interface IBoardData {
    items: Record<string, IRow>;
    order: number[];
}

const buildBoard = (): IBoardData => ({
    items: {a: {title: 'A1'}, b: {title: 'B1'}},
    order: [1, 2, 3],
});

class BoardCarburetor extends Carburetor<IBoardData> {
    public setTitle = (id: string, title: string): void => {
        this.update((draft: IBoardData) => {
            draft.items[id].title = title;
        });
    };

    public addItem = (id: string, row: IRow): void => {
        this.update((draft: IBoardData) => {
            draft.items[id] = row;
        });
    };

    public deleteItem = (id: string): void => {
        this.update((draft: IBoardData) => {
            delete draft.items[id];
        });
    };

    /** Replaces the whole record, keeping any key the replacement does not name (R16-03's diff). */
    public replaceKeepingOthers = (id: string, row: IRow): void => {
        this.update((draft: IBoardData) => {
            draft.items[id] = {...draft.items[id], ...row};
        });
    };

    public pushOrder = (value: number): void => {
        this.update((draft: IBoardData) => {
            draft.order.push(value);
        });
    };

    public popOrder = (): void => {
        this.update((draft: IBoardData) => {
            draft.order.pop();
        });
    };

    public spliceOrder = (start: number, deleteCount: number, ...items: number[]): void => {
        this.update((draft: IBoardData) => {
            draft.order.splice(start, deleteCount, ...items);
        });
    };

    public truncateOrder = (length: number): void => {
        this.update((draft: IBoardData) => {
            draft.order.length = length;
        });
    };

    /** A write that bypasses draft entirely, published through the documented markAllChanged() escape hatch. */
    public bypassSet = (id: string, title: string): void => {
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().items[id].title = title;
        this.markAllChanged();
        this.emitUpdate();
    };
}

describe('CarburetorHistory patch replay', () => {
    test('dependent object patches preserve unrelated baseline identity and history ownership (R33-06)', () => {
        const rows = Array.from({length: 8}, (_, index) => ({title: `row-${index}`}));
        const store = new Carburetor<{docs: Record<string, IRow>; rows: IRow[]}>({docs: {}, rows});
        const history = new CarburetorHistory(store);
        const baselineRowsBefore = (history as unknown as {baseline: {rows: IRow[]}}).baseline.rows;
        store.update(draft => {
            draft.docs.entry = {title: 'first'};
            draft.docs.entry.title = 'final';
        });
        expect(store.getData().rows).toBe(rows);
        expect(store.getData().docs.entry).toEqual({title: 'final'});
        expect((history as unknown as {baseline: {rows: IRow[]}}).baseline.rows).toBe(baselineRowsBefore);
        expect(history.undo()).toBe(true);
        expect(store.getData().docs).toEqual({});
        // Undo/redo replay rebuilds the root via own(baseline)+installPatch, so unrelated rows
        // come back as a fresh copy with equal content.
        expect(store.getData().rows).toEqual(rows);
        expect(history.redo()).toBe(true);
        expect(store.getData().docs.entry).toEqual({title: 'final'});
        expect(store.getData().rows).toStrictEqual(rows);
        expect((history as unknown as {baseline: {rows: IRow[]}}).baseline.rows).toStrictEqual(rows);
        const aliasedStore = new Carburetor<{left: IRow | null; right: IRow | null}>({left: null, right: null});
        const aliasHistory = new CarburetorHistory(aliasedStore);
        const shared = {title: 'same'};
        aliasedStore.update(draft => {
            draft.left = shared;
            draft.right = shared;
        });
        expect(aliasHistory.undo()).toBe(true);
        expect(aliasHistory.redo()).toBe(true);
        expect(aliasedStore.getData().left).not.toBe(aliasedStore.getData().right);
        aliasHistory.disconnect();
        history.disconnect();
    });

    test('same-path object replacement folds to the final endpoint and survives repeated undo/redo', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        store.update(draft => {
            draft.items.a = {title: 'A2'};
            draft.items.a = {title: 'A3'};
        });
        expect(store.getData().items.a).toEqual({title: 'A3'});
        for (let index = 0; index < 3; index++) {
            expect(history.undo()).toBe(true);
            expect(store.getData().items.a).toEqual({title: 'A1'});
            expect(history.redo()).toBe(true);
            expect(store.getData().items.a).toEqual({title: 'A3'});
        }
        history.disconnect();
    });

    test('transaction object replacement and nested mutation stay independent from caller aliases', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        const external = {title: 'external'};
        const externalCopy = {...external};
        transaction(() => {
            store.update(draft => { draft.items.a = externalCopy; });
            store.update(draft => { draft.items.a.title = 'transaction-final'; });
        });
        external.title = 'mutated-after-publication';
        expect(store.getData().items.a.title).toBe('transaction-final');
        expect(history.undo()).toBe(true);
        expect(store.getData().items.a.title).toBe('A1');
        expect(history.redo()).toBe(true);
        expect(store.getData().items.a.title).toBe('transaction-final');
        expect(external.title).toBe('mutated-after-publication');
        history.disconnect();
    });

    test('repeated undo/redo preserves aliased patch endpoint isolation', () => {
        const store = new Carburetor<{left: IRow | null; right: IRow | null}>({left: null, right: null});
        const history = new CarburetorHistory(store);
        const shared = {title: 'shared'};
        store.update(draft => { draft.left = shared; draft.right = shared; });
        shared.title = 'caller-mutation';
        for (let index = 0; index < 3; index++) {
            expect(history.undo()).toBe(true);
            expect(store.getData()).toEqual({left: null, right: null});
            expect(history.redo()).toBe(true);
            expect(store.getData().left).toEqual({title: 'shared'});
            expect(store.getData().right).toEqual({title: 'shared'});
            expect(store.getData().left).not.toBe(store.getData().right);
        }
        history.disconnect();
    });

    test('a class instance stays rejected by the history contract when written mid-history', () => {
        class Point { constructor(public x: number) {} }
        const store = new Carburetor<{holder: {p: Point | null} | null}>({holder: null});
        const history = new CarburetorHistory(store);
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(() => store.update(draft => { draft.holder = {p: new Point(1)}; })).not.toThrow();
            expect(errorSpy.mock.calls.some(call =>
                /cannot own a mutable class instance/.test(String(call[0])))).toBe(true);
        } finally {
            errorSpy.mockRestore();
        }
        // The contract error surfaces through subscriber delivery, and the opaque snapshot capture
        // cannot own state containing a class instance, so undo throws the documented rejection.
        expect(() => history.undo()).toThrow(/cannot own a mutable class instance/);
        expect(store.getData().holder?.p).toBeInstanceOf(Point);
        history.disconnect();
    });

    test('Map endpoint falls back to opaque snapshot and round-trips through undo/redo', () => {
        const store = new Carburetor<{holder: {p: Map<number, number> | null} | null}>({holder: null});
        const history = new CarburetorHistory(store);
        expect(() => store.update(draft => { draft.holder = {p: new Map([[1, 2]])}; })).not.toThrow();
        expect(history.undo()).toBe(true);
        expect(store.getData().holder).toBeNull();
        expect(history.redo()).toBe(true);
        expect(store.getData().holder?.p).toBeInstanceOf(Map);
        expect(store.getData().holder?.p.get(1)).toBe(2);
        history.disconnect();
    });

    test('a frozen nested baseline object still records undoable patch history', () => {
        interface INoteData { note: {frozen: {readonly title: string}; plain: string}; }
        const frozen = Object.freeze({title: 'frozen'});
        const store = new Carburetor<INoteData>(
            {note: {frozen, plain: 'one'}},
        );
        const history = new CarburetorHistory(store);
        expect(() => store.update(draft => { draft.note.plain = 'two'; })).not.toThrow();
        expect(history.undo()).toBe(true);
        expect(store.getData().note.plain).toBe('one');
        expect(history.redo()).toBe(true);
        expect(store.getData().note.plain).toBe('two');
        history.disconnect();
    });

    test('field write: undo restores the previous value, redo the next one', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        store.setTitle('a', 'A2');
        expect(store.getData().items.a.title).toEqual('A2');
        expect(history.undo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A1');
        expect(history.redo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A2');
        history.disconnect();
    });

    test('key add: undo deletes the added key instead of setting it to undefined', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.addItem('c', {title: 'C1'});
        expect(store.getData().items.c).toEqual({title: 'C1'});

        history.undo();

        expect(Object.prototype.hasOwnProperty.call(store.getData().items, 'c')).toBeFalsy();
        expect(Object.keys(store.getData().items)).toEqual(['a', 'b']);

        history.redo();
        expect(store.getData().items.c).toEqual({title: 'C1'});

        history.disconnect();
    });

    test('key delete: undo re-adds the deleted key with its original value', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.deleteItem('a');
        expect(Object.prototype.hasOwnProperty.call(store.getData().items, 'a')).toBeFalsy();

        history.undo();
        expect(store.getData().items.a).toEqual({title: 'A1'});
        expect(Object.keys(store.getData().items).sort()).toEqual(['a', 'b']);

        history.redo();
        expect(Object.prototype.hasOwnProperty.call(store.getData().items, 'a')).toBeFalsy();

        history.disconnect();
    });

    test('array push: undo removes the pushed element and restores length', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.pushOrder(4);
        expect(store.getData().order).toEqual([1, 2, 3, 4]);

        history.undo();
        expect(store.getData().order).toEqual([1, 2, 3]);

        history.redo();
        expect(store.getData().order).toEqual([1, 2, 3, 4]);

        history.disconnect();
    });

    test('array pop: undo restores the popped element', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.popOrder();
        expect(store.getData().order).toEqual([1, 2]);

        history.undo();
        expect(store.getData().order).toEqual([1, 2, 3]);

        history.redo();
        expect(store.getData().order).toEqual([1, 2]);

        history.disconnect();
    });

    test('array splice: undo restores the original elements', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.spliceOrder(1, 1, 9, 8);
        expect(store.getData().order).toEqual([1, 9, 8, 3]);

        history.undo();
        expect(store.getData().order).toEqual([1, 2, 3]);

        history.redo();
        expect(store.getData().order).toEqual([1, 9, 8, 3]);

        history.disconnect();
    });

    test('array truncate via length=: undo restores the truncated elements', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.truncateOrder(1);
        expect(store.getData().order).toEqual([1]);

        history.undo();
        expect(store.getData().order).toEqual([1, 2, 3]);

        history.redo();
        expect(store.getData().order).toEqual([1]);

        history.disconnect();
    });

    test('nested object replacement via the structural diff: undo restores only the changed field', () => {
        const initial: IBoardData = {items: {a: {title: 'A1', done: true}, b: {title: 'B1'}}, order: [1, 2, 3]};
        const store = new BoardCarburetor(initial);
        const history = new CarburetorHistory<IBoardData>(store);

        store.replaceKeepingOthers('a', {title: 'A2'});
        expect(store.getData().items.a).toEqual({title: 'A2', done: true});

        history.undo();
        expect(store.getData().items.a).toEqual({title: 'A1', done: true});

        history.redo();
        expect(store.getData().items.a).toEqual({title: 'A2', done: true});

        history.disconnect();
    });

    test('a markAllChanged bypass sandwiched between patch writes: undo/redo walk every state exactly', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.setTitle('a', 'A2'); // patch entry
        store.bypassSet('b', 'B-bypassed'); // opaque -> snapshot entry, baseline must know "before" is A2/B1
        store.setTitle('a', 'A3'); // patch entry

        expect(store.getData().items.a.title).toEqual('A3');
        expect(store.getData().items.b.title).toEqual('B-bypassed');

        expect(history.undo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A2');
        expect(store.getData().items.b.title).toEqual('B-bypassed');

        expect(history.undo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A2');
        expect(store.getData().items.b.title).toEqual('B1');

        expect(history.undo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A1');
        expect(store.getData().items.b.title).toEqual('B1');

        expect(history.undo()).toBeFalsy();

        expect(history.redo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A2');

        expect(history.redo()).toBeTruthy();
        expect(store.getData().items.b.title).toEqual('B-bypassed');

        expect(history.redo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A3');

        history.disconnect();
    });

    test('transaction()/a batch of several writes is recorded as one entry', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        let notifications = 0;

        store.subscribe(() => notifications++, {id: 'counter'});

        transaction(() => {
            store.setTitle('a', 'A2');
            store.pushOrder(4);
        });

        // One flush for the whole transaction, not one per write inside it.
        expect(notifications).toEqual(1);
        expect(store.getData().items.a.title).toEqual('A2');
        expect(store.getData().order).toEqual([1, 2, 3, 4]);

        expect(history.undo()).toBeTruthy();
        // A single undo() reverts both writes: they were one entry.
        expect(store.getData().items.a.title).toEqual('A1');
        expect(store.getData().order).toEqual([1, 2, 3]);

        expect(history.undo()).toBeFalsy();

        history.disconnect();
    });

    test('disconnect() stops recording new entries', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);

        store.setTitle('a', 'A2');
        expect(history.canUndo()).toBeTruthy();

        history.disconnect();
        store.setTitle('a', 'A3');

        // The write after disconnect landed, but was never recorded: undoing steps past it
        // straight back to the state before the pre-disconnect write.
        expect(store.getData().items.a.title).toEqual('A3');
        expect(history.undo()).toBeTruthy();
        expect(store.getData().items.a.title).toEqual('A1');
        expect(history.undo()).toBeFalsy();
    });
});

describe('CarburetorHistory literal __proto__ and limit', () => {
    interface IData { branch: Record<string, unknown> }
    class Store extends Carburetor<IData> {
        public write = (value: unknown, define = false): void => this.update(draft => {
            if (define) {
                Object.defineProperty(draft.branch, '__proto__', {
                    value, writable: true, enumerable: true, configurable: true,
                });
            } else {
                draft.branch['__proto__'] = value;
            }
        });
        public changeChild = (value: number): void => this.update(draft => {
            (draft.branch['__proto__'] as {x: number}).x = value;
        });
        public remove = (): void => this.update(draft => {
            delete draft.branch['__proto__'];
        });
    }

    test.each([false, true])('literal key via defineProperty=%s survives replay', (define) => {
        const store = new Store({branch: {}});
        const history = new CarburetorHistory(store);
        const seen: string[] = [];
        const values: Array<number | undefined> = [];
        const stop = store.watch(state => Object.keys(state.branch).join(','), value => seen.push(value));
        const stopValue = store.watch(state => Object.keys(state.branch).includes('__proto__')
            ? (state.branch['__proto__'] as {x: number}).x : undefined, value => values.push(value));
        const branch = (): Record<string, unknown> => store.getData().branch;
        const check = (own: boolean, x?: number): void => {
            expect(Object.getPrototypeOf(branch())).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(branch(), '__proto__')).toBe(own);
            expect(Object.keys(branch())).toEqual(own ? ['__proto__'] : []);
            if (own) expect((branch()['__proto__'] as {x: number}).x).toBe(x);
        };

        store.write({x: 1}, define);
        check(true, 1);
        store.changeChild(2);
        check(true, 2);
        store.remove();
        check(false);
        expect(history.undo()).toBe(true);
        check(true, 2);
        expect(history.undo()).toBe(true);
        check(true, 1);
        expect(history.undo()).toBe(true);
        check(false);
        expect(history.redo()).toBe(true);
        check(true, 1);
        expect(history.redo()).toBe(true);
        check(true, 2);
        expect(history.redo()).toBe(true);
        check(false);
        expect(seen).toEqual(['__proto__', '', '__proto__', '', '__proto__', '']);
        expect(values).toEqual([1, 2, undefined, 2, 1, undefined, 1, 2, undefined]);
        stop();
        stopValue();
        history.disconnect();
    });

    test('limit rejects invalid values before attaching and keeps only its cap', () => {
        const store = new BoardCarburetor(buildBoard());
        for (const limit of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => new CarburetorHistory(store, {limit})).toThrow(RangeError);
        }
        class InspectedHistory extends CarburetorHistory<IBoardData> {
            public retained(): number { return this.past.length; }
        }
        const history = new InspectedHistory(store, {limit: 1});
        store.setTitle('a', 'A2');
        store.setTitle('a', 'A3');
        store.setTitle('a', 'A4');
        expect(history.retained()).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().items.a.title).toBe('A3');
        expect(history.undo()).toBe(false);
        history.disconnect();
    });
});

describe('history retains supported prototype topology (R13-E02)', () => {
    test('a nested prototype-only setData and a later ordinary patch undo and redo independently', () => {
        const original = JSON.parse('{"__proto__":7,"value":1}') as Record<string, number>;
        const store = new Carburetor({branch: original, rows: [1]});
        const history = new CarburetorHistory(store);
        const dictionary: Record<string, number> = Object.create(null);
        dictionary.value = 1;
        dictionary['__proto__'] = 7;
        let wakes = 0;
        const id = store.subscribe(() => wakes++, {reads: new Set(['branch.toString'])});
        store.setData({branch: dictionary, rows: [1]});
        expect(history.canUndo()).toBe(true);
        expect(Object.getPrototypeOf(store.snapshot().branch)).toBeNull();
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(Object.hasOwn(store.getData().branch, '__proto__')).toBe(true);
        expect(store.getData().branch['__proto__']).toBe(7);
        expect(wakes).toBe(1);
        const edited: Record<string, number> = Object.create(null);
        edited.value = 2;
        edited['__proto__'] = 7;
        store.restore({branch: edited, rows: [1, 2]});
        expect(store.getData().branch.value).toBe(2);
        expect(store.getData().rows).toEqual([1, 2]);
        expect(wakes).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().branch.value).toBe(1);
        expect(store.getData().rows).toEqual([1]);
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().branch)).toBe(Object.prototype);
        expect(store.getData().branch['__proto__']).toBe(7);
        expect(wakes).toBe(2);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(wakes).toBe(3);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(store.getData().branch.value).toBe(2);
        expect(store.getData().rows).toEqual([1, 2]);
        expect(wakes).toBe(3);
        store.unsubscribe(id);
        history.disconnect();
    });

    test.each(['setData', 'restore'] as const)('%s root topology survives both history directions', operation => {
        const store = new Carburetor<Record<string, number>>({value: 1});
        const history = new CarburetorHistory(store);
        const next: Record<string, number> = Object.assign(Object.create(null), {value: 1});

        store[operation]({value: 1});
        expect(store.getVersion()).toBe(0);
        expect(history.canUndo()).toBe(false);

        store[operation](next);
        expect(Object.getPrototypeOf(store.snapshot())).toBeNull();
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData())).toBe(Object.prototype);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData())).toBeNull();
        expect(store.getData()).not.toBe(next);
        history.disconnect();
    });
});

describe('history preserves supported array prototypes (R13-E02A)', () => {
    test.each(['setData', 'restore'] as const)('%s nested array replacement round-trips', operation => {
        const store = new Carburetor({rows: [1, 2], other: 5});
        const history = new CarburetorHistory(store);
        const next: number[] = Object.setPrototypeOf([1, 2], null);

        store[operation]({rows: next, other: 5});
        expect(Object.getPrototypeOf(store.getData().rows)).toBeNull();
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().rows)).toBe(Array.prototype);
        expect(store.getData().rows).toEqual([1, 2]);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().rows)).toBeNull();
        expect(Array.from(store.getData().rows)).toEqual([1, 2]);
        expect(store.getData().rows).not.toBe(next);
        history.disconnect();
    });

    test('a root array with a null prototype survives snapshot-based undo and redo', () => {
        const store = new Carburetor([1, 2]);
        const history = new CarburetorHistory(store);
        store.restore(Object.setPrototypeOf([1, 2], null));
        expect(Object.getPrototypeOf(store.snapshot())).toBeNull();
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData())).toBe(Array.prototype);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData())).toBeNull();
        expect(Array.from(store.getData())).toEqual([1, 2]);
        history.disconnect();
    });
});
