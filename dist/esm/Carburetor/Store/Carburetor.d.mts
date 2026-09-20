import { IDict, TDisposer, TReadonly, TSubscriber } from "../Models/Base.mjs";
import { TPath, TPathRecorder, TPathSet } from "../Models/Paths.mjs";
import { ICarburetor, INotifiable, ISubscribeOptions, IUpdateScheduler } from "../Models/Store.mjs";
import { SubscriberIndex } from "./Paths/SubscriberIndex.mjs";
interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}
export declare class Carburetor<T extends object> implements ICarburetor<T>, INotifiable {
    protected data: T;
    protected scheduler: IUpdateScheduler;
    protected subscribers: IDict<ISubscriberRecord>;
    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex;
    protected uid: string;
    protected version: number;
    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet;
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean;
    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean;
    protected draftProxy: T | undefined;
    constructor(data: T, scheduler?: IUpdateScheduler);
    getUID: () => string;
    getVersion: () => number;
    getData: () => T;
    read: (record: TPathRecorder) => TReadonly<T>;
    setData: (data: T) => T;
    snapshot: () => T;
    restore: (data: T) => void;
    toJSON: () => unknown;
    fromJSON: (value: unknown) => void;
    subscribe: (callback: TSubscriber, options?: ISubscribeOptions) => string;
    unsubscribe: (id: string) => void;
    /** Subscribes outside React — for persistence, logging, analytics. */
    watch: (reads: TPathSet, callback: TSubscriber) => TDisposer;
    /** Called by the batch coordinator when a transaction closes. */
    notifyWrites: (writes: TPathSet) => void;
    /**
     * Writes go through draft: changed paths are remembered, and only the subscribers
     * that read those paths get woken up. Mutating this.data directly still works,
     * but loses precision — the whole store is then treated as changed.
     */
    protected get draft(): T;
    /**
     * Mutates and publishes in one step. Writing to `draft` and forgetting `emitUpdate()`
     * changes the data while nobody re-renders, which is why this is the recommended form.
     */
    protected update: (mutate: (draft: T) => void) => void;
    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon: () => void;
    protected touchDraft: () => void;
    protected recordWrite: (path: TPath) => void;
    protected preEmit: () => void;
    protected emitUpdate: () => void;
}
export {};
