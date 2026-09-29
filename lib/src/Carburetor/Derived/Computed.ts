import {IDict, TSubscriber} from "@/Carburetor/Models/Base";
import {IComputed, IComputedOptions, TComputeBody, TComputedReader} from "@/Carburetor/Models/Derived";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetor, ICarburetorSubscription, ISubscribeOptions} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";
import {updateWave} from "@/Carburetor/Store/Scheduling/UpdateWaveInstance";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {transferReads} from "@/Carburetor/Store/Paths/Markers/transferReads";
import {announceIsUnchanged} from "./announceIsUnchanged";
import {reportComputedEscape} from "./reportComputedEscape";

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

/**
 * A dependency's source, with the store-only hook a live leaf read amends through. A computed
 * source never has `extend` — it notifies at the granularity of its whole value — so the field
 * is optional rather than widening `ICarburetorSubscription` itself for one caller.
 */
interface IDependencySource extends ICarburetorSubscription {
    extend?: (id: string, path: TPath) => void;
}

/** One source's read set for one recompute cycle, plus attachDependencies' own bookkeeping. */
interface IDependency {
    source: IDependencySource;
    reads: TPathSet;
    /** Set by attachDependencies once this becomes `this.dependencies[cuid]`. */
    published: boolean;
    /** Prior cycle's dependency for the same source, read only to count `overlap`. */
    previous: IDependency | undefined;
    /** Paths added to `reads` this cycle that `previous.reads` already held. */
    overlap: number;
}

/** One store a value was computed from, and the version it held at the time. */
interface IDependencyVersion {
    source: ICarburetorSubscription;
    version: number;
}

/** The value the last notification carried, and the dependency versions it was read from. */
interface IAnnouncement<R> {
    value: R;
    versions: IDict<IDependencyVersion>;
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
    /** Callbacks woken when a changed value settles, keyed by subscription id. */
    protected subscribers: Map<string, TSubscriber> = new Map<string, TSubscriber>();
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency> = {};

    /** The stores the current value was computed from, including those behind inner computeds. */
    protected versions: IDict<IDependencyVersion> = {};

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
    }

    /** The identity a component or another computed subscribes by. */
    public getUID(): string {
        return this.uid;
    }

    /** Bumped once per delivered change, not on every recompute. */
    public getVersion(): number {
        return this.version;
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

        this.subscribers.set(id, callback);

        // A value nobody reads is not worth keeping fresh, so dependencies are only observed
        // once someone is listening. While unobserved the computed misses every write, so
        // observation starts with a freshness check: the cached value survives only when the
        // stores it was computed from have not moved since. The check is `hasDrifted` rather
        // than `isStale` because the subscriber above already made this computed observed.
        if (!this.valid || (wasUnobserved && this.hasDrifted())) {
            this.recompute();
        } else if (wasUnobserved) {
            this.observeDependencies();
        }

        // First observation is the moment the value becomes a publication: whoever just
        // subscribed is looking at exactly this value, so it is the baseline the first
        // settlement is judged against. A body that just threw leaves the baseline alone —
        // there is nothing successful to be told about yet.
        if (wasUnobserved && this.valid) {
            this.announced = {value: this.value as R, versions: {...this.versions}};
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

    /** Whether the cached value can still be handed out. */
    protected isStale(): boolean {
        // Observed, invalidations arrive through the subscription, so `valid` is authoritative.
        if (this.subscribers.size > 0) {
            return !this.valid;
        }

        return !this.valid || this.hasDrifted();
    }

    /** Whether any store this value was computed from moved since it was read. */
    protected hasDrifted(): boolean {
        for (const cuid in this.versions) {
            const recorded = this.versions[cuid];

            if (recorded.source.getVersion() !== recorded.version) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether any dependency moved since the given version snapshot was taken.
     *
     * @param record - the versions captured at an earlier moment, e.g. alongside an announcement
     */
    protected driftedSince(record: IDict<IDependencyVersion>): boolean {
        for (const cuid in record) {
            const recorded = record[cuid];

            if (recorded.source.getVersion() !== recorded.version) {
                return true;
            }
        }

        // A body that now reads a store the snapshot never saw has changed inputs too.
        for (const cuid in this.versions) {
            if (!(cuid in record)) {
                return true;
            }
        }

        return false;
    }

    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute(): void {
        const collected: IDict<IDependency> = {};

        const track = (source: ICarburetor<object> | IComputed<unknown>): unknown => {
            const cuid = source.getUID();
            let dependency = collected[cuid];

            if (!dependency) {
                dependency = {
                    source, reads: new Set<TPath>(), published: false, previous: this.dependencies[cuid], overlap: 0,
                };
                collected[cuid] = dependency;
            }

            if ('read' in source) {
                return source.read((path: TPath) => {
                    this.recordDependencyRead(dependency, path);
                });
            }

            // Another computed notifies at the granularity of its whole value — no finer path
            // to depend on — routed through the recorder so an unchanged wildcard still counts.
            this.recordDependencyRead(dependency, WILDCARD_PATH);

            return source.get();
        };

        this.value = this.body(track as TComputedReader);
        this.valid = true;

        this.attachDependencies(collected);
    }

    /**
     * Records one path read through a dependency, amending an established registration
     * when the read arrives after the body's own evaluation.
     *
     * The value a computed hands out stays live: a consumer reading a deeper leaf off it
     * re-enters the read proxy the value was built from, whose recorder reports here long
     * after attachDependencies published the read set. Growing `dependency.reads` only grows
     * that Set; the store's own exact/branch index is separate and a plain mutation never
     * reaches it — while the leaf is exactly what that consumer renders from, and a write to
     * it must wake this computed. `extend` files just the new path into the existing
     * registration — O(path depth), not the O(read-set size) a full re-subscribe would cost
     * for every leaf a render adds.
     *
     * During the body's own evaluation `dependency.published` is still false — diffDependencies
     * flips it once the dependency is adopted into `this.dependencies` — so nothing is amended
     * there; once nobody listens there is no registration to amend either. `published` also
     * gates the development escape diagnostic (R15-02), and the overlap counted here against
     * the previous cycle's read set is what lets diffDependencies skip a second pass.
     *
     * @param dependency - the dependency edge the read belongs to
     * @param path - the path the read proxy reported, or the wildcard for an inner computed
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

        if (dependency.published && this.subscribers.size > 0 && dependency.source.extend) {
            dependency.source.extend(this.uid, path);
        }
    }

    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies(collected: IDict<IDependency>): void {
        // Only registrations the fresh collection does not already hold need work: kept
        // edges stay subscribed under the same id and read set, departed edges are
        // dropped, new or changed edges are subscribed below. Releasing a retained edge
        // instead would unsubscribe an upstream computed, whose last-subscriber release
        // invalidates it and drags the whole upstream chain through an eager recompute
        // mid-wave — work no settlement deduplicates, because it is not a settlement.
        const fresh = this.diffDependencies(collected);

        this.dependencies = collected;
        this.recordVersions(collected);

        // Dependencies are only observed while somebody is listening to the computed.
        if (this.subscribers.size === 0) {
            return;
        }

        Object.keys(collected).forEach((cuid: string) => {
            if (!fresh[cuid]) {
                return;
            }

            const dependency = collected[cuid];

            dependency.source.subscribe(this.onDependencyChanged, transferReads(dependency.reads, this.uid));
        });
    }

    /**
     * Splits a fresh collection into edges already held and edges needing a registration.
     *
     * Also flips `published` on each dependency object the instant it stops or starts being
     * the one `this.dependencies[cuid]` names — what a live `===` check did before — and
     * decides equality from the overlap recordDependencyRead already counted while filling
     * `next.reads`: the sets hold exactly the same paths exactly when that count equals both
     * sizes, so no second walk over either set is needed here.
     *
     * A kept edge survives with its live subscription untouched — same source, same read
     * set, same subscription id — so recomputing while observed never churns the upstream
     * subscriber list. Sources the body no longer reads are unsubscribed; a source still
     * read through different paths is reported as fresh, and the caller's subscribe
     * replaces that registration in place.
     *
     * @param collected - the dependencies the body just collected, compared against the held set
     * @returns the collected ids that still need a subscription: new sources, and sources
     * now read through different paths
     */
    protected diffDependencies(collected: IDict<IDependency>): IDict<boolean> {
        const fresh: IDict<boolean> = {};

        Object.keys(this.dependencies).forEach((cuid: string) => {
            const previous = this.dependencies[cuid];
            const next = collected[cuid];

            previous.published = false;

            if (!next) {
                previous.source.unsubscribe(this.uid);

                return;
            }

            if (next.overlap !== previous.reads.size || next.overlap !== next.reads.size) {
                fresh[cuid] = true;
            }
        });

        Object.keys(collected).forEach((cuid: string) => {
            const dependency = collected[cuid];

            dependency.published = true;

            // Only needed above, while `reads` was filled; dropped so cycles don't chain
            // dependency objects into a growing list nothing reads.
            dependency.previous = undefined;

            if (!(cuid in this.dependencies)) {
                fresh[cuid] = true;
            }
        });

        return fresh;
    }

    /**
     * Records the store versions the value was computed from. An inner computed hides the
     * stores behind it, so those are recorded in its place — otherwise a write they saw
     * while nobody was listening could never be noticed here.
     *
     * The body has just read every dependency, so their own records are current.
     */
    protected recordVersions(collected: IDict<IDependency>): void {
        const versions: IDict<IDependencyVersion> = {};

        const record = (dependency: IDependency): void => {
            if ('read' in dependency.source) {
                versions[dependency.source.getUID()] = {
                    source: dependency.source,
                    version: dependency.source.getVersion(),
                };

                return;
            }

            const inner = dependency.source as Computed<unknown>;

            Object.keys(inner.versions).forEach((cuid: string) => {
                versions[cuid] = inner.versions[cuid];
            });
        };

        Object.keys(collected).forEach((cuid: string) => {
            record(collected[cuid]);
        });

        this.versions = versions;
    }

    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies(): void {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            const dependency = this.dependencies[cuid];

            dependency.source.subscribe(this.onDependencyChanged, transferReads(dependency.reads, this.uid));
        });
    }

    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies(): void {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });

        this.dependencies = {};
    }

    /**
     * Invalidates on a dependency write, and settles once the wave around it has passed.
     *
     * A bound field, not a method: it is the key `invalidationEdges` files `markStale` under
     * and the callback a dependency's `subscribers` map holds, both called detached from
     * `this`, so its identity and receiver have to survive past this call.
     */
    protected onDependencyChanged = (): void => {
        // An upstream announcement can arrive after something else already pulled this
        // value fresh — an eager get() during a sibling's settlement, for instance. Once
        // recomputed, this value's own recorded versions bottom out at the same raw stores
        // the announcement traces back to, so a clean hasDrifted() here means the pull
        // already saw everything this notification is reporting: nothing to act on.
        if (this.valid && !this.hasDrifted()) {
            return;
        }

        // Invalidation travels before any settlement runs: everything downstream is marked
        // stale now, so a settlement that pulls a dependent's cached value recomputes it
        // from current inputs instead of combining a new input with a stale derived one.
        this.markStale();

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
        for (const callback of this.subscribers.values()) {
            const mark = invalidationEdges.get(callback);

            if (mark) {
                mark();
            }
        }
    };

    /**
     * Recomputes and wakes subscribers if the value moved past what was last announced.
     *
     * A body that throws changes nothing here: the value, `valid` and `announced` stand
     * untouched, so no old cached value can be announced as a newly successful computation.
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

        const moved = this.announced !== undefined && this.driftedSince(this.announced.versions);
        const unchanged = announceIsUnchanged(this.announced, previous, this.value as R, moved, this.options.equals);

        if (unchanged) {
            return;
        }

        this.announced = {value: this.value as R, versions: {...this.versions}};
        this.version++;
        this.deliver();
    };

    /**
     * Wakes every subscriber with the settled value.
     *
     * Each subscriber is isolated, matching notifyWrites(): one that throws costs the
     * subscribers after it neither their notification nor the wave its remaining work, and
     * the failures are reported once delivery finishes rather than re-thrown.
     * A lone subscriber is called without copying the id list.
     */
    protected deliver(): void {
        let failures: unknown[] | undefined = undefined;
        // Snapshot past one subscriber: a leaver is skipped, a joiner waits for the next pass.
        const single = this.subscribers.size === 1;
        const ids = single ? this.subscribers.keys() : Array.from(this.subscribers.keys());

        for (const id of ids) {
            try {
                this.subscribers.get(id)?.();
            } catch (error: unknown) {
                (failures ??= []).push(error);
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
