import { TTimerHandle, TUpdater } from "../../Models/Base.js";
import { IUpdateScheduler } from "../../Models/Store.js";
/**
 * A policy for streaming sources: a socket pushing a thousand messages per second,
 * mousemove, presence cursors. There updates arrive in separate ticks and coalescing
 * genuinely helps. Regular UI does not need it — a carburetor delivers updates immediately
 * by default.
 */
export declare class ComponentUpdateThrottle implements IUpdateScheduler {
    protected updateTimeout: number;
    /** Flush rounds letsUpdate() tolerates before it declares an infinite update loop. */
    protected maxUpdateDepth: number;
    /** The armed flush timer, whose presence keeps setupTimeout() from sliding the window. */
    protected timeout: TTimerHandle;
    /** Updates waiting for the next flush, keyed by subscriber; letsUpdate() drains it until empty. */
    protected updaters: Map<string, TUpdater>;
    /** Current flush round; remaining entries can still be cancelled or replaced. */
    private flushing;
    /** Empty map from the previous round, reused for updates scheduled during delivery. */
    private spareUpdaters;
    /** Failures of the active flush; nested flushes save and restore their caller's list. */
    private flushFailures;
    /** Enclosing rounds, allocated only when a callback explicitly flushes recursively. */
    private enclosingFlushes;
    /** Rounds spent by this entire flush chain, including nested letsUpdate() calls. */
    private flushDepth;
    /** Number of active letsUpdate() frames; the outermost frame resets the depth budget. */
    private flushNesting;
    /** Identifies a depth error so callback isolation does not swallow the loop guard. */
    private depthError;
    /** Bound once for `setTimeout`, called detached from `this`; forwards to the overridable `letsUpdate`. */
    private readonly letsUpdateBound;
    /** Takes the coalescing window in milliseconds. */
    constructor(updateTimeout?: number);
    /**
     * Queues one update per subscriber, so repeated writes collapse into one render.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it.
     *
     * @param uid - the internal delivery key, unique across stores sharing this scheduler;
     * reuse for one store-local subscription replaces its still-unrun update
     * @param updater - the callback to run unless cancelled or replaced, including during a flush
     */
    schedule(uid: string, updater: TUpdater): void;
    /** Drops an update even when its flush round has already begun. */
    cancel(uid: string): void;
    /** Removes a pending key from every active round, including suspended outer rounds. */
    private cancelActive;
    /** Arms the flush, leaving an already armed one alone: the window must not slide. */
    protected setupTimeout(): void;
    /** Disarms the flush timer. */
    protected clearTimeout(): void;
    /** Runs one queued update; a seam for tests and subclasses. */
    protected runUpdater(updater: TUpdater): void;
    /** Runs one captured callback without allocating a closure for each flush round. */
    private runFlushingUpdater;
    /** Flushes the queue, including what the flush itself queues, and fails on a loop. */
    protected letsUpdate(): void;
}
