/** Scheduling interface for deterministic test clocks. */
export interface ITestClock {
    /**
     * Advance simulated time and run callbacks due within the window.
     *
     * @param ms - finite, non-negative milliseconds to advance
     */
    advance(ms: number): void;
    /**
     * Run all pending callbacks; throws after a callback limit for recurring timers.
     */
    runAll(): void;
    /** Return current simulated time. */
    now(): number;
    /** Return the number of scheduled callbacks. */
    readonly pending: number;
    /**
     * Attach a Carburetor store that is not placed in a scope; re-homes its pending timers onto this clock.
     *
     * @param store - Carburetor store instance to drive with this clock
     */
    attach(store: object): void;
    /**
     * Schedule a callback after a delay.
     *
     * @param task - callback invoked when the delay expires
     * @param ms - finite, non-negative delay that does not overflow time
     */
    setTimeout(task: () => void, ms: number): number;
    /**
     * Cancel a pending callback.
     *
     * @param id - identifier returned by setTimeout
     */
    clearTimeout(id: number): void;
}
