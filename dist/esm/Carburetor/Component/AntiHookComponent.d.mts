import * as React from "react";
import { IDict, TEffect, TEffectCleanup, TEffectDeps, TReadonly } from "../Models/Base.mjs";
import { IComputed } from "../Models/Derived.mjs";
import { IResourceSource, IResourceView } from "../Models/Resource.mjs";
import { TPathSet } from "../Models/Paths.mjs";
import { ICarburetor, ICarburetorSubscription } from "../Models/Store.mjs";
interface ITrackedCarburetor {
    carburetor: ICarburetorSubscription;
    reads: TPathSet;
    version: number;
    generation: number;
    /** Read set as last actually registered; undefined means nothing is currently registered. */
    committed: TPathSet | undefined;
}
interface IEffectRecord {
    deps: TEffectDeps;
    cleanup: TEffectCleanup | undefined;
}
/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount
 * or shouldComponentUpdate. If you do override those, call the super implementation —
 * otherwise effects, subscription cleanup or the props gate will not work.
 */
export declare class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    /** This component's identity: the id its carburetor subscriptions are keyed and replaced under. */
    protected uid: string;
    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<IEffectRecord>;
    /**
     * Carburetors read by this component: what was read, and in which render.
     *
     * The records outlive unmount: releaseSubscriptions keeps them, so a replayed mount
     * lifecycle can restore the subscriptions without a render to refill them.
     */
    protected tracked: IDict<ITrackedCarburetor>;
    /** Number of the current, not yet committed render. */
    protected renderGeneration: number;
    /** Stale entries this render found. Fetched after the commit — never during render. */
    protected staleResources: (() => void)[];
    /**
     * A re-render of the parent must not cascade down the tree. Precise invalidation only
     * governs updates coming from a carburetor; without this gate every parent render would
     * re-render every descendant, which is the very cost the engine exists to avoid.
     *
     * This is safe here because a component does not depend on its parent to learn about
     * state: when its own data changes it re-renders itself through forceUpdate, which
     * bypasses shouldComponentUpdate.
     *
     * @param nextProps - the incoming props, shallow-compared against the current ones; an object
     * or arrow rebuilt by the parent still counts as changed and lets the update through
     * @param nextState - the incoming state, compared with shallowEqual the same way; updates a
     * carburetor triggers never depend on this gate, since forceUpdate bypasses it
     */
    shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean;
    /** Establishes the subscriptions this render collected, then fetches and runs effects. */
    componentDidMount(): void;
    /** The same commit work as on mount, with the previous props' effects torn down first. */
    componentDidUpdate(prevProps: Readonly<P>): void;
    /** Releases everything this component holds: effect cleanups first, subscriptions last. */
    componentWillUnmount(): void;
    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     */
    useCarburetor: <T extends object>(carburetor: ICarburetor<T>) => TReadonly<T>;
    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    useComputed: <R extends unknown>(computed: IComputed<R>) => R;
    /**
     * Reads one entry of a resource cache, and subscribes to that entry alone.
     *
     * A stale entry is not fetched here: a write during render notifies subscribers mid-render, which
     * is the hazard the rules report. The fetch is queued and runs after the commit, by which time
     * the subscription exists — so the answer reaches this component.
     *
     * An entry that failed is left alone. Retrying it from render would loop: the failure re-renders
     * the component, which would queue the same request again. A failed entry waits for an explicit
     * `refresh`, which is what the documented behaviour promises.
     *
     * The status check alone cannot see every failure: an entry whose *refresh* failed keeps
     * `status: Success` with its old data. `failed` on the view is what stops this method from
     * re-queueing the same failing request from the failure's own notification; only a successful
     * answer, an explicit `refresh`/`load`, or a new `invalidate` re-arms a fetch.
     *
     * @param source - the cache entry's owner: `pathOf(args)` gives the path this render
     * subscribes to, and a stale entry queues a `load` for after the commit
     * @param args - the cache key, identifying the entry read now and targeted by the deferred
     * `load`; a different value reads a different entry
     */
    useResource: <T extends unknown, TArgs extends unknown>(source: IResourceSource<T, TArgs>, args: TArgs) => IResourceView<T>;
    /** Runs the fetches render queued, now that the subscriptions they need exist. */
    protected loadStaleResources(): void;
    /**
     * The read record for one source in the current render.
     *
     * A record from an earlier generation is replaced rather than extended, so reads that are
     * gone from this render do not keep the component subscribed to their paths.
     */
    protected track(source: ICarburetorSubscription): ITrackedCarburetor;
    /** Where a subclass declares its effects; called after every commit. */
    protected useEffects(): void;
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void;
    /**
     * Runs `callBack` when its dependencies changed since the last run.
     *
     * Whatever the effect returns is treated as its cleanup and is run before the effect runs
     * again, and on unmount — so setup and teardown stay paired per effect rather than being
     * one global hook for the whole component.
     *
     * @param callBack - the effect body; a function it returns becomes the cleanup, run before
     * the next run and on unmount
     * @param name - the key in the per-effect record, so two effects sharing one name would
     * overwrite each other's deps and cleanup
     * @param deps - compared shallowly with the last run's; an equal set skips the run and
     * leaves the existing cleanup standing
     */
    protected useEffect: (callBack: TEffect, name: string, deps: TEffectDeps) => void;
    /** Runs every effect's cleanup once, on unmount, and forgets them. */
    protected releaseEffects(): void;
    /**
     * What a carburetor calls when a path this component read was written.
     *
     * `forceUpdate` deliberately skips `shouldComponentUpdate`: the props gate must not be able
     * to swallow an update the component is itself subscribed to.
     */
    protected onCarburetorUpdate: () => void;
    /**
     * Establishes this render's subscriptions and drops the ones it no longer needs.
     *
     * Subscribing happens here rather than in render: render has to stay pure, otherwise an
     * abandoned concurrent render would leave subscriptions pointing at a component that was
     * never committed. The price is the window between render and commit, which is closed by
     * comparing the carburetor version.
     */
    protected commitSubscriptions(): void;
    /**
     * Unsubscribes from every tracked source, so a carburetor stops holding this instance.
     *
     * The read records survive the teardown: a commit can follow without a render to refill
     * them, because StrictMode replays the mount lifecycles (mount, unmount, mount) in
     * development, and that commit rebuilds the subscriptions from the records — render is
     * what fills them, and it does not run again.
     *
     * The records are re-stamped so the next commit accepts them: `commitSubscriptions` moves
     * `renderGeneration` past the generation that stamped the record, so a record kept as it
     * stood would read as stale and be dropped. No render runs between this method and that
     * commit, so the re-stamp cannot be mistaken for a future render's marks — a real render
     * stamps its reads with a fresh generation, which is what still lets it drop the reads it
     * no longer makes.
     *
     * `committed` is reset along with the subscriptions: the replayed mount's commit must
     * subscribe for real again even though its read set is identical — letting it count as
     * unchanged would leave the restore silently skipped.
     */
    protected releaseSubscriptions(): void;
}
export {};
