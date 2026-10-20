import {createAbortHandle} from "@/Carburetor/Resource/Slot/createAbortHandle";

class StoreLifecycle {
    private readonly states = new WeakMap<object, {
        disposed: boolean;
        controller?: AbortController;
        timers?: Set<ReturnType<typeof setTimeout>>;
    }>();
    private readonly disposedError = (): Error => new Error('Carburetor: store has been disposed');

    /** Check whether the store is disposed.
     *
     * @param store - store whose lifecycle is inspected
     */
    public isDisposed(store: object): boolean { return this.states.get(store)?.disposed === true; }

    /**
     * Dispose store resources, then run the cleanup steps, preserving the first failure.
     *
     * @param store - store whose resources are disposed
     * @param steps - cleanup steps run in order after timers and signal; each runs even if one throws
     */
    public dispose(store: object, steps: ReadonlyArray<() => void>): void {
        let state = this.states.get(store);
        if (state?.disposed) return;
        if (!state) {
            state = {disposed: true};
            this.states.set(store, state);
        } else state.disposed = true;
        let failed = false;
        let failure: unknown;
        const recordFailure = (error: unknown): void => {
            if (!failed) { failed = true; failure = error; }
        };
        try { state.controller?.abort(); } catch (error: unknown) { recordFailure(error); }
        state.timers?.forEach((timer) => clearTimeout(timer));
        state.timers?.clear();
        for (const step of steps) {
            try { step(); } catch (error: unknown) { recordFailure(error); }
        }
        if (failed) throw failure;
    }

    /** Get the store's abort signal, creating it on demand.
     *
     * @param store - store whose abort signal is requested
     */
    public signal(store: object): AbortSignal {
        const state = this.states.get(store) ?? {disposed: false};
        this.states.set(store, state);
        state.controller ??= createAbortHandle();
        if (state.disposed && !state.controller.signal.aborted) state.controller.abort();
        return state.controller.signal;
    }

    /** Schedule owned work and return a cancellation disposer.
     *
     * @param store - store that owns the timer
     * @param ms - delay before running task
     * @param task - callback to run unless disposed or cancelled
     */
    public after(store: object, ms: number, task: () => void): () => void {
        if (this.isDisposed(store)) throw this.disposedError();
        const state = this.states.get(store) ?? {disposed: false};
        this.states.set(store, state);
        const timers = state.timers ??= new Set<ReturnType<typeof setTimeout>>();
        let timer: ReturnType<typeof setTimeout>;
        timer = setTimeout(() => { timers.delete(timer); if (!state.disposed) task(); }, ms);
        timers.add(timer);
        return () => { clearTimeout(timer); timers.delete(timer); };
    }
}

export const storeLifecycle = new StoreLifecycle();
