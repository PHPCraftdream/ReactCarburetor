import {ITestClock} from '../../../../Testing/ITestClock';
/** A pending owned timer, re-homable between global and clock timelines. */
interface TimerEntry {
    task: () => void;
    delay: number;
    startedAt: number;
    clock?: ITestClock;
    clockId?: number;
    globalId?: ReturnType<typeof setTimeout>;
}
/** Per-store disposal state kept outside the store: lazy signal, owned timers, disposed flag. */
class StoreLifecycle {
    /** Lifecycle state per store, created on first need. */
    private readonly states = new WeakMap<object, {
        disposed: boolean;
        controller?: AbortController;
        timers?: Set<TimerEntry>;
        clock?: ITestClock;
    }>();
    /** The error every use after disposal throws. */
    private readonly disposedError = (): Error => new Error('Carburetor: store has been disposed');
    /** Attach a test clock to a real Carburetor store at scope handout.
     *
     * Attaching the same clock again is a no-op. Attaching a different clock moves every pending
     * timer onto it; the remaining delay is preserved on the old clock's timeline.
     *
     * @param store - store that will use the test clock
     * @param clock - optional test clock to associate with the store
     */
    public useClock(store: object, clock: ITestClock | undefined): void {
        if (!clock) return;
        const state = this.states.get(store);
        if (state?.clock === clock) return;
        if (!state) {
            this.states.set(store, {disposed: false, clock});
            return;
        }
        state.clock = clock;
        state.timers?.forEach((entry) => this.moveEntry(state!, entry, clock));
    }

    /** Cancel the current handle of an entry. */
    private cancelEntry(entry: TimerEntry): void {
        if (entry.clock !== undefined) {
            if (entry.clockId !== undefined) entry.clock.clearTimeout(entry.clockId);
        } else if (entry.globalId !== undefined) clearTimeout(entry.globalId);
    }

    /** Re-schedule a pending entry on a clock, preserving the remaining delay.
     *
     * @param state - lifecycle state of the store owning the timer
     * @param entry - pending timer entry to move
     * @param clock - clock the entry is re-homed onto
     */
    private moveEntry(
        state: {disposed: boolean; timers?: Set<TimerEntry>},
        entry: TimerEntry,
        clock: ITestClock
    ): void {
        this.cancelEntry(entry);
        const elapsed = (entry.clock !== undefined ? entry.clock.now() : Date.now()) - entry.startedAt;
        entry.delay = Math.max(0, entry.delay - elapsed);
        entry.startedAt = clock.now();
        entry.clock = clock;
        entry.globalId = undefined;
        entry.clockId = clock.setTimeout((): void => {
            state.timers?.delete(entry);
            if (!state.disposed) entry.task();
        }, entry.delay);
    }

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
        state.timers?.forEach((entry) => this.cancelEntry(entry));
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
        state.controller ??= new AbortController();
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
        const timers = state.timers ??= new Set<TimerEntry>();
        const clock = state.clock;
        const entry: TimerEntry = {task, delay: ms, startedAt: 0};
        const callback = (): void => { timers.delete(entry); if (!state.disposed) task(); };
        if (clock) {
            entry.startedAt = clock.now();
            entry.clock = clock;
            entry.clockId = clock.setTimeout(callback, ms);
        } else {
            entry.startedAt = Date.now();
            entry.globalId = setTimeout(callback, ms);
        }
        timers.add(entry);
        return (): void => { this.cancelEntry(entry); timers.delete(entry); };
    }
}

export const storeLifecycle = new StoreLifecycle();
