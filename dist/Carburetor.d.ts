import { ICarburetor, IDict, IUpdateScheduler, TPath, TPathRecorder, TPathSet, TSubscriber } from "./Models.js";
interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}
export declare class Carburetor<T extends {}> implements ICarburetor<T> {
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
    read: (record: TPathRecorder) => T;
    setData: (data: T) => T;
    subscribe: (callback: TSubscriber, customId?: string, reads?: TPathSet) => string;
    unsubscribe: (id: string) => void;
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
