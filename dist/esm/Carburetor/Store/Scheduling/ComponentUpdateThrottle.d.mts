import { TTimerHandle, TUpdater } from "../../Models/Base.mjs";
import { IUpdateScheduler } from "../../Models/Store.mjs";
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
    /** Takes the coalescing window in milliseconds. */
    constructor(updateTimeout?: number);
    /**
     * Queues one update per subscriber, so repeated writes collapse into one render.
     *
     * @param uid - the subscriber's id, the queue key whose reuse replaces the still-unrun
     * update instead of queueing a second one
     * @param updater - the callback the flush runs; nothing here invokes it, and cancel()
     * before the window elapses drops it unrun
     */
    schedule: (uid: string, updater: TUpdater) => void;
    /** Drops a queued update, for a subscriber that unsubscribed before the flush. */
    cancel: (uid: string) => void;
    /** Arms the flush, leaving an already armed one alone: the window must not slide. */
    protected setupTimeout: () => void;
    /** Disarms the flush timer. */
    protected clearTimeout: () => void;
    /** Runs one queued update; a seam for tests and subclasses. */
    protected runUpdater: (updater: TUpdater) => void;
    /** Flushes the queue, including what the flush itself queues, and fails on a loop. */
    protected letsUpdate: () => void;
}
