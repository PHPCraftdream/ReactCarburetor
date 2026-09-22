/**
 * The scope of one notification pass. A write is delivered to its subscribers one by one,
 * and each delivery can cascade — a computed wakes its own subscribers inside the same
 * pass. An outer computed woken midway would read its other inputs before they have been
 * told about the write, so invalidation during a pass defers instead of settling, and the
 * end of the pass drains what accumulated until the cascades stop producing more.
 */
export declare class UpdateWave {
    protected depth: number;
    protected pending: Map<string, () => void>;
    /** Whether a notification pass is open. */
    isActive: () => boolean;
    /** Opens a pass; invalidations inside it are collected instead of settled. */
    begin: () => void;
    /** Closes a pass, then drains deferred work until the cascades stop producing more. */
    end: () => void;
    /** Remembers one deferred computation; a later invalidation replaces an earlier one. */
    defer: (uid: string, settle: () => void) => void;
}
