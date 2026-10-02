import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IState {
    n: number;
    left: number;
    right: number;
    other: number;
    values: number[];
    locked?: number;
}

class Store extends Carburetor<IState> {
    public write(key: 'n' | 'left' | 'right', value: number): void {
        this.update(draft => { draft[key] = value; });
    }

    public edit(mutate: (draft: IState) => void): void {
        this.update(mutate);
    }
}

interface INativeState {
    n: number;
    native: Map<string, number>;
}

class NativeStore extends Carburetor<INativeState> {
    public edit(mutate: (draft: INativeState) => void): void {
        this.update(mutate);
    }
}

const makeState = (): IState => ({
    n: 0, left: 0, right: 0, other: 0, values: [1, 2],
});

describe('history cancellation for existing primitive leaves', () => {
    test('a canceled batch preserves redo, while a later fresh branch replaces it', () => {
        const store = new Store(makeState());
        const history = new CarburetorHistory(store);
        store.write('n', 1);
        expect(history.undo()).toBe(true);
        expect(history.canRedo()).toBe(true);

        transaction(() => {
            store.write('n', 1);
            store.write('n', 0);
        });
        expect(store.getData().n).toBe(0);
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(1);

        expect(history.undo()).toBe(true);
        transaction(() => {
            store.edit(draft => {
                draft.n = 2;
                draft.n = 0;
            });
        });
        expect(history.canRedo()).toBe(true);
        store.write('n', 4);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().n).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(4);
        history.disconnect();
    });

    test('multiple exact paths and repeated writes cancel, but changed endpoints undo and redo', () => {
        const store = new Store(makeState());
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.edit(draft => {
                draft.left = 1;
                draft.n = 1;
                draft.left = 2;
                draft.right = 3;
                draft.n = 0;
                draft.left = 0;
                draft.right = 0;
            });
        });
        expect(store.getData()).toMatchObject({n: 0, left: 0, right: 0});
        expect(history.canUndo()).toBe(false);

        transaction(() => {
            store.edit(draft => {
                draft.left = 5;
                draft.right = 6;
                draft.left = 7;
            });
        });
        expect(history.undo()).toBe(true);
        expect(store.getData()).toMatchObject({left: 0, right: 0});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toMatchObject({left: 7, right: 6});
        history.disconnect();
    });

    test('NaN and signed zero use Object.is endpoints for cancellation and replay', () => {
        class NumericStore extends Carburetor<{n: number; zero: number}> {
            public edit(mutate: (draft: {n: number; zero: number}) => void): void {
                this.update(mutate);
            }
        }
        const store = new NumericStore({n: NaN, zero: 0});
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.edit(draft => {
                draft.n = 1;
                draft.n = NaN;
                draft.zero = -0;
                draft.zero = 0;
            });
        });
        expect(Number.isNaN(store.getData().n)).toBe(true);
        expect(Object.is(store.getData().zero, 0)).toBe(true);
        expect(history.canUndo()).toBe(false);

        store.edit(draft => { draft.zero = -0; });
        expect(Object.is(store.getData().zero, -0)).toBe(true);
        expect(history.undo()).toBe(true);
        expect(Object.is(store.getData().zero, 0)).toBe(true);
        expect(history.redo()).toBe(true);
        expect(Object.is(store.getData().zero, -0)).toBe(true);
        history.disconnect();
    });

    test('a reentrant subscriber write after cancellation forms a fresh undoable branch', () => {
        const store = new Store(makeState());
        const history = new CarburetorHistory(store);
        let branched = false;
        const subscription = store.subscribe(() => {
            if (!branched && store.getData().n === 0) {
                branched = true;
                store.write('n', 2);
            }
        });
        transaction(() => {
            store.edit(draft => {
                draft.n = 1;
                draft.n = 0;
            });
        });
        expect(branched).toBe(true);
        expect(store.getData().n).toBe(2);
        expect(history.undo()).toBe(true);
        expect(store.getData().n).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(2);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('deferred cancellation preserves replay ownership and a later fresh branch', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Store(makeState(), throttle);
        const history = new CarburetorHistory(store);
        store.write('n', 1);
        store.write('n', 0);
        throttle.flush();
        expect(history.canUndo()).toBe(false);
        expect(store.getData().n).toBe(0);
        store.write('n', 1);
        throttle.flush();
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        throttle.flush();
        expect(store.getData().n).toBe(0);
        store.edit(draft => {
            draft.n = 2;
            draft.n = 0;
        });
        throttle.flush();
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);
        store.write('n', 3);
        throttle.flush();
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        throttle.flush();
        expect(store.getData().n).toBe(0);
        expect(history.redo()).toBe(true);
        throttle.flush();
        expect(store.getData().n).toBe(3);
        history.disconnect();
    });
    });

describe('history cancellation conservative fallbacks', () => {
    test('mixed patch and root replacement retain the unrelated replacement in history', () => {
        const store = new Store(makeState());
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.write('n', 1);
            store.setData({
                n: 0, left: 0, right: 0, other: 2, values: [1, 2],
            });
        });
        expect(store.getData().other).toBe(2);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toMatchObject({n: 0, other: 0});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toMatchObject({n: 0, other: 2});
        history.disconnect();
    });

    test('array cancellation and native mutation keep conservative replay behavior', () => {
        const store = new Store(makeState());
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.edit(draft => {
                draft.values.push(3);
                draft.values.pop();
            });
        });
        expect(store.getData().values).toEqual([1, 2]);
        expect(history.canUndo()).toBe(false);

        const nativeStore = new NativeStore({n: 0, native: new Map([['key', 1]])});
        const nativeHistory = new CarburetorHistory(nativeStore);
        transaction(() => {
            nativeStore.edit(draft => {
                draft.n = 1;
                draft.n = 0;
                draft.native.set('key', 2);
            });
        });
        expect(nativeStore.getData().n).toBe(0);
        expect(nativeStore.getData().native.get('key')).toBe(2);
        expect(nativeHistory.undo()).toBe(true);
        expect(nativeStore.getData().n).toBe(0);
        expect(nativeStore.getData().native.get('key')).toBe(1);
        expect(nativeHistory.redo()).toBe(true);
        expect(nativeStore.getData().n).toBe(0);
        expect(nativeStore.getData().native.get('key')).toBe(2);
        history.disconnect();
        nativeHistory.disconnect();
    });

    test('restricted baseline fields keep canceled scalar proof on the full graph fallback', () => {
        const state = makeState();
        Object.defineProperty(state, 'locked', {
            value: 9, enumerable: true, writable: false, configurable: false,
        });
        const store = new Store(state);
        const history = new CarburetorHistory(store);
        transaction(() => {
            store.edit(draft => {
                draft.n = 1;
                draft.n = 0;
            });
        });
        expect(store.getData().n).toBe(0);
        expect(history.canUndo()).toBe(false);

        store.write('n', 3);
        expect(history.undo()).toBe(true);
        expect(store.getData().n).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(3);
        const locked = Object.getOwnPropertyDescriptor(store.getData(), 'locked');
        expect(locked).toMatchObject({value: 9, writable: false, configurable: false});
        history.disconnect();
    });

    test('a standalone metadata-only root replacement remains silent', () => {
        const store = new Store({...makeState(), locked: 9});
        const history = new CarburetorHistory(store);
        let notifications = 0;
        const subscription = store.subscribe(() => { notifications++; });
        const replacement = {...makeState(), locked: 9};
        Object.defineProperty(replacement, 'locked', {
            value: 9, enumerable: true, writable: false, configurable: false,
        });
        store.setData(replacement);
        expect(notifications).toBe(0);
        expect(store.getVersion()).toBe(0);
        expect(history.canUndo()).toBe(false);
        expect(history.undo()).toBe(false);
        expect(notifications).toBe(0);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('deferred metadata-only root replacement joins the pending scalar publication', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const before = {...makeState(), locked: 9};
        const store = new Store(before, throttle);
        const history = new CarburetorHistory(store);
        store.write('n', 1);
        const replacement = {...store.getData()};
        Object.defineProperty(replacement, 'locked', {
            value: 9, enumerable: true, writable: false, configurable: false,
        });
        store.setData(replacement);
        store.write('n', 0);
        throttle.flush();
        expect(store.getData().n).toBe(0);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: false, configurable: false});
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: true, configurable: true});
        expect(history.redo()).toBe(true);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: false, configurable: false});
        history.disconnect();
    });

    test('a metadata-only root replacement within canceled scalar writes keeps both endpoints', () => {
        const before = {...makeState(), locked: 9};
        const store = new Store(before);
        const history = new CarburetorHistory(store);
        const replacement = {...before, n: 1};
        Object.defineProperty(replacement, 'locked', {
            value: 9, enumerable: true, writable: false, configurable: false,
        });
        transaction(() => {
            store.write('n', 1);
            store.setData(replacement);
            store.write('n', 0);
        });

        expect(store.getData().n).toBe(0);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: false, configurable: false});
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData().n).toBe(0);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: true, configurable: true});
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(0);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'locked'))
            .toMatchObject({writable: false, configurable: false});
        history.disconnect();
    });

});
