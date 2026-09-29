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

/** Counts calls to `store.snapshot()`, the O(state) operation R16-07 removes from the hot path. */
const countSnapshots = (store: BoardCarburetor): {count: () => number} => {
    let calls = 0;
    const original = store.snapshot.bind(store);

    store.snapshot = (): IBoardData => {
        calls++;

        return original();
    };

    return {count: () => calls};
};

describe('CarburetorHistory records patches, not snapshots (R16-07)', () => {
    test('a field write calls snapshot() zero times once history is attached', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        const snapshots = countSnapshots(store);

        store.setTitle('a', 'A2');

        // Pre-fix, record() took a fresh snapshot() on every write; this would read 1.
        expect(snapshots.count()).toEqual(0);

        history.disconnect();
    });

    test('several field writes in a row still call snapshot() zero times', () => {
        const store = new BoardCarburetor(buildBoard());
        const history = new CarburetorHistory<IBoardData>(store);
        const snapshots = countSnapshots(store);

        store.setTitle('a', 'A2');
        store.setTitle('b', 'B2');
        store.pushOrder(4);

        expect(snapshots.count()).toEqual(0);

        history.disconnect();
    });
});

describe('CarburetorHistory undo/redo correctness (R16-07)', () => {
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
