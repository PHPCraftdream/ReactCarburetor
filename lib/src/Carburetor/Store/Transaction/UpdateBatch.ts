import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {INotifiable} from "@/Carburetor/Models/Store";
import {updateWave} from "@/Carburetor/Store/Scheduling/UpdateWaveInstance";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

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
    protected pending: Map<INotifiable, TPathSet> = new Map<INotifiable, TPathSet>();

    /** Whether a transaction is open, so writes are collected rather than delivered. */
    public isActive = (): boolean => {
        return this.depth > 0;
    };

    /** Opens a transaction; nesting is counted, so only the outermost one delivers. */
    public begin = (): void => {
        this.depth++;
    };

    /** Closes a transaction, delivering everything collected once the outermost one ends. */
    public end = (): void => {
        this.depth--;

        if (this.depth > 0) {
            return;
        }

        this.depth = 0;
        this.flush();
    };

    /**
     * Merges writes into what a carburetor will be notified about.
     *
     * @param target - the carburetor the writes belong to; the map key that folds repeated
     * adds into the single notification pass flush() gives it
     * @param writes - the paths changed; the first add copies the set, so the caller stays
     * free to keep mutating its own
     */
    public add = (target: INotifiable, writes: TPathSet): void => {
        const merged = this.pending.get(target);

        if (!merged) {
            this.pending.set(target, new Set<TPath>(writes));

            return;
        }

        writes.forEach((path: TPath) => merged.add(path));
    };

    /** Delivers one notification pass per carburetor, draining what the passes add. */
    protected flush = (): void => {
        // The whole drain is one wave: a transaction writing several carburetors is one
        // logical write, so a computation reading several of them settles once, after all
        // of them have been told, instead of once per store.
        updateWave.begin();

        try {
            // The carburetors in one transaction are independent parts of one logical
            // write: one failing to deliver must not abandon the others still queued, so
            // each pass is isolated and the failures are reported once the drain ends.
            const failures: unknown[] = [];

            // A notification may open a new transaction, so drain until nothing is left.
            while (this.pending.size > 0) {
                const batch = Array.from(this.pending.entries());
                this.pending.clear();

                batch.forEach(([target, writes]: [INotifiable, TPathSet]) => {
                    try {
                        target.notifyWrites(writes);
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                });
            }

            failures.forEach((error: unknown) => {
                if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                    diagnostics.report(
                        'a carburetor threw while a transaction was being delivered: ' +
                        (error instanceof Error ? error.message : String(error)) +
                        '. The other carburetors in the batch were notified anyway.'
                    );
                }
            });
        } finally {
            updateWave.end();
        }
    };
}
