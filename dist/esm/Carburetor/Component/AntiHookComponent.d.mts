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
    protected uid: string;
    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<IEffectRecord>;
    /** Carburetors read by this component: what was read, and in which render. */
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
     */
    shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean;
    componentDidMount(): void;
    componentDidUpdate(prevProps: Readonly<P>): void;
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
     */
    useResource: <T extends unknown, TArgs extends unknown>(source: IResourceSource<T, TArgs>, args: TArgs) => IResourceView<T>;
    protected loadStaleResources(): void;
    protected track(source: ICarburetorSubscription): ITrackedCarburetor;
    protected useEffects(): void;
    protected unUseEffects(_prevProps: P): void;
    /**
     * Runs `callBack` when its dependencies changed since the last run. Whatever the effect
     * returns is treated as its cleanup and is run before the effect runs again, and on
     * unmount — so setup and teardown stay paired per effect rather than being one global
     * hook for the whole component.
     */
    protected useEffect: (callBack: TEffect, name: string, deps: TEffectDeps) => void;
    protected releaseEffects(): void;
    protected onCarburetorUpdate: () => void;
    /**
     * Subscribing happens here rather than in render: render has to stay pure, otherwise
     * an abandoned concurrent render would leave subscriptions pointing at a component
     * that was never committed. The price is the window between render and commit,
     * which is closed by comparing the carburetor version.
     */
    protected commitSubscriptions(): void;
    protected releaseSubscriptions(): void;
}
export {};
