import {IDict, TDisposer, TReadonly, TSubscriber} from "@/Carburetor/Models/Base";
import {TPath, TPathRecorder, TPathSet, TAliasLedger} from "@/Carburetor/Models/Paths";
import {ICarburetor, INotifiable, ISubscribeOptions, IUpdateScheduler, TSelector} from "@/Carburetor/Models/Store";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {deepClone} from "./Utils/deepClone";
import {detachOpaque} from "./Utils/detachOpaque";
import {SubscriberIndex} from "./Paths/SubscriberIndex";
import {WriteLog} from "./Paths/WriteLog";
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

/**
 * `watch(select, onChange)`'s detach step: like `useCarburetorValue`'s own `detach`, a `Map`,
 * `Set` or `Date` is copied structurally (safe — `sameSelection` never trusts their identity
 * anyway, only their content matters for comparison), while a genuine class instance has no
 * generic safe copy and is rejected outright rather than handed to `onChange` still live.
 *
 * @param value - the selector's result to detach before handing it to `onChange`/storing it
 * for the next comparison
 */
const detachWatchSelection = <R>(value: R): R => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    return detachOpaque(value, (instance: object): void => {
        throw new Error(
            'watch() cannot select a live ' +
            (Object.getPrototypeOf(instance)?.constructor?.name || 'class') +
            ' instance because in-place changes cannot produce a safe comparison. Select the ' +
            'fields the callback needs, or return a plain object of those fields.'
        );
    }) as R;
};

// Declared locally rather than through @types/node: bundlers substitute this exact member
// expression at build time, which is what lets the guarded blocks below be dropped whole.
declare const process: {env: {NODE_ENV?: string}} | undefined;

interface ISubscriberRecord {
    callback: TSubscriber;
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

    /** Which paths recent emits touched, bounded and watermarked; feeds the commit drift check (R16-05). */
    protected writeLog: WriteLog = new WriteLog();

    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean = false;

    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean = false;
    /** The write proxy behind draft, memoized across accesses and dropped by setData. */
    protected draftProxy: T | undefined = undefined;

    /** Bound once for `createWriteProxy`, called detached from `this`; forwards to the overridable `recordWrite`. */
    private readonly writeRecorder = (path: TPath): void => this.recordWrite(path);

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

    /**
     * The store's identity, which subscriptions and dev tooling key on.
     *
     * A method, not an arrow field: every overridable member below is, so a subclass override
     * lands on the prototype instead of an own property shadowing it.
     */
    public getUID(): string {
        return this.uid;
    }

    /**
     * The write counter, bumped on every emit.
     *
     * A component compares it between render and commit to notice a write that landed in
     * between, which would otherwise leave it subscribed to stale paths.
     */
    public getVersion(): number {
        return this.version;
    }

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
    public hasDriftSince(baselineVersion: number, reads: ReadonlySet<TPath>): boolean {
        return this.writeLog.matches(baselineVersion, reads);
    }

    /** The state as it is, untracked: reads through it subscribe to nothing. */
    public getData(): T {
        return this.data;
    }

    /** The state behind a read proxy that reports every path the caller touches. */
    public read(record: TPathRecorder): TReadonly<T> {
        const data: unknown = this.data;

        if (!isTrackable(data)) {
            record(WILDCARD_PATH);

            return this.data as unknown as TReadonly<T>;
        }

        return createReadProxy(data, record, '', this.aliases) as unknown as TReadonly<T>;
    }

    /** Replaces the whole state and wakes everyone: no path survives a root swap. */
    public setData(data: T): T {
        this.data = data;
        this.draftProxy = undefined;
        this.writes.add(WILDCARD_PATH);

        this.emitUpdate();

        return data;
    }

    /** A deep copy of the state, detached from further writes. */
    public snapshot(): T {
        return deepClone(this.data);
    }

    /** Installs a snapshot as the current state, copying it so the caller keeps its own. */
    public restore(data: T): void {
        this.setData(deepClone(data));
    }

    /** The type-erased half of the snapshot bridge, for callers that do not know `T`. */
    public toJSON(): unknown {
        return this.snapshot();
    }

    /** The type-erased half of `restore`; the cast is the caller's promise about the shape. */
    public fromJSON(value: unknown): void {
        this.restore(value as T);
    }

    /**
     * Registers a subscriber, returning the id it is cancelled and rescheduled by.
     *
     * @param callback - called with no arguments per matching write; it must re-read to
     * see fresh values, and a throw costs it only a development-mode complaint.
     * @param options - the id to reuse across re-subscribes and the paths to watch;
     * without `reads` the subscription matches every write.
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = options.id || getUid();

        // Adopted, not copied: callers here (a component's committed read set, a computed's
        // own dependency.reads, watch()'s freshly built read set) never mutate it after handing
        // it over, and extend() relies on that — see addPath's own comment. No reads means
        // everything: coarse, but nothing is missed.
        //
        // options.reads is ReadonlySet<string> in the public contract — mutating it after
        // subscribing already has no effect (the index files it once, here), so the interface
        // says so — but the engine still needs the concrete Set instance underneath, since
        // extend() (and a computed's own dependency amend) mutate it in place afterward. Every
        // caller reaching this line, internal or public, hands over a real Set; the cast just
        // recovers that.
        const reads = (options.reads as TPathSet | undefined) || new Set<TPath>([WILDCARD_PATH]);

        this.subscribers[id] = {callback};
        this.subscriberIndex.add(id, reads);

        return id;
    }

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
    public extend(id: string, path: TPath): void {
        if (!(id in this.subscribers)) {
            return;
        }

        this.subscriberIndex.addPath(id, path);
    }

    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    public unsubscribe(id: string): void {
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    }

    /**
     * Runs `select` against a tracked read of the data, returning both the result and the
     * paths that produced it — the one place `watch()` reads, so its first call and every
     * later re-run go through the identical mechanism.
     */
    private runSelector<R>(select: TSelector<T, R>): {value: R; reads: TPathSet} {
        const reads = new Set<TPath>();
        const view = this.read((path: TPath) => reads.add(path));

        return {value: select(view), reads};
    }

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
    public watch<R>(select: TSelector<T, R>, onChange: (next: R, previous: R) => void): TDisposer {
        const id = getUid();
        const initial = this.runSelector(select);

        let previous: R = detachWatchSelection(initial.value);

        const callback = (): void => {
            const fresh = this.runSelector(select);
            const changed = !sameSelection(previous, fresh.value);

            // Re-filed unconditionally: a selector whose branch moved without moving its
            // result must still hand the subscription its new read set.
            this.subscribe(callback, {id, reads: fresh.reads});

            if (changed) {
                const next = detachWatchSelection(fresh.value);
                const last = previous;

                previous = next;
                onChange(next, last);
            }
        };

        this.subscribe(callback, {id, reads: initial.reads});

        return () => {
            this.unsubscribe(id);
        };
    }

    /** Called by the batch coordinator when a transaction closes. */
    public notifyWrites(writes: TPathSet): void {
        // Delivering one write is one wave: whatever its delivery cascades into settles
        // before the wave ends, so outer observers only ever hear settled values.
        updateWave.begin();

        try {
            // The write has already landed when delivery runs, so one throwing subscriber
            // must not cost the subscribers after it their notification: each delivery is
            // isolated, and the failures are reported once the pass finishes rather than
            // re-thrown into whoever made the write. Allocated only once something actually
            // throws — the overwhelming majority of deliveries never do.
            let failures: unknown[] | undefined;

            this.subscriberIndex.match(writes).forEach((id: string) => {
                // A subscriber may have unsubscribed while this batch was being delivered.
                const record = this.subscribers[id];

                if (record) {
                    try {
                        this.scheduler.schedule(id, record.callback);
                    } catch (error: unknown) {
                        (failures ??= []).push(error);
                    }
                }
            });

            failures?.forEach((error: unknown) => {
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
    }

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
            this.draftProxy = createWriteProxy(data, this.writeRecorder, '', this.aliases) as T;
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
    protected update(mutate: (draft: T) => void): void {
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
    }

    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon(): void {
        this.pendingEmit = true;

        queueMicrotask(() => {
            this.pendingEmit = false;
            this.emitUpdate();
        });
    }

    /** Marks draft as used and arms the development check for a write that never published. */
    protected touchDraft(): void {
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
    }

    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    protected recordWrite(path: TPath): void {
        this.writes.add(path);
    }

    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged(): void {
        this.recordWrite(WILDCARD_PATH);
    }

    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit(): void {

    }

    /** Publishes the writes recorded so far, alone or as part of an open transaction. */
    protected emitUpdate(): void {
        this.preEmit();

        const touched = this.draftTouched;
        // Handed off, not copied: a fresh Set takes over as this.writes, so the caller below
        // (notifyWrites, or the update batch) owns this one exclusively and may keep it as is.
        // An empty writes Set is never handed off anywhere, so it is reused as-is instead of
        // being replaced on every emit, including the (common) no-op ones.
        const changed: TPathSet | undefined = this.writes.size > 0 ? this.writes : undefined;

        if (changed) {
            this.writes = new Set<TPath>();
        }

        this.draftTouched = false;

        // Draft was used, but no value actually changed — there is nobody to wake.
        if (!changed && touched) {
            return;
        }

        // Writes bypassed draft: the changed paths are unknown, so treat everything as changed.
        const writes = changed || new Set<TPath>([WILDCARD_PATH]);
        this.version++;
        this.writeLog.record(this.version, writes);

        if (updateBatch.isActive()) {
            updateBatch.add(this, writes);

            return;
        }

        this.notifyWrites(writes);
    }
}
