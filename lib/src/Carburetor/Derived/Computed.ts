import {IDict, TSubscriber} from "@/Carburetor/Models/Base";
import {IComputed, IComputedOptions, TComputeBody, TComputedReader} from "@/Carburetor/Models/Derived";
import {TPath} from "@/Carburetor/Models/Paths";
import {IReadableCarburetor, ISubscribeOptions} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";
import {updateWave} from "@/Carburetor/Store/Scheduling/UpdateWaveInstance";
import {nativeStoreWriteEpoch} from "@/Carburetor/Store/Scheduling/nativeStoreWriteEpoch";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {completeReads} from "@/Carburetor/Store/Tracking/Observation/completeReads";
import {transferReads} from "@/Carburetor/Store/Paths/Markers/transferReads";
import {CARBURETOR_EXTEND, CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {announceIsUnchanged} from "./Freshness/announceIsUnchanged";
import {reportComputedEscape} from "./reportComputedEscape";
import {captureLeafVersions} from "./Freshness/captureLeafVersions";
import {driftedSince} from "./Freshness/driftedSince";
import {ILeafVersion} from "./Freshness/Models";
import {leafVersionsDrifted} from "./Freshness/leafVersionsDrifted";
import {computedDependencies} from "./computedDependencies";
import {C, IDependency, IActiveReadSlot} from "./Models";
import {PersistentViews} from "@/Carburetor/Store/Tracking/Observation/PersistentViewCache";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/**
 * Maps a live computed's invalidation callback to the call that marks that computed's
 * cached value stale. Invalidation travels downstream along these edges — and only
 * these: a plain value observer is woken by a delivered change, never by a mark.
 *
 * Shared across every copy of the library in this process — see sharedSingleton — so an outer
 * computed from one copy still gets marked when an inner computed from another copy's settlement
 * fails without announcing.
 */
const invalidationEdges: WeakMap<TSubscriber, () => void> =
    sharedSingleton('invalidationEdges', () => new WeakMap<TSubscriber, () => void>());

/** The value the last notification carried, and the dependency versions it was read from. */
interface IAnnouncement<R> {
    value: R;
    versions: IDict<ILeafVersion>;
}

/** A subscriber's callback and the registration generation that owns it. */
interface IComputedSubscriber {
    callback: TSubscriber;
    generation: number;
}

/**
 * Subclasses may add domain members. The reserved contract is constructor(body, options),
 * get(), getUID(), getVersion(), subscribe() and unsubscribe(); overriding those public
 * methods changes the source protocol. Engine state and callbacks are not subclass hooks.
 *
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export class Computed<R> implements IComputed<R> {
    /** This computed's id, which dependencies are subscribed and released under. */
    private [C.uid]: string = getUid();
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    private [C.version]: number = 0;
    /** Successful unobserved changes that had no subscriber to receive a publication. */
    private [C.snapshotRevision]: number = 0;
    /** Callbacks woken when a changed value settles, keyed by public subscription id. */
    private [C.subscribers]: Map<string, IComputedSubscriber> = new Map<string, IComputedSubscriber>();
    /** Distinguishes registrations created after a publication selected its subscribers. */
    private [C.observationGeneration] = 0;
    /** Allocated only when an active wave actually queues settlement. */
    private [C.queuedSettlement]: (() => void) | undefined;
    /** Keeps registrations added during delivery out of that publication. */
    private [C.subscriptionGeneration] = 0;
    /** What the current value was computed from, observed only while somebody is listening. */
    private [C.dependencies]: IDict<IDependency> = {};

    /** Per store source: the dependency the source's persistent view currently records into. */
    private readonly [C.views] = new PersistentViews();
    /** Object identity preserves cached recorder routes across release and reused public ids.
     * Allocated only for a body that reads a store; weak keys do not retain retired sources.
     */
    private [C.readSlots]: WeakMap<object, IActiveReadSlot> | undefined;
    /** Strong filing only for current routes, trimmed on publication and cleared on release. */
    private [C.activeReads]: Map<string, IActiveReadSlot> = new Map();

    /** Leaf versions, including flattened native computations and public external sources. */
    private [C.versions]: IDict<ILeafVersion> = {};
    /** A shared write epoch is enough to trust a cache whose leaves are all native stores. */
    private [C.allNativeSources]: boolean = true;
    /** Last epoch whose leaf versions were validated. */
    private [C.validatedEpoch]: number = nativeStoreWriteEpoch.value;

    /**
     * The value an observer last had delivered: the baseline a settlement is judged
     * against, kept independently of the evaluation cache.
     *
     * It is set when the first subscriber arrives — the moment somebody starts actually
     * looking at the value — so a read that refreshes the cache mid-wave can never move
     * the baseline. Undefined while nobody has been told anything.
     */
    private [C.announced]: IAnnouncement<R> | undefined = undefined;

    /** The cached body result, undefined until the first compute. */
    private [C.value]: R | undefined = undefined;
    /** Whether the cached value can be trusted; cleared when a dependency moves or the last listener leaves. */
    private [C.valid]: boolean = false;

    /** Constructor-supplied evaluation, isolated from subclass domain fields. */
    private [C.body]!: TComputeBody<R>;
    /** Constructor-supplied equality policy, isolated from subclass domain fields. */
    private [C.options]!: IComputedOptions<R>;

    /**
     * Takes the body whose reads become this value's dependencies.
     *
     * @param body - runs against a tracking reader; everything it reads becomes a dependency
     * @param options - `equals` judges two results by content instead of by reference
     */
    constructor(body: TComputeBody<R>, options: IComputedOptions<R> = {}) {
        this[C.body] = body;
        this[C.options] = options;
        // Files this computed's invalidation callback so computations upstream of it can
        // reach it when they are invalidated — including when their settlement fails and
        // nothing is announced.
        invalidationEdges.set(this[C.onDependencyChanged], this[C.markStale]);
        computedDependencies.versions.set(this, () => this[C.versions]);
    }

    /** The identity a component or another computed subscribes by. */
    public getUID(): string {
        return this[C.uid];
    }

    /** Bumped once per delivered change, not on every recompute. */
    public getVersion(): number {
        return this[C.version];
    }

    /** Includes unannounced changes to a previously rendered value. */
    public [CARBURETOR_SNAPSHOT_VERSION](): number {
        return this[C.version] + this[C.snapshotRevision];
    }

    /** The value, recomputing first if it cannot be trusted. */
    public get(): R {
        if (this[C.isStale]()) {
            this[C.recompute]();
        }

        return this[C.value] as R;
    }

    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     *
     * @param callback - woken only when a settled value differs from the last announced one
     * @param options - `id` keys the subscription for later unsubscribe; a uid is generated when omitted
     */
    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = options.id || getUid();
        const wasUnobserved = this[C.subscribers].size === 0;
        const previous = this[C.subscribers].get(id);

        this[C.subscribers].set(id, {callback, generation: ++this[C.subscriptionGeneration]});

        try {
            if (!this[C.valid] || (wasUnobserved && this[C.hasDrifted]())) {
                this[C.recompute](wasUnobserved);
            } else if (wasUnobserved) {
                this[C.attachDependencies](this[C.dependencies]);
            }

            if (wasUnobserved && this[C.valid]) {
                this[C.announced] = {value: this[C.value] as R, versions: this[C.versions]};
            }
        } catch (error: unknown) {
            if (previous) {
                this[C.subscribers].set(id, previous);
            } else {
                this[C.subscribers].delete(id);
            }
            this[C.valid] = false;
            if (this[C.subscribers].size === 0) this[C.releaseDependencies]();
            throw error;
        }

        return id;
    }

    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
    public unsubscribe(id: string): void {
        if (!this[C.subscribers].has(id)) {
            return;
        }

        this[C.subscribers].delete(id);

        if (this[C.subscribers].size === 0) {
            this[C.valid] = false;
            this[C.releaseDependencies]();
        }
    }

    /** Whether the cached value can still be handed out, including deferred invalidations. */
    private [C.isStale](): boolean {
        return !this[C.valid] || this[C.hasDrifted]();
    }

    /** Whether any leaf source moved since this value was read. */
    private [C.hasDrifted](): boolean {
        const epoch = nativeStoreWriteEpoch.value;
        if (this[C.allNativeSources] && this[C.validatedEpoch] === epoch) {
            return false;
        }

        const live = typeof this[C.value] === 'object' && this[C.value] !== null || typeof this[C.value] === 'function';
        if (leafVersionsDrifted(this[C.versions], this[C.dependencies], live)) {
            return true;
        }

        this[C.validatedEpoch] = epoch;

        return false;
    }

    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    private [C.recompute](wasUnobserved: boolean = this[C.subscribers].size === 0): void {
        const collected: IDict<IDependency> = {};
        const track = (source: IReadableCarburetor<object> | IComputed<unknown>): unknown => {
            // Encode arbitrary public ids so __proto__ is an ordinary data key.
            const cuid = ':' + source.getUID();
            let dependency = computedDependencies.ownDependency(collected, cuid);
            if (!dependency) {
                dependency = {
                    source, reads: new Set<TPath>(), published: false, observed: false,
                    previous: computedDependencies.ownDependency(this[C.dependencies], cuid), overlap: 0,
                };
                collected[cuid] = dependency;
            }
            if ('read' in source) {
                // One persistent view per source, rebuilt only when its data object changed.
                const readSlots = this[C.readSlots] ??= new WeakMap<object, IActiveReadSlot>();
                let cached = readSlots.get(source);
                if (!cached) {
                    cached = {current: undefined};
                    readSlots.set(source, cached);
                }
                const slot = cached;
                const active = this[C.activeReads].get(cuid);
                if (active !== slot) {
                    if (active) active.current = undefined;
                    this[C.activeReads].set(cuid, slot);
                }
                slot.current = dependency;
                return this[C.views].view(source, this[C.createReadRecorder](slot));
            }

            // Another computed notifies at the granularity of its whole value — no finer path
            // to depend on — routed through the recorder so an unchanged wildcard still counts.
            this[C.recordDependencyRead](dependency, WILDCARD_PATH);
            return source.get();
        };

        const previous = this[C.value];
        const hadValue = this[C.valid] || Object.keys(this[C.versions]).length > 0;
        const oldVersions = this[C.versions];
        let value: R;
        try {
            value = this[C.body](track as TComputedReader);
            this[C.attachDependencies](collected);
        } catch (error: unknown) {
            // Late reads go back to the still-published dependencies.
            computedDependencies.publishActiveReads(this[C.dependencies], this[C.activeReads], this[C.readSlots]);
            throw error;
        }
        computedDependencies.publishActiveReads(this[C.dependencies], this[C.activeReads], this[C.readSlots]);
        this[C.value] = value;
        this[C.valid] = true;

        // Before observation no dependency can announce a change to an already-rendered
        // value. A stable exotic result may have changed in place.
        const dependenciesMoved = wasUnobserved && hadValue && driftedSince(oldVersions, this[C.versions]);
        if (dependenciesMoved) {
            if (announceIsUnchanged(undefined, previous, value, true, this[C.options].equals)) {
                this[C.value] = previous as R;
            } else {
                this[C.snapshotRevision]++;
            }
        }
    }

    /** Creates a persistent recorder without capturing an evaluation's lexical environment.
     *
     * @param slot - The source-identity route, cleared when its dependency retires.
     */
    private [C.createReadRecorder](slot: IActiveReadSlot): (path: TPath) => void {
        return (path: TPath): void => {
            if (slot.current) {
                this[C.recordDependencyRead](slot.current, path);
            }
        };
    }

    /** Records body reads and extends adopted store edges for later live leaf reads.
     *
     * @param dependency - The edge receiving the read.
     * @param path - The recorded path.
     */
    private [C.recordDependencyRead](dependency: IDependency, path: TPath): void {
        if (dependency.reads.has(path)) {
            return;
        }
        dependency.reads.add(path);
        if (dependency.published && typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            reportComputedEscape(this, (id: string) => this[C.subscribers].has(id));
        }
        const extend = (dependency.source as IInternalSubscriptionProtocol)[CARBURETOR_EXTEND];
        if (dependency.published && this[C.subscribers].size > 0 && extend) {
            extend.call(dependency.source, this[C.uid], path);
        }
    }

    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    private [C.attachDependencies](collected: IDict<IDependency>): void {
        const fresh = this[C.diffDependencies](collected);
        // A retained edge keeps the read set its store subscription filed: the drift answer
        // is O(1) only for that identity, and late reads extend the same set through
        // CARBURETOR_EXTEND.
        for (const cuid of Object.keys(collected)) {
            if (collected[cuid].fresh) {
                continue;
            }
            collected[cuid].reads = this[C.dependencies][cuid].reads;
        }
        const previousVersions = this[C.versions];
        const previousAllNative = this[C.allNativeSources];
        const previousEpoch = this[C.validatedEpoch];
        this[C.recordVersions](collected);
        // Retained edges need no setup transaction or subscription churn.
        if (!fresh) {
            for (const cuid of Object.keys(this[C.dependencies])) {
                const previous = this[C.dependencies][cuid];
                const next = computedDependencies.ownDependency(collected, cuid);
                previous.published = false;
                if (next) {
                    next.published = true;
                    next.observed = previous.observed;
                    next.previous = undefined;
                } else if (previous.observed) {
                    computedDependencies.unsubscribe(previous.source, this[C.uid]);
                }
            }
            this[C.dependencies] = collected;
            return;
        }
        const attempted: string[] = [];
        try {
            if (this[C.subscribers].size > 0) {
                for (const cuid of fresh) {
                    const dependency = collected[cuid];
                    attempted.push(cuid);
                    computedDependencies.subscribe(dependency.source, this[C.onDependencyChanged],
                        transferReads(dependency.reads, this[C.uid]));
                }
            }
        } catch (error: unknown) {
            // Restore replaced edges; release new edges, including a partially attached failure.
            for (const cuid of attempted.reverse()) {
                const previous = computedDependencies.ownDependency(this[C.dependencies], cuid);
                try {
                    if (previous?.observed && previous.source === collected[cuid].source) {
                        computedDependencies.subscribe(previous.source, this[C.onDependencyChanged],
                            transferReads(previous.reads, this[C.uid]));
                    } else {
                        computedDependencies.unsubscribe(collected[cuid].source, this[C.uid]);
                    }
                } catch { /* Preserve the attachment error. */ }
            }
            this[C.versions] = previousVersions;
            this[C.allNativeSources] = previousAllNative;
            this[C.validatedEpoch] = previousEpoch;
            this[C.valid] = false;
            throw error;
        }

        for (const cuid of Object.keys(this[C.dependencies])) {
            const previous = this[C.dependencies][cuid];
            previous.published = false;
            if (previous.observed && previous.source !== computedDependencies.ownDependency(collected, cuid)?.source) {
                computedDependencies.unsubscribe(previous.source, this[C.uid]);
            }
        }
        for (const cuid of Object.keys(collected)) {
            const dependency = collected[cuid];
            dependency.published = true;
            dependency.observed = this[C.subscribers].size > 0;
            dependency.previous = undefined;
        }
        this[C.dependencies] = collected;
    }

    /** Keeps equal read sets subscribed, and replaces changed or newly collected edges. */
    private [C.diffDependencies](collected: IDict<IDependency>): string[] | undefined {
        let fresh: string[] | undefined;

        for (const cuid of Object.keys(collected)) {
            const next = collected[cuid];
            const previous = computedDependencies.ownDependency(this[C.dependencies], cuid);
            if (!next.published) {
                completeReads(next.reads);
                next.overlap = 0;
                for (const path of next.reads) if (previous?.reads.has(path)) next.overlap++;
            }
            if (!previous?.observed || next.source !== previous.source
                || (next !== previous && (next.overlap !== previous.reads.size
                    || next.overlap !== next.reads.size))) {
                next.fresh = true;
                (fresh ??= []).push(cuid);
            } else {
                next.fresh = false;
            }
        }

        return fresh;
    }

    /** Flattens native dependency metadata; external sources expose their public version. */
    private [C.recordVersions](collected: IDict<IDependency>): void {
        const versions: IDict<ILeafVersion> = {};
        const allNative = captureLeafVersions(collected, versions);
        this[C.versions] = versions;
        this[C.allNativeSources] = allNative;
        this[C.validatedEpoch] = nativeStoreWriteEpoch.value;
    }

    /** Unsubscribes from every dependency and forgets them. */
    private [C.releaseDependencies](): void {
        // Close observer state before calling external teardown: it may subscribe reentrantly.
        // Evaluation value/versions remain independent and are not cleared here.
        this[C.observationGeneration]++;
        this[C.queuedSettlement] = undefined;
        const released = this[C.dependencies];
        this[C.dependencies] = {};
        this[C.announced] = undefined;
        for (const slot of this[C.activeReads].values()) {
            slot.current = undefined;
        }
        // Only weak recorder filing survives. Clear before teardown can rejoin and adopt slots.
        this[C.activeReads].clear();
        Object.keys(released).forEach((cuid: string) => {
            const dependency = released[cuid];
            dependency.published = false;
            const adopted = computedDependencies.ownDependency(this[C.dependencies], cuid);
            if (dependency.observed && !(adopted?.observed && adopted.source === dependency.source)) {
                dependency.observed = false;
                computedDependencies.unsubscribe(dependency.source, this[C.uid]);
            }
        });
    }

    /**
     * Invalidates on a dependency write, and settles once the wave around it has passed.
     *
     * A bound field, not a method: it is the key `invalidationEdges` files `markStale` under
     * and the callback a dependency's `subscribers` map holds, both called detached from
     * `this`, so its identity and receiver have to survive past this call.
     */
    private [C.onDependencyChanged] = (): void => {
        if (this[C.subscribers].size === 0) return;
        // A pull during a transaction or throttle delay can refresh the cache without
        // delivering the change. The queued invalidation still owes a settlement against
        // the independent announcement baseline.
        if (this[C.valid] && !this[C.hasDrifted]()) {
            const announcement = this[C.announced];
            if (announcement === undefined || !driftedSince(announcement.versions, this[C.versions])) {
                return;
            }
        } else {
            // Propagate staleness through native dependencies before settlement starts.
            this[C.markStale]();
        }

        // One write reaches this computed's dependencies one after another inside the same
        // pass. Settling for each notification would announce values built from inputs that
        // have not been told about the write yet — and recomputing mid-pass resubscribes the
        // dependency set, which can even consume an input's own invalidation. The wave
        // decides when it is this computed's turn: once, with every input already settled.
        if (updateWave.isActive()) {
            const generation = this[C.observationGeneration];
            const callback = this[C.queuedSettlement] ??= () => {
                if (generation === this[C.observationGeneration]) this[C.settle]();
            };
            updateWave.defer(this[C.uid], callback);

            return;
        }

        this[C.settle]();
    };

    /** Bound invalidation mark: propagates only to computed edges, not value observers.
     * Validity is monotone until a successful recompute revalidates every upstream.
     */
    private [C.markStale] = (): void => {
        if (!this[C.valid]) {
            return;
        }

        this[C.valid] = false;

        // Live, not a snapshot: marking never subscribes or unsubscribes, so the map is stable.
        for (const record of this[C.subscribers].values()) {
            const mark = invalidationEdges.get(record.callback);

            if (mark) {
                mark();
            }
        }
    };

    /** Bound settlement preserves the independent announcement during active waves. */
    private [C.settle] = (): void => {
        // Queued work from a closed observation must not resurrect its announcement.
        if (this[C.subscribers].size === 0) return;
        const generation = this[C.observationGeneration];
        const previous = this[C.value];

        // A settlement queued while this value was stale can find it already valid by the
        // time its turn comes: an eager get() elsewhere in the wave — pulled by another
        // node's own settlement — already reran the body against the same upstream state
        // this settlement was deferred to wait for. Recomputing again would just repeat
        // that call for no new input.
        if (!this[C.valid] || this[C.hasDrifted]()) {
            this[C.recompute]();
        }

        const announcement = this[C.announced];
        const moved = announcement !== undefined && driftedSince(announcement.versions, this[C.versions]);
        const unchanged = announceIsUnchanged(
            announcement, previous, this[C.value] as R, moved, this[C.options].equals
        );

        if (generation !== this[C.observationGeneration] || this[C.subscribers].size === 0) return;
        if (unchanged) {
            this[C.value] = announcement !== undefined ? announcement.value : previous;
            return;
        }

        this[C.announced] = {value: this[C.value] as R, versions: this[C.versions]};
        this[C.version]++;
        this[C.deliver]();
    };

    /** Wakes only registrations present when delivery began; isolates callback failures. */
    private [C.deliver](): void {
        let failures: unknown[] | undefined = undefined;
        const generation = this[C.subscriptionGeneration];
        // Snapshot past one subscriber: a leaver is skipped, a joiner waits for the next pass.
        const single = this[C.subscribers].size === 1;
        const ids = single ? this[C.subscribers].keys() : Array.from(this[C.subscribers].keys());

        for (const id of ids) {
            const record = this[C.subscribers].get(id);
            if (record && record.generation <= generation) {
                try {
                    record.callback();
                } catch (error: unknown) {
                    (failures ??= []).push(error);
                }
            }

            if (single) {
                break;
            }
        }

        if (!failures) {
            return;
        }

        failures.forEach((error: unknown) => {
            if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                diagnostics.report(
                    'a subscriber threw while a computed value was delivered: ' +
                    (error instanceof Error ? error.message : String(error)) +
                    '. The remaining subscribers were notified anyway.'
                );
            }
        });
    }
}
