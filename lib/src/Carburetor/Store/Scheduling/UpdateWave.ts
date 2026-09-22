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

    /** Closes a pass, then drains deferred work until the cascades stop producing more. */
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
            while (this.pending.size > 0) {
                const batch = Array.from(this.pending.entries());
                this.pending.clear();

                batch.forEach(([, settle]: [string, () => void]) => {
                    settle();
                });
            }
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
