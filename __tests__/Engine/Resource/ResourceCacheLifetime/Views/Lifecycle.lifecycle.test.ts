import {Carburetor} from "@/Carburetor";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

class LifecycleStore extends Carburetor<{value: number}> {
    public static readonly jobs = new Map<string, () => void>();
    public static synchronous = false;
    private static readonly scheduler: IUpdateScheduler = {
        schedule: (id, updater) => {
            LifecycleStore.jobs.set(id, updater);
            if (LifecycleStore.synchronous) updater();
        },
        cancel: (id) => { LifecycleStore.jobs.delete(id); },
    };
    public constructor() { super({value: 0}, LifecycleStore.scheduler); }
    public mutate(): void { this.update(draft => { draft.value++; }); }
    public publish(): void { this.emitUpdate(); }
    public schedulePublication(): void { this.emitSoon(); }
    public observe(): () => void { return this.watch(data => data.value, () => undefined); }
    public getSignal(): AbortSignal { return this.signal; }
    public scheduleTask(ms: number, task: () => void): () => void { return this.after(ms, task); }
    public touchDraft(): void { this.draft.value++; }
    public didDisposeCalls = 0;
    protected didDispose(): void { super.didDispose(); this.didDisposeCalls++; }
}

describe('Carburetor lifecycle', () => {
    test('dispose is idempotent, aborts signal, runs hook once, and cancels timers', async () => {
        rstest.useFakeTimers();
        try {
            const store = new LifecycleStore();
            let taskCalls = 0;
            const cancel = store.scheduleTask(10_000, () => { taskCalls++; });
            const signal = store.getSignal();
            store.dispose();
            await rstest.advanceTimersByTimeAsync(20_000);
            store.dispose();
            cancel();
            expect(store.didDisposeCalls).toBe(1);
            expect(signal.aborted).toBe(true);
            expect(taskCalls).toBe(0);
        } finally { rstest.useRealTimers(); }
    });

    test('update, emitUpdate, and watch throw after disposal', () => {
        const store = new LifecycleStore();
        store.dispose();
        expect(() => store.mutate()).toThrow(/disposed/);
        expect(() => store.publish()).toThrow(/disposed/);
        expect(() => store.observe()).toThrow(/disposed/);
    });

    test('queued emitSoon is silent and disposed draft checks do not diagnose', async () => {
        const store = new LifecycleStore();
        const logs: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { logs.push(args); };
        try {
            store.schedulePublication();
            store.touchDraft();
            store.dispose();
            await Promise.resolve();
            await Promise.resolve();
        } finally { console.error = original; }
        expect(store.getVersion()).toBe(0);
        expect(logs).toHaveLength(0);
    });

    test('scheduled notifications are cancelled but registrations remain removable', () => {
        const store = new LifecycleStore();
        let calls = 0;
        const id = store.subscribe(() => { calls++; });
        store.mutate();
        expect(LifecycleStore.jobs.size).toBeGreaterThan(0);
        store.dispose();
        expect(LifecycleStore.jobs.size).toBe(0);
        store.unsubscribe(id);
        expect(calls).toBe(0);
    });

    test('signal works without a global AbortController and is aborted when first requested after disposal', () => {
        const original = globalThis.AbortController;
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
        const error = rstest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            Object.defineProperty(globalThis, 'AbortController', {configurable: true, value: undefined});
            const before = new LifecycleStore();
            const signal = before.getSignal();
            let aborts = 0;
            signal.addEventListener('abort', () => { aborts++; });
            before.dispose();
            expect(signal.aborted).toBe(true);
            expect(aborts).toBe(1);
            const store = new LifecycleStore();
            store.dispose();
            expect(store.getSignal().aborted).toBe(true);
        } finally {
            if (descriptor) Object.defineProperty(globalThis, 'AbortController', descriptor);
            else Reflect.deleteProperty(globalThis, 'AbortController');
            error.mockRestore();
        }
    });

    test('timer completion and cancellation release handles before disposal', async () => {
        rstest.useFakeTimers();
        const clear = rstest.spyOn(globalThis, 'clearTimeout');
        try {
            const fired = new LifecycleStore();
            fired.scheduleTask(5, () => undefined);
            await rstest.advanceTimersByTimeAsync(5);
            clear.mockClear();
            fired.dispose();
            expect(clear).not.toHaveBeenCalled();

            const cancelled = new LifecycleStore();
            const cancel = cancelled.scheduleTask(5, () => undefined);
            cancel();
            clear.mockClear();
            cancelled.dispose();
            expect(clear).not.toHaveBeenCalled();
        } finally { clear.mockRestore(); rstest.useRealTimers(); }
    });

    test('draft diagnostics are deferred until an actual draft is touched', async () => {
        const store = new LifecycleStore();
        const logs: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { logs.push(args); };
        try {
            store.touchDraft();
            store.dispose();
            await Promise.resolve();
        } finally { console.error = original; }
        expect(logs).toHaveLength(0);
    });
    test('a signal first requested after disposal is aborted', () => {
        const store = new LifecycleStore();
        store.dispose();
        expect(store.getSignal().aborted).toBe(true);
    });


    test('reentrant disposal during subscriber scheduling skips later subscribers', () => {
        const store = new LifecycleStore();
        const calls: string[] = [];
        LifecycleStore.synchronous = true;
        try {
            store.subscribe(() => { calls.push('first'); store.dispose(); });
            store.subscribe(() => { calls.push('second'); });
            store.mutate();
        } finally { LifecycleStore.synchronous = false; }
        expect(calls).toEqual(['first']);
    });

    test('manual timer disposer and timer completion both release their timer entries', async () => {
        rstest.useFakeTimers();
        try {
            const store = new LifecycleStore();
            let manualCalls = 0;
            const cancel = store.scheduleTask(10, () => { manualCalls++; });
            cancel();
            await rstest.advanceTimersByTimeAsync(10);
            expect(manualCalls).toBe(0);

            let cancelledCalls = 0;
            store.scheduleTask(10, () => { cancelledCalls++; });
            store.dispose();
            await rstest.advanceTimersByTimeAsync(10);
            expect(cancelledCalls).toBe(0);

            const fired = new LifecycleStore();
            let firedCalls = 0;
            fired.scheduleTask(5, () => { firedCalls++; });
            await rstest.advanceTimersByTimeAsync(5);
            expect(firedCalls).toBe(1);
            fired.dispose();
        } finally { rstest.useRealTimers(); }
    });
});
