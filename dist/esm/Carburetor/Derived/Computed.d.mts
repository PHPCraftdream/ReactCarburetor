import { IDict, TSubscriber } from "../Models/Base.mjs";
import { IComputed, IComputedOptions, TComputeBody } from "../Models/Derived.mjs";
import { TPath, TPathSet } from "../Models/Paths.mjs";
import { ICarburetorSubscription, ISubscribeOptions } from "../Models/Store.mjs";
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
export declare class Computed<R> implements IComputed<R> {
    protected body: TComputeBody<R>;
    protected options: IComputedOptions<R>;
    /** This computed's id, which dependencies are subscribed and released under. */
    protected uid: string;
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    protected version: number;
    /** Callbacks woken when a changed value settles, keyed by subscription id. */
    protected subscribers: Map<string, TSubscriber>;
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency>;
    /** The stores the current value was computed from, including those behind inner computeds. */
    protected versions: IDict<IDependencyVersion>;
    /**
     * The value an observer last had delivered: the baseline a settlement is judged
     * against, kept independently of the evaluation cache.
     *
     * It is set when the first subscriber arrives — the moment somebody starts actually
     * looking at the value — so a read that refreshes the cache mid-wave can never move
     * the baseline. Undefined while nobody has been told anything.
     */
    protected announced: IAnnouncement<R> | undefined;
    /** The cached body result, undefined until the first compute. */
    protected value: R | undefined;
    /** Whether the cached value can be trusted; cleared when a dependency moves or the last listener leaves. */
    protected valid: boolean;
    /**
     * Takes the body whose reads become this value's dependencies.
     *
     * @param body - runs against a tracking reader; everything it reads becomes a dependency
     * @param options - `equals` judges two results by content instead of by reference
     */
    constructor(body: TComputeBody<R>, options?: IComputedOptions<R>);
    /** The identity a component or another computed subscribes by. */
    getUID(): string;
    /** Bumped once per delivered change, not on every recompute. */
    getVersion(): number;
    /** The value, recomputing first if it cannot be trusted. */
    get(): R;
    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     *
     * @param callback - woken only when a settled value differs from the last announced one
     * @param options - `id` keys the subscription for later unsubscribe; a uid is generated when omitted
     */
    subscribe(callback: TSubscriber, options?: ISubscribeOptions): string;
    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
    unsubscribe(id: string): void;
    /** Whether the cached value can still be handed out. */
    protected isStale(): boolean;
    /** Whether any store this value was computed from moved since it was read. */
    protected hasDrifted(): boolean;
    /**
     * Whether any dependency moved since the given version snapshot was taken.
     *
     * @param record - the versions captured at an earlier moment, e.g. alongside an announcement
     */
    protected driftedSince(record: IDict<IDependencyVersion>): boolean;
    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute(): void;
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
    protected recordDependencyRead(dependency: IDependency, path: TPath): void;
    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies(collected: IDict<IDependency>): void;
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
    protected diffDependencies(collected: IDict<IDependency>): IDict<boolean>;
    /**
     * Records the store versions the value was computed from. An inner computed hides the
     * stores behind it, so those are recorded in its place — otherwise a write they saw
     * while nobody was listening could never be noticed here.
     *
     * The body has just read every dependency, so their own records are current.
     */
    protected recordVersions(collected: IDict<IDependency>): void;
    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies(): void;
    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies(): void;
    /**
     * Invalidates on a dependency write, and settles once the wave around it has passed.
     *
     * A bound field, not a method: it is the key `invalidationEdges` files `markStale` under
     * and the callback a dependency's `subscribers` map holds, both called detached from
     * `this`, so its identity and receiver have to survive past this call.
     */
    protected onDependencyChanged: () => void;
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
    protected markStale: () => void;
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
    protected settle: () => void;
    /**
     * Wakes every subscriber with the settled value.
     *
     * Each subscriber is isolated, matching notifyWrites(): one that throws costs the
     * subscribers after it neither their notification nor the wave its remaining work, and
     * the failures are reported once delivery finishes rather than re-thrown.
     * A lone subscriber is called without copying the id list.
     */
    protected deliver(): void;
}
export {};
