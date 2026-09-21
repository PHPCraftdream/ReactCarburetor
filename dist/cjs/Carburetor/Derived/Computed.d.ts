import { IDict, TSubscriber } from "../Models/Base.js";
import { IComputed, TComputeBody } from "../Models/Derived.js";
import { TPathSet } from "../Models/Paths.js";
import { ICarburetorSubscription, ISubscribeOptions } from "../Models/Store.js";
interface IDependency {
    source: ICarburetorSubscription;
    reads: TPathSet;
}
/**
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export declare class Computed<R> implements IComputed<R> {
    protected body: TComputeBody<R>;
    protected uid: string;
    protected version: number;
    protected subscribers: IDict<TSubscriber>;
    protected dependencies: IDict<IDependency>;
    protected value: R | undefined;
    protected valid: boolean;
    /** Takes the body whose reads become this value's dependencies. */
    constructor(body: TComputeBody<R>);
    /** The identity a component or another computed subscribes by. */
    getUID: () => string;
    /** Bumped only when the value actually changed, not on every recompute. */
    getVersion: () => number;
    /** The value, recomputing first if a dependency invalidated it. */
    get: () => R;
    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     */
    subscribe: (callback: TSubscriber, options?: ISubscribeOptions) => string;
    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
    unsubscribe: (id: string) => void;
    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute: () => void;
    /** Swaps in a fresh dependency set, releasing the previous one first. */
    protected attachDependencies: (collected: IDict<IDependency>) => void;
    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies: () => void;
    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies: () => void;
    /** Recomputes on a dependency write, and wakes subscribers only if the result moved. */
    protected onDependencyChanged: () => void;
}
export {};
