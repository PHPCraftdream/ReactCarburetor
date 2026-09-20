import { ICarburetorSubscription, IComputed, IDict, TComputedReader, TPathSet, TSubscriber } from "./Models.mjs";
interface IDependency {
    source: ICarburetorSubscription;
    reads: TPathSet;
}
export type TComputeBody<R> = (read: TComputedReader) => R;
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
    constructor(body: TComputeBody<R>);
    getUID: () => string;
    getVersion: () => number;
    get: () => R;
    subscribe: (callback: TSubscriber, customId?: string) => string;
    unsubscribe: (id: string) => void;
    protected recompute: () => void;
    protected attachDependencies: (collected: IDict<IDependency>) => void;
    protected observeDependencies: () => void;
    protected releaseDependencies: () => void;
    protected onDependencyChanged: () => void;
}
export declare const computed: <R>(body: TComputeBody<R>) => Computed<R>;
export {};
