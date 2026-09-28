import {TDisposer} from "@/Carburetor/Models/Base";
import {IWritePatch, PATCH_OPAQUE} from "@/Carburetor/Models/Paths";
import {ICarburetor, IPatchSource} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";
import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";

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
export class CarburetorHistory<T extends object> {
    /** Entries to step back to; the oldest is dropped once `limit` is exceeded. */
    protected past: THistoryEntry<T>[] = [];
    /** Undone entries waiting for redo; any fresh write empties it. */
    protected future: THistoryEntry<T>[] = [];
    /**
     * A detached mirror of the live state, advanced by replaying each entry's own patches
     * instead of a fresh snapshot — so a later opaque change still has an exact "before" to
     * record without paying for one on every write.
     */
    protected baseline: T;
    /** The most entries `past` may hold; set from options at construction. */
    protected limit: number;
    /** Set inside apply() so the watcher and the patch listener ignore history's own writes. */
    protected applying: boolean = false;
    /** The watch installed at construction; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;
    /** Patches collected since the last flush; turned into an entry by record(). */
    protected pendingPatches: IWritePatch[] = [];
    /** Whether the pending change contains a write the proxy could not describe. */
    protected pendingOpaque: boolean = false;

    /** Bound once for `subscribe`, called detached from `this`; forwards to the overridable `record`. */
    private readonly recordBound = (): void => this.record();
    /** Bound once for `attachPatchListener`, called detached from `this`; forwards to `onPatch`. */
    private readonly onPatchBound = (patch: IWritePatch | typeof PATCH_OPAQUE): void => this.onPatch(patch);

    /**
     * Starts watching a carburetor, with its current state as the baseline for the first
     * opaque change, should one come before any patch-based one does.
     *
     * History needs "every write", which `watch(select, onChange)` cannot express cheaply (its
     * selector would have to read the whole tree, then diff it, on every change) — `subscribe`
     * with no `reads` is the engine's own way to say that, so history uses it directly instead
     * of reconstructing the same thing through `watch`.
     *
     * @param carburetor - the store being tracked: `attachPatchListener` feeds entries, restore()
     * applies undo and redo to it.
     * @param options - `limit` caps how far back undo reaches; defaults to 50 entries when omitted
     */
    constructor(protected carburetor: ICarburetor<T> & IPatchSource, options: IHistoryOptions = {}) {
        this.limit = options.limit || 50;
        this.baseline = carburetor.snapshot();

        const detachPatches = carburetor.attachPatchListener(this.onPatchBound);
        const subscriptionId = carburetor.subscribe(this.recordBound);

        this.dispose = () => {
            detachPatches();
            carburetor.unsubscribe(subscriptionId);
        };
    }

    /**
     * Whether there is a past entry to step back to.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it. `undo`/`redo` are a
     * breaking change from the earlier arrow fields — detaching them (for example
     * `onClick={history.undo}`) now needs an explicit bind at the call site.
     */
    public canUndo(): boolean {
        return this.past.length > 0;
    }

    /** Whether an undone entry is waiting to be stepped forward into. */
    public canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Steps one change back, or reports that there was nothing to step back to. */
    public undo(): boolean {
        const entry = this.past.pop();

        if (entry === undefined) {
            return false;
        }

        this.future.push(entry);
        this.apply(entry, true);

        return true;
    }

    /** Steps one undone change forward again. */
    public redo(): boolean {
        const entry = this.future.pop();

        if (entry === undefined) {
            return false;
        }

        this.past.push(entry);
        this.apply(entry, false);

        return true;
    }

    /** Forgets the recorded history, keeping the state as it is. */
    public clear(): void {
        this.past = [];
        this.future = [];
    }

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect(): void {
        this.dispose();
    }

    /** Collects one write's patch, or notes the pending change is opaque; ignored while applying. */
    protected onPatch(patch: IWritePatch | typeof PATCH_OPAQUE): void {
        if (this.applying) {
            return;
        }

        if (patch === PATCH_OPAQUE) {
            this.pendingOpaque = true;

            return;
        }

        this.pendingPatches.push(patch);
    }

    /** Flushes the pending change into one entry, dropping the oldest past the limit. */
    protected record(): void {
        if (this.applying) {
            return;
        }

        this.past.push(this.buildEntry());

        if (this.past.length > this.limit) {
            this.past.shift();
        }

        this.future = [];
        this.pendingPatches = [];
        this.pendingOpaque = false;
    }

    /**
     * Turns the writes collected since the last flush into one entry.
     *
     * Patches when every one of them was describable; a full snapshot either side of the change
     * otherwise. The empty-patch case is defensive — every write path this class knows of reports
     * one or the other — so a gap in that coverage still falls back to a safe, larger entry.
     */
    protected buildEntry(): THistoryEntry<T> {
        if (this.pendingOpaque || this.pendingPatches.length === 0) {
            const before = this.baseline;
            const after = this.carburetor.snapshot();

            this.baseline = deepClone(after);

            return {kind: 'snapshot', before, after};
        }

        const patches = this.pendingPatches;

        for (const patch of patches) {
            installPatch(this.baseline as unknown as Record<string, unknown>, patch, false);
        }

        return {kind: 'patches', patches};
    }

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
    protected apply(entry: THistoryEntry<T>, inverse: boolean): void {
        this.applying = true;

        try {
            const state = entry.kind === 'snapshot'
                ? (inverse ? entry.before : entry.after)
                : this.reconstruct(entry.patches, inverse);

            // restore() copies what it is given, so the store never aliases this entry or
            // `reconstruct`'s own return value.
            this.carburetor.restore(state);
            this.baseline = entry.kind === 'snapshot' ? deepClone(state) : state;
        } finally {
            this.applying = false;
        }
    }

    /**
     * The state `patches` produce when installed onto a fresh copy of `baseline`.
     *
     * @param patches - the entry's patches, in the order originally recorded.
     * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
     */
    private reconstruct(patches: readonly IWritePatch[], inverse: boolean): T {
        const target = deepClone(this.baseline) as unknown as Record<string, unknown>;
        const ordered = inverse ? [...patches].reverse() : patches;

        for (const patch of ordered) {
            installPatch(target, patch, inverse);
        }

        return target as unknown as T;
    }
}
