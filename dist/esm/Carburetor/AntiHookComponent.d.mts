import * as React from "react";
import { ICarburetor, ICarburetorSubscription, IComputed, IDict, TEffect, TPathSet, TReadonly } from "./Models.mjs";
interface ITrackedCarburetor {
    carburetor: ICarburetorSubscription;
    reads: TPathSet;
    version: number;
    generation: number;
}
/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount.
 * If you do override those, call the super implementation — otherwise effects and
 * subscription cleanup will not run.
 */
export declare class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    protected uid: string;
    protected lastValues: IDict<unknown>;
    /** Carburetors read by this component: what was read, and in which render. */
    protected tracked: IDict<ITrackedCarburetor>;
    /** Number of the current, not yet committed render. */
    protected renderGeneration: number;
    componentDidMount(): void;
    componentDidUpdate(prevProps: Readonly<P>): void;
    componentWillUnmount(): void;
    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     */
    useCarburetor: <T extends {}>(carburetor: ICarburetor<T>) => TReadonly<T>;
    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    useComputed: <R extends unknown>(computed: IComputed<R>) => R;
    protected track(source: ICarburetorSubscription): ITrackedCarburetor;
    protected useEffects(): void;
    protected unUseEffects(_prevProps: P): void;
    protected useEffect: <TDep extends unknown>(callBack: TEffect, name: string, lastValue: TDep) => void;
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
