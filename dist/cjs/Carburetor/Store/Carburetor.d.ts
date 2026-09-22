import { IDict, TDisposer, TReadonly, TSubscriber } from "../Models/Base.js";
import { TPath, TPathRecorder, TPathSet, TAliasLedger } from "../Models/Paths.js";
import { ICarburetor, INotifiable, ISubscribeOptions, IUpdateScheduler } from "../Models/Store.js";
import { SubscriberIndex } from "./Paths/SubscriberIndex.js";
interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}
export declare class Carburetor<T extends object> implements ICarburetor<T>, INotifiable {
    protected data: T;
    protected scheduler: IUpdateScheduler;
    protected subscribers: IDict<ISubscriberRecord>;
    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex;
    /** Development alias ledger handed to both proxies; undefined outside development. */
    protected aliases: TAliasLedger;
    protected uid: string;
    protected version: number;
    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet;
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean;
    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean;
    protected draftProxy: T | undefined;
    /** Takes the initial state and the policy that decides when subscribers are woken. */
    constructor(data: T, scheduler?: IUpdateScheduler);
    /** The store's identity, which subscriptions and dev tooling key on. */
    getUID: () => string;
    /**
     * The write counter, bumped on every emit.
     *
     * A component compares it between render and commit to notice a write that landed in
     * between, which would otherwise leave it subscribed to stale paths.
     */
    getVersion: () => number;
    /** The state as it is, untracked: reads through it subscribe to nothing. */
    getData: () => T;
    /** The state behind a read proxy that reports every path the caller touches. */
    read: (record: TPathRecorder) => TReadonly<T>;
    /** Replaces the whole state and wakes everyone: no path survives a root swap. */
    setData: (data: T) => T;
    /** A deep copy of the state, detached from further writes. */
    snapshot: () => T;
    /** Installs a snapshot as the current state, copying it so the caller keeps its own. */
    restore: (data: T) => void;
    /** The type-erased half of the snapshot bridge, for callers that do not know `T`. */
    toJSON: () => unknown;
    /** The type-erased half of `restore`; the cast is the caller's promise about the shape. */
    fromJSON: (value: unknown) => void;
    /** Registers a subscriber, returning the id it is cancelled and rescheduled by. */
    subscribe: (callback: TSubscriber, options?: ISubscribeOptions) => string;
    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    unsubscribe: (id: string) => void;
    /** Subscribes outside React — for persistence, logging, analytics. */
    watch: (reads: TPathSet, callback: TSubscriber) => TDisposer;
    /** Called by the batch coordinator when a transaction closes. */
    notifyWrites: (writes: TPathSet) => void;
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
    protected update: (mutate: (draft: T) => void) => void;
    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon: () => void;
    /** Marks draft as used and arms the development check for a write that never published. */
    protected touchDraft: () => void;
    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    protected recordWrite: (path: TPath) => void;
    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged: () => void;
    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit: () => void;
    /** Publishes the writes recorded so far, alone or as part of an open transaction. */
    protected emitUpdate: () => void;
}
export {};
