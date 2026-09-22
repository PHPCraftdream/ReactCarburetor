import {TTimerHandle, TUpdater} from "@/Carburetor/Models/Base";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

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
        // One throwing updater must not cost the updaters after it the flush they were
        // already promised: each run is isolated and the failures are reported once the
        // flush settles, below, so they surface even when the depth guard aborts it.
        const failures: unknown[] = [];

        try {
            while (this.updaters.size > 0) {
                if (depth++ >= this.maxUpdateDepth) {
                    this.updaters.clear();

                    throw new Error(
                        'ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth +
                        '. An updater keeps scheduling new updates — this is an infinite update loop.'
                    );
                }

                const batch = Array.from(this.updaters.values());
                this.updaters.clear();

                batch.forEach((updater: TUpdater) => {
                    try {
                        this.runUpdater(updater);
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                });
            }
        } finally {
            failures.forEach((error: unknown) => {
                if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                    diagnostics.report(
                        'an updater threw while the throttle flushed: ' +
                        (error instanceof Error ? error.message : String(error)) +
                        '. The remaining updaters in the batch were run anyway.'
                    );
                }
            });

            // The handle belongs to the flush that just fired: it has to be dropped even
            // when the flush ends abnormally, or setupTimeout() would see it in place and
            // never arm again — every update after a throwing one would sit queued forever.
            this.clearTimeout();
        }
    };
}
