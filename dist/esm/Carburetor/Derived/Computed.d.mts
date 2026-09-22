import { IDict, TSubscriber } from "../Models/Base.mjs";
import { IComputed, TComputeBody } from "../Models/Derived.mjs";
import { TPathSet } from "../Models/Paths.mjs";
import { ICarburetorSubscription, ISubscribeOptions } from "../Models/Store.mjs";
interface IDependency {
    source: ICarburetorSubscription;
    reads: TPathSet;
}
/** One store a value was computed from, and the version it held at the time. */
interface IDependencyVersion {
    source: ICarburetorSubscription;
    version: number;
}
/** The value the last notification carried. */
interface IAnnouncement<R> {
    value: R;
}
/**
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export declare class Computed<R> implements IComputed<R> {
    protected body: TComputeBody<R>;
    /** This computed's id, which dependencies are subscribed and released under. */
    protected uid: string;
    /** Moves only when a changed value is announced, letting a component spot writes across a render. */
    protected version: number;
    /** Callbacks woken when a changed value settles, keyed by subscription id. */
    protected subscribers: IDict<TSubscriber>;
    /** What the current value was computed from, observed only while somebody is listening. */
    protected dependencies: IDict<IDependency>;
    /** The stores the current value was computed from, including those behind inner computeds. */
    protected versions: IDict<IDependencyVersion>;
    /** The value the last notification carried; undefined until the first one. */
    protected announced: IAnnouncement<R> | undefined;
    /** The cached body result, undefined until the first compute. */
    protected value: R | undefined;
    /** Whether the cached value can be trusted; cleared when a dependency moves or the last listener leaves. */
    protected valid: boolean;
    /** Takes the body whose reads become this value's dependencies. */
    constructor(body: TComputeBody<R>);
    /** The identity a component or another computed subscribes by. */
    getUID: () => string;
    /** Bumped once per delivered change, not on every recompute. */
    getVersion: () => number;
    /** The value, recomputing first if it cannot be trusted. */
    get: () => R;
    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     *
     * @param callback - woken only when a settled value differs from the last announced one
     * @param options - `id` keys the subscription for later unsubscribe; a uid is generated when omitted
     */
    subscribe: (callback: TSubscriber, options?: ISubscribeOptions) => string;
    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
    unsubscribe: (id: string) => void;
    /** Whether the cached value can still be handed out. */
    protected isStale: () => boolean;
    /** Whether any store this value was computed from moved since it was read. */
    protected hasDrifted: () => boolean;
    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute: () => void;
    /** Swaps in a fresh dependency set, keeping every edge the body still reads. */
    protected attachDependencies: (collected: IDict<IDependency>) => void;
    /**
     * Splits a fresh collection into edges already held and edges needing a registration.
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
    protected diffDependencies: (collected: IDict<IDependency>) => IDict<boolean>;
    /**
     * Whether two read sets name exactly the same paths.
     *
     * @param before - the paths an edge is currently registered under
     * @param after - the paths the fresh collection recorded for the same source
     * @returns true when both sets hold the same paths, so the registration can stay
     */
    protected sameReads: (before: TPathSet, after: TPathSet) => boolean;
    /**
     * Records the store versions the value was computed from. An inner computed hides the
     * stores behind it, so those are recorded in its place — otherwise a write they saw
     * while nobody was listening could never be noticed here.
     *
     * The body has just read every dependency, so their own records are current.
     */
    protected recordVersions: (collected: IDict<IDependency>) => void;
    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies: () => void;
    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies: () => void;
    /** Invalidates on a dependency write, and settles once the wave around it has passed. */
    protected onDependencyChanged: () => void;
    /**
     * Recomputes and wakes subscribers if the value moved past what was last announced.
     *
     * A body that throws changes nothing here: the value, `valid` and `announced` stand
     * untouched, so no old cached value can be announced as a newly successful computation.
     * The error escapes to the wave, which isolates it and keeps settling the other
     * computations; an explicit get() reruns the body and hands the error to its reader,
     * and the next write to a dependency retries it.
     */
    protected settle: () => void;
    /**
     * Wakes every subscriber with the settled value.
     *
     * Each subscriber is isolated, matching notifyWrites(): one that throws costs the
     * subscribers after it neither their notification nor the wave its remaining work, and
     * the failures are reported once delivery finishes rather than re-thrown.
     */
    protected deliver: () => void;
}
export {};
