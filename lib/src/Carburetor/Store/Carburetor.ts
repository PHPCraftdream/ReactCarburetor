import {IDict, TDisposer, TReadonly, TSubscriber} from "@/Carburetor/Models/Base";
import {
    IPatchObserver, IStateInstallation, IStatePublication, IStateRestoreClaim, PATCH_OPAQUE,
    STATE_MIXED_PUBLICATION, STATE_MUTATION_PUBLICATION, STATE_PUBLIC_REPLACEMENT, IWritePatch,
    TPath, TPathRecorder, TPathSet, TAliasLedger, TPatchPort,
} from "@/Carburetor/Models/Paths";
import {
    ICarburetor, ICarburetorEvents, ICarburetorOptions, IPatchSource, ISubscribeOptions,
    IUpdateScheduler, TSelector,
} from "@/Carburetor/Models/Store";
import {deepClone} from "./Utils/deepClone";
import {applyDiff} from "./Paths/Diff/applyDiff";
import {sameKind} from "./Paths/Diff/Kinds/sameKind";
import {SubscriberIndex} from "./Paths/SubscriberIndex";
import {deliveryCallback} from './Diagnostics/Internal/scheduleTrace';
import {WriteLog} from "./Paths/WriteLog";
import {WriteTargetLedger} from "./Utils/Graph/WriteTargetLedger";
import {TargetOwners} from "./Utils/Graph/TargetOwners";
import {WILDCARD_PATH} from "./Paths/WildcardPath";
import {syncUpdateScheduler} from "./Scheduling/SyncUpdateSchedulerInstance";
import {updateWave} from "./Scheduling/UpdateWaveInstance";
import {nativeStoreWriteEpoch} from "./Scheduling/nativeStoreWriteEpoch";
import {createReadProxy} from "./Tracking/createReadProxy";
import {createWriteProxy} from "./Tracking/createWriteProxy";
import {watchSelection} from "./Tracking/Observation/watchSelection";
import {createAliasLedger} from "./Tracking/Aliases/AliasLedger";
import {isTrackable} from "./Tracking/isTrackable";
import {PatchObserverRegistry} from "./Transaction/PatchObserverRegistry";
import {IStateInstallPort} from "./Transaction/Models";
import {installState} from "./Transaction/installState";
import {emitStoreUpdate} from "./Transaction/emitStoreUpdate";
import {replayPatchesOnPort} from "./Utils/Graph/replayPatchesOnPort";
import {getUid} from "./Utils/getUid";
import {IS_DEVELOPMENT} from "./Utils/DevelopmentFlag";
import {diagnostics} from "./Diagnostics/DiagnosticsInstance";
import {reportDeliveryFailure} from "./Diagnostics/reportDeliveryFailure";
import {warnIfAsyncMutate} from "./Diagnostics/warnIfAsyncMutate";
import {
    CARBURETOR_EXTEND, CARBURETOR_HAS_DRIFT, CARBURETOR_NOTIFY_WRITES, CARBURETOR_PATHS_SINCE,
    CARBURETOR_REPLAY_PATCHES, CARBURETOR_TARGETS_SINCE, CARBURETOR_TRACK_TARGETS,
    IInternalSubscriptionProtocol, ISubscriberRecord,
} from "./Utils/Models";
import {S} from "./Diagnostics/Internal/StoreIdentity";
import {StoreEvents} from "./Utils/Graph/Events/StoreEvents";
import {CARBURETOR_EVENT_TYPES} from "./Utils/Graph/Events/EventTypes";
import {updateBatch} from "./Transaction/UpdateBatchInstance";
import {READS_TRANSFER} from "./Paths/Markers/ReadsTransferBrand";
import {READS_RETAIN} from "@/Carburetor/Store/Paths/Markers/RetainDeliveryBrand";
import {storeLifecycle} from "@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle";
declare const process: {env: {NODE_ENV?: string}} | undefined;
export class Carburetor<T extends object, TEvents extends object = {}> implements
    ICarburetor<T>, IPatchSource, IInternalSubscriptionProtocol, ICarburetorEvents<TEvents> {
    /** Shared base-method identities; no registration record allocated per store. */
    private static readonly nativeStoreMethods = {
        getVersion: Carburetor.prototype.getVersion, emitUpdate: Carburetor.prototype.emitUpdate,
    };
    /** Type-only event witness; `declare` emits no runtime field or allocation. */
    declare public readonly [CARBURETOR_EVENT_TYPES]?: TEvents;
    /** Lazily created event listeners; absent until the first on(). */
    #eventHub?: StoreEvents<TEvents>;
    /** Set when event listeners are dropped by dispose(). */
    #disposed = false;
    /** Registered callbacks and their stable scheduler keys, indexed by public local id. */
    public [S.subscribers]: IDict<ISubscriberRecord> = Object.create(null);
    /** Distinguishes registrations created after an event selected its subscribers. */
    private [S.subscriptionGeneration] = 0;
    /** Finds subscribers writes concern without scanning them. */
    public [S.subscriberIndex]: SubscriberIndex = new SubscriberIndex();
    /** Development alias ledger handed to both proxies; undefined outside development. */
    public [S.aliases]: TAliasLedger = createAliasLedger();
    /** The currently attached patch listener, if any; shared with the write proxy tree. */
    public [S.patchPort]: TPatchPort = {};
    /** Lazily attached mutation/publication observers, shared by draft and restore paths. */
    public [S.patchObservers]: PatchObserverRegistry | undefined;
    /** The store's identity, minted once at construction. */
    private [S.uid]: string = getUid();
    /** The counter getVersion() returns; bumped by every emitUpdate. */
    private [S.version]: number = 0;
    /** Latest store version whose subscriptions have completed matching. */
    private [S.notifiedVersion] = 0;
    /** Maps a transferred read-set identity to its active subscription for constant-time drift answers. */
    private readonly [S.subscriptionByReads] = new WeakMap<TPathSet, ISubscriberRecord>();
    /** Paths changed since the last emitUpdate. */
    public [S.writes]: TPathSet = new Set<TPath>();
    /** The raw objects each pending write mutated, handed to the write log at emit. */
    public [S.writeTargets] = new WriteTargetLedger(false);
    /** Which paths recent emits touched, bounded and watermarked; feeds the commit drift check. */
    public [S.writeLog]: WriteLog = new WriteLog(undefined, false);
    /** Counts selection consumers that need write proofs. */
    private readonly [S.targetOwners] = new TargetOwners(
        this[S.writeTargets], this[S.writeLog], () => this[S.version]);
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    public [S.draftTouched]: boolean = false;
    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    public [S.pendingEmit]: boolean = false;
    /** Minted on the first development draft write; later checks reuse the same callback. */
    declare private [S.unpublishedDraftCheck]: (() => void) | undefined;
    /** The write proxy behind draft, memoized across accesses and dropped by setData. */
    public [S.draftProxy]: T | undefined = undefined;
    /** Whether a closed state publication is waiting for delivery. */
    private [S.publicationPending]: boolean = false;
    /** The transition fact coalesced until notifyWrites closes the batch. */
    private [S.pendingPublication]: IStatePublication | undefined;
    /** Exact root installation currently being applied through restore's draft diff. */
    private [S.activeInstallation]: IStateInstallation | undefined;
    /** Bound once: draft writes announce paths and their raw targets (createWriteProxy).
     *
     * @param path - the written path.
     * @param target - the raw object the mutation landed on, when known. */
    private readonly [S.writeRecorder] = (path: TPath, target?: object): void => {
        this[S.recordWrite](path); if (target !== undefined) this[S.writeTargets].add(path, target);
        const installation = this[S.activeInstallation];
        if (installation && (!this[S.publicationPending] || this[S.pendingPublication] !== installation)) {
            this[S.rememberPublication](installation);
        }
    };
    /** Authoritative root, independent of the subclass getter. */
    private [S.data]!: T;
    /** Delivery policy, independent of application fields. */
    private [S.scheduler]!: IUpdateScheduler;
    /**
     * Takes the initial state and the policy that decides when subscribers are woken.
     *
     * @param data - the state the store wraps; reads go through read(), writes through
     * draft, and setData() swaps it wholesale.
     * @param scheduler - either a scheduler itself (positional form) or an options object `{scheduler}`;
     * omitted means immediate delivery.
     */
    constructor(data: T, scheduler: IUpdateScheduler | ICarburetorOptions = syncUpdateScheduler) {
        const policy = 'schedule' in scheduler ? scheduler : scheduler.scheduler ?? syncUpdateScheduler;
        this[S.data] = data; this[S.scheduler] = policy;
        this[S.aliases]?.checkState(data, '');
        nativeStoreWriteEpoch.sources.set(this, Carburetor.nativeStoreMethods);
    }
    /** Emits one captured event to the listeners registered at this point.
     *
     * @param name - event name
     * @param payload - event payload
     */
    protected emit<K extends keyof TEvents>(name: K, payload: TEvents[K]): void {
        const delivery = this.#eventHub?.capture(name, payload);
        if (delivery) updateBatch.enqueueAfterFlush(delivery);
    }
    /** Registers a typed one-off event listener.
     *
     * @param name - event name
     * @param listener - callback receiving the event payload
     */
    public on<K extends keyof TEvents>(name: K, listener: (payload: TEvents[K]) => void): TDisposer {
        if (this.#disposed) return (): void => {};
        const hub = this.#eventHub ??= new StoreEvents<TEvents>();
        return hub.on(name, listener);
    }
    /** Dispose once; subscription owners still unsubscribe. */
    public dispose(): void {
        const subscribers = this[S.subscribers];
        storeLifecycle.dispose(this, [
            ...Object.keys(subscribers).map(id => (): void => this[S.scheduler].cancel(subscribers[id]!.schedulerKey)),
            (): void => this.cleanupEventListeners(), (): void => this.didDispose(),
        ]);
    }
    /** Aborted on disposal; allocated lazily. */
    protected get signal(): AbortSignal { return storeLifecycle.signal(this); }
    /** Schedule a task and cancel it when the store is disposed.
     *
     * @param ms - delay in milliseconds
     * @param task - task to invoke unless disposal cancels the timer
     */
    protected after(ms: number, task: () => void): TDisposer { return storeLifecycle.after(this, ms, task); }
    /** Subclass cleanup hook, called once after built-in resources are cancelled. */
    protected didDispose(): void {}
    /** Clears listeners and cancels already captured event deliveries. */
    private cleanupEventListeners(): void {
        this.#disposed = true; this.#eventHub?.dispose(); this.#eventHub = undefined;
    }
    /** Current raw state; the root is readonly, while mutations still require draft publication. */
    protected get data(): T { return this[S.data]; }
    /** Unique engine identity. */
    public getUID(): string { return this[S.uid]; }
    /**
     * The write counter, bumped on every emit. A component compares it between render and commit
     * to notice a write that landed in between, which would otherwise leave it subscribed to stale paths.
     */
    public getVersion(): number { return this[S.version]; }
    /** The paths written after `baselineVersion`; undefined once the write log cannot enumerate them. */
    public [CARBURETOR_PATHS_SINCE](baselineVersion: number): ReadonlyArray<TPath> | undefined {
        return this[S.writeLog].pathsSince(baselineVersion);
    }
    /** A selection consumer asks for write proofs until it calls the returned release. */
    public [CARBURETOR_TRACK_TARGETS](): () => void { return this[S.targetOwners].acquire(); }
    /** The raw mutation targets behind the paths written after `baselineVersion`. */
    public [CARBURETOR_TARGETS_SINCE](baselineVersion: number): ReadonlyMap<TPath, ReadonlySet<object>> | undefined {
        return this[S.writeLog].targetsSince(baselineVersion);
    }
    /**
     * The path-precise drift check: could a write since `baselineVersion` concern
     * `reads`? O(1) for a read set this store filed; otherwise the write log, which says `true`
     * once it cannot answer.
     *
     * @param baselineVersion - the version a render's read set was captured at
     * @param reads - the paths that read set touched
     */
    public [CARBURETOR_HAS_DRIFT](baselineVersion: number, reads: ReadonlySet<TPath>): boolean {
        const record = this[S.subscriptionByReads].get(reads as TPathSet);
        if (record && record.reads === reads && baselineVersion >= record.growthVersion
            && this[S.notifiedVersion] >= this[S.version]) {
            return record.matchedVersion > baselineVersion;
        }
        return this[S.writeLog].matches(baselineVersion, reads);
    }
    /**
     * History's draft replay of undo/redo patches; reached via the internal protocol.
     *
     * @param patches - the entry's patches, in recorded order
     * @param inverse - true installs `previous` in reverse; false installs `next`
     * @param installation - the replay owner's fact, kept on the closed publication
     */
    public [CARBURETOR_REPLAY_PATCHES](
        patches: readonly IWritePatch[], inverse: boolean, installation: IStateInstallation
    ): void {
        replayPatchesOnPort(this[S.port], () => this.draft, patches, inverse, installation);
    }
    /** The state as it is, untracked: reads through it subscribe to nothing. */
    public getData(): T {
        return this[S.data];
    }
    /** The state behind a read proxy that reports every path the caller touches. */
    public read(record: TPathRecorder): TReadonly<T> {
        const data: unknown = this[S.data];
        if (!isTrackable(data)) {
            record(WILDCARD_PATH);
            return this[S.data] as unknown as TReadonly<T>;
        }
        return createReadProxy(data, record, '', this[S.aliases]) as unknown as TReadonly<T>;
    }
    /** Adopts `data` verbatim through the shared install/commit/delivery boundary. */
    public setData(data: T): T { return this[S.commitState](data, STATE_PUBLIC_REPLACEMENT); }
    /**
     * Installs one prepared root, records topology and changed paths, then closes publication — the
     * one entry library subclasses use instead of coordinating data, proxies, aliases and emits.
     *
     * @param data - the already prepared root to install
     * @param installation - the transition's origin, owner, representation and delivery policy
     */
    public [S.commitState](data: T, installation: IStateInstallation = STATE_PUBLIC_REPLACEMENT): T {
        return installState(this[S.port], data, installation);
    }
    /** Symbol-keyed transaction view without an allocation on the write path. */
    private get [S.port](): IStateInstallPort<T> {
        return this as unknown as IStateInstallPort<T>;
    }
    /** Lets subclasses synchronize derived state before replacement notifications. */
    protected didSetData(): void {}
    /** Copies plain state while retaining native and class-instance references as documented. */
    public snapshot(): T {
        return deepClone(this[S.data]);
    }
    /** Owns the live graph for history: it is the authoritative raw state.
     * Internal engine protocol (history); not an extension point, no stability guarantee.
     *
     * Classes whose wire state differs from their live data must override this.
     *
     * @param own - detaches the live graph while preserving native/plain aliases
     */
    public captureHistory(own: <V>(value: V) => V): T {
        return own(this[S.data]);
    }
    /** Installs a detached snapshot with precise draft changes. A root kind change or an
     * oversized structural diff falls back to a whole-root replacement through setData().
     *
     * @param data - read but never mutated or retained as the live state.
     */
    public restore(data: T): void {
        const current: unknown = this[S.data];
        const claim: IStateRestoreClaim | undefined = this[S.patchObservers]?.claimRestore(data);
        const installation: IStateInstallation = claim
            ? {origin: 'restore', owner: claim.owner, representation: claim.representation}
            : {origin: 'restore', representation: 'public'};
        this[S.aliases]?.checkState(data, '');
        // An owned endpoint may need to keep aliases across plain/native branches intact.
        if (claim?.adopt) {
            this[S.commitState](data, installation);
            return;
        }
        if (!isTrackable(current) || !isTrackable(data) || !sameKind(current, data)) {
            this[S.commitState](deepClone(data), installation);
            return;
        }
        let applied: boolean;
        const previousInstallation = this[S.activeInstallation];
        this[S.activeInstallation] = installation;
        try {
            applied = applyDiff(
                this.draft as unknown as Record<string, unknown>,
                current as Record<string, unknown>,
                data as unknown as Record<string, unknown>
            );
        } catch (error) {
            this[S.activeInstallation] = previousInstallation;
            // Publish any already-applied writes, but preserve the mutation's original failure.
            try {
                this.emitUpdate(undefined, true);
            } catch {
                // The write observer failure is already the synchronous result of restore().
            }
            throw error;
        }
        this[S.activeInstallation] = previousInstallation;
        if (!applied) {
            installState(this[S.port], deepClone(data), installation, true);
            return;
        }
        this.emitUpdate(undefined, true);
    }
    /** Cancels one registration's scheduled updates and drops its read-set filing.
     *
     * @param record - the registration being replaced or removed. */
    private [S.retract](record: ISubscriberRecord): void {
        this[S.scheduler].cancel(record.schedulerKey);
        if (this[S.subscriptionByReads].get(record.reads) === record) this[S.subscriptionByReads].delete(record.reads);
    }
    /** The store's wire form: the live data as it stands, without a copy.
     *
     * Ordinary stores expose live data; classes with another wire form override it. A detached
     * copy is `snapshot()`.
     */
    public toJSON(): unknown {
        return this[S.data];
    }
    /**
     * The type-erased half of `setData`: adopts `value` directly, diffed the same way.
     * Unlike `restore`, it makes no copy: `value` is expected to be freshly parsed JSON the
     * caller does not keep.
     *
     * @param value - the parsed state to install; the cast is the caller's promise about the
     * shape, and the store keeps this exact object as `getData()`'s answer.
     */
    public fromJSON(value: unknown): void {
        this.setData(value as T);
    }
    /**
     * Registers a subscriber, returning its public, store-local id. Public read sets are copied;
     * fresh sets branded by `transferReads()` are adopted so `extend()` can grow them in place.
     *
     * @param callback - called on matching writes; failures do not stop other subscribers
     * @param options - optional local id and paths to watch (omitted reads match every write)
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = options.id || getUid();
        const given = options.reads;
        let reads: TPathSet;
        const transferred = given !== undefined
            && (options as {[READS_TRANSFER]?: unknown})[READS_TRANSFER] === given;
        if (given === undefined) {
            reads = new Set<TPath>([WILDCARD_PATH]);
        } else if (transferred) {
            reads = given as TPathSet;
        } else {
            reads = new Set<TPath>(given);
        }
        const previous = this[S.subscribers][id];
        const retained = previous && transferred
            && (options as {[READS_RETAIN]?: unknown})[READS_RETAIN] === true && previous.callback === callback;
        if (!retained && previous) this[S.retract](previous);
        const record = retained ? previous : {
            callback, schedulerKey: previous?.schedulerKey ?? getUid(),
            generation: ++this[S.subscriptionGeneration], matchedVersion: 0,
            growthVersion: this[S.version], reads,
        };
        if (retained) {
            record.growthVersion = this[S.version];
            if (record.reads !== reads && this[S.subscriptionByReads].get(record.reads) === record) {
                this[S.subscriptionByReads].delete(record.reads);
            }
            record.reads = reads;
        }
        this[S.subscribers][id] = record;
        this[S.subscriptionByReads].set(reads, record);
        this[S.subscriberIndex].add(id, reads);
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
    public [CARBURETOR_EXTEND](id: string, path: TPath): void {
        if (!Object.prototype.hasOwnProperty.call(this[S.subscribers], id)) {
            return;
        }
        this[S.subscriberIndex].addPath(id, path);
        const record = this[S.subscribers][id];
        if (record) {
            record.growthVersion = this[S.version];
            record.reads.add(path);
        }
    }
    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    public unsubscribe(id: string): void {
        const record = this[S.subscribers][id];
        if (record) {
            this[S.retract](record);
            this[S.subscriberIndex].remove(id);
            delete this[S.subscribers][id];
        }
    }
    /** Attaches one observer without displacing independent history recorders.
     * Internal engine protocol (patch observers); not an extension point, no stability guarantee. */
    public attachPatchListener(observer: IPatchObserver): TDisposer {
        const registry = this[S.patchObservers] ??= new PatchObserverRegistry(this[S.patchPort], this[S.scheduler]);
        return registry.attach(observer);
    }
    /** Subscribes to a selected value with a read set that follows conditional branches.
     *
     * @param select - computes the tracked selection.
     * @param onChange - receives changed detached selections.
     */
    public watch<R>(select: TSelector<T, R>,
        onChange: (next: TReadonly<R>, previous: TReadonly<R>) => void): TDisposer {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        return watchSelection(this, select, onChange);
    }
    /** Delivers one notification pass for a closed write set; called only via the internal
     * symbol protocol, never as a public method. */
    public [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void {
        if (storeLifecycle.isDisposed(this)) return;
        updateWave.begin();
        try {
            let failures: unknown[] | undefined;
            const generation = this[S.subscriptionGeneration];
            const matched = this[S.subscriberIndex].match(writes);
            const notifiedAt = this[S.version];
            matched.forEach((id: string) => {
                const record = this[S.subscribers][id];
                if (record && record.generation <= generation) record.matchedVersion = notifiedAt;
            });
            this[S.notifiedVersion] = Math.max(this[S.notifiedVersion], notifiedAt);
            const fact = this[S.publicationPending]
                ? this[S.pendingPublication] ?? STATE_MUTATION_PUBLICATION
                : STATE_MUTATION_PUBLICATION;
            this[S.publicationPending] = false;
            this[S.pendingPublication] = undefined;
            failures = this[S.patchObservers]?.publish(fact);
            matched.forEach((id: string) => {
                if (storeLifecycle.isDisposed(this)) return;
                const record = this[S.subscribers][id];
                if (record && record.generation <= generation) {
                    try {
                        let callback = record.callback;
                        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
                            && diagnostics.isTracing()) {
                            callback = deliveryCallback(true, id, this.getUID(), record, writes, notifiedAt,
                                () => this[S.subscribers][id]);
                        }
                        this[S.scheduler].schedule(record.schedulerKey, callback);
                    } catch (error: unknown) {
                        (failures ??= []).push(error);
                    }
                }
            });
            failures?.forEach(reportDeliveryFailure);
        } finally {
            updateWave.end();
        }
    }
    /**
     * Writes through draft record changed paths; matching subscribers are woken.
     * Raw-state writes are unobserved. Alone, an emit without recorded paths wakes all;
     * mixed with draft writes, only recorded paths wake. Use markAllChanged() to publish raw writes.
     */
    protected get draft(): T {
        const data: unknown = this[S.data];
        this[S.touchDraft]();
        if (!isTrackable(data)) {
            // The store itself cannot be wrapped (a Map or a class instance as the root),
            // so a mutation through this reference is invisible. There is no path to be
            // precise about either, which makes the whole store the honest answer.
            this[S.recordWrite](WILDCARD_PATH);
            this[S.patchPort].listener?.(PATCH_OPAQUE);
            return this[S.data];
        }
        if (!this[S.draftProxy]) {
            this[S.draftProxy] = createWriteProxy(
                data, this[S.writeRecorder], '', this[S.aliases], undefined, this[S.patchPort]
            ) as T;
        }
        return this[S.draftProxy]!;
    }
    /**
     * Mutates and publishes in one step: writing to `draft` and forgetting `emitUpdate()` changes
     * the data while nobody re-renders, which is why this is the recommended form.
     *
     * If mutate throws partway through, the writes it already made stay in the data (the draft
     * applies each at once) and are published anyway; the error still reaches the caller. Rolling
     * back would cost a full snapshot per update. Mutate may be a module-level function taking
     * `(draft, ...args)`. The name `update` is reserved: a subclass cannot declare it.
     *
     * @param mutate - writes to the draft
     * @param args - forwarded to `mutate` after the draft
     */
    protected update<A extends readonly unknown[]>(mutate: (draft: T, ...args: A) => void, ...args: A): void {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        let result: unknown;
        try {
            result = mutate(this.draft, ...args);
        } finally {
            this.emitUpdate();
        }
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') warnIfAsyncMutate(result);
    }
    /** Publishes on the next microtask when synchronous delivery is unsafe.
     * The parameters drive internal engine paths only; call this publicly without arguments.
     *
     * @param installation - the root transition whose facts this deferred write closes
     * @param deferredContinuation - whether an earlier phase already queued the fact
     */
    protected emitSoon(installation?: IStateInstallation, deferredContinuation: boolean = false): void {
        if (!deferredContinuation || !this[S.publicationPending]) {
            this[S.rememberPublication](installation);
        }
        this[S.pendingEmit] = true;
        const scheduledAt = this[S.version];
        queueMicrotask(() => {
            this[S.pendingEmit] = false;
            // Keep the opaque fallback, unless a synchronous emit already published it.
            if (storeLifecycle.isDisposed(this)) return;
            if (this[S.version] === scheduledAt || this[S.draftTouched] || this[S.writes].size > 0) {
                this.emitUpdate(undefined, true);
            }
        });
    }
    /** Coalesces ordinary mutations without losing facts from root installs or owned operations.
     *
     * @param installation - the root transition, or none for an in-place mutation
     */
    public [S.rememberPublication](installation?: IStateInstallation): void {
        if (this[S.publicationPending]) {
            if (this[S.pendingPublication]?.origin === 'mutation' && installation === undefined) {
                this[S.pendingPublication] = STATE_MUTATION_PUBLICATION;
            } else {
                this[S.pendingPublication] = STATE_MIXED_PUBLICATION;
            }
        } else {
            this[S.publicationPending] = true;
            this[S.pendingPublication] = installation ?? STATE_MUTATION_PUBLICATION;
        }
    }
    /** Marks draft as used and arms the development check for a write that never published. */
    public [S.touchDraft](): void {
        if (this[S.draftTouched]) {
            return;
        }
        this[S.draftTouched] = true;
        // Keep the diagnostic inside the development guard so its message is removed from
        // production bundles. A single callback per store suffices: it reads the current cycle.
        if (IS_DEVELOPMENT) {
            if (this[S.unpublishedDraftCheck] === undefined) {
                this[S.unpublishedDraftCheck] = (): void => {
                    if (!this[S.draftTouched] || this[S.pendingEmit] || storeLifecycle.isDisposed(this)) {
                        return;
                    }
                    diagnostics.report(
                        'a write went through draft, but emitUpdate() was never called, so no ' +
                        'subscriber was notified. Prefer this.update(mutate, ...args), which writes ' +
                        'and publishes in one step.'
                    );
                };
            }
            queueMicrotask(this[S.unpublishedDraftCheck]!);
        }
    }
    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    public [S.recordWrite](path: TPath): void { this[S.writes].add(path); }
    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged(): void {
        // Always a real change; unlike the emitUpdate() fallback, this is an explicit mark.
        this[S.recordWrite](WILDCARD_PATH);
        this[S.patchPort].listener?.(PATCH_OPAQUE);
    }
    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit(_changed: ReadonlySet<string>): void {}
    /** Closes the completed write set through the shared pre-subscriber publication boundary.
     * The parameters drive internal engine paths only; call this publicly without arguments.
     *
     * @param installation - an explicit root transition, when this write set installs one
     * @param deferredContinuation - whether its publication fact was already queued
     */
    protected emitUpdate(installation?: IStateInstallation, deferredContinuation: boolean = false): void {
        if (storeLifecycle.isDisposed(this)) throw new Error('Carburetor: store has been disposed');
        emitStoreUpdate<T>(this[S.port], installation, deferredContinuation);
    }
}
