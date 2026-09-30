import { IDict, TSubscriber } from "../Models/Base.js";
import { IComputed, IComputedOptions, TComputeBody } from "../Models/Derived.js";
import { TPath, TPathSet } from "../Models/Paths.js";
import { ICarburetorSubscription, ISubscribeOptions } from "../Models/Store.js";
import { ILeafVersion } from "./Freshness/Models.js";
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
    observed: boolean;
    /** Prior cycle's dependency for the same source, read only to count `overlap`. */
    previous: IDependency | undefined;
    /** Paths added to `reads` this cycle that `previous.reads` already held. */
    overlap: number;
}
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
export declare class Computed<R> implements IComputed<R> {
    protected body: TComputeBody<R>;
    protected options: IComputedOptions<R>;
    /** This computed's id, which dependencies are subscribed and released under. */
    protected uid: string;
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    protected version: number;
    /** Successful unobserved changes that had no subscriber to receive a publication. */
    protected snapshotRevision: number;
    /** Callbacks woken when a changed value settles, keyed by public subscription id. */
    protected subscribers: Map<string, IComputedSubscriber>;
    /** Distinguishes registrations created after a publication selected its subscribers. */
    private subscriptionGeneration;
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency>;
    /** Leaf versions, including flattened native computations and public external sources. */
    protected versions: IDict<ILeafVersion>;
    /** A shared write epoch is enough to trust a cache whose leaves are all native stores. */
    protected allNativeSources: boolean;
    /** Last epoch whose leaf versions were validated. */
    protected validatedEpoch: number;
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
    /** Includes unannounced changes to a previously rendered value. */
    getSnapshotVersion(): number;
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
    /** Whether the cached value can still be handed out, including deferred invalidations. */
    protected isStale(): boolean;
    /** Whether any leaf source moved since this value was read. */
    protected hasDrifted(): boolean;
    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute(wasUnobserved?: boolean): void;
    /** Records body reads and extends adopted store edges for later live leaf reads.
     *
     * @param dependency - The edge receiving the read.
     * @param path - The recorded path.
     */
    protected recordDependencyRead(dependency: IDependency, path: TPath): void;
    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies(collected: IDict<IDependency>): void;
    /** Keeps equal read sets subscribed, and replaces changed or newly collected edges. */
    protected diffDependencies(collected: IDict<IDependency>): string[] | undefined;
    /** Flattens native dependency metadata; external sources expose their public version. */
    protected recordVersions(collected: IDict<IDependency>): void;
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
    protected settle: () => void;
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
    protected deliver(): void;
}
export {};
