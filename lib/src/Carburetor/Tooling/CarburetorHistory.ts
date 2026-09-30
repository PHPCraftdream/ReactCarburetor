import {TDisposer} from "@/Carburetor/Models/Base";
import {IPatchObserver, IWritePatch, PATCH_ARRAY_LENGTH_LOCK, PATCH_OPAQUE} from "@/Carburetor/Models/Paths";
import {ICarburetor, IPatchSource} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";
import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";
import {containsExoticValue} from "@/Carburetor/Store/Utils/containsExoticValue";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";
import {sameHistoryGraph} from "./sameHistoryGraph";

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
    /** Whether each stored endpoint contains native state requiring whole-graph replay. */
    beforeExotic: boolean;
    afterExotic: boolean;
    /** Array length descriptor transitions cannot be installed through a locked live draft. */
    replaceOnReplay: boolean;
}

type THistoryEntry<T> = IPatchesEntry | ISnapshotEntry<T>;

/** History must not retain a live class instance whose mutable internals it cannot copy. */
const refuseLiveEndpoint = (): never => {
    throw new Error('CarburetorHistory: cannot own a mutable class instance in a history endpoint');
};

/**
 * Owns a supported history graph in one pass. Ordinary containers retain the fast assignment
 * shape where descriptors permit it; native members share the same cycle ledger and keep their
 * intrinsic contents and own data descriptors. A read view and its raw target share one copy.
 */
const own = <V>(value: V, onOpaque?: () => void, onLockedArray?: () => void): V => {
    const seen = new WeakMap<object, object>();
    const copy = (source: unknown): unknown => {
        if (source === null || typeof source !== 'object') {
            return source;
        }
        const raw = liveViews.readTarget(source) ?? source;
        const previous = seen.get(raw);
        if (previous !== undefined) {
            return previous;
        }
        const prototype = Object.getPrototypeOf(raw);
        const array = Array.isArray(raw);
        let result: object;
        let native = false;
        if (prototype === Map.prototype && raw instanceof Map) {
            onOpaque?.();
            const map = new Map<unknown, unknown>();
            result = map;
            native = true;
            seen.set(raw, result);
            Map.prototype.forEach.call(raw, (member: unknown, key: unknown): void => {
                map.set(copy(key), copy(member));
            });
        } else if (prototype === Set.prototype && raw instanceof Set) {
            onOpaque?.();
            const set = new Set<unknown>();
            result = set;
            native = true;
            seen.set(raw, result);
            Set.prototype.forEach.call(raw, (member: unknown): void => { set.add(copy(member)); });
        } else if (prototype === Date.prototype && raw instanceof Date) {
            onOpaque?.();
            result = new Date(Date.prototype.getTime.call(raw));
            native = true;
            seen.set(raw, result);
        } else if (prototype === Object.prototype || prototype === null ||
            prototype === Array.prototype) {
            if (!array && prototype === Array.prototype) {
                onOpaque?.();
            }
            result = array
                ? (prototype === Array.prototype ? [] : Object.setPrototypeOf([], prototype))
                : (prototype === Object.prototype ? {} : Object.create(prototype));
            seen.set(raw, result);
        } else {
            return refuseLiveEndpoint();
        }
        let length: PropertyDescriptor | undefined;
        for (const key of Reflect.ownKeys(raw)) {
            const descriptor = Object.getOwnPropertyDescriptor(raw, key);
            if (!descriptor) continue;
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw new Error('CarburetorHistory: cannot snapshot accessor property ' + String(key));
            }
            if (array && key === 'length') {
                // Other indices must be installed before a non-writable length.
                if (descriptor.writable === false) onLockedArray?.();
                length = descriptor;
                continue;
            }
            descriptor.value = copy(descriptor.value);
            const target = result as Record<string | symbol, unknown>;
            if (!native && descriptor.writable && descriptor.enumerable &&
                descriptor.configurable && !(key in target)) {
                target[key] = descriptor.value;
            } else {
                Object.defineProperty(result, key, descriptor);
            }
        }
        if (length) {
            Object.defineProperty(result, 'length', length);
        }
        return result;
    };
    return copy(value) as V;
};

/** Owns the object endpoints of a patch; primitive-only patches bypass this copier. */
const ownPatch = (patch: IWritePatch, onLockedArray: () => void): IWritePatch => {
    const previous = patch.previous;
    const next = patch.next;

    return {
        segments: patch.segments,
        previous: patch.previousExists ? own(previous, undefined, onLockedArray) : undefined,
        next: patch.nextExists ? own(next, undefined, onLockedArray) : undefined,
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
    /** Locks in the owned baseline persist unless a patch actually replaces a locked subtree. */
    private baselineContainsLockedArray: boolean;
    /** The last snapshot endpoint may also be baseline until a patch needs to mutate it. */
    private baselineShared: boolean = false;
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
    /** The selected replay endpoint's graph classification, valid only while applying. */
    private replayContainsExotic: boolean = false;
    /** Only a replay containing a length descriptor transition adopts its owned plain graph. */
    private replayReplaceLockedArray: boolean = false;
    /** Set by the source immediately before it begins installing replay's own state. */
    private ownedReplay: boolean = false;
    /** Detaches both streams; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;
    /** Patches collected since the last flush; turned into an entry by record(). */
    protected pendingPatches: IWritePatch[] = [];
    /** Whether the pending change contains a write the proxy could not describe. */
    protected pendingOpaque: boolean = false;
    /** The pending publication changed an array length writable flag. */
    private pendingLengthLock: boolean = false;

    /** One observer for mutation patches, the pre-subscriber boundary and replay ownership. */
    private readonly observer: IPatchObserver = {
        patch: (patch: IWritePatch | typeof PATCH_OPAQUE | typeof PATCH_ARRAY_LENGTH_LOCK): void =>
            this.onPatch(patch),
        publication: (): void => this.record(),
        ownRestore: (state: unknown): boolean => {
            if (this.applying && state === this.replayTarget) {
                this.ownedReplay = true;
                return this.replayContainsExotic || this.replayReplaceLockedArray;
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
        const capture = this.capture();
        this.baseline = capture.state;
        this.baselineContainsExotic = capture.exotic;
        this.baselineContainsLockedArray = capture.lockedArray;
        this.dispose = carburetor.attachPatchListener(this.observer);
    }

    /** The producer captures its authoritative graph and its native/length-lock classification. */
    private capture(): {state: T; exotic: boolean; lockedArray: boolean} {
        let exotic = false;
        let lockedArray = false;
        const markOpaque = (): void => { exotic = true; };
        const markLockedArray = (): void => { lockedArray = true; };
        const state = this.carburetor.captureHistory(
            <V>(value: V): V => own(value, markOpaque, markLockedArray)) as T;
        return {state, exotic, lockedArray};
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
        // Commit already-collected newer writes before selecting the step to undo.
        if (this.pendingOpaque || this.pendingPatches.length > 0) {
            this.record();
        }
        const entry = this.past.pop();

        if (entry === undefined) {
            return false;
        }

        const beforeVersion = this.carburetor.getVersion();
        const beforeState = this.carburetor.getData();
        this.future.push(entry);
        try {
            this.apply(entry, true);
        } catch (error) {
            // Restore may fail before installation (e.g. a custom restore guard). A subscriber
            // that published a fresh branch during replay already owns the cursor instead.
            if (this.carburetor.getVersion() === beforeVersion
                && this.carburetor.getData() === beforeState
                && !this.pendingOpaque && this.pendingPatches.length === 0
                && this.future[this.future.length - 1] === entry
                && sameHistoryGraph(this.baseline, this.capture().state)) {
                this.future.pop();
                this.past.push(entry);
            }
            throw error;
        }

        return true;
    }

    /** Steps one undone change forward again. */
    public redo(): boolean {
        // A queued new branch invalidates redo; an equal-content opaque read does not.
        if (this.pendingOpaque || this.pendingPatches.length > 0) {
            this.record();
        }
        const entry = this.future.pop();

        if (entry === undefined) {
            return false;
        }

        const beforeVersion = this.carburetor.getVersion();
        const beforeState = this.carburetor.getData();
        this.past.push(entry);
        try {
            this.apply(entry, false);
        } catch (error) {
            if (this.carburetor.getVersion() === beforeVersion
                && this.carburetor.getData() === beforeState
                && !this.pendingOpaque && this.pendingPatches.length === 0
                && this.past[this.past.length - 1] === entry
                && sameHistoryGraph(this.baseline, this.capture().state)) {
                this.past.pop();
                this.future.push(entry);
            }
            throw error;
        }

        return true;
    }

    /** Forgets history and pending writes through this instant, without canceling other observers. */
    public clear(): void {
        const capture = this.capture();
        this.past = [];
        this.future = [];
        this.baseline = capture.state;
        this.baselineContainsExotic = capture.exotic;
        this.baselineContainsLockedArray = capture.lockedArray;
        this.baselineShared = false;
        this.pendingPatches = [];
        this.pendingOpaque = false;
        this.pendingLengthLock = false;
        this.skipClearedPublication = true;
    }

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect(): void {
        this.dispose();
    }

    /** Collects a patch or opaque fallback, ignoring only the exact replay-owned installation. */
    protected onPatch(patch: IWritePatch | typeof PATCH_OPAQUE | typeof PATCH_ARRAY_LENGTH_LOCK): void {
        if (this.applying && this.ownedReplay) {
            return;
        }

        if (patch === PATCH_ARRAY_LENGTH_LOCK) {
            this.pendingOpaque = true;
            this.pendingLengthLock = true;
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

        if ((patch.previous === null || typeof patch.previous !== 'object') &&
            (patch.next === null || typeof patch.next !== 'object')) {
            this.pendingPatches.push(patch);
            return;
        }

        // A native payload can point to an otherwise plain sibling (or the root itself).
        // Installing only the leaf would split that graph, so own the complete endpoints.
        if ((patch.previousExists && containsExoticValue(patch.previous)) ||
            (patch.nextExists && containsExoticValue(patch.next))) {
            this.pendingOpaque = true;
            return;
        }

        let lockedArray = false;
        const ownedPatch = ownPatch(patch, (): void => { lockedArray = true; });
        if (lockedArray) {
            // Removing or installing a locked subtree requires a complete endpoint. An
            // unrelated patch cannot change the baseline's existing lock classification.
            this.pendingOpaque = true;
            return;
        }
        this.pendingPatches.push(ownedPatch);
    }

    /** Flushes the pending publication into one entry, dropping the oldest past the limit. */
    protected record(): void {
        if (this.applying) {
            this.applying = false;
            if (this.ownedReplay) {
                // Replay has landed. Its subscribers may now publish their own changes.
                const capture = this.capture();
                this.baseline = capture.state;
                this.baselineContainsExotic = capture.exotic;
                this.baselineContainsLockedArray = capture.lockedArray;
                this.baselineShared = false;
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
        const entry = this.buildEntry();
        this.pendingPatches = [];
        this.pendingOpaque = false;
        this.pendingLengthLock = false;
        if (entry === undefined) return;
        this.past.push(entry);
        if (this.past.length > this.limit) {
            this.past.shift();
        }
        this.future = [];
    }

    /**
     * Probes changed paths before comparing a canceled deferred batch's complete graph.
     *
     * Ordinary changes need no full copy; equal candidates still verify aliases and descriptors.
     */
    private pendingPatchesUnchanged(): boolean {
        if (this.pendingPatches.length < 2) return false;
        const current = this.carburetor.getData();
        for (const patch of this.pendingPatches) {
            let before: unknown = this.baseline;
            let after: unknown = current;
            for (const key of patch.segments) {
                const oldField = before !== null && typeof before === 'object'
                    ? Object.getOwnPropertyDescriptor(before, key) : undefined;
                const newField = after !== null && typeof after === 'object'
                    ? Object.getOwnPropertyDescriptor(after, key) : undefined;
                if ((oldField === undefined) !== (newField === undefined)) return false;
                if (oldField === undefined || newField === undefined) {
                    before = undefined;
                    after = undefined;
                    break;
                }
                if (!('value' in oldField) || !('value' in newField)) return false;
                before = oldField.value;
                after = newField.value;
            }
            if (!sameHistoryGraph(before, after)) return false;
        }
        return sameHistoryGraph(this.baseline, this.capture().state);
    }

    /**
     * Turns the writes collected since the last flush into one entry.
     *
     * Patches when every one of them was describable; a full snapshot either side of the change
     * otherwise. The empty-patch case is defensive — every write path this class knows of reports
     * one or the other — so a gap in that coverage still falls back to a safe, larger entry.
     */
    protected buildEntry(): THistoryEntry<T> | undefined {
        if (this.pendingOpaque || this.pendingPatches.length === 0) {
            const before = this.baseline;
            const beforeExotic = this.baselineContainsExotic;
            const beforeLockedArray = this.baselineContainsLockedArray;
            const capture = this.capture();
            this.baseline = capture.state;
            this.baselineContainsExotic = capture.exotic;
            this.baselineContainsLockedArray = capture.lockedArray;
            if (sameHistoryGraph(before, capture.state)) {
                // A conservative opaque publication need not insert an undoable step.
                this.baselineShared = false;
                return undefined;
            }
            this.baselineShared = true;
            return {
                kind: 'snapshot', before, after: capture.state,
                beforeExotic, afterExotic: capture.exotic,
                replaceOnReplay: this.pendingLengthLock ||
                    (!beforeExotic && !capture.exotic &&
                        (beforeLockedArray || capture.lockedArray)),
            };
        }

        if (this.pendingPatchesUnchanged()) return undefined;
        const patches = this.pendingPatches;
        if (this.baselineShared) {
            this.baseline = own(this.baseline);
            this.baselineShared = false;
        }

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
            this.replayContainsExotic = entry.kind === 'snapshot'
                ? (inverse ? entry.beforeExotic : entry.afterExotic)
                : false;
            this.replayReplaceLockedArray = entry.kind === 'snapshot' && entry.replaceOnReplay;
            this.replayTarget = state;

            // Only a publication from this exact restore argument suppresses its own entry;
            // an abort listener's replacement, or a write by a replay subscriber, is fresh.
            this.carburetor.restore(state);
            if (this.applying && this.ownedReplay) {
                // The source deferred replay's publication. Reconcile its actual wire state
                // now, before any later subscriber can publish on top of it.
                const capture = this.capture();
                this.baseline = capture.state;
                this.baselineContainsExotic = capture.exotic;
                this.baselineContainsLockedArray = capture.lockedArray;
                this.baselineShared = false;
                this.skipReplay = this.carburetor.getVersion() !== beforeVersion;
            } else if (this.applying) {
                // A superseding callback published before the restore could install anything.
                // Its pending patches still need the old baseline at deferred delivery.
                this.skipReplay = false;
            }
        } finally {
            this.replayTarget = undefined;
            this.ownedReplay = false;
            this.replayContainsExotic = false;
            this.replayReplaceLockedArray = false;
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
