import { TDisposer } from "../Models/Base.mjs";
import { IWritePatch, PATCH_OPAQUE } from "../Models/Paths.mjs";
import { ICarburetor, IPatchSource } from "../Models/Store.mjs";
import { IHistoryOptions } from "../Models/Tooling.mjs";
/** One change recorded as the patches to invert it — the fast path (R16-07). */
interface IPatchesEntry {
    kind: 'patches';
    /** The patches, in the order originally recorded; redo replays them forward. */
    patches: IWritePatch[];
}
/** One change the proxy could not describe, recorded as a full state either side of it. */
interface ISnapshotEntry<T> {
    kind: 'snapshot';
    /** The state right before this change. */
    before: T;
    /** The state right after this change. */
    after: T;
}
type THistoryEntry<T> = IPatchesEntry | ISnapshotEntry<T>;
/**
 * Undo/redo for a carburetor, built on patches (R16-07). Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 *
 * Cost: O(changed values) per change, not O(state) — the write proxy already knows every path
 * it writes and the value it replaces, so an entry stores just that instead of a deep copy of
 * the whole state. A change the proxy cannot describe (the wildcard, a whole-root replacement, a
 * write that bypassed draft) still falls back to a full snapshot either side of it; one deep copy
 * per change is the floor only for *that* case, not for history in general.
 */
export declare class CarburetorHistory<T extends object> {
    protected carburetor: ICarburetor<T> & IPatchSource;
    /** Entries to step back to; the oldest is dropped once `limit` is exceeded. */
    protected past: THistoryEntry<T>[];
    /** Undone entries waiting for redo; any fresh write empties it. */
    protected future: THistoryEntry<T>[];
    /**
     * A detached mirror of the live state, advanced by replaying each entry's own patches
     * instead of a fresh snapshot — so a later opaque change still has an exact "before" to
     * record without paying for one on every write.
     */
    protected baseline: T;
    /** The most entries `past` may hold; set from options at construction. */
    protected limit: number;
    /** True only until the replay's own publication reaches history, not through its subscribers. */
    protected applying: boolean;
    /** A delayed replay notification must not produce an empty history entry. */
    private skipReplay;
    /** The exact restore argument identifies history's installation, not nested user restores. */
    private replayTarget;
    /** Set by the source immediately before it begins installing replay's own state. */
    private ownedReplay;
    /** Detaches both streams; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;
    /** Patches collected since the last flush; turned into an entry by record(). */
    protected pendingPatches: IWritePatch[];
    /** Whether the pending change contains a write the proxy could not describe. */
    protected pendingOpaque: boolean;
    /** One observer for mutation patches, the pre-subscriber boundary and replay ownership. */
    private readonly observer;
    /**
     * Starts watching a carburetor, with its current state as the baseline for the first
     * opaque change, should one come before any patch-based one does.
     *
     * Mutation patches arrive as they are written; the same observer's publication callback
     * runs before any ordinary subscriber can reenter the store. It follows the source's
     * scheduler, so a transaction or throttle still coalesces one history entry.
     *
     * @param carburetor - the store being tracked: `attachPatchListener` feeds entries, restore()
     * applies undo and redo to it.
     * @param options - `limit` caps how far back undo reaches; defaults to 50 entries when omitted
     */
    constructor(carburetor: ICarburetor<T> & IPatchSource, options?: IHistoryOptions);
    /**
     * Whether there is a past entry to step back to.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it. `undo`/`redo` are a
     * breaking change from the earlier arrow fields — detaching them (for example
     * `onClick={history.undo}`) now needs an explicit bind at the call site.
     */
    canUndo(): boolean;
    /** Whether an undone entry is waiting to be stepped forward into. */
    canRedo(): boolean;
    /** Steps one change back, or reports that there was nothing to step back to. */
    undo(): boolean;
    /** Steps one undone change forward again. */
    redo(): boolean;
    /** Forgets the recorded history, keeping the state as it is. */
    clear(): void;
    /** Stops watching the carburetor: nothing is recorded after this. */
    disconnect(): void;
    /** Collects a patch or opaque fallback, ignoring only the exact replay-owned installation. */
    protected onPatch(patch: IWritePatch | typeof PATCH_OPAQUE): void;
    /** Flushes the pending publication into one entry, dropping the oldest past the limit. */
    protected record(): void;
    /**
     * Turns the writes collected since the last flush into one entry.
     *
     * Patches when every one of them was describable; a full snapshot either side of the change
     * otherwise. The empty-patch case is defensive — every write path this class knows of reports
     * one or the other — so a gap in that coverage still falls back to a safe, larger entry.
     */
    protected buildEntry(): THistoryEntry<T>;
    /**
     * Installs `entry` through `restore()` without recording the installation itself, keeping
     * `baseline` in step so a later opaque entry still gets an exact "before".
     *
     * Always `restore()`, never a patch-specific apply: a store that overrides it (a
     * `ResourceCache` aborting in-flight requests on time travel, for one) must see undo and
     * redo the same way it always has, patches entry or not.
     *
     * @param entry - the entry to install.
     * @param inverse - true undoes `entry` (patches in reverse, or its `before`); false redoes it.
     */
    protected apply(entry: THistoryEntry<T>, inverse: boolean): void;
    /**
     * The state `patches` produce when installed onto a fresh copy of `baseline`.
     *
     * @param patches - the entry's patches, in the order originally recorded.
     * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
     */
    private reconstruct;
}
export {};
