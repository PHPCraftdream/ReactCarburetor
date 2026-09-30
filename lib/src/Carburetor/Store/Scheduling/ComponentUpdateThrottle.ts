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
    /** Flush rounds letsUpdate() tolerates before it declares an infinite update loop. */
    protected maxUpdateDepth: number = 50;
    /** The armed flush timer, whose presence keeps setupTimeout() from sliding the window. */
    protected timeout: TTimerHandle = undefined;
    /** Updates waiting for the next flush, keyed by subscriber; letsUpdate() drains it until empty. */
    protected updaters: Map<string, TUpdater> = new Map<string, TUpdater>();
    /** Current flush round; remaining entries can still be cancelled or replaced. */
    private flushing: Map<string, TUpdater> | undefined;
    /** Empty map from the previous round, reused for updates scheduled during delivery. */
    private spareUpdaters: Map<string, TUpdater> | undefined;
    /** Failures of the active flush; nested flushes save and restore their caller's list. */
    private flushFailures: unknown[] | undefined;
    /** Enclosing rounds, allocated only when a callback explicitly flushes recursively. */
    private enclosingFlushes: Map<string, TUpdater>[] | undefined;
    /** Rounds spent by this entire flush chain, including nested letsUpdate() calls. */
    private flushDepth = 0;
    /** Number of active letsUpdate() frames; the outermost frame resets the depth budget. */
    private flushNesting = 0;
    /** Identifies a depth error so callback isolation does not swallow the loop guard. */
    private depthError: Error | undefined;

    /** Bound once for `setTimeout`, called detached from `this`; forwards to the overridable `letsUpdate`. */
    private readonly letsUpdateBound = (): void => this.letsUpdate();

    /** Takes the coalescing window in milliseconds. */
    constructor(protected updateTimeout: number = 40) {
    }

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
    public schedule(uid: string, updater: TUpdater): void {
        this.cancelActive(uid);
        this.updaters.set(uid, updater);
        this.setupTimeout();
    }

    /** Drops an update even when its flush round has already begun. */
    public cancel(uid: string): void {
        this.cancelActive(uid);
        this.updaters.delete(uid);
    }

    /** Removes a pending key from every active round, including suspended outer rounds. */
    private cancelActive(uid: string): void {
        this.flushing?.delete(uid);
        const enclosing = this.enclosingFlushes;
        if (enclosing) {
            for (let index = 0; index < enclosing.length; index++) {
                enclosing[index].delete(uid);
            }
        }
    }

    /** Arms the flush, leaving an already armed one alone: the window must not slide. */
    protected setupTimeout(): void {
        if (!this.timeout) {
            this.timeout = setTimeout(this.letsUpdateBound, this.updateTimeout);
        }
    }

    /** Disarms the flush timer. */
    protected clearTimeout(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = undefined;
    }

    /** Runs one queued update; a seam for tests and subclasses. */
    protected runUpdater(updater: TUpdater): void {
        updater();
    }

    /** Runs one captured callback without allocating a closure for each flush round. */
    private runFlushingUpdater(updater: TUpdater): void {
        try {
            this.runUpdater(updater);
        } catch (error: unknown) {
            if (error === this.depthError) {
                throw error;
            }
            (this.flushFailures ??= []).push(error);
        }
    }

    /** Flushes the queue, including what the flush itself queues, and fails on a loop. */
    protected letsUpdate(): void {
        // Updates queued while flushing (for example from an effect that writes to a
        // carburetor) have to run in this very cycle, otherwise clearing the queue
        // would silently drop them.
        const enclosing = this.flushing;
        if (enclosing) {
            (this.enclosingFlushes ??= []).push(enclosing);
        }
        this.flushNesting++;
        // Failures are rare; keep the normal path allocation-free and isolate nested flushes.
        const previousFailures = this.flushFailures;
        this.flushFailures = undefined;

        try {
            while (this.updaters.size > 0) {
                if (this.flushDepth++ >= this.maxUpdateDepth) {
                    this.updaters.clear();
                    this.flushing?.clear();
                    this.enclosingFlushes?.forEach((batch) => batch.clear());
                    throw (this.depthError = new Error(
                        'ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth +
                        '. An updater keeps scheduling new updates — this is an infinite update loop.'
                    ));
                }

                const batch = this.updaters;
                this.updaters = this.spareUpdaters ?? new Map<string, TUpdater>();
                this.spareUpdaters = undefined;
                this.flushing = batch;

                // Removing only pending entries during iteration preserves cancellation and
                // replacement. Executed entries need no per-callback delete: clear the round
                // after traversal, before recycling its map.
                batch.forEach(this.runFlushingUpdater, this);
                batch.clear();
                this.flushing = undefined;
                this.spareUpdaters = batch;
            }
        } finally {
            this.flushing = enclosing;
            if (enclosing) {
                this.enclosingFlushes?.pop();
                if (this.enclosingFlushes?.length === 0) {
                    this.enclosingFlushes = undefined;
                }
            }
            if (--this.flushNesting === 0) {
                this.flushDepth = 0;
                this.depthError = undefined;
            }
            // The Map callback can assign this field outside TypeScript's local flow analysis.
            const failures = this.flushFailures as unknown[] | undefined;
            this.flushFailures = previousFailures;
            failures?.forEach((error: unknown) => {
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
    }
}
