import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {Carburetor, CarburetorHistory, transaction} from '@/Carburetor';

interface IState {
    row: {due: Date; done: boolean};
    other: Date;
    list: Array<{due: Date}>;
    scalar: number;
}

class InspectedHistory extends CarburetorHistory<IState> {
    public get opaquePending(): boolean {
        return this.pendingOpaque;
    }
    public get kinds(): readonly string[] {
        return [...this.past.map(entry => entry.kind), ...this.future.map(entry => entry.kind)];
    }
}

/** A store exposing only public entry points for the protected mutation/publication API. */
class DateStore extends Carburetor<IState> {

    public pendingWritePaths(): readonly string[] {
        return [...this[S.writes]];
    }

    /** Applies a mutation through Carburetor.update.
     *
     * @param fn - Synchronous draft mutation.
     */
    public edit(fn: (draft: IState) => void): void {
        this.update(fn);
    }

    /** Applies a draft mutation and publishes it immediately.
     *
     * @param fn - Synchronous draft mutation.
     */
    public manual(fn: (draft: IState) => void): void {
        fn(this.draft);
        this.emitUpdate();
    }

    /** Applies a draft mutation and queues publication for a microtask.
     *
     * @param fn - Synchronous draft mutation.
     */
    public soon(fn: (draft: IState) => void): void {
        fn(this.draft);
        this.emitSoon();
    }

    /** Performs a nested public update while retaining a Date from the outer draft. */
    public nested(): void {
        this.update(draft => {
            const date = draft.row.due;
            this.update(inner => { inner.scalar++; });
            draft.scalar++;
            date.setTime(101);
        });
    }

    /** Mutates a Date across update emissions and a later scalar write. */
    public repeat(): void {
        this.update(draft => {
            const date = draft.row.due;
            date.setTime(102);
            this.emitUpdate();
            date.setTime(103);
            draft.scalar++;
        });
    }
}

const makeStore = (): DateStore => new DateStore({
    row: {due: new Date(100), done: false},
    other: new Date(200),
    list: [{due: new Date(300)}, {due: new Date(400)}],
    scalar: 0,
});

const settle = async (): Promise<void> => {
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
};

describe('Date draft exposure tracking', () => {
    test('reading Date methods inside edit does not publish a Date change with a scalar write', () => {
        const store = makeStore();
        const history = new InspectedHistory(store);
        let dateWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dateWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        store.edit(draft => {
            expect(draft.row.due.getTime()).toBe(100);
            draft.scalar++;
        });

        expect(dateWakes).toBe(0);
        expect(scalarWakes).toBe(1);
        expect(store.getVersion()).toBe(1);
        expect(history.kinds).toEqual(['patches']);
        history.disconnect();
    });

    test('mutated Date snapshot publishes its path and history undo/redo restores timestamps', () => {
        const store = makeStore();
        const history = new InspectedHistory(store);
        let wakes = 0;
        store.subscribe(() => wakes++, {reads: new Set(['row.due'])});

        store.edit(draft => {
            draft.row.due.setTime(101);
        });

        expect(wakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(101);
        expect(history.kinds).toContain('snapshot');
        const snapshot = store.snapshot();
        expect(snapshot.row.due.getTime()).toBe(101);
        expect(history.undo()).toBeTruthy();
        expect(store.getData().row.due.getTime()).toBe(100);
        expect(history.redo()).toBeTruthy();
        expect(store.getData().row.due.getTime()).toBe(101);
        history.disconnect();
    });

    test('setting the Date to its current timestamp is a no-op', () => {
        const store = makeStore();
        let wakes = 0;
        store.subscribe(() => wakes++);

        store.edit(draft => { draft.row.due.setTime(100); });

        expect(wakes).toBe(0);
        expect(store.getVersion()).toBe(0);
    });

    test('setting then reverting a Date before emit produces no changed path', () => {
        const store = makeStore();
        let wakes = 0;
        store.subscribe(() => wakes++);

        store.edit(draft => {
            draft.row.due.setTime(110);
            draft.row.due.setTime(100);
        });

        expect(wakes).toBe(0);
        expect(store.getVersion()).toBe(0);
    });

    test('one exposed aliased Date publishes to readers at both paths', () => {
        const shared = new Date(1);
        const store = new Carburetor({a: shared, b: shared});
        let aWakes = 0;
        let bWakes = 0;
        store.subscribe(() => aWakes++, {reads: new Set(['a'])});
        store.subscribe(() => bWakes++, {reads: new Set(['b'])});

        store.update(draft => {
            draft.a.setTime(2);
            draft.b.getTime();
        });

        expect(aWakes).toBe(1);
        expect(bWakes).toBe(1);
    });

    test('mutating two distinct Dates publishes both precise paths', () => {
        const store = makeStore();
        let dueWakes = 0;
        let otherWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => otherWakes++, {reads: new Set(['other'])});

        store.edit(draft => {
            draft.row.due.setTime(101);
            draft.other.setTime(201);
        });

        expect(dueWakes).toBe(1);
        expect(otherWakes).toBe(1);
    });

    test('array reorder and splice are tracked and a Date mutation uses its draft index', () => {
        const store = makeStore();
        let firstWakes = 0;
        let secondWakes = 0;
        store.subscribe(() => firstWakes++, {reads: new Set(['list.0'])});
        store.subscribe(() => secondWakes++, {reads: new Set(['list.1'])});

        store.edit(draft => {
            draft.list.reverse();
            draft.list.splice(1, 1);
        });

        expect(store.getData().list.map(row => row.due.getTime())).toEqual([400]);
        expect(firstWakes).toBe(1);
        expect(secondWakes).toBe(1);

        firstWakes = 0;
        store.edit(draft => { draft.list[0].due.setTime(401); });
        expect(firstWakes).toBe(1);
        expect(store.getData().list[0].due.getTime()).toBe(401);
    });

    test('cloned Date snapshots preserve native identity and timestamp', () => {
        const store = makeStore();
        let wakes = 0;
        store.subscribe(() => wakes++, {reads: new Set(['row.due'])});

        store.edit(draft => { draft.row.due.setTime(105); });

        const snapshot = store.snapshot();
        expect(snapshot.row.due).toBeInstanceOf(Date);
        expect(snapshot.row.due).toBe(store.getData().row.due);
        expect(snapshot.row.due.getTime()).toBe(105);
        expect(wakes).toBe(1);
    });

    test('subclass and own-property Dates are conservatively published', () => {
        class CustomDate extends Date {
            public marker = 1;
        }
        const own = new Date(2) as Date & {marker: number};
        own.marker = 1;
        const store = new Carburetor({custom: new CustomDate(1), own});
        let customWakes = 0;
        let ownWakes = 0;
        store.subscribe(() => customWakes++, {reads: new Set(['custom'])});
        store.subscribe(() => ownWakes++, {reads: new Set(['own'])});

        store.update(draft => {
            void draft.custom;
            void draft.own;
        });

        expect(customWakes).toBe(1);
        expect(ownWakes).toBe(1);
    });

    test('nested update keeps the outer Date mutation and publishes its path', () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        store.nested();

        expect(dueWakes).toBe(1);
        expect(scalarWakes).toBe(2);
        expect(store.getData().row.due.getTime()).toBe(101);
        expect(store.getData().scalar).toBe(2);
    });

    test('manual publication flushes Date mutation together with draft writes', () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        store.manual(draft => {
            draft.row.due.setTime(102);
            draft.scalar++;
        });

        expect(dueWakes).toBe(1);
        expect(scalarWakes).toBe(1);
    });

    test('repeated synchronous publications keep externally mutated Dates unobserved', () => {
        const store = makeStore();
        let dueWakes = 0;
        const date = store.getData().row.due;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});

        date.setTime(102);
        store.manual(draft => { draft.scalar++; });
        date.setTime(103);
        store.manual(draft => { draft.scalar++; });

        expect(dueWakes).toBe(0);
        expect(store.getData().row.due.getTime()).toBe(103);
    });

    test('an update emission captures a Date mutation before the enclosing update completes', () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        store.repeat();

        expect(dueWakes).toBe(2);
        expect(scalarWakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(103);
    });

    test('assignment and replacement track Date paths and history', () => {
        const store = makeStore();
        const history = new CarburetorHistory<IState>(store);
        let dueWakes = 0;
        let otherWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => otherWakes++, {reads: new Set(['other'])});

        store.edit(draft => {
            draft.other = draft.row.due;
            draft.row.due = new Date(500);
            draft.other.setTime(501);
            draft.row.due.setTime(502);
        });

        expect(store.getData().row.due.getTime()).toBe(502);
        expect(store.getData().other.getTime()).toBe(501);
        expect(dueWakes).toBeGreaterThanOrEqual(1);
        expect(otherWakes).toBeGreaterThanOrEqual(1);
        expect(history.undo()).toBeTruthy();
        expect(store.getData().row.due.getTime()).toBe(100);
        expect(store.getData().other.getTime()).toBe(200);
        history.disconnect();
    });

    test('soon schedules Date-only publication without a synchronous update', async () => {
        const store = makeStore();
        const history = new InspectedHistory(store);
        let dueWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});

        store.soon(draft => { draft.row.due.setTime(104); });
        expect(dueWakes).toBe(0);
        await settle();

        expect(dueWakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(104);
        expect(history.kinds).toContain('snapshot');
        history.disconnect();
    });

    test('a thrown update still publishes completed Date and scalar mutations', () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        expect(() => store.edit(draft => {
            draft.row.due.setTime(106);
            draft.scalar++;
            throw new Error('mutation failed');
        })).toThrow('mutation failed');

        expect(dueWakes).toBe(1);
        expect(scalarWakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(106);
        expect(store.getData().scalar).toBe(1);
    });

    test('transaction batches Date mutation publication', () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        transaction(() => {
            store.edit(draft => { draft.row.due.setTime(107); });
            store.edit(draft => { draft.scalar++; });
        });

        expect(dueWakes).toBe(1);
        expect(scalarWakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(107);
    });

    test('shared Date exposure in separate stores publishes independently', () => {
        const shared = new Date(8);
        const first = new DateStore({row: {due: shared, done: false}, other: new Date(0), list: [], scalar: 0});
        const second = new DateStore({row: {due: shared, done: false}, other: new Date(0), list: [], scalar: 0});
        let firstWakes = 0;
        let secondWakes = 0;
        first.subscribe(() => firstWakes++, {reads: new Set(['row.due'])});
        second.subscribe(() => secondWakes++, {reads: new Set(['row.due'])});

        first.edit(draft => { draft.row.due.getTime(); });
        second.edit(draft => { draft.row.due.getTime(); });
        shared.setTime(9);
        first.manual(draft => { draft.scalar++; });
        second.manual(draft => { draft.scalar++; });

        expect(firstWakes).toBe(1);
        expect(secondWakes).toBe(1);
    });

    test('pruning an old Date exposure does not invoke an own getter', () => {
        const store = makeStore();
        const rawRow = store.getData().row;
        const oldDate = rawRow.due;
        let getterCalls = 0;
        store.edit(draft => { void draft.row.due; });
        Object.defineProperty(rawRow, 'due', {
            get: () => { getterCalls++; return oldDate; },
            enumerable: true,
            configurable: true,
        });
        oldDate.setTime(101);
        try {
            store.edit(draft => { draft.scalar++; });
            expect(getterCalls).toBe(0);
            expect(store.getData().row.due.getTime()).toBe(101);
        } finally {
            Object.defineProperty(rawRow, 'due', {
                value: oldDate,
                enumerable: true,
                writable: true,
                configurable: true,
            });
        }
    });

    test('cleanup leaves a held Date mutation out of the next scalar patch', async () => {
        const store = makeStore();
        const history = new InspectedHistory(store);
        let dueWakes = 0;
        let scalarWakes = 0;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});
        let held!: Date;

        store.edit(draft => { held = draft.row.due; });
        held.setTime(101);
        await settle();
        expect(history.kinds).toEqual([]);
        expect(history.opaquePending).toBe(false);
        expect(store.pendingWritePaths()).toEqual([]);
        store.edit(draft => { draft.scalar++; });

        expect(dueWakes).toBe(0);
        expect(scalarWakes).toBe(1);
        expect(history.kinds).toEqual(['patches']);
        expect(history.opaquePending).toBe(false);
        expect(store.pendingWritePaths()).toEqual([]);
        expect(store.getData().scalar).toBe(1);
        expect(history.undo()).toBeTruthy();
        expect(store.getData().scalar).toBe(0);
        expect(store.getData().row.due.getTime()).toBe(101);
        history.disconnect();
    });

    test('moved nested Date exposure follows its current array path', () => {
        const store = makeStore();
        let wakes = 0;

        store.edit(draft => { void draft.list[0].due; });
        store.edit(draft => { draft.list.reverse(); });
        store.subscribe(() => wakes++, {reads: new Set(['list.1.due'])});
        store.edit(draft => { draft.list[1].due.setTime(101); });

        expect(wakes).toBe(1);
        expect(store.getData().list[1].due.getTime()).toBe(101);
    });

    test('replaced Date exposure no longer wakes for the detached Date', () => {
        const store = makeStore();
        let wakes = 0;
        store.subscribe(() => wakes++, {reads: new Set(['row.due'])});
        let oldDate!: Date;

        store.edit(draft => { oldDate = draft.row.due; });
        store.edit(draft => { draft.row.due = new Date(500); });
        const history = new InspectedHistory(store);
        wakes = 0;
        oldDate.setTime(101);
        store.edit(draft => { draft.scalar++; });

        expect(wakes).toBe(0);
        expect(history.kinds).toEqual(['patches']);
        expect(store.getData().row.due.getTime()).toBe(500);
        expect(history.undo()).toBeTruthy();
        expect(store.getData().scalar).toBe(0);
        expect(store.getData().row.due.getTime()).toBe(500);
        history.disconnect();
    });

    test('microtask cleanup does not turn a future external mutation into a Date write', async () => {
        const store = makeStore();
        let dueWakes = 0;
        let scalarWakes = 0;
        const date = store.getData().row.due;
        store.subscribe(() => dueWakes++, {reads: new Set(['row.due'])});
        store.subscribe(() => scalarWakes++, {reads: new Set(['scalar'])});

        store.edit(draft => { draft.row.due.getTime(); });
        await settle();
        date.setTime(112);
        store.edit(draft => { draft.scalar++; });

        expect(dueWakes).toBe(0);
        expect(scalarWakes).toBe(1);
        expect(store.getData().row.due.getTime()).toBe(112);
    });
});
