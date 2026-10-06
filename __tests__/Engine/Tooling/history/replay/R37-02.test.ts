import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from "@/Carburetor";

/** A patch-only throwing observer (no `publication`, no `restoreClaim`) that counts what it saw before throwing. */
const throwingObserver = (throwOn?: string, throwUndefined = false) => {
    const received: unknown[] = [];
    return {
        received,
        observer: {
            patch: (patch: {segments?: readonly string[]} | symbol): void => {
                if (typeof patch === 'symbol') return;
                if (throwOn !== undefined && patch.segments?.at(-1) === throwOn) {
                    throw throwUndefined ? undefined : new Error('observer-stop');
                }
                received.push(patch);
            },
        },
    };
};

/** A publication-bearing counting observer: coexists with patch-only observers instead of replacing them. */
const countingObserver = () => {
    const received: unknown[] = [];
    return {
        received,
        observer: {
            patch: (patch: {segments?: readonly string[]} | symbol): void => {
                if (typeof patch === 'symbol') return;
                received.push(patch);
            },
            publication: (): void => {},
        },
    };
};

/**
 * The throwing setData contract: the original error surfaces, the cycle stays complete.
 * The thrower must be detached before undo/redo so draft replay cannot rethrow.
 */
const expectCompleteCycle = (
    store: Carburetor<{x: number; y: number}>,
    history: CarburetorHistory<{x: number; y: number}>,
    detachThrower: (() => void) | undefined,
    throwUndefined = false
): void => {
    let caught: unknown;
    try {
        store.setData({x: 1, y: 1});
    } catch (error: unknown) {
        caught = error;
    }
    if (throwUndefined) expect(caught).toBeUndefined();
    else expect((caught as Error).message).toBe('observer-stop');
    expect(store.getData()).toEqual({x: 1, y: 1});
    detachThrower?.();
    expect(history.undo()).toBe(true);
    expect(store.getData()).toEqual({x: 0, y: 0});
    expect(history.redo()).toBe(true);
    expect(store.getData()).toEqual({x: 1, y: 1});
};

describe('R37-02 a throwing patch observer must not truncate the replacement batch', () => {
    test('history attached first — setData throws the original error, undo/redo stay complete', () => {
        const store = new Carburetor({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        const {observer} = throwingObserver('x');
        const detach = store.attachPatchListener(observer);
        expectCompleteCycle(store, history, detach);
        history.disconnect();
    });

    test('throwing observer attached first — the same contract holds', () => {
        const store = new Carburetor({x: 0, y: 0});
        const {observer} = throwingObserver('y');
        const detach = store.attachPatchListener(observer);
        const history = new CarburetorHistory(store);
        expectCompleteCycle(store, history, detach);
        history.disconnect();
    });

    test('an observer throwing undefined still undoes both fields', () => {
        const store = new Carburetor({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        const {observer} = throwingObserver('x', true);
        const detach = store.attachPatchListener(observer);
        let caught: unknown;
        let threw = false;
        try {
            store.setData({x: 1, y: 1});
        } catch (error: unknown) {
            threw = true;
            caught = error;
        }
        expect(threw).toBe(true);
        expect(caught).toBeUndefined();
        expect(store.getData()).toEqual({x: 1, y: 1});
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({x: 1, y: 1});
        history.disconnect();
    });

    test('one throw mid-batch delivers every detailed patch to an independent observer', () => {
        const store = new Carburetor({a: 0, b: 0, c: 0, d: 0});
        const history = new CarburetorHistory(store);
        const throwing = throwingObserver('b');
        const counting = countingObserver();
        const detachThrowing = store.attachPatchListener(throwing.observer);
        store.attachPatchListener(counting.observer);
        expect(() => store.setData({a: 1, b: 1, c: 1, d: 1})).toThrow('observer-stop');
        expect(counting.received).toHaveLength(4);
        detachThrowing();
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({a: 0, b: 0, c: 0, d: 0});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({a: 1, b: 1, c: 1, d: 1});
        history.disconnect();
    });

    test('two independent histories each record the complete replacement', () => {
        const store = new Carburetor({x: 0, y: 0});
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        const {observer} = throwingObserver('y');
        const detach = store.attachPatchListener(observer);
        expect(() => store.setData({x: 1, y: 1})).toThrow('observer-stop');
        expect(store.getData()).toEqual({x: 1, y: 1});
        detach();
        expect(first.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        expect(first.redo()).toBe(true);
        expect(store.getData()).toEqual({x: 1, y: 1});
        expect(second.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        first.disconnect();
        second.disconnect();
    });

    test('deferred publication keeps the full batch and complete undo', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle(60_000);
        const store = new Carburetor({x: 0, y: 0}, throttle);
        const history = new CarburetorHistory(store);
        const {observer} = throwingObserver('x');
        const detach = store.attachPatchListener(observer);
        expect(() => store.setData({x: 1, y: 1})).toThrow('observer-stop');
        expect(store.getData()).toEqual({x: 1, y: 1});
        detach();
        throttle.flush();
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({x: 1, y: 1});
        history.disconnect();
    });

    test('restore adopting its endpoint routes through the shared install boundary completely', () => {
        const store = new Carburetor({x: 0, y: 0});
        const throwing = throwingObserver('x');
        const counting = countingObserver();
        store.attachPatchListener({
            patch: throwing.observer.patch,
            restoreClaim: () => ({representation: 'history-owned', adopt: true}),
        });
        store.attachPatchListener(counting.observer);
        expect(() => store.restore({x: 1, y: 1})).toThrow('observer-stop');
        expect(store.getData()).toEqual({x: 1, y: 1});
        expect(counting.received).toHaveLength(2);
    });

    test('fromJSON delivers the whole batch and undoes completely', () => {
        const store = new Carburetor({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        const {observer} = throwingObserver('x');
        const detach = store.attachPatchListener(observer);
        expect(() => store.fromJSON({x: 1, y: 1})).toThrow('observer-stop');
        expect(store.getData()).toEqual({x: 1, y: 1});
        detach();
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        history.disconnect();
    });

    test('a transaction replacement delivers every patch despite a mid-batch throw', () => {
        const store = new Carburetor({a: 0, b: 0, c: 0, d: 0});
        const history = new CarburetorHistory(store);
        const throwing = throwingObserver('b');
        const counting = countingObserver();
        const detachThrowing = store.attachPatchListener(throwing.observer);
        store.attachPatchListener(counting.observer);
        expect(() => transaction(() => {
            store.setData({a: 1, b: 1, c: 1, d: 1});
        })).toThrow('observer-stop');
        expect(store.getData()).toEqual({a: 1, b: 1, c: 1, d: 1});
        expect(counting.received).toHaveLength(4);
        detachThrowing();
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({a: 0, b: 0, c: 0, d: 0});
        history.disconnect();
    });

    test('positive control without a throwing observer', () => {
        const store = new Carburetor({x: 0, y: 0});
        const history = new CarburetorHistory(store);
        const counting = countingObserver();
        store.attachPatchListener(counting.observer);
        store.setData({x: 1, y: 1});
        expect(counting.received).toHaveLength(2);
        expect(store.getData()).toEqual({x: 1, y: 1});
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({x: 0, y: 0});
        history.disconnect();
    });
});
