import { IDict, TDisposer, TReadonly, TSubscriber } from "../Models/Base.js";
import { TPath, TPathRecorder, TPathSet } from "../Models/Paths.js";
import { ICarburetor, INotifiable, IUpdateScheduler } from "../Models/Store.js";
interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}
export declare class Carburetor<T extends {}> implements ICarburetor<T>, INotifiable {
    protected data: T;
    protected scheduler: IUpdateScheduler;
    protected subscribers: IDict<ISubscriberRecord>;
    protected uid: string;
    protected version: number;
    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet;
    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean;
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
    subscribe: (callback: TSubscriber, customId?: string, reads?: TPathSet) => string;
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
    protected recordWrite: (path: TPath) => void;
    protected preEmit: () => void;
    protected emitUpdate: () => void;
}
export {};
