import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IRow {
    done: boolean;
    title: string;
}

interface IListData {
    rows: IRow[];
    extra: Record<string, number>;
}

const buildRows = (count: number): IRow[] =>
    Array.from({length: count}, (_, index) => ({done: false, title: `row-${index}`}));

class ListStore extends Carburetor<IListData> {
    public toggle(index: number): void {
        this.update(draft => {
            draft.rows[index].done = !draft.rows[index].done;
        });
    }

    public rename(index: number, title: string): void {
        this.update(draft => {
            draft.rows[index].title = title;
        });
    }

    public touchExtra(key: string, value: number): void {
        this.update(draft => {
            draft.extra[key] = value;
        });
    }
}

class CountingStore extends ListStore {
    public captures: number = 0;

    public captureHistory<V>(own: (value: V) => V): V {
        this.captures++;
        return super.captureHistory(own);
    }
}

class ExposedHistory<T extends object> extends CarburetorHistory<T> {
    public getBaseline(): T {
        return this.baseline;
    }
}

describe('history patches entries replay through the draft (R34-03)', () => {
    test('undo and redo of one field copy no state and keep unrelated branches identical', () => {
        const store = new CountingStore({rows: buildRows(50), extra: {a: 1}});
        const history = new ExposedHistory<IListData>(store);
        store.toggle(5);
        expect(store.getData().rows[5].done).toBe(true);

        const capturesAtRest = store.captures;
        const baselineAtRest = history.getBaseline();
        const liveAtRest = store.getData();
        const liveRows = liveAtRest.rows;
        const untouchedRow = liveRows[7];
        const untouchedExtra = liveAtRest.extra;

        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        expect(store.captures).toBe(capturesAtRest);
        expect(history.getBaseline()).toBe(baselineAtRest);
        expect(history.getBaseline().rows[7]).toBe(baselineAtRest.rows[7]);
        expect(history.getBaseline().extra).toBe(baselineAtRest.extra);
        expect(store.getData().rows).toBe(liveRows);
        expect(store.getData().rows[7]).toBe(untouchedRow);
        expect(store.getData().extra).toBe(untouchedExtra);

        expect(history.redo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(true);
        expect(store.captures).toBe(capturesAtRest);
        expect(history.getBaseline()).toBe(baselineAtRest);
        expect(store.getData().rows).toBe(liveRows);
        expect(store.getData().rows[7]).toBe(untouchedRow);
        history.disconnect();
    });

    test('a fresh write after undo invalidates redo and keeps the installed replay state', () => {
        const store = new ListStore({rows: buildRows(10), extra: {}});
        const history = new CarburetorHistory(store);
        store.toggle(5);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        expect(history.canRedo()).toBe(true);

        store.rename(2, 'fresh');
        expect(history.canRedo()).toBe(false);
        expect(history.redo()).toBe(false);
        expect(store.getData().rows[5].done).toBe(false);
        expect(store.getData().rows[2].title).toBe('fresh');
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[2].title).toBe('row-2');
        expect(history.undo()).toBe(false);
        history.disconnect();
    });

    test('a subscriber writing during undo branches history from the replay state', () => {
        const store = new ListStore({rows: buildRows(10), extra: {}});
        const history = new CarburetorHistory(store);
        store.toggle(5);
        store.rename(3, 'undo me');
        let nested = 0;
        const subscription = store.subscribe(() => {
            if (store.getData().rows[3].title === 'row-3' && nested === 0) {
                nested++;
                store.touchExtra('fresh', 1);
            }
        });

        expect(history.undo()).toBe(true);
        expect(nested).toBe(1);
        expect(store.getData().rows[3].title).toBe('row-3');
        expect(store.getData().extra.fresh).toBe(1);
        expect(store.getData().rows[5].done).toBe(true);
        expect(history.canRedo()).toBe(false);

        expect(history.undo()).toBe(true);
        expect(store.getData().extra.fresh).toBeUndefined();
        expect(store.getData().rows[5].done).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        expect(history.undo()).toBe(false);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('a throttled store delivers its own replay fact late and still skips recording it', () => {
        class ControlledThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void {
                this.letsUpdate();
            }
        }
        const throttle = new ControlledThrottle();
        const store = new ListStore({rows: buildRows(10), extra: {}}, throttle);
        const history = new CarburetorHistory(store);

        store.toggle(5);
        expect(history.canUndo()).toBe(false);
        throttle.flush();
        expect(store.getData().rows[5].done).toBe(true);

        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        throttle.flush();
        expect(history.canRedo()).toBe(true);
        expect(history.canUndo()).toBe(false);

        expect(history.redo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(true);
        throttle.flush();
        expect(store.getData().rows[5].done).toBe(true);
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        throttle.flush();
        history.disconnect();
    });

    test('a fresh write between a deferred replay and its publication branches from the replay state', () => {
        class ControlledThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void {
                this.letsUpdate();
            }
        }
        const throttle = new ControlledThrottle();
        const store = new ListStore({rows: buildRows(10), extra: {}}, throttle);
        const history = new CarburetorHistory(store);

        store.toggle(5);
        throttle.flush();
        expect(history.undo()).toBe(true);
        // The replay's publication is still queued; this write lands on the installed replay state.
        store.touchExtra('fresh', 1);
        throttle.flush();

        expect(store.getData().rows[5].done).toBe(false);
        expect(store.getData().extra.fresh).toBe(1);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[5].done).toBe(false);
        expect(store.getData().extra.fresh).toBeUndefined();
        expect(history.undo()).toBe(false);
        history.disconnect();
    });

    test('undo inside a transaction keeps its own fact through the batch drain', () => {
        const store = new ListStore({rows: buildRows(10), extra: {}});
        const history = new CarburetorHistory(store);
        store.toggle(5);
        store.rename(1, 'second');

        transaction(() => {
            expect(history.undo()).toBe(true);
            expect(store.getData().rows[1].title).toBe('row-1');
        });

        expect(store.getData().rows[1].title).toBe('row-1');
        expect(store.getData().rows[5].done).toBe(true);
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().rows[1].title).toBe('second');
        history.disconnect();
    });
});
