import { IDict, TDisposer, TReadonly, TSubscriber } from "../Models/Base.mjs";
import { TPath, TPathRecorder, TPathSet, TAliasLedger, TPatchPort, TPatchRecorder } from "../Models/Paths.mjs";
import { ICarburetor, INotifiable, IPatchSource, ISubscribeOptions, IUpdateScheduler, TSelector } from "../Models/Store.mjs";
import { SubscriberIndex } from "./Paths/SubscriberIndex.mjs";
import { WriteLog } from "./Paths/WriteLog.mjs";
interface ISubscriberRecord {
    callback: TSubscriber;
}
export declare class Carburetor<T extends object> implements ICarburetor<T>, INotifiable, IPatchSource {
    protected data: T;
    protected scheduler: IUpdateScheduler;
    /** The subscriber records the index points at: delivery schedules the callback it finds here. */
    protected subscribers: IDict<ISubscriberRecord>;
    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex;
    /** Development alias ledger handed to both proxies; undefined outside development. */
    protected aliases: TAliasLedger;
    /** The currently attached patch listener, if any; shared with the write proxy tree (R16-07). */
    protected patchPort: TPatchPort;
    /** The store's identity, minted once at construction. */
    protected uid: string;
    /** The counter getVersion() returns; bumped by every emitUpdate. */
    protected version: number;
    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet;
    /** Which paths recent emits touched, bounded and watermarked; feeds the commit drift check (R16-05). */
    protected writeLog: WriteLog;
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean;
    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean;
    /** The write proxy behind draft, memoized across accesses and dropped by setData. */
    protected draftProxy: T | undefined;
    /** Bound once for `createWriteProxy`, called detached from `this`; forwards to the overridable `recordWrite`. */
    private readonly writeRecorder;
    /**
     * Takes the initial state and the policy that decides when subscribers are woken.
     *
     * @param data - the state the store wraps; reads go through read(), writes through
     * draft, and setData() swaps it wholesale.
     * @param scheduler - decides when a matched subscriber's callback actually runs;
     * defaults to immediate, synchronous delivery.
     */
    constructor(data: T, scheduler?: IUpdateScheduler);
    /**
     * The store's identity, which subscriptions and dev tooling key on.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it.
     */
    getUID(): string;
    /**
     * The write counter, bumped on every emit.
     *
     * A component compares it between render and commit to notice a write that landed in
     * between, which would otherwise leave it subscribed to stale paths.
     */
    getVersion(): number;
    /**
     * The path-precise form of the drift check above: whether a write since `baselineVersion`
     * could concern `reads`, per the write log.
     *
     * Falls back to `true` once the log cannot answer for that baseline — see
     * `WriteLog.matches`. Optional on the subscription surface so a source with no such log (a
     * computed) keeps today's coarse "the version moved" behaviour.
     *
     * @param baselineVersion - the version a render's read set was captured at
     * @param reads - the paths that read set touched
     */
    hasDriftSince(baselineVersion: number, reads: ReadonlySet<TPath>): boolean;
    /** The state as it is, untracked: reads through it subscribe to nothing. */
    getData(): T;
    /** The state behind a read proxy that reports every path the caller touches. */
    read(record: TPathRecorder): TReadonly<T>;
    /**
     * Replaces the whole state, keeping `getData() === data` afterwards.
     *
     * Wakes exactly the readers of what changed (R16-02): the previous and next roots are
     * diffed instead of the wildcard, unless the root changed kind or is not trackable, where
     * nothing survives a root swap and every subscriber wakes, as before.
     *
     * A component keyed on data identity (`buildTrackedView`, the `connect()` facade, the
     * interop root view) rebuilds its view lazily on its next render regardless of whether it
     * was woken — one that was not woken kept showing correct output, since none of its leaves
     * changed.
     */
    setData(data: T): T;
    /** A deep copy of the state, detached from further writes. */
    snapshot(): T;
    /**
     * Installs a snapshot as the current state, without adopting or mutating the caller's copy.
     *
     * Applies the difference into the live tree through draft (R16-02): only the values it
     * actually assigns are cloned, so an untouched branch keeps its old identity and only the
     * paths that changed are announced. Falls back to a wholesale, diffed swap — see setData() —
     * when the root itself changed kind, is not trackable, or the walk crosses
     * DIFF_PATH_THRESHOLD; going through draft key by key would cost more than it saves there.
     *
     * @param data - the snapshot to install; read but never mutated or kept by reference.
     */
    restore(data: T): void;
    /** The type-erased half of the snapshot bridge, for callers that do not know `T`. */
    toJSON(): unknown;
    /**
     * The type-erased half of `setData`: adopts `value` directly, diffed the same way (R16-02).
     *
     * Unlike `restore`, which copies to protect a snapshot the caller may reuse, `value` here is
     * expected to be freshly parsed JSON the caller does not keep, so no second copy is made
     * (R16-09).
     *
     * @param value - the parsed state to install; the cast is the caller's promise about the
     * shape, and the store keeps this exact object as `getData()`'s answer.
     */
    fromJSON(value: unknown): void;
    /**
     * Registers a subscriber, returning the id it is cancelled and rescheduled by.
     *
     * `options.reads` is copied: the public contract is `ReadonlySet<string>`, and a copy is
     * what makes "changes after subscribing do not affect the subscription" actually true,
     * instead of true only by convention. An internal caller that already holds the only
     * reference to a fresh Set — `transferReads()` — is exempted from the copy and handed
     * over by reference instead, since `extend()` needs the concrete Set to grow in place.
     *
     * @param callback - called with no arguments per matching write; it must re-read to
     * see fresh values, and a throw costs it only a development-mode complaint.
     * @param options - the id to reuse across re-subscribes and the paths to watch;
     * without `reads` the subscription matches every write.
     */
    subscribe(callback: TSubscriber, options?: ISubscribeOptions): string;
    /**
     * Adds one path to an already-registered subscription, without copying or re-filing
     * the rest of its read set — the incremental sibling of `subscribe`, for a caller
     * that discovers one more path after the subscription already exists.
     *
     * `reads` here is the same Set instance `subscriberIndex` files paths into, so filing
     * the path there is all that is needed to keep the subscriber's own read set current.
     *
     * @param id - the subscription to extend; an unknown id is left alone
     * @param path - the path to add to that subscription's read set
     */
    extend(id: string, path: TPath): void;
    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    unsubscribe(id: string): void;
    /**
     * IPatchSource (R16-07): replaces any previously attached listener; needs no tree rebuild.
     *
     * @param listener - called per describable write, or PATCH_OPAQUE otherwise.
     */
    attachPatchListener(listener: TPatchRecorder): TDisposer;
    /**
     * Runs `select` against a tracked read of the data, returning both the result and the
     * paths that produced it — the one place `watch()` reads, so its first call and every
     * later re-run go through the identical mechanism.
     */
    private runSelector;
    /**
     * Subscribes outside React — for persistence, logging, analytics — to a derived value
     * rather than to raw paths; see the interface doc for the fuller contract.
     *
     * Reads twice per matching write: once (isolated, by `notifyWrites`) to recompute
     * `select`, and — only when the fresh result differs from the previous one — the detach
     * that turns it into a value `onChange` and the next comparison can hold onto safely.
     * Re-registering the read set on every invocation, changed or not, is what keeps a
     * conditional selector's subscription following whichever branch it read last.
     *
     * @param select - reads the part of the data this subscription cares about
     * @param onChange - called with the fresh and previous selection when they differ
     */
    watch<R>(select: TSelector<T, R>, onChange: (next: R, previous: R) => void): TDisposer;
    /** Called by the batch coordinator when a transaction closes. */
    notifyWrites(writes: TPathSet): void;
    /**
     * Writes go through draft: changed paths are remembered, and only the subscribers
     * that read those paths get woken up.
     *
     * Mutating this.data directly also changes the state, but nothing records it —
     * getData() hands out the raw object, and a raw object cannot be observed after the
     * fact. On its own, such a write still wakes everyone: an emit with no recorded path
     * falls back to the whole store. Mixed with draft writes in the same emit, only the
     * recorded paths go out and the direct write wakes nobody — call markAllChanged()
     * to publish such a write deliberately.
     */
    protected get draft(): T;
    /**
     * Mutates and publishes in one step. Writing to `draft` and forgetting `emitUpdate()`
     * changes the data while nobody re-renders, which is why this is the recommended form.
     *
     * If mutate throws partway through, the writes it already made stay in the data —
     * the draft applies each one the moment it executes — so they are published anyway:
     * subscribers keep seeing the state as it is, and the error still reaches the caller.
     * Rolling the writes back would take a full snapshot of the state before every update,
     * too high a price on the hot path for a programming error.
     */
    protected update(mutate: (draft: T) => void): void;
    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon(): void;
    /** Marks draft as used and arms the development check for a write that never published. */
    protected touchDraft(): void;
    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    protected recordWrite(path: TPath): void;
    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged(): void;
    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit(): void;
    /** Publishes the writes recorded so far, alone or as part of an open transaction. */
    protected emitUpdate(): void;
}
export {};
