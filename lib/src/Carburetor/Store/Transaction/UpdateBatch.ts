import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {CARBURETOR_NOTIFY_WRITES, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {updateWave} from "@/Carburetor/Store/Scheduling/UpdateWaveInstance";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}};

const reportBatchFailure = (error: unknown): void => {
    if (process.env.NODE_ENV !== 'production') {
        diagnostics.report(
            'a carburetor threw while a transaction was being delivered: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. The other carburetors in the batch were notified anyway.'
        );
    }
};

/**
 * Collects writes while a transaction is open and delivers one notification pass per
 * carburetor when it closes. Without it a method that writes to several carburetors —
 * or a preEmit that cascades into a neighbour — produces a separate notification pass
 * for every write.
 */
export class UpdateBatch {
    /** How many transactions are open; flush runs only when the outermost one closes. */
    protected depth: number = 0;
    /** Writes collected per carburetor while the transaction is open, delivered once at flush. */
    protected pending: Map<IInternalSubscriptionProtocol, TPathSet> =
        new Map<IInternalSubscriptionProtocol, TPathSet>();
    /** Event deliveries deferred until the outermost transaction has flushed. */
    private afterFlush?: Array<() => void>;
    /** Nesting of flushes in progress; deferred events wait for the outermost. */
    private flushDepth = 0;
    /** Guards against re-entering the event drain from a listener. */
    private drainingEvents = false;

    /**
     * Whether a transaction is open, so writes are collected rather than delivered.
     *
     * A method, not an arrow field: every overridable member here is, so a subclass override
     * lands on the prototype instead of an own property shadowing it.
     */
    public isActive(): boolean {
        return this.depth > 0;
    }

    /** Appends one captured event delivery to the transaction FIFO when batching is active.
     *
     * @param deliver - delivery callback captured at emit time
     */
    public enqueueAfterFlush(deliver: () => void): void {
        if (this.depth > 0 || this.flushDepth > 0 || this.drainingEvents) {
            (this.afterFlush ??= []).push(deliver);
        } else {
            deliver();
        }
    }

    /** Opens a transaction; nesting is counted, so only the outermost one delivers. */
    public begin(): void {
        this.depth++;
    }

    /** Closes a transaction, delivering everything collected once the outermost one ends. */
    public end(): void {
        this.depth--;
        if (this.depth > 0) return;
        this.depth = 0;
        this.flush();
    }

    /**
     * Merges writes into what a carburetor will be notified about.
     *
     * @param target - the carburetor the writes belong to; the map key that folds repeated
     * adds into the single notification pass flush() gives it
     * @param writes - the paths changed; the first add adopts the set as given, so the caller
     * must be handing over ownership (emitUpdate always does) rather than keeping it around to
     * mutate further
     */
    public add(target: IInternalSubscriptionProtocol, writes: TPathSet): void {
        const merged = this.pending.get(target);
        if (!merged) {
            this.pending.set(target, writes);
            return;
        }
        writes.forEach((path: TPath) => merged.add(path));
    }

    /** Delivers deferred events in FIFO order once no transaction or flush is open. */
    private drainEvents(): void {
        if (this.drainingEvents || this.depth > 0) return;
        const queue = this.afterFlush;
        if (!queue?.length) return;
        this.drainingEvents = true;
        let cursor = 0;
        try {
            while (cursor < queue.length) {
                const delivery = queue[cursor++];
                try { delivery(); } catch (error: unknown) { reportBatchFailure(error); }
            }
        } finally {
            this.afterFlush = undefined;
            this.drainingEvents = false;
        }
    }

    /** Delivers one notification pass per carburetor, draining what the passes add. */
    protected flush(): void {
        // The whole drain is one wave: a transaction writing several carburetors is one
        // logical write, so a computation reading several of them settles once, after all
        // of them have been told, instead of once per store.
        this.flushDepth++;
        updateWave.begin();
        let waveActive = true;
        try {
            // The carburetors in one transaction are independent parts of one logical
            // write: one failing to deliver must not abandon the others still queued, so
            // each pass is isolated and the failures are reported once the drain ends.
            const failures: unknown[] = [];

            // Settlement may itself write stores. Close each wave, then deliver those
            // writes in another wave before allowing queued events to drain.
            while (true) {
                while (this.pending.size > 0) {
                    const batch = Array.from(this.pending.entries());
                    this.pending.clear();
                    batch.forEach(([target, writes]: [IInternalSubscriptionProtocol, TPathSet]) => {
                        try {
                            target[CARBURETOR_NOTIFY_WRITES]!(writes);
                        } catch (error: unknown) {
                            failures.push(error);
                        }
                    });
                }
                if (waveActive) {
                    waveActive = false;
                    updateWave.end();
                }
                if (this.pending.size === 0) break;
                updateWave.begin();
                waveActive = true;
            }
            failures.forEach(reportBatchFailure);
        } finally {
            this.flushDepth--;
            try {
                if (waveActive) {
                    waveActive = false;
                    updateWave.end();
                }
            } finally {
                if (this.flushDepth === 0 && this.depth === 0) this.drainEvents();
            }
        }
    }
}
