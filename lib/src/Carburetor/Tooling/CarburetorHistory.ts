import {TDisposer} from "@/Carburetor/Models/Base";
import {IPatchObserver, IWritePatch, PATCH_OPAQUE} from "@/Carburetor/Models/Paths";
import {ICarburetor, IPatchSource} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";
import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";
import {containsExoticValue} from "@/Carburetor/Store/Utils/containsExoticValue";
import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";

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

/** History must not retain a live class instance whose mutable internals it cannot copy. */
const refuseLiveEndpoint = (): never => {
    throw new Error('CarburetorHistory: cannot own a mutable class instance in a history endpoint');
};

/**
 * Plain state needs one quick graph copy, not per-property defineProperty/live-view handling.
 * An opaque member or accessor switches the entire graph to the established native copier,
 * so its keys, backlinks, descriptors and shared references are still copied as one graph.
 */
const own = <V>(value: V): V => {
    let opaque = false;
    const seen = new WeakMap<object, object>();
    const plain = (source: unknown): unknown => {
        if (source === null || typeof source !== 'object') {
            return source;
        }
        const prototype = Object.getPrototypeOf(source);
        if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
            opaque = true;
            return source;
        }
        const previous = seen.get(source);
        if (previous !== undefined) {
            return previous;
        }
        const array = Array.isArray(source);
        // Keep ordinary objects/arrays on their native fast shape; only unusual supported
        // prototypes need adjustment. Inherited names below use defineProperty, never setters.
        const container = array
            ? (prototype === Array.prototype ? [] : Object.setPrototypeOf([], prototype))
            : (prototype === Object.prototype ? {} : Object.create(prototype));
        const result = container as Record<string | symbol, unknown>;
        seen.set(source, result);
        const keys = Reflect.ownKeys(source);
        let length: PropertyDescriptor | undefined;
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                opaque = true;
                return result;
            }
            if (array && key === 'length') {
                length = descriptor;
                continue;
            }
            descriptor.value = plain(descriptor.value);
            if (opaque) {
                return result;
            }
            if (descriptor.writable && descriptor.enumerable && descriptor.configurable && !(key in result)) {
                result[key] = descriptor.value;
            } else {
                Object.defineProperty(result, key, descriptor);
            }
        }
        if (array && length) {
            if (length.writable) {
                result.length = length.value;
            } else {
                Object.defineProperty(result, 'length', length);
            }
        }
        return result;
    };
    const copied = plain(value);
    return opaque ? detachOpaque(value, refuseLiveEndpoint, refuseLiveEndpoint) : copied as V;
};

/** Primitive endpoints already have value ownership; only object graphs need detachment. */
const ownPatch = (patch: IWritePatch): IWritePatch => {
    const previous = patch.previous;
    const next = patch.next;
    if ((previous === null || typeof previous !== 'object') &&
        (next === null || typeof next !== 'object')) {
        return patch;
    }

    return {
        segments: patch.segments,
        previous: patch.previousExists ? own(previous) : undefined,
        next: patch.nextExists ? own(next) : undefined,
        previousExists: patch.previousExists,
        nextExists: patch.nextExists,
    };
};

/**
 * Undo/redo for a carburetor, built on patches (R16-07). Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 *
 * Cost: O(changed values) per describable change, not O(state) — the write proxy already knows
 * each written path and endpoint. Opaque changes require privately owned full before/after
 * states so native in-place mutations cannot rewrite an older history endpoint.
 */
export class CarburetorHistory<T extends object> {
    /** Entries to step back to; the oldest is dropped once `limit` is exceeded. */
    protected past: THistoryEntry<T>[] = [];
    /** Undone entries waiting for redo; any fresh write empties it. */
    protected future: THistoryEntry<T>[] = [];
    /**
     * A privately owned mirror of the live state, advanced by replaying patches instead of
     * taking a fresh snapshot on every describable write. Native values are detached too.
     */
    protected baseline: T;
    /** Plain-only histories retain their patch fast path; native graphs require whole-state ownership. */
    private baselineContainsExotic: boolean;
    /** The most entries `past` may hold; set from options at construction. */
    protected limit: number;
    /** True only until the replay's own publication reaches history, not through its subscribers. */
    protected applying: boolean = false;
    /** A delayed replay notification must not produce an empty history entry. */
    private skipReplay: boolean = false;
    /** A queued pre-clear publication with no later writes must not revive the old operation. */
    private skipClearedPublication: boolean = false;
    /** The exact restore argument identifies history's installation, not nested user restores. */
    private replayTarget: T | undefined;
    /** Set by the source immediately before it begins installing replay's own state. */
    private ownedReplay: boolean = false;
    /** Detaches both streams; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;
    /** Patches collected since the last flush; turned into an entry by record(). */
    protected pendingPatches: IWritePatch[] = [];
    /** Whether the pending change contains a write the proxy could not describe. */
    protected pendingOpaque: boolean = false;

    /** One observer for mutation patches, the pre-subscriber boundary and replay ownership. */
    private readonly observer: IPatchObserver = {
        patch: (patch: IWritePatch | typeof PATCH_OPAQUE): void => this.onPatch(patch),
        publication: (): void => this.record(),
        ownRestore: (state: unknown): boolean => {
            if (this.applying && state === this.replayTarget) {
                this.ownedReplay = true;
                return containsExoticValue(state);
            }
            return false;
        },
    };

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
    constructor(protected carburetor: ICarburetor<T> & IPatchSource, options: IHistoryOptions = {}) {
        if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
            throw new RangeError('CarburetorHistory: limit must be a positive safe integer');
        }
        this.limit = options.limit ?? 50;
        this.baseline = this.capture();
        this.baselineContainsExotic = containsExoticValue(this.baseline);

        this.dispose = carburetor.attachPatchListener(this.observer);
    }

    /** The producer captures its authoritative raw/wire graph before plain snapshot copying. */
    private capture(): T {
        return this.carburetor.captureHistory(own) as T;
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

    /** Forgets history and pending writes through this instant, without canceling other observers. */
    public clear(): void {
        const baseline = this.capture();
        this.past = [];
        this.future = [];
        this.baseline = baseline;
        this.baselineContainsExotic = containsExoticValue(baseline);
        this.pendingPatches = [];
        this.pendingOpaque = false;
        this.skipClearedPublication = true;
    }

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect(): void {
        this.dispose();
    }

    /** Collects a patch or opaque fallback, ignoring only the exact replay-owned installation. */
    protected onPatch(patch: IWritePatch | typeof PATCH_OPAQUE): void {
        if (this.applying && this.ownedReplay) {
            return;
        }

        if (patch === PATCH_OPAQUE) {
            this.pendingOpaque = true;

            return;
        }

        if (this.baselineContainsExotic) {
            this.pendingOpaque = true;
            return;
        }

        // A native payload can point to an otherwise plain sibling (or the root itself).
        // Installing only the leaf would split that graph, so own the complete endpoints.
        if ((patch.previousExists && containsExoticValue(patch.previous)) ||
            (patch.nextExists && containsExoticValue(patch.next))) {
            this.pendingOpaque = true;
            return;
        }

        this.pendingPatches.push(ownPatch(patch));
    }

    /** Flushes the pending publication into one entry, dropping the oldest past the limit. */
    protected record(): void {
        if (this.applying) {
            this.applying = false;
            if (this.ownedReplay) {
                // Replay has landed. Its subscribers may now publish their own changes.
                this.baseline = this.capture();
                this.baselineContainsExotic = containsExoticValue(this.baseline);
                this.ownedReplay = false;
                this.skipReplay = false;
                return;
            }
            // A synchronous callback (notably a resource abort listener) published before
            // the restore could install anything. Its patches belong to a fresh branch.
            this.skipReplay = false;
        }

        if (this.skipClearedPublication && !this.pendingOpaque && this.pendingPatches.length === 0) {
            this.skipClearedPublication = false;
            return;
        }
        this.skipClearedPublication = false;
        if (this.skipReplay && !this.pendingOpaque && this.pendingPatches.length === 0) {
            this.skipReplay = false;
            return;
        }
        this.skipReplay = false;
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
            const after = this.capture();
            this.baseline = own(after);
            this.baselineContainsExotic = containsExoticValue(after);

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
        const beforeVersion = this.carburetor.getVersion();
        this.applying = true;
        this.ownedReplay = false;
        this.skipReplay = true;

        try {
            const state = entry.kind === 'snapshot'
                ? own(inverse ? entry.before : entry.after)
                : this.reconstruct(entry.patches, inverse);
            this.replayTarget = state;

            // Only a publication from this exact restore argument suppresses its own entry;
            // an abort listener's replacement, or a write by a replay subscriber, is fresh.
            this.carburetor.restore(state);
            if (this.applying && this.ownedReplay) {
                // The source deferred replay's publication. Reconcile its actual wire state
                // now, before any later subscriber can publish on top of it.
                this.baseline = this.capture();
                this.baselineContainsExotic = containsExoticValue(this.baseline);
                this.skipReplay = this.carburetor.getVersion() !== beforeVersion;
            } else if (this.applying) {
                // A superseding callback published before the restore could install anything.
                // Its pending patches still need the old baseline at deferred delivery.
                this.skipReplay = false;
            }
        } finally {
            this.replayTarget = undefined;
            this.ownedReplay = false;
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
        const target = own(this.baseline) as unknown as Record<string, unknown>;
        const ordered = inverse ? [...patches].reverse() : patches;

        for (const patch of ordered) {
            installPatch(target, patch, inverse);
        }

        return target as unknown as T;
    }
}
