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
    protected maxUpdateDepth: number;
    protected timeout: TTimerHandle;
    protected updaters: Map<string, TUpdater>;
    /** Takes the coalescing window in milliseconds. */
    constructor(updateTimeout?: number);
    /** Queues one update per subscriber, so repeated writes collapse into one render. */
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
