import {
    ICarburetor,
    IDict,
    IUpdateScheduler,
    TDisposer,
    TPath,
    TPathRecorder,
    TPathSet,
    TReadonly,
    TSubscriber
} from "./Models";
import {pathsIntersect, WILDCARD_PATH} from "./Paths";
import {deepClone} from "./Snapshot";
import {syncUpdateScheduler} from "./SyncUpdateScheduler";
import {INotifiable, updateBatch} from "./Transaction";
import {createReadProxy, createWriteProxy, isTrackable} from "./Tracking";
import {getUid} from "./Utils/getUid";

interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}

export class Carburetor<T extends {}> implements ICarburetor<T>, INotifiable {
    protected subscribers: IDict<ISubscriberRecord> = {};
    protected uid: string = getUid();
    protected version: number = 0;

    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet = new Set<TPath>();

    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean = false;
    protected draftProxy: T | undefined = undefined;

    constructor(protected data: T, protected scheduler: IUpdateScheduler = syncUpdateScheduler) {
    }

    public getUID = (): string => {
        return this.uid;
    };

    public getVersion = (): number => {
        return this.version;
    };

    public getData = (): T => {
        return this.data;
    };

    public read = (record: TPathRecorder): TReadonly<T> => {
        const data: unknown = this.data;

        if (!isTrackable(data)) {
            record(WILDCARD_PATH);

            return this.data as unknown as TReadonly<T>;
        }

        return createReadProxy(data, record) as unknown as TReadonly<T>;
    };

    public setData = (data: T): T => {
        this.data = data;
        this.draftProxy = undefined;
        this.writes.add(WILDCARD_PATH);

        this.emitUpdate();

        return data;
    };

    public snapshot = (): T => {
        return deepClone(this.data);
    };

    public restore = (data: T): void => {
        this.setData(deepClone(data));
    };

    public toJSON = (): unknown => {
        return this.snapshot();
    };

    public fromJSON = (value: unknown): void => {
        this.restore(value as T);
    };

    public subscribe = (callback: TSubscriber, customId?: string, reads?: TPathSet): string => {
        const id = customId || getUid();

        // A subscription without a path set is a subscription to everything: coarse,
        // but no update can be missed.
        this.subscribers[id] = {callback, reads: reads || new Set<TPath>([WILDCARD_PATH])};

        return id;
    };

    public unsubscribe = (id: string) => {
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            delete this.subscribers[id];
        }
    };

    /** Subscribes outside React — for persistence, logging, analytics. */
    public watch = (reads: TPathSet, callback: TSubscriber): TDisposer => {
        const id = this.subscribe(callback, undefined, new Set<TPath>(reads));

        return () => {
            this.unsubscribe(id);
        };
    };

    /** Called by the batch coordinator when a transaction closes. */
    public notifyWrites = (writes: TPathSet): void => {
        Object.keys(this.subscribers).forEach((id: string) => {
            // A subscriber may have unsubscribed while this batch was being delivered.
            const record = this.subscribers[id];

            if (record && pathsIntersect(record.reads, writes)) {
                this.scheduler.schedule(id, record.callback);
            }
        });
    };

    /**
     * Writes go through draft: changed paths are remembered, and only the subscribers
     * that read those paths get woken up. Mutating this.data directly still works,
     * but loses precision — the whole store is then treated as changed.
     */
    protected get draft(): T {
        const data: unknown = this.data;

        this.draftTouched = true;

        if (!isTrackable(data)) {
            return this.data;
        }

        if (!this.draftProxy) {
            this.draftProxy = createWriteProxy(data, this.recordWrite) as T;
        }

        return this.draftProxy;
    }

    protected recordWrite = (path: TPath) => {
        this.writes.add(path);
    };

    protected preEmit = () => {

    };

    protected emitUpdate = () => {
        this.preEmit();

        const changed: TPathSet | undefined = this.writes.size > 0 ? new Set<TPath>(this.writes) : undefined;
        const touched = this.draftTouched;

        this.writes.clear();
        this.draftTouched = false;

        // Draft was used, but no value actually changed — there is nobody to wake.
        if (!changed && touched) {
            return;
        }

        // Writes bypassed draft: the changed paths are unknown, so treat everything as changed.
        const writes = changed || new Set<TPath>([WILDCARD_PATH]);
        this.version++;

        if (updateBatch.isActive()) {
            updateBatch.add(this, writes);

            return;
        }

        this.notifyWrites(writes);
    };
}
