import {TDisposer, TReadonly, TSubscriber, TUpdater} from "./Base";
import {TPathRecorder, TPathSet} from "./Paths";

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

/** A carburetor as seen by the batch coordinator. */
export interface INotifiable {
    notifyWrites: (writes: TPathSet) => void;
}
