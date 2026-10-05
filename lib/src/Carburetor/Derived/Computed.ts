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
import {transferReads} from "@/Carburetor/Store/Paths/Markers/transferReads";
import {CARBURETOR_EXTEND, CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {announceIsUnchanged} from "./Freshness/announceIsUnchanged";
import {reportComputedEscape} from "./reportComputedEscape";
import {captureLeafVersions} from "./Freshness/captureLeafVersions";
import {driftedSince} from "./Freshness/driftedSince";
import {ILeafVersion} from "./Freshness/Models";
import {leafVersionsDrifted} from "./Freshness/leafVersionsDrifted";
import {computedDependencies} from "./computedDependencies";
import {IDependency, IActiveReadSlot} from "./Models";
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

/*
 * A dependency's source and the per-cycle dependency record live in ./activeReads.
 */


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
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export class Computed<R> implements IComputed<R> {
    /** This computed's id, which dependencies are subscribed and released under. */
    protected uid: string = getUid();
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    protected version: number = 0;
    /** Successful unobserved changes that had no subscriber to receive a publication. */
    protected snapshotRevision: number = 0;
    /** Callbacks woken when a changed value settles, keyed by public subscription id. */
    protected subscribers: Map<string, IComputedSubscriber> = new Map<string, IComputedSubscriber>();
    /** Distinguishes registrations created after a publication selected its subscribers. */
    private subscriptionGeneration = 0;
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency> = {};

    /** Per store source: the dependency the source's persistent view currently records into. */
    private readonly views = new PersistentViews();
    /** Per encoded source id: the slot that source's persistent view records through. */
    private activeReads: Map<string, IActiveReadSlot> = new Map();

    /** Leaf versions, including flattened native computations and public external sources. */
    protected versions: IDict<ILeafVersion> = {};
    /** A shared write epoch is enough to trust a cache whose leaves are all native stores. */
    protected allNativeSources: boolean = true;
    /** Last epoch whose leaf versions were validated. */
    protected validatedEpoch: number = nativeStoreWriteEpoch.value;

    /**
     * The value an observer last had delivered: the baseline a settlement is judged
     * against, kept independently of the evaluation cache.
     *
     * It is set when the first subscriber arrives — the moment somebody starts actually
     * looking at the value — so a read that refreshes the cache mid-wave can never move
     * the baseline. Undefined while nobody has been told anything.
     */
    protected announced: IAnnouncement<R> | undefined = undefined;

    /** The cached body result, undefined until the first compute. */
    protected value: R | undefined = undefined;
    /** Whether the cached value can be trusted; cleared when a dependency moves or the last listener leaves. */
    protected valid: boolean = false;

    /**
     * Takes the body whose reads become this value's dependencies.
     *
     * @param body - runs against a tracking reader; everything it reads becomes a dependency
     * @param options - `equals` judges two results by content instead of by reference
     */
    constructor(protected body: TComputeBody<R>, protected options: IComputedOptions<R> = {}) {
        // Files this computed's invalidation callback so computations upstream of it can
        // reach it when they are invalidated — including when their settlement fails and
        // nothing is announced.
        invalidationEdges.set(this.onDependencyChanged, this.markStale);
        computedDependencies.versions.set(this, () => this.versions);
    }

    /** The identity a component or another computed subscribes by. */
    public getUID(): string {
        return this.uid;
    }

    /** Bumped once per delivered change, not on every recompute. */
    public getVersion(): number {
        return this.version;
    }

    /** Includes unannounced changes to a previously rendered value. */
    public [CARBURETOR_SNAPSHOT_VERSION](): number {
        return this.version + this.snapshotRevision;
    }

    /** The value, recomputing first if it cannot be trusted. */
    public get(): R {
        if (this.isStale()) {
            this.recompute();
        }

        return this.value as R;
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
        const wasUnobserved = this.subscribers.size === 0;
        const previous = this.subscribers.get(id);

        this.subscribers.set(id, {callback, generation: ++this.subscriptionGeneration});

        try {
            if (!this.valid || (wasUnobserved && this.hasDrifted())) {
                this.recompute(wasUnobserved);
            } else if (wasUnobserved) {
                this.attachDependencies(this.dependencies);
            }

            if (wasUnobserved && this.valid) {
                this.announced = {value: this.value as R, versions: this.versions};
            }
        } catch (error: unknown) {
            if (previous) {
                this.subscribers.set(id, previous);
            } else {
                this.subscribers.delete(id);
            }
            this.valid = false;
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
        if (!this.subscribers.has(id)) {
            return;
        }

        this.subscribers.delete(id);

        if (this.subscribers.size === 0) {
            this.releaseDependencies();
            this.valid = false;
        }
    }

    /** Whether the cached value can still be handed out, including deferred invalidations. */
    protected isStale(): boolean {
        return !this.valid || this.hasDrifted();
    }

    /** Whether any leaf source moved since this value was read. */
    protected hasDrifted(): boolean {
        const epoch = nativeStoreWriteEpoch.value;
        if (this.allNativeSources && this.validatedEpoch === epoch) {
            return false;
        }

        if (leafVersionsDrifted(this.versions, this.dependencies)) {
            return true;
        }

        this.validatedEpoch = epoch;

        return false;
    }

    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute(wasUnobserved: boolean = this.subscribers.size === 0): void {
        const collected: IDict<IDependency> = {};

        const track = (source: IReadableCarburetor<object> | IComputed<unknown>): unknown => {
            // Encode arbitrary public ids so __proto__ is an ordinary data key.
            const cuid = ':' + source.getUID();
            let dependency = computedDependencies.ownDependency(collected, cuid);

            if (!dependency) {
                dependency = {
                    source, reads: new Set<TPath>(), published: false, observed: false,
                    previous: computedDependencies.ownDependency(this.dependencies, cuid), overlap: 0,
                };
                collected[cuid] = dependency;
            }

            if ('read' in source) {
                // One persistent view per source, rebuilt only when its data object changed.
                let active = this.activeReads.get(cuid);
                if (!active) {
                    active = {current: undefined};
                    this.activeReads.set(cuid, active);
                }
                active.current = dependency;
                const slot = active;

                return this.views.view(source, (path: TPath) => {
                    if (slot.current) {
                        this.recordDependencyRead(slot.current, path);
                    }
                });
            }

            // Another computed notifies at the granularity of its whole value — no finer path
            // to depend on — routed through the recorder so an unchanged wildcard still counts.
            this.recordDependencyRead(dependency, WILDCARD_PATH);

            return source.get();
        };

        const previous = this.value;
        const hadValue = this.valid || Object.keys(this.versions).length > 0;
        const oldVersions = this.versions;
        const value = this.body(track as TComputedReader);
        try {
            this.attachDependencies(collected);
        } catch (error: unknown) {
            // Late reads go back to the still-published dependencies.
            computedDependencies.publishActiveReads(this.dependencies, this.activeReads);
            throw error;
        }
        computedDependencies.publishActiveReads(this.dependencies, this.activeReads);
        this.value = value;
        this.valid = true;

        // Before observation no dependency can announce a change to an already-rendered
        // value. A stable exotic result may have changed in place.
        const dependenciesMoved = wasUnobserved && hadValue && driftedSince(oldVersions, this.versions);
        if (dependenciesMoved) {
            if (announceIsUnchanged(undefined, previous, value, true, this.options.equals)) {
                this.value = previous as R;
            } else {
                this.snapshotRevision++;
            }
        }
    }

    /** Records body reads and extends adopted store edges for later live leaf reads.
     *
     * @param dependency - The edge receiving the read.
     * @param path - The recorded path.
     */
    protected recordDependencyRead(dependency: IDependency, path: TPath): void {
        if (dependency.reads.has(path)) {
            return;
        }

        dependency.reads.add(path);

        // Grown past the previous set, it cannot match: stop paying a lookup per path.
        if (dependency.previous !== undefined && dependency.reads.size > dependency.previous.reads.size) {
            dependency.previous = undefined;
        } else if (dependency.previous?.reads.has(path)) {
            dependency.overlap++;
        }

        if (dependency.published && typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            reportComputedEscape(this, (id: string) => this.subscribers.has(id));
        }

        const extend = (dependency.source as IInternalSubscriptionProtocol)[CARBURETOR_EXTEND];
        if (dependency.published && this.subscribers.size > 0 && extend) {
            extend.call(dependency.source, this.uid, path);
        }
    }

    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies(collected: IDict<IDependency>): void {
        const fresh = this.diffDependencies(collected);
        const previousVersions = this.versions;
        const previousAllNative = this.allNativeSources;
        const previousEpoch = this.validatedEpoch;
        this.recordVersions(collected);
        // Retained edges need no setup transaction or subscription churn.
        if (!fresh) {
            for (const cuid of Object.keys(this.dependencies)) {
                const previous = this.dependencies[cuid];
                const next = computedDependencies.ownDependency(collected, cuid);
                previous.published = false;
                if (next) {
                    next.published = true;
                    next.observed = previous.observed;
                    next.previous = undefined;
                } else if (previous.observed) {
                    computedDependencies.unsubscribe(previous.source, this.uid);
                }
            }
            this.dependencies = collected;
            return;
        }
        const attempted: string[] = [];
        try {
            if (this.subscribers.size > 0) {
                for (const cuid of fresh) {
                    const dependency = collected[cuid];
                    attempted.push(cuid);
                    computedDependencies.subscribe(dependency.source, this.onDependencyChanged,
                        transferReads(dependency.reads, this.uid));
                }
            }
        } catch (error: unknown) {
            // Restore replaced edges; release new edges, including a partially attached failure.
            for (const cuid of attempted.reverse()) {
                const previous = computedDependencies.ownDependency(this.dependencies, cuid);
                try {
                    if (previous?.observed && previous.source === collected[cuid].source) {
                        computedDependencies.subscribe(previous.source, this.onDependencyChanged,
                            transferReads(previous.reads, this.uid));
                    } else {
                        computedDependencies.unsubscribe(collected[cuid].source, this.uid);
                    }
                } catch { /* Preserve the attachment error. */ }
            }
            this.versions = previousVersions;
            this.allNativeSources = previousAllNative;
            this.validatedEpoch = previousEpoch;
            this.valid = false;
            throw error;
        }

        for (const cuid of Object.keys(this.dependencies)) {
            const previous = this.dependencies[cuid];
            previous.published = false;
            if (previous.observed && previous.source !== computedDependencies.ownDependency(collected, cuid)?.source) {
                computedDependencies.unsubscribe(previous.source, this.uid);
            }
        }
        for (const cuid of Object.keys(collected)) {
            const dependency = collected[cuid];
            dependency.published = true;
            dependency.observed = this.subscribers.size > 0;
            dependency.previous = undefined;
        }
        this.dependencies = collected;
    }

    /** Keeps equal read sets subscribed, and replaces changed or newly collected edges. */
    protected diffDependencies(collected: IDict<IDependency>): string[] | undefined {
        let fresh: string[] | undefined;

        for (const cuid of Object.keys(collected)) {
            const next = collected[cuid];
            const previous = computedDependencies.ownDependency(this.dependencies, cuid);
            if (!previous?.observed || next.source !== previous.source
                || (next !== previous && (next.overlap !== previous.reads.size
                    || next.overlap !== next.reads.size))) {
                (fresh ??= []).push(cuid);
            }
        }

        return fresh;
    }

    /** Flattens native dependency metadata; external sources expose their public version. */
    protected recordVersions(collected: IDict<IDependency>): void {
        const versions: IDict<ILeafVersion> = {};
        const allNative = captureLeafVersions(collected, versions);
        this.versions = versions;
        this.allNativeSources = allNative;
        this.validatedEpoch = nativeStoreWriteEpoch.value;
    }

    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies(): void {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            const dependency = this.dependencies[cuid];
            dependency.published = false;
            if (dependency.observed) {
                computedDependencies.unsubscribe(dependency.source, this.uid);
                dependency.observed = false;
            }
        });

        this.dependencies = {};
        for (const slot of this.activeReads.values()) {
            slot.current = undefined;
        }
    }

    /**
     * Invalidates on a dependency write, and settles once the wave around it has passed.
     *
     * A bound field, not a method: it is the key `invalidationEdges` files `markStale` under
     * and the callback a dependency's `subscribers` map holds, both called detached from
     * `this`, so its identity and receiver have to survive past this call.
     */
    protected onDependencyChanged = (): void => {
        // A pull during a transaction or throttle delay can refresh the cache without
        // delivering the change. The queued invalidation still owes a settlement against
        // the independent announcement baseline.
        if (this.valid && !this.hasDrifted()) {
            if (this.announced === undefined || !driftedSince(this.announced.versions, this.versions)) {
                return;
            }
        } else {
            // Propagate staleness through native dependencies before settlement starts.
            this.markStale();
        }

        // One write reaches this computed's dependencies one after another inside the same
        // pass. Settling for each notification would announce values built from inputs that
        // have not been told about the write yet — and recomputing mid-pass resubscribes the
        // dependency set, which can even consume an input's own invalidation. The wave
        // decides when it is this computed's turn: once, with every input already settled.
        if (updateWave.isActive()) {
            updateWave.defer(this.uid, this.settle);

            return;
        }

        this.settle();
    };

    /**
     * Marks this cached value untrustworthy and passes the mark downstream.
     *
     * The mark stops at value observers on purpose: they are woken when a changed value
     * is delivered, and a mark must not wake them into reading a computation that is
     * still mid-flight. Computed subscribers, however, must learn about the invalidation
     * even when no settlement of theirs follows — when the settlement upstream fails, no
     * announcement ever comes, and an unmarked dependent would keep serving its cached
     * value as if it were still current.
     *
     * A bound field, not a method: it is the value `invalidationEdges` maps this computed's
     * `onDependencyChanged` to, looked up and called detached from `this`.
     *
     * Returns early once `valid` is already false. Validity is monotone: `recompute` is the
     * only place that sets it true, and only after reading every current upstream, which
     * revalidates that upstream first — so an already-invalid computed's downstream was
     * already marked by whichever pass invalidated it. Every other site touching `valid`
     * (`subscribe`, `settle`, `unsubscribe`, a thrown body) only ever recomputes, clears it,
     * or leaves it alone.
     */
    protected markStale = (): void => {
        if (!this.valid) {
            return;
        }

        this.valid = false;

        // Live, not a snapshot: marking never subscribes or unsubscribes, so the map is stable.
        for (const record of this.subscribers.values()) {
            const mark = invalidationEdges.get(record.callback);

            if (mark) {
                mark();
            }
        }
    };

    /**
     * Recomputes and wakes subscribers if the value moved past what was last announced.
     *
     * A failed body or attachment preserves the last successful value and announcement.
     * The stale computation cannot announce an old value as a newly successful result.
     * The error escapes to the wave, which isolates it and keeps settling the other
     * computations; an explicit get() reruns the body and hands the error to its reader,
     * and the next write to a dependency retries it.
     *
     * The judgment itself — reference, the R6-02/R7-02 exotic-mutation carve-out, and the
     * caller's `equals` — is `announceIsUnchanged`'s; see its docstring for exactly which
     * case each rule covers and why `equals` cannot reach the exotic one.
     *
     * A bound field, not a method: `updateWave.defer` holds onto it and calls it detached
     * from `this` once the wave drains.
     */
    protected settle = (): void => {
        const previous = this.value;

        // A settlement queued while this value was stale can find it already valid by the
        // time its turn comes: an eager get() elsewhere in the wave — pulled by another
        // node's own settlement — already reran the body against the same upstream state
        // this settlement was deferred to wait for. Recomputing again would just repeat
        // that call for no new input.
        if (!this.valid || this.hasDrifted()) {
            this.recompute();
        }

        const moved = this.announced !== undefined && driftedSince(this.announced.versions, this.versions);
        const unchanged = announceIsUnchanged(this.announced, previous, this.value as R, moved, this.options.equals);

        if (unchanged) {
            this.value = this.announced !== undefined ? this.announced.value : previous;
            return;
        }

        this.announced = {value: this.value as R, versions: this.versions};
        this.version++;
        this.deliver();
    };

    /**
     * Wakes the subscribers owned by registrations present when delivery began.
     *
     * A leaver is skipped; replacing or readding a captured id creates a new registration
     * that waits for its own publication, even though its public id is unchanged. Each
     * subscriber is isolated, matching notifyWrites(): one that throws costs the
     * subscribers after it neither their notification nor the wave its remaining work, and
     * the failures are reported once delivery finishes rather than re-thrown.
     * A lone subscriber is called without copying the id list.
     */
    protected deliver(): void {
        let failures: unknown[] | undefined = undefined;
        const generation = this.subscriptionGeneration;
        // Snapshot past one subscriber: a leaver is skipped, a joiner waits for the next pass.
        const single = this.subscribers.size === 1;
        const ids = single ? this.subscribers.keys() : Array.from(this.subscribers.keys());

        for (const id of ids) {
            const record = this.subscribers.get(id);
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
