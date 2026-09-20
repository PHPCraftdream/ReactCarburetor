export interface IDict<T> {
    [id: string]: T;
}
/** Subscriber callback: takes no arguments, data is read back through `read`. */
export type TSubscriber = () => void;
/** A component update queued by a scheduler. */
export type TUpdater = () => void;
/** Body of a component effect. */
export type TEffect = () => void;
/** Removes a subscription established outside React. */
export type TDisposer = () => void;
/** Timer handle: a number in the browser, a Timeout in Node — inferred from setTimeout itself. */
export type TTimerHandle = ReturnType<typeof setTimeout> | undefined;
/** Path to a data field, e.g. `items.workTodo1.title`. */
export type TPath = string;
export type TPathSet = Set<TPath>;
/** Records a path that has been read or written. */
export type TPathRecorder = (path: TPath) => void;
/**
 * Deeply immutable view of the data. Data read through a carburetor is read-only:
 * the proxy throws on a write at runtime, and this type makes the compiler say so first.
 */
export type TReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends ReadonlyArray<infer TItem> ? ReadonlyArray<TReadonly<TItem>> : T extends object ? {
    readonly [TKey in keyof T]: TReadonly<T[TKey]>;
} : T;
/**
 * Delivery policy for updates.
 * A carburetor delivers updates immediately by default; throttling is a deliberate
 * choice for streaming sources (sockets, mousemove), not a global rule.
 */
export interface IUpdateScheduler {
    schedule: (uid: string, updater: TUpdater) => void;
    cancel: (uid: string) => void;
}
/**
 * The part of the carburetor API that does not depend on the data type.
 * A component only needs the subscription surface, never the data itself, so it keeps
 * carburetors in this shape — that is how differently typed carburetors share one dictionary
 * without `any`.
 */
export interface ICarburetorSubscription {
    getUID: () => string;
    /** Write counter: lets a component detect data changes between render and commit. */
    getVersion: () => number;
    subscribe: (callback: TSubscriber, customId?: string, reads?: TPathSet) => string;
    unsubscribe: (id: string) => void;
}
/**
 * Type-erased state access, for tooling that cannot know the data type:
 * devtools, persistence, server-side hydration.
 */
export interface IInspectable extends ICarburetorSubscription {
    toJSON: () => unknown;
    fromJSON: (value: unknown) => void;
}
export interface ICarburetor<T> extends IInspectable {
    /** Untracked data, for code outside render. */
    getData: () => T;
    /** Tracked data: every field read is reported to `record`. */
    read: (record: TPathRecorder) => TReadonly<T>;
    setData: (data: T) => T;
    /** Detached deep copy of the data, safe to serialize or keep around. */
    snapshot: () => T;
    /** Replaces the data with a previously taken snapshot. */
    restore: (data: T) => void;
    /** Subscribes outside React: reacts to writes under the given paths. */
    watch: (reads: TPathSet, callback: TSubscriber) => TDisposer;
}
/** A memoized derived value that tracks its own dependencies. */
export interface IComputed<R> extends ICarburetorSubscription {
    get: () => R;
}
/** Reads a carburetor with tracking; used inside a computed body. */
export type TComputedReader = <T extends {}>(carburetor: ICarburetor<T>) => TReadonly<T>;
