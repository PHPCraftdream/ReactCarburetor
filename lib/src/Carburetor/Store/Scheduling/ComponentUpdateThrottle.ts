import {TTimerHandle, TUpdater} from "@/Carburetor/Models/Base";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

/**
 * A policy for streaming sources: a socket pushing a thousand messages per second,
 * mousemove, presence cursors. There updates arrive in separate ticks and coalescing
 * genuinely helps. Regular UI does not need it — a carburetor delivers updates immediately
 * by default.
 */
export class ComponentUpdateThrottle implements IUpdateScheduler {
    protected maxUpdateDepth: number = 50;
    protected timeout: TTimerHandle = undefined;
    protected updaters: Map<string, TUpdater> = new Map<string, TUpdater>();

    /** Takes the coalescing window in milliseconds. */
    constructor(protected updateTimeout: number = 40) {
    }

    /** Queues one update per subscriber, so repeated writes collapse into one render. */
    public schedule = (uid: string, updater: TUpdater) => {
        this.updaters.set(uid, updater);
        this.setupTimeout();
    };

    /** Drops a queued update, for a subscriber that unsubscribed before the flush. */
    public cancel = (uid: string) => {
        this.updaters.delete(uid);
    };

    /** Arms the flush, leaving an already armed one alone: the window must not slide. */
    protected setupTimeout = () => {
        if (!this.timeout) {
            this.timeout = setTimeout(this.letsUpdate, this.updateTimeout);
        }
    };

    /** Disarms the flush timer. */
    protected clearTimeout = () => {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = undefined;
    };

    /** Runs one queued update; a seam for tests and subclasses. */
    protected runUpdater = (updater: TUpdater) => {
        updater();
    };

    /** Flushes the queue, including what the flush itself queues, and fails on a loop. */
    protected letsUpdate = () => {
        // Updates queued while flushing (for example from an effect that writes to a
        // carburetor) have to run in this very cycle, otherwise clearing the queue
        // would silently drop them.
        let depth = 0;

        while (this.updaters.size > 0) {
            if (depth++ >= this.maxUpdateDepth) {
                this.updaters.clear();
                this.clearTimeout();

                throw new Error(
                    'ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth +
                    '. An updater keeps scheduling new updates — this is an infinite update loop.'
                );
            }

            const batch = Array.from(this.updaters.values());
            this.updaters.clear();

            batch.forEach(this.runUpdater);
        }

        this.clearTimeout();
    };
}
