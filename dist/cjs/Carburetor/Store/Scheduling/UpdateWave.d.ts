/**
 * The scope of one notification pass. A write is delivered to its subscribers one by one,
 * and each delivery can cascade — a computed wakes its own subscribers inside the same
 * pass. An outer computed woken midway would read its other inputs before they have been
 * told about the write, so invalidation during a pass defers instead of settling, and the
 * end of the pass drains what accumulated until the cascades stop producing more.
 */
export declare class UpdateWave {
    /** How many passes are open; the deferred work drains only when this returns to zero. */
    protected depth: number;
    /** Settlements deferred during the pass, keyed so a re-defer replaces the earlier one. */
    protected pending: Map<string, () => void>;
    /** Whether a notification pass is open. */
    isActive: () => boolean;
    /** Opens a pass; invalidations inside it are collected instead of settled. */
    begin: () => void;
    /** Closes a pass, then drains deferred work until the cascades stop producing more. */
    end: () => void;
    /**
     * Remembers one deferred computation; a later invalidation replaces an earlier one.
     *
     * @param uid - the computation's id, the map key whose reuse replaces the earlier
     * settlement and leaves its callback unrun
     * @param settle - the callback end()'s drain invokes once the cascades stop; it is not
     * run at defer time
     */
    defer: (uid: string, settle: () => void) => void;
}
