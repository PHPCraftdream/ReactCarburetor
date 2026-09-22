/**
 * The scope of one notification pass. A write is delivered to its subscribers one by one,
 * and each delivery can cascade — a computed wakes its own subscribers inside the same
 * pass. An outer computed woken midway would read its other inputs before they have been
 * told about the write, so invalidation during a pass defers instead of settling, and the
 * end of the pass drains what accumulated until the cascades stop producing more.
 */
export class UpdateWave {
    protected depth: number = 0;
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

    /** Remembers one deferred computation; a later invalidation replaces an earlier one. */
    public defer = (uid: string, settle: () => void): void => {
        this.pending.set(uid, settle);
    };
}
