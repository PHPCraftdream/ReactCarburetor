import {TDisposer} from "@/Carburetor/Models/Base";
import {
    IStatePublication, IWritePatch, IPatchObserver, PATCH_ARRAY_LENGTH_LOCK,
    PATCH_KEY_ORDER_CHANGE, PATCH_OPAQUE, TPatchRecorder,
} from "@/Carburetor/Models/Paths";
import {ICarburetor, IPatchSource} from "@/Carburetor/Models/Store";
import {IHistoryOptions} from "@/Carburetor/Models/Tooling";
import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";
import {IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {applyPatchesEntryOnDraft} from "./Graph/replayPatchesOnDraft";
import {foldDependentPatch} from './Graph/foldDependentPatch';
import {preflightOwnedPatches} from "./Graph/canInstallOwnedPatch";
import {cloneOwnedGraph as own} from "@/Carburetor/Store/Utils/Graph/cloneOwnedGraph";
import {IReplayAttempt} from './Graph/IReplayAttempt';
import {sameHistoryGraph} from "./Graph/sameHistoryGraph";
import {isSafeScalarPatch} from './Graph/isSafeScalarPatch';
import {sameExistingScalarPath} from './Graph/sameExistingScalarPath';
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
    /** Structural transitions may require adopting an owned endpoint instead of patching a draft. */
    replaceOnReplay: boolean;
}

type THistoryEntry<T> = IPatchesEntry | ISnapshotEntry<T>;

/** The private state the draft replay drives; structurally this class's own fields. */
type THistoryReplayHost<T extends object> = Parameters<typeof applyPatchesEntryOnDraft<T>>[0];

/**
 * Undo/redo for a carburetor, built on patches (R16-07). Every change is recorded, except the
 * ones this class applies itself — otherwise undo would keep re-recording its own work.
 *
 * Cost: O(changed values) per describable change and O(patches) per undo/redo of a describable
 * entry — a plain patches entry on the base store replays through the draft, not whole-state
 * copies; snapshot entries and `restore()`-overriding stores still replay at O(state). Opaque
 * changes need owned before/after states so native mutations cannot rewrite history.
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
    /** Native baselines admit only proven open scalar patches. */
    private baselineContainsExotic: boolean;
    /** Locks in the owned baseline persist unless a patch actually replaces a locked subtree. */
    private baselineContainsLockedArray: boolean;
    /** Readonly and non-configurable own fields need owned descriptor endpoints on replay. */
    private baselineContainsRestricted: boolean;
    /** The last snapshot endpoint may also be baseline until a patch needs to mutate it. */
    private baselineShared: boolean = false;
    /** The most entries `past` may hold; set from options at construction. */
    protected limit: number;
    /** The exact restore argument identifies history's installation, not nested user restores. */
    private replayTarget: T | undefined;
    /** Temporary owner presented while the source synchronously prepares this restore. */
    private replayOwner: object | undefined;
    /** One exact restore owner for custom producers whose publication callback carries no fact. */
    private pendingReplayOwner: object | undefined;
    /** Deferred facts retain the token; weak identity recognizes only this history's replays. */
    private readonly replayOwners: WeakSet<object> = new WeakSet<object>();
    /** Scoped call context; undo/redo retain their own reference across nested calls. */
    private replayAttempt: IReplayAttempt | undefined;
    /** Publication ownership survives deferred delivery after the initiating call returns. */
    private readonly replayAttempts: WeakMap<object, IReplayAttempt> = new WeakMap();
    /** The selected replay endpoint's graph classification. */
    private replayContainsExotic: boolean = false;
    /** Structural replay adopts its owned plain graph to preserve key order and locked descriptors. */
    private replayReplaceOnReplay: boolean = false;
    /** Detaches both streams; disconnect() runs it to stop recording. */
    protected dispose: TDisposer;
    /** Patches collected since the last flush; turned into an entry by record(). */
    protected pendingPatches: IWritePatch[] = [];
    /** Whether the pending change contains a write the proxy could not describe. */
    protected pendingOpaque: boolean = false;
    /** The pending publication requires adoption of the exact owned endpoint on replay. */
    private pendingOwnedReplay: boolean = false;

    /** One observer for mutation patches, the closed publication boundary and exact replay ownership. */
    private readonly observer: IPatchObserver = {
        patch: (patch: Parameters<TPatchRecorder>[0]): void => this.onPatch(patch),
        publication: (fact?: IStatePublication): void => this.record(fact),
        restoreClaim: (state: unknown) => {
            if (state !== this.replayTarget || this.replayOwner === undefined) return undefined;
            this.pendingReplayOwner = this.replayOwner;
            return {
                owner: this.replayOwner, representation: 'history-owned',
                adopt: this.replayContainsExotic || this.replayReplaceOnReplay,
            };
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
    constructor(
        protected carburetor: Pick<ICarburetor<T>, 'getData' | 'getVersion' | 'restore'> & IPatchSource &
            IInternalSubscriptionProtocol,
        options: IHistoryOptions = {}
    ) {
        if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
            throw new RangeError('CarburetorHistory: limit must be a positive safe integer');
        }
        this.limit = options.limit ?? 50;
        const capture = this.capture();
        this.baseline = capture.state;
        this.baselineContainsExotic = capture.exotic;
        this.baselineContainsLockedArray = capture.lockedArray;
        this.baselineContainsRestricted = capture.restricted;
        this.dispose = carburetor.attachPatchListener(this.observer);
    }

    /** Capture authoritative state and its native, array-lock, and restricted-field traits. */
    private capture(): {state: T; exotic: boolean; lockedArray: boolean; restricted: boolean} {
        let exotic = false;
        let lockedArray = false;
        let restricted = false;
        const classify = (trait: 'exotic' | 'lockedArray' | 'restricted'): void => {
            if (trait === 'exotic') exotic = true;
            else if (trait === 'lockedArray') lockedArray = true;
            else restricted = true;
        };
        const state = this.carburetor.captureHistory(
            <V>(value: V): V => own(value, classify)) as T;
        return {state, exotic, lockedArray, restricted};
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
        const attempt: IReplayAttempt = {owner: {}, started: false, refused: false, reconcile: undefined};
        try {
            this.applyAttempt(entry, true, attempt);
        } catch (error) {
            // Restore may fail before installation (e.g. a custom restore guard). A subscriber
            // that published a fresh branch during replay already owns the cursor instead.
            if ((this.carburetor.getVersion() === beforeVersion || attempt.refused)
                && (this.carburetor.getData() === beforeState || attempt.refused)
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
        const attempt: IReplayAttempt = {owner: {}, started: false, refused: false, reconcile: undefined};
        try {
            this.applyAttempt(entry, false, attempt);
        } catch (error) {
            if ((this.carburetor.getVersion() === beforeVersion || attempt.refused)
                && (this.carburetor.getData() === beforeState || attempt.refused)
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
        this.baselineContainsRestricted = capture.restricted;
        this.baselineShared = false;
        this.pendingPatches = [];
        this.pendingOpaque = false;
        this.pendingOwnedReplay = false;
        if (this.pendingReplayOwner !== undefined) this.replayAttempts.delete(this.pendingReplayOwner);
        this.pendingReplayOwner = undefined;
    }

    /** Stops watching the carburetor: nothing is recorded after this. */
    public disconnect(): void {
        this.dispose();
    }

    /** Collects a patch or opaque fallback until its publication boundary. */
    protected onPatch(patch: Parameters<TPatchRecorder>[0]): void {
        const attempt = this.pendingReplayOwner === undefined
            ? undefined : this.replayAttempts.get(this.pendingReplayOwner);
        if (typeof patch !== 'symbol' && attempt !== undefined) attempt.started = true;
        if (this.pendingReplayOwner !== undefined &&
            (this.replayTarget !== undefined || attempt !== undefined)) return;

        if (patch === PATCH_ARRAY_LENGTH_LOCK || patch === PATCH_KEY_ORDER_CHANGE) {
            this.pendingOpaque = true;
            this.pendingOwnedReplay = true;
            return;
        }
        if (patch === PATCH_OPAQUE) {
            this.pendingOpaque = true;
            return;
        }

        if (this.baselineContainsExotic && (this.baselineContainsLockedArray ||
            this.baselineContainsRestricted || !isSafeScalarPatch(this.baseline, patch))) {
            this.pendingOpaque = true; return;
        }

        if ((patch.previous === null || typeof patch.previous !== 'object') &&
            (patch.next === null || typeof patch.next !== 'object')) {
            if (!foldDependentPatch(this.pendingPatches, patch)) this.pendingPatches.push(patch);
            return;
        }

        let requiresOwnedEndpoint = false;
        let hasExoticEndpoint = false;
        const classify = (trait: 'exotic' | 'lockedArray' | 'restricted'): void => {
            if (trait === 'exotic') hasExoticEndpoint = true;
            if (trait === 'lockedArray' || trait === 'restricted') requiresOwnedEndpoint = true;
        };
        let ownedPatch: IWritePatch;
        try {
            const previous = patch.previousExists ? own(patch.previous, classify) : undefined;
            const next = patch.nextExists ? own(patch.next, classify) : undefined;
            ownedPatch = {
                segments: patch.segments, previous, next,
                previousExists: patch.previousExists, nextExists: patch.nextExists,
            };
        } catch {
            this.pendingOpaque = true;
            return;
        }
        if (requiresOwnedEndpoint || hasExoticEndpoint) {
            this.pendingOpaque = true;
            return;
        }
        if (!foldDependentPatch(this.pendingPatches, ownedPatch)) this.pendingPatches.push(ownedPatch);
    }

    /** Advances the owned mirror to the source's installed wire representation. */
    private reconcileBaseline(): void {
        const capture = this.capture();
        this.baseline = capture.state;
        this.baselineContainsExotic = capture.exotic;
        this.baselineContainsLockedArray = capture.lockedArray;
        this.baselineContainsRestricted = capture.restricted;
        this.baselineShared = false;
    }

    /** Flushes one closed publication, suppressing only this recorder's exact restore owner. */
    protected record(fact?: IStatePublication): void {
        if (fact?.origin === 'restore' && fact.representation === 'history-owned'
            && fact.owner !== undefined && this.replayOwners.has(fact.owner)) {
            if (this.pendingReplayOwner === fact.owner) this.pendingReplayOwner = undefined;
            const attempt = this.replayAttempts.get(fact.owner);
            // The draft replay already advanced the baseline by the same patches.
            if (attempt !== undefined) {
                attempt.reconcile?.();
                attempt.reconcile = undefined;
                this.replayAttempts.delete(fact.owner);
            } else this.reconcileBaseline();
            this.pendingPatches = [];
            this.pendingOpaque = false;
            this.pendingOwnedReplay = false;
            return;
        }
        if (this.pendingReplayOwner !== undefined) {
            const customReplay = fact === undefined
                && !this.pendingOpaque && this.pendingPatches.length === 0;
            const attempt = this.replayAttempts.get(this.pendingReplayOwner);
            if (attempt !== undefined && !attempt.started) attempt.reconcile?.();
            this.replayAttempts.delete(this.pendingReplayOwner);
            if (attempt !== undefined) attempt.reconcile = undefined;
            this.pendingReplayOwner = undefined;
            if (customReplay) {
                this.reconcileBaseline();
                this.pendingPatches = [];
                this.pendingOpaque = false;
                this.pendingOwnedReplay = false;
                return;
            }
            if (fact !== undefined) this.pendingOpaque = true;
        }

        const entry = this.buildEntry(fact);
        this.pendingPatches = [];
        this.pendingOpaque = false;
        this.pendingOwnedReplay = false;
        if (entry === undefined) return;
        this.past.push(entry);
        if (this.past.length > this.limit) {
            this.past.shift();
        }
        this.future = [];
    }

    /**
     * Proves a mutation-only batch canceled using only its existing primitive leaf paths.
     *
     * Undefined means a structural or capability boundary needs the full graph proof.
     */
    private pendingPrimitivePatchesUnchanged(fact?: IStatePublication): boolean | undefined {
        if (fact?.origin !== 'mutation' || this.pendingOpaque || this.pendingOwnedReplay ||
            this.pendingPatches.length < 2 ||
            this.baselineContainsLockedArray || this.baselineContainsRestricted) {
            return undefined;
        }

        for (const patch of this.pendingPatches) {
            const previousType = typeof patch.previous;
            const nextType = typeof patch.next;
            if (!patch.previousExists || !patch.nextExists || patch.segments.length === 0 ||
                (patch.previous !== null && (previousType === 'object' || previousType === 'function')) ||
                (patch.next !== null && (nextType === 'object' || nextType === 'function'))) {
                return undefined;
            }
        }

        const current = this.carburetor.getData();
        let unchanged = true;
        try {
            for (const patch of this.pendingPatches) {
                const equal = sameExistingScalarPath(
                    this.baseline, current, patch.segments, this.baselineContainsExotic);
                if (equal === undefined) return undefined;
                if (!equal) unchanged = false;
            }
        } catch {
            return undefined;
        }
        return unchanged;
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
    protected buildEntry(fact?: IStatePublication): THistoryEntry<T> | undefined {
        if (this.pendingOpaque || this.pendingPatches.length === 0 ||
            (this.baselineContainsExotic && fact !== undefined && fact.origin !== 'mutation') ||
            (fact !== undefined && fact.origin !== 'mutation' &&
                !((fact.origin === 'replacement' || fact.origin === 'restore') &&
                    fact.representation === 'public'))) {
            return this.buildSnapshotEntry();
        }

        const scalarCancellation = this.pendingPrimitivePatchesUnchanged(fact);
        if (scalarCancellation === true ||
            (scalarCancellation === undefined && this.pendingPatchesUnchanged())) return undefined;
        const patches = this.pendingPatches;
        let plainScalars = !this.baselineContainsRestricted && !this.baselineContainsLockedArray;
        if (plainScalars) {
            for (const patch of patches) {
                if ((patch.previous !== null && typeof patch.previous === 'object') ||
                    (patch.next !== null && typeof patch.next === 'object')) {
                    plainScalars = false;
                    break;
                }
            }
        }
        const preview = plainScalars ? undefined : preflightOwnedPatches(this.baseline, patches);
        if (preview === false) {
            this.pendingOwnedReplay = true;
            return this.buildSnapshotEntry();
        }
        if (preview) {
            this.baseline = preview as T;
        } else {
            if (this.baselineShared) this.baseline = own(this.baseline);
            for (const patch of patches) {
                installPatch(this.baseline as unknown as Record<string, unknown>, patch, false);
            }
        }
        this.baselineShared = false;
        return {kind: 'patches', patches};
    }

    /** Own both ends before any unsafe patch can modify a retained baseline endpoint. */
    private buildSnapshotEntry(): THistoryEntry<T> | undefined {
        const before = this.baseline;
        const beforeExotic = this.baselineContainsExotic;
        const beforeLockedArray = this.baselineContainsLockedArray;
        const capture = this.capture();
        this.baseline = capture.state;
        this.baselineContainsExotic = capture.exotic;
        this.baselineContainsLockedArray = capture.lockedArray;
        const beforeRestricted = this.baselineContainsRestricted;
        this.baselineContainsRestricted = capture.restricted;
        if (sameHistoryGraph(before, capture.state)) {
            // A conservative opaque publication need not insert an undoable step.
            this.baselineShared = false;
            return undefined;
        }
        this.baselineShared = !capture.exotic;
        if (capture.exotic) this.baseline = own(capture.state);
        return {
            kind: 'snapshot', before, after: capture.state,
            beforeExotic, afterExotic: capture.exotic,
            replaceOnReplay: this.pendingOwnedReplay || beforeRestricted || capture.restricted ||
                (!beforeExotic && !capture.exotic &&
                    (beforeLockedArray || capture.lockedArray)),
        };
    }

    /** Keeps protected apply overrides intact while isolating each call's rollback verdict.
     *
     * @param entry - the selected history entry.
     * @param inverse - whether this call undoes the entry.
     * @param attempt - this call's retained installation verdict.
     */
    private applyAttempt(entry: THistoryEntry<T>, inverse: boolean, attempt: IReplayAttempt): void {
        const previous = this.replayAttempt;
        this.replayAttempt = attempt;
        try { this.apply(entry, inverse); }
        finally { this.replayAttempt = previous; }
    }

    /**
     * Installs `entry` without recording the installation itself, keeping `baseline` in step so
     * a later opaque entry still gets an exact "before".
     *
     * A plain patches entry on the base store replays through the draft at O(patches)
     * (R34-03); snapshot entries, restricted baselines and stores overriding `restore()` (a
     * `ResourceCache`, for one) go through `restore()` as they always have.
     *
     * @param entry - the entry to install.
     * @param inverse - true undoes `entry` (patches in reverse, or its `before`); false redoes it.
     */
    protected apply(entry: THistoryEntry<T>, inverse: boolean): void {
        const attempt = this.replayAttempt ?? {owner: {}, started: false, refused: false, reconcile: undefined};
        if (entry.kind === 'patches' &&
            applyPatchesEntryOnDraft(this as unknown as THistoryReplayHost<T>, entry.patches, inverse, attempt)) {
            return;
        }
        const state = entry.kind === 'snapshot'
            ? own(inverse ? entry.before : entry.after)
            : this.reconstruct(entry.patches, inverse);
        this.replayContainsExotic = entry.kind === 'snapshot'
            ? (inverse ? entry.beforeExotic : entry.afterExotic)
            : this.baselineContainsExotic;
        this.replayReplaceOnReplay = entry.kind === 'snapshot'
            ? entry.replaceOnReplay : this.baselineContainsRestricted;
        this.replayTarget = state;
        const owner = attempt.owner;
        this.replayOwner = owner;
        this.replayOwners.add(owner);

        let restored = false;
        try {
            // A callback write is a separate mutation fact; only this root's owner is suppressed.
            this.carburetor.restore(state);
            restored = true;
        } finally {
            if (this.pendingReplayOwner === owner) {
                if (restored) this.reconcileBaseline();
                else this.pendingReplayOwner = undefined;
            }
            this.replayTarget = undefined;
            this.replayOwner = undefined;
            this.replayContainsExotic = false;
            this.replayReplaceOnReplay = false;
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
