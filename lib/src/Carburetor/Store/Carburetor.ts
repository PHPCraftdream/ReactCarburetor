import {IDict, TDisposer, TReadonly, TSubscriber} from "@/Carburetor/Models/Base";
import {TPath, TPathRecorder, TPathSet, TAliasLedger} from "@/Carburetor/Models/Paths";
import {ICarburetor, INotifiable, ISubscribeOptions, IUpdateScheduler} from "@/Carburetor/Models/Store";
import {deepClone} from "./Utils/deepClone";
import {SubscriberIndex} from "./Paths/SubscriberIndex";
import {WILDCARD_PATH} from "./Paths/WildcardPath";
import {syncUpdateScheduler} from "./Scheduling/SyncUpdateSchedulerInstance";
import {updateWave} from "./Scheduling/UpdateWaveInstance";
import {createReadProxy} from "./Tracking/createReadProxy";
import {createWriteProxy} from "./Tracking/createWriteProxy";
import {createAliasLedger} from "./Tracking/AliasLedger";
import {isTrackable} from "./Tracking/isTrackable";
import {updateBatch} from "./Transaction/UpdateBatchInstance";
import {getUid} from "./Utils/getUid";
import {diagnostics} from "./Diagnostics/DiagnosticsInstance";

// Declared locally rather than through @types/node: bundlers substitute this exact member
// expression at build time, which is what lets the guarded blocks below be dropped whole.
declare const process: {env: {NODE_ENV?: string}} | undefined;

interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}

export class Carburetor<T extends object> implements ICarburetor<T>, INotifiable {
    /** The subscriber records the index points at: delivery schedules the callback it finds here. */
    protected subscribers: IDict<ISubscriberRecord> = {};

    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex = new SubscriberIndex();

    /** Development alias ledger handed to both proxies; undefined outside development. */
    protected aliases: TAliasLedger = createAliasLedger();

    /** The store's identity, minted once at construction. */
    protected uid: string = getUid();
    /** The counter getVersion() returns; bumped by every emitUpdate. */
    protected version: number = 0;

    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet = new Set<TPath>();

    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean = false;

    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean = false;
    /** The write proxy behind draft, memoized across accesses and dropped by setData. */
    protected draftProxy: T | undefined = undefined;

    /**
     * Takes the initial state and the policy that decides when subscribers are woken.
     *
     * @param data - the state the store wraps; reads go through read(), writes through
     * draft, and setData() swaps it wholesale.
     * @param scheduler - decides when a matched subscriber's callback actually runs;
     * defaults to immediate, synchronous delivery.
     */
    constructor(protected data: T, protected scheduler: IUpdateScheduler = syncUpdateScheduler) {
    }

    /** The store's identity, which subscriptions and dev tooling key on. */
    public getUID = (): string => {
        return this.uid;
    };

    /**
     * The write counter, bumped on every emit.
     *
     * A component compares it between render and commit to notice a write that landed in
     * between, which would otherwise leave it subscribed to stale paths.
     */
    public getVersion = (): number => {
        return this.version;
    };

    /** The state as it is, untracked: reads through it subscribe to nothing. */
    public getData = (): T => {
        return this.data;
    };

    /** The state behind a read proxy that reports every path the caller touches. */
    public read = (record: TPathRecorder): TReadonly<T> => {
        const data: unknown = this.data;

        if (!isTrackable(data)) {
            record(WILDCARD_PATH);

            return this.data as unknown as TReadonly<T>;
        }

        return createReadProxy(data, record, '', this.aliases) as unknown as TReadonly<T>;
    };

    /** Replaces the whole state and wakes everyone: no path survives a root swap. */
    public setData = (data: T): T => {
        this.data = data;
        this.draftProxy = undefined;
        this.writes.add(WILDCARD_PATH);

        this.emitUpdate();

        return data;
    };

    /** A deep copy of the state, detached from further writes. */
    public snapshot = (): T => {
        return deepClone(this.data);
    };

    /** Installs a snapshot as the current state, copying it so the caller keeps its own. */
    public restore = (data: T): void => {
        this.setData(deepClone(data));
    };

    /** The type-erased half of the snapshot bridge, for callers that do not know `T`. */
    public toJSON = (): unknown => {
        return this.snapshot();
    };

    /** The type-erased half of `restore`; the cast is the caller's promise about the shape. */
    public fromJSON = (value: unknown): void => {
        this.restore(value as T);
    };

    /**
     * Registers a subscriber, returning the id it is cancelled and rescheduled by.
     *
     * @param callback - called with no arguments per matching write; it must re-read to
     * see fresh values, and a throw costs it only a development-mode complaint.
     * @param options - the id to reuse across re-subscribes and the paths to watch;
     * without `reads` the subscription matches every write.
     */
    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        const id = options.id || getUid();

        // A subscription without a path set is a subscription to everything: coarse,
        // but no update can be missed.
        const reads = options.reads ? new Set<TPath>(options.reads) : new Set<TPath>([WILDCARD_PATH]);

        this.subscribers[id] = {callback, reads};
        this.subscriberIndex.add(id, reads);

        return id;
    };

    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    public unsubscribe = (id: string) => {
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    };

    /**
     * Subscribes outside React — for persistence, logging, analytics.
     *
     * @param reads - the paths the callback cares about; a set holding the wildcard path
     * hears about every write.
     * @param callback - run per matching write with no arguments; the returned disposer
     * unsubscribes it.
     */
    public watch = (reads: TPathSet, callback: TSubscriber): TDisposer => {
        const id = this.subscribe(callback, {reads});

        return () => {
            this.unsubscribe(id);
        };
    };

    /** Called by the batch coordinator when a transaction closes. */
    public notifyWrites = (writes: TPathSet): void => {
        // Delivering one write is one wave: whatever its delivery cascades into settles
        // before the wave ends, so outer observers only ever hear settled values.
        updateWave.begin();

        try {
            // The write has already landed when delivery runs, so one throwing subscriber
            // must not cost the subscribers after it their notification: each delivery is
            // isolated, and the failures are reported once the pass finishes rather than
            // re-thrown into whoever made the write.
            const failures: unknown[] = [];

            this.subscriberIndex.match(writes).forEach((id: string) => {
                // A subscriber may have unsubscribed while this batch was being delivered.
                const record = this.subscribers[id];

                if (record) {
                    try {
                        this.scheduler.schedule(id, record.callback);
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                }
            });

            failures.forEach((error: unknown) => {
                if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                    diagnostics.report(
                        'a subscriber threw while a write was delivered: ' +
                        (error instanceof Error ? error.message : String(error)) +
                        '. The write had already landed, so the remaining subscribers were notified anyway.'
                    );
                }
            });
        } finally {
            updateWave.end();
        }
    };

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
    protected get draft(): T {
        const data: unknown = this.data;

        this.touchDraft();

        if (!isTrackable(data)) {
            // The store itself cannot be wrapped (a Map or a class instance as the root),
            // so a mutation through this reference is invisible. There is no path to be
            // precise about either, which makes the whole store the honest answer.
            this.recordWrite(WILDCARD_PATH);

            return this.data;
        }

        if (!this.draftProxy) {
            this.draftProxy = createWriteProxy(data, this.recordWrite, '', this.aliases) as T;
        }

        return this.draftProxy;
    }

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
    protected update = (mutate: (draft: T) => void): void => {
        let result: unknown;

        try {
            result = mutate(this.draft);
        } finally {
            this.emitUpdate();
        }

        // An async callback is accepted by a void-returning signature, and then everything it
        // writes after the first await lands in the data long after this emitUpdate has run.
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            if (result instanceof Promise) {
                diagnostics.report(
                    'update(mutate) published before the mutation finished: the callback returned ' +
                    'a promise, so writes made after its first await wake nobody. Keep the ' +
                    'callback synchronous and publish after the await instead.'
                );
            }
        }
    };

    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon = (): void => {
        this.pendingEmit = true;

        queueMicrotask(() => {
            this.pendingEmit = false;
            this.emitUpdate();
        });
    };

    /** Marks draft as used and arms the development check for a write that never published. */
    protected touchDraft = (): void => {
        if (this.draftTouched) {
            return;
        }

        this.draftTouched = true;

        // The message lives inside the guard, not in a method of its own: a class member
        // stays reachable whatever the branch does, so its string would survive into a
        // production bundle.
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            queueMicrotask(() => {
                if (!this.draftTouched || this.pendingEmit) {
                    return;
                }

                diagnostics.report(
                    'a write went through draft, but emitUpdate() was never called, so no ' +
                    'subscriber was notified. Prefer this.update(draft => ...), which does both.'
                );
            });
        }
    };

    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    protected recordWrite = (path: TPath) => {
        this.writes.add(path);
    };

    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged = (): void => {
        this.recordWrite(WILDCARD_PATH);
    };

    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit = () => {

    };

    /** Publishes the writes recorded so far, alone or as part of an open transaction. */
    protected emitUpdate = () => {
        this.preEmit();

        const changed: TPathSet | undefined = this.writes.size > 0 ? new Set<TPath>(this.writes) : undefined;
        const touched = this.draftTouched;

        this.writes.clear();
        this.draftTouched = false;

        // Draft was used, but no value actually changed — there is nobody to wake.
        if (!changed && touched) {
            return;
        }

        // Writes bypassed draft: the changed paths are unknown, so treat everything as changed.
        const writes = changed || new Set<TPath>([WILDCARD_PATH]);
        this.version++;

        if (updateBatch.isActive()) {
            updateBatch.add(this, writes);

            return;
        }

        this.notifyWrites(writes);
    };
}
