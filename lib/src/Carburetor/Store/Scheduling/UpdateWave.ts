import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/**
 * The scope of one notification pass. A write is delivered to its subscribers one by one,
 * and each delivery can cascade — a computed wakes its own subscribers inside the same
 * pass. An outer computed woken midway would read its other inputs before they have been
 * told about the write, so invalidation during a pass defers instead of settling, and the
 * end of the pass drains what accumulated until the cascades stop producing more.
 */
export class UpdateWave {
    /** How many passes are open; the deferred work drains only when this returns to zero. */
    protected depth: number = 0;
    /** Settlements deferred during the pass, keyed so a re-defer replaces the earlier one. */
    protected pending: Map<string, () => void> = new Map<string, () => void>();

    /** Whether a notification pass is open. */
    public isActive = (): boolean => {
        return this.depth > 0;
    };

    /** Opens a pass; invalidations inside it are collected instead of settled. */
    public begin = (): void => {
        this.depth++;
    };

    /**
     * Closes a pass, then drains deferred work until the cascades stop producing more.
     *
     * The drain follows the store's notification policy: every settlement is isolated, so
     * one that throws costs neither the settlements after it their turn nor the work queued
     * while the drain runs — the loop keeps going until `pending` is empty. Failures are
     * reported once the drain finishes rather than re-thrown into whoever made the write,
     * and the depth is restored no matter how the drain went.
     */
    public end = (): void => {
        this.depth--;

        if (this.depth > 0) {
            return;
        }

        // The drain itself counts as inside the wave: settling one deferred computation
        // can invalidate another, which must defer again rather than settle mid-drain
        // with its other inputs not yet settled.
        this.depth = 1;

        try {
            const failures: unknown[] = [];

            while (this.pending.size > 0) {
                const batch = Array.from(this.pending.entries());
                this.pending.clear();

                batch.forEach(([, settle]: [string, () => void]) => {
                    try {
                        settle();
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                });
            }

            failures.forEach((error: unknown) => {
                if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                    diagnostics.report(
                        'a computation threw while a wave was drained: ' +
                        (error instanceof Error ? error.message : String(error)) +
                        '. The remaining deferred computations were settled anyway.'
                    );
                }
            });
        } finally {
            this.depth = 0;
        }
    };

    /**
     * Remembers one deferred computation; a later invalidation replaces an earlier one.
     *
     * @param uid - the computation's id, the map key whose reuse replaces the earlier
     * settlement and leaves its callback unrun
     * @param settle - the callback end()'s drain invokes once the cascades stop; it is not
     * run at defer time
     */
    public defer = (uid: string, settle: () => void): void => {
        this.pending.set(uid, settle);
    };
}
