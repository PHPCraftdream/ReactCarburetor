import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

describe('history publication boundaries under reentrant writes (R15-ENGINE-01/02)', () => {
    class Store extends Carburetor<{x: number; y: number}> {
        public write(key: 'x' | 'y', value: number): void {
            this.update(draft => { draft[key] = value; });
        }
    }

    test.each(['observer-first', 'history-first'])('%s preserves two separately published edits', order => {
        const store = new Store({x: 0, y: 0});
        let nested = 0;
        const observer = (): void => {
            if (store.getData().x === 1 && nested === 0) {
                nested++;
                store.write('x', 2);
            }
        };
        const prior = order === 'history-first' ? new CarburetorHistory(store) : undefined;
        const subscription = store.subscribe(observer);
        const history = prior ?? new CarburetorHistory(store);
        store.write('x', 1);

        expect(store.getData().x).toBe(2);
        expect(store.getVersion()).toBe(2);
        expect(nested).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().x).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().x).toBe(0);
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().x).toBe(1);
        expect(history.redo()).toBe(true);
        expect(store.getData().x).toBe(2);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test.each(['patch', 'snapshot'])('a fresh subscriber %s write during undo branches history', kind => {
        const store = new Store({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        if (kind === 'snapshot') {
            store.setData({x: 1, y: 0});
        } else {
            store.write('x', 1);
        }
        let nested = 0;
        const subscription = store.subscribe(() => {
            if (store.getData().x === 0 && store.getData().y === 0 && nested === 0) {
                nested++;
                store.write('y', 1);
            }
        });
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 1});
        expect(nested).toBe(1);
        expect(history.canRedo()).toBe(false);
        expect(history.redo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 1});
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('a subscriber write during redo invalidates the remaining future without losing its own patch', () => {
        const store = new Store({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        store.write('x', 1);
        store.write('x', 2);
        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        let nested = 0;
        const subscription = store.subscribe(() => {
            if (store.getData().x === 1 && store.getData().y === 0 && nested === 0) {
                nested++;
                store.write('y', 1);
            }
        });
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({x: 1, y: 1});
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 1, y: 0});
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('a transaction coalesces its own writes but not a subscriber write after publication', () => {
        const store = new Store({x: 0, y: 0});
        let nested = 0;
        const subscription = store.subscribe(() => {
            if (store.getData().x === 2 && nested === 0) {
                nested++;
                store.write('y', 3);
            }
        });
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.write('x', 1);
            store.write('x', 2);
        });
        expect(store.getData()).toEqual({x: 2, y: 3});
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 2, y: 0});
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        expect(history.undo()).toBe(false);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('a throttled history subscriber coalesces writes and skips its own replay', () => {
        class ControlledThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ControlledThrottle();
        const store = new Store({x: 0, y: 0}, throttle);
        const history = new CarburetorHistory(store);
        store.write('x', 1);
        store.write('x', 2);
        expect(history.canUndo()).toBe(false);
        throttle.flush();
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        throttle.flush();
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        throttle.flush();
        expect(store.getData()).toEqual({x: 2, y: 0});
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
        history.disconnect();
    });

    test('disconnect cancels a deferred publication without creating a history entry', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Store({x: 0, y: 0}, throttle);
        const history = new CarburetorHistory(store);
        store.write('x', 1);
        history.disconnect();
        throttle.flush();
        expect(store.getData().x).toBe(1);
        expect(history.canUndo()).toBe(false);
        store.write('x', 2);
        throttle.flush();
        expect(history.canUndo()).toBe(false);
    });

    test('two histories retain independent limits while patch-only replacement leaves both recording', () => {
        const store = new Store({x: 0, y: 0});
        const short = new CarburetorHistory(store, {limit: 1});
        const long = new CarburetorHistory(store, {limit: 3});
        let first = 0;
        let second = 0;
        const detachFirst = store.attachPatchListener({patch: () => { first++; }});
        store.write('x', 1);
        const detachSecond = store.attachPatchListener({patch: () => { second++; }});
        detachFirst();
        store.write('x', 2);
        expect([first, second]).toEqual([1, 1]);
        expect(short.canUndo()).toBe(true);
        expect(long.canUndo()).toBe(true);

        detachSecond();
        short.disconnect();
        store.write('x', 3);
        expect(long.undo()).toBe(true);
        expect(store.getData().x).toBe(2);
        expect(long.undo()).toBe(true);
        expect(store.getData().x).toBe(1);
        expect(long.undo()).toBe(true);
        expect(store.getData().x).toBe(0);
        expect(long.undo()).toBe(false);
        expect(short.canUndo()).toBe(true);
        long.disconnect();
    });

    test('one history replay remains a fresh publication for another history', () => {
        const store = new Store({x: 0, y: 0});
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        store.write('x', 1);
        expect(first.canUndo()).toBe(true);
        expect(second.canUndo()).toBe(true);
        expect(first.undo()).toBe(true);
        expect(store.getData().x).toBe(0);
        expect(first.canRedo()).toBe(true);
        expect(second.undo()).toBe(true);
        expect(store.getData().x).toBe(1);
        expect(first.canRedo()).toBe(false);
        first.disconnect();
        second.disconnect();
    });

    test('disconnecting one throttled history cancels only its pending publication', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Store({x: 0, y: 0}, throttle);
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        store.write('x', 1);
        store.write('x', 2);
        first.disconnect();
        throttle.flush();
        expect(first.canUndo()).toBe(false);
        expect(second.canUndo()).toBe(true);
        expect(second.undo()).toBe(true);
        throttle.flush();
        expect(store.getData().x).toBe(0);
        expect(second.undo()).toBe(false);
        second.disconnect();
    });

    test('one throwing history callback does not starve another history or a subscriber', () => {
        class ThrowOnce extends CarburetorHistory<{x: number; y: number}> {
            private first = true;
            protected record(): void {
                if (this.first) {
                    this.first = false;
                    throw new Error('history callback failed');
                }
                super.record();
            }
        }
        const store = new Store({x: 0, y: 0});
        const throwing = new ThrowOnce(store);
        const healthy = new CarburetorHistory(store);
        let delivered = 0;
        const subscription = store.subscribe(() => { delivered++; });
        const original = console.error;
        console.error = () => {};
        try {
            store.write('x', 1);
            expect(delivered).toBe(1);
            expect(healthy.canUndo()).toBe(true);
            expect(healthy.undo()).toBe(true);
            expect(store.getData().x).toBe(0);
        } finally {
            console.error = original;
            store.unsubscribe(subscription);
            throwing.disconnect();
            healthy.disconnect();
        }
    });
});
