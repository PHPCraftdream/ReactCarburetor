import {IDict, TDisposer, TReadonly, TSubscriber} from "@/Carburetor/Models/Base";
import {
    IPatchObserver, IStateInstallation, IStatePublication, IStateRestoreClaim,
    PATCH_OPAQUE, STATE_MIXED_PUBLICATION, STATE_MUTATION_PUBLICATION, STATE_PUBLIC_REPLACEMENT,
    IWritePatch, TPath, TPathRecorder, TPathSet, TAliasLedger, TPatchPort,
} from "@/Carburetor/Models/Paths";
import {
    ICarburetor, IPatchSource, ISubscribeOptions, IUpdateScheduler, TSelector,
} from "@/Carburetor/Models/Store";
import {deepClone} from "./Utils/deepClone";
import {applyDiff} from "./Paths/Diff/applyDiff";
import {sameKind} from "./Paths/Diff/Kinds/sameKind";
import {SubscriberIndex} from "./Paths/SubscriberIndex";
import {WriteLog} from "./Paths/WriteLog";
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
import {
    CARBURETOR_EXTEND, CARBURETOR_HAS_DRIFT, CARBURETOR_NOTIFY_WRITES, CARBURETOR_PATHS_SINCE,
    CARBURETOR_REPLAY_PATCHES, IInternalSubscriptionProtocol, ISubscriberRecord,
} from "./Utils/Models";
import {READS_TRANSFER} from "./Paths/Markers/ReadsTransferBrand";

declare const process: {env: {NODE_ENV?: string}} | undefined;

export class Carburetor<T extends object> implements
    ICarburetor<T>, IPatchSource, IInternalSubscriptionProtocol {
    /** Shared base-method identities; no registration record allocated per store. */
    private static readonly nativeStoreMethods = {
        getVersion: Carburetor.prototype.getVersion, emitUpdate: Carburetor.prototype.emitUpdate,
    };
    /** Never called: the build fails if a member the transaction ports read is renamed or retyped. */
    private static checkPort<T extends object>(s: Carburetor<T>): IStateInstallPort<T> {
        return {
            data: s.data, aliases: s.aliases, draftProxy: s.draftProxy, patchPort: s.patchPort,
            draftTouched: s.draftTouched, writes: s.writes, writeLog: s.writeLog, version: s.version,
            publicationPending: s.publicationPending, pendingPublication: s.pendingPublication,
            patchObservers: s.patchObservers, preEmit: s.preEmit, didSetData: s.didSetData,
            touchDraft: s.touchDraft, recordWrite: s.recordWrite, rememberPublication: s.rememberPublication,
            [CARBURETOR_NOTIFY_WRITES]: s[CARBURETOR_NOTIFY_WRITES],
            emitSoon: s.emitSoon, emitUpdate: s.emitUpdate,
        };
    }
    /** Registered callbacks and their stable scheduler keys, indexed by public local id. */
    protected subscribers: IDict<ISubscriberRecord> = Object.create(null);
    /** Distinguishes registrations created after an event selected its subscribers. */
    private subscriptionGeneration = 0;
    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex = new SubscriberIndex();
    /** Development alias ledger handed to both proxies; undefined outside development. */
    protected aliases: TAliasLedger = createAliasLedger();

    /** The currently attached patch listener, if any; shared with the write proxy tree (R16-07). */
    protected patchPort: TPatchPort = {};

    /** Lazily attached mutation/publication observers, shared by draft and restore paths. */
    protected patchObservers: PatchObserverRegistry | undefined;
    /** The store's identity, minted once at construction. */
    protected uid: string = getUid();
    /** The counter getVersion() returns; bumped by every emitUpdate. */
    protected version: number = 0;
    /** Latest store version whose subscriptions have completed matching. */
    private notifiedVersion = 0;
    /** Maps a transferred read-set identity to its active subscription for constant-time drift answers. */
    private readonly subscriptionByReads = new WeakMap<TPathSet, ISubscriberRecord>();

    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet = new Set<TPath>();
    /** Which paths recent emits touched, bounded and watermarked; feeds the commit drift check (R16-05). */
    protected writeLog: WriteLog = new WriteLog();
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean = false;
    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean = false;
    /** Minted on the first development draft write; later checks reuse the same callback. */
    declare private unpublishedDraftCheck: (() => void) | undefined;
    /** The write proxy behind draft, memoized across accesses and dropped by setData. */
    protected draftProxy: T | undefined = undefined;
    /** Whether a closed state publication is waiting for delivery. */
    private publicationPending: boolean = false;
    /** The transition fact coalesced until notifyWrites closes the batch. */
    private pendingPublication: IStatePublication | undefined;
    /** Exact root installation currently being applied through restore's draft diff. */
    private activeInstallation: IStateInstallation | undefined;
    /** Bound once; draft writes announce paths, and topological ones refresh ownership (createWriteProxy). */
    private readonly writeRecorder = (path: TPath): void => {
        this.recordWrite(path);
        const installation = this.activeInstallation;
        if (installation && (!this.publicationPending || this.pendingPublication !== installation)) {
            this.rememberPublication(installation);
        }
    };

    /**
     * Takes the initial state and the policy that decides when subscribers are woken.
     *
     * @param data - the state the store wraps; reads go through read(), writes through
     * draft, and setData() swaps it wholesale.
     * @param scheduler - decides when a matched subscriber's callback actually runs;
     * defaults to immediate, synchronous delivery.
     */
    constructor(protected data: T, protected scheduler: IUpdateScheduler = syncUpdateScheduler) {
        this.aliases?.checkState(data, '');
        nativeStoreWriteEpoch.sources.set(this, Carburetor.nativeStoreMethods);
    }

    /**
     * The store's identity, which subscriptions and dev tooling key on.
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

    /** The paths written after `baselineVersion` (R36-01); undefined once the write log cannot enumerate them. */
    public [CARBURETOR_PATHS_SINCE](baselineVersion: number): ReadonlyArray<TPath> | undefined {
        return this.writeLog.pathsSince(baselineVersion);
    }

    /**
     * The path-precise drift check (R16-05, R33-03): could a write since `baselineVersion` concern
     * `reads`? O(1) for a read set this store filed; otherwise the write log, which says `true`
     * once it cannot answer.
     *
     * @param baselineVersion - the version a render's read set was captured at
     * @param reads - the paths that read set touched
     */
    public [CARBURETOR_HAS_DRIFT](baselineVersion: number, reads: ReadonlySet<TPath>): boolean {
        const record = this.subscriptionByReads.get(reads as TPathSet);

        if (record && record.reads === reads && baselineVersion >= record.growthVersion
            && this.notifiedVersion >= this.version) {
            return record.matchedVersion > baselineVersion;
        }

        return this.writeLog.matches(baselineVersion, reads);
    }

    /**
     * History's draft replay of undo/redo patches (R34-03); reached via the internal protocol.
     *
     * @param patches - the entry's patches, in recorded order
     * @param inverse - true installs `previous` in reverse; false installs `next`
     * @param installation - the replay owner's fact, kept on the closed publication
     */
    public [CARBURETOR_REPLAY_PATCHES](
        patches: readonly IWritePatch[], inverse: boolean, installation: IStateInstallation
    ): void {
        replayPatchesOnPort(this.port, () => this.draft, patches, inverse, installation);
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

    /** Adopts `data` verbatim through the shared install/commit/delivery boundary. */
    public setData(data: T): T { return this.commitState(data, STATE_PUBLIC_REPLACEMENT); }

    /**
     * Installs one prepared root, records topology and changed paths, then closes publication — the
     * one entry library subclasses use instead of coordinating data, proxies, aliases and emits.
     *
     * @param data - the already prepared root to install
     * @param installation - the transition's origin, owner, representation and delivery policy
     */
    protected commitState(data: T, installation: IStateInstallation = STATE_PUBLIC_REPLACEMENT): T {
        return installState(this.port, data, installation);
    }

    /** The transaction ports' typed view of this store; `checkPort` guards its shape. */
    private get port(): IStateInstallPort<T> {
        return this as unknown as IStateInstallPort<T>;
    }

    /** Lets subclasses synchronize derived state before replacement notifications. */
    protected didSetData(): void {}

    /** Copies plain state while retaining native and class-instance references as documented. */
    public snapshot(): T {
        return deepClone(this.data);
    }

    /** Owns the live graph for history: it is the authoritative raw state (R30-06b).
     *
     * Classes whose wire state differs from their live data must override this.
     *
     * @param own - detaches the live graph while preserving native/plain aliases
     */
    public captureHistory(own: <V>(value: V) => V): T {
        return own(this.data);
    }

    /** Installs a detached snapshot with precise draft changes. A root kind change or an
     * oversized structural diff falls back to a whole-root replacement through setData().
     *
     * @param data - read but never mutated or retained as the live state.
     */
    public restore(data: T): void {
        const current: unknown = this.data;
        const claim: IStateRestoreClaim | undefined = this.patchObservers?.claimRestore(data);
        const installation: IStateInstallation = claim
            ? {origin: 'restore', owner: claim.owner, representation: claim.representation}
            : {origin: 'restore', representation: 'public'};

        this.aliases?.checkState(data, '');

        // An owned endpoint may need to keep aliases across plain/native branches intact.
        if (claim?.adopt) {
            this.commitState(data, installation);
            return;
        }

        if (!isTrackable(current) || !isTrackable(data) || !sameKind(current, data)) {
            this.commitState(deepClone(data), installation);
            return;
        }

        let applied: boolean;
        const previousInstallation = this.activeInstallation;
        this.activeInstallation = installation;
        try {
            applied = applyDiff(
                this.draft as unknown as Record<string, unknown>,
                current as Record<string, unknown>,
                data as unknown as Record<string, unknown>
            );
        } catch (error) {
            this.activeInstallation = previousInstallation;
            // Publish any already-applied writes, but preserve the mutation's original failure.
            try {
                this.emitUpdate(undefined, true);
            } catch {
                // The write observer failure is already the synchronous result of restore().
            }
            throw error;
        }
        this.activeInstallation = previousInstallation;

        if (!applied) {
            installState(this.port, deepClone(data), installation, true);
            return;
        }

        this.emitUpdate(undefined, true);
    }

    /** The store's wire form: the live data as it stands, without a copy.
     *
     * Ordinary stores expose live data; classes with another wire form override it. A detached
     * copy is `snapshot()`.
     */
    public toJSON(): unknown {
        return this.data;
    }

    /**
     * The type-erased half of `setData`: adopts `value` directly, diffed the same way (R16-02).
     * Unlike `restore`, it makes no copy: `value` is expected to be freshly parsed JSON the
     * caller does not keep (R16-09).
     *
     * @param value - the parsed state to install; the cast is the caller's promise about the
     * shape, and the store keeps this exact object as `getData()`'s answer.
     */
    public fromJSON(value: unknown): void {
        this.setData(value as T);
    }

    /**
     * Registers a subscriber, returning its public, store-local id.
     * Public read sets are copied; fresh sets branded by `transferReads()` are adopted
     * so `extend()` can grow them in place.
     *
     * @param callback - called on matching writes; failures do not stop other subscribers
     * @param options - optional local id and paths to watch (omitted reads match every write)
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = options.id || getUid();
        const given = options.reads;
        let reads: TPathSet;

        if (given === undefined) {
            reads = new Set<TPath>([WILDCARD_PATH]);
        } else if ((options as {[READS_TRANSFER]?: unknown})[READS_TRANSFER] === given) {
            reads = given as TPathSet;
        } else {
            reads = new Set<TPath>(given);
        }

        // Keep the same private queue slot when replacing this store's local id.
        const previous = this.subscribers[id];
        if (previous) {
            this.scheduler.cancel(previous.schedulerKey);
            if (this.subscriptionByReads.get(previous.reads) === previous) {
                this.subscriptionByReads.delete(previous.reads);
            }
        }

        this.subscribers[id] = {
            callback, schedulerKey: previous?.schedulerKey ?? getUid(),
            generation: ++this.subscriptionGeneration, matchedVersion: 0, growthVersion: this.version, reads,
        };
        this.subscriptionByReads.set(reads, this.subscribers[id]);
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
    public [CARBURETOR_EXTEND](id: string, path: TPath): void {
        if (!Object.prototype.hasOwnProperty.call(this.subscribers, id)) {
            return;
        }

        this.subscriberIndex.addPath(id, path);
        const record = this.subscribers[id];
        if (record) {
            record.growthVersion = this.version;
            record.reads.add(path);
        }
    }

    /** Drops a subscriber, its index entries and any update already scheduled for it. */
    public unsubscribe(id: string): void {
        const record = this.subscribers[id];
        if (record) {
            this.scheduler.cancel(record.schedulerKey);
            if (this.subscriptionByReads.get(record.reads) === record) {
                this.subscriptionByReads.delete(record.reads);
            }
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    }

    /** Attaches one observer without displacing independent history recorders. */
    public attachPatchListener(observer: IPatchObserver): TDisposer {
        const registry = this.patchObservers ??= new PatchObserverRegistry(this.patchPort, this.scheduler);
        return registry.attach(observer);
    }

    /** Subscribes to a selected value with a read set that follows conditional branches.
     *
     * @param select - computes the tracked selection.
     * @param onChange - receives changed detached selections.
     */
    public watch<R>(select: TSelector<T, R>, onChange: (next: R, previous: R) => void): TDisposer {
        return watchSelection(this, select, onChange);
    }

    /** Delivers one notification pass for a closed write set; called only via the internal
     * symbol protocol (R32-07), never as a public method. */
    public [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void {
        updateWave.begin();

        try {
            let failures: unknown[] | undefined;
            const generation = this.subscriptionGeneration;
            const matched = this.subscriberIndex.match(writes);
            const notifiedAt = this.version;
            // A removed/replaced registration cannot inherit an earlier event's match.
            matched.forEach((id: string) => {
                const record = this.subscribers[id];
                if (record && record.generation <= generation) {
                    record.matchedVersion = notifiedAt;
                }
            });
            this.notifiedVersion = Math.max(this.notifiedVersion, notifiedAt);
            const fact = this.publicationPending
                ? this.pendingPublication ?? STATE_MUTATION_PUBLICATION
                : STATE_MUTATION_PUBLICATION;
            this.publicationPending = false;
            this.pendingPublication = undefined;
            failures = this.patchObservers?.publish(fact);
            matched.forEach((id: string) => {
                const record = this.subscribers[id];
                if (record && record.generation <= generation) {
                    try {
                        this.scheduler.schedule(record.schedulerKey, record.callback);
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
            this.patchPort.listener?.(PATCH_OPAQUE);

            return this.data;
        }

        if (!this.draftProxy) {
            this.draftProxy = createWriteProxy(
                data, this.writeRecorder, '', this.aliases, undefined, this.patchPort
            ) as T;
        }

        return this.draftProxy;
    }

    /**
     * Mutates and publishes in one step: writing to `draft` and forgetting `emitUpdate()` changes
     * the data while nobody re-renders, which is why this is the recommended form.
     *
     * If mutate throws partway through, the writes it already made stay in the data (the draft
     * applies each at once) and are published anyway; the error still reaches the caller. Rolling
     * back would take a full snapshot before every update — too high a price on the hot path.
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

    /** Publishes on the next microtask when synchronous delivery is unsafe.
     *
     * @param installation - the root transition whose facts this deferred write closes
     * @param deferredContinuation - whether an earlier phase already queued the fact
     */
    protected emitSoon(installation?: IStateInstallation, deferredContinuation: boolean = false): void {
        if (!deferredContinuation || !this.publicationPending) {
            this.rememberPublication(installation);
        }
        this.pendingEmit = true;
        const scheduledAt = this.version;

        queueMicrotask(() => {
            this.pendingEmit = false;

            // Keep the opaque fallback, unless a synchronous emit already published it.
            if (this.version === scheduledAt || this.draftTouched || this.writes.size > 0) {
                this.emitUpdate(undefined, true);
            }
        });
    }

    /** Coalesces ordinary mutations without losing facts from root installs or owned operations.
     *
     * @param installation - the root transition, or none for an in-place mutation
     */
    protected rememberPublication(installation?: IStateInstallation): void {
        if (this.publicationPending) {
            if (this.pendingPublication?.origin === 'mutation' && installation === undefined) {
                this.pendingPublication = STATE_MUTATION_PUBLICATION;
            } else {
                this.pendingPublication = STATE_MIXED_PUBLICATION;
            }
        } else {
            this.publicationPending = true;
            this.pendingPublication = installation ?? STATE_MUTATION_PUBLICATION;
        }
    }

    /** Marks draft as used and arms the development check for a write that never published. */
    protected touchDraft(): void {
        if (this.draftTouched) {
            return;
        }

        this.draftTouched = true;

        // Keep the diagnostic inside the development guard so its message is removed from
        // production bundles. A single callback per store suffices: it reads the current cycle.
        if (IS_DEVELOPMENT) {
            if (this.unpublishedDraftCheck === undefined) {
                this.unpublishedDraftCheck = (): void => {
                    if (!this.draftTouched || this.pendingEmit) {
                        return;
                    }

                    diagnostics.report(
                        'a write went through draft, but emitUpdate() was never called, so no ' +
                        'subscriber was notified. Prefer this.update(draft => ...), which does both.'
                    );
                };
            }

            queueMicrotask(this.unpublishedDraftCheck);
        }
    }

    /** Remembers one changed path, so the emit wakes only the subscribers that read it. */
    protected recordWrite(path: TPath): void { this.writes.add(path); }
    /** Marks the whole store as changed: the escape hatch for a write that bypassed draft. */
    protected markAllChanged(): void {
        // Always a real change, unlike emitUpdate()'s own bypass fallback below (R16-07).
        this.recordWrite(WILDCARD_PATH);
        this.patchPort.listener?.(PATCH_OPAQUE);
    }

    /** A hook for subclasses to write derived state before an emit goes out. */
    protected preEmit(): void {}

    /** Closes the completed write set through the shared pre-subscriber publication boundary.
     *
     * @param installation - an explicit root transition, when this write set installs one
     * @param deferredContinuation - whether its publication fact was already queued
     */
    protected emitUpdate(installation?: IStateInstallation, deferredContinuation: boolean = false): void {
        emitStoreUpdate<T>(this.port, installation, deferredContinuation);
    }
}
