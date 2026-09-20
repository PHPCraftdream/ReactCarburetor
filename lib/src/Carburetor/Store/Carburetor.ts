import {IDict, TDisposer, TReadonly, TSubscriber} from "../Models/Base";
import {TPath, TPathRecorder, TPathSet} from "../Models/Paths";
import {ICarburetor, INotifiable, ISubscribeOptions, IUpdateScheduler} from "../Models/Store";
import {deepClone} from "./Utils/deepClone";
import {SubscriberIndex} from "./Paths/SubscriberIndex";
import {WILDCARD_PATH} from "./Paths/WildcardPath";
import {syncUpdateScheduler} from "./Scheduling/SyncUpdateSchedulerInstance";
import {createReadProxy} from "./Tracking/createReadProxy";
import {createWriteProxy} from "./Tracking/createWriteProxy";
import {isTrackable} from "./Tracking/isTrackable";
import {updateBatch} from "./Transaction/UpdateBatchInstance";
import {getUid} from "./Utils/getUid";
import {diagnostics} from "./Diagnostics/DiagnosticsInstance";

// Declared locally rather than through @types/node: bundlers substitute this exact member
// expression at build time, which is what lets the guarded blocks below be dropped whole.
declare const process: {env: {NODE_ENV?: string}} | undefined;

interface ISubscriberRecord {
    callback: TSubscriber;
    reads: TPathSet;
}

export class Carburetor<T extends object> implements ICarburetor<T>, INotifiable {
    protected subscribers: IDict<ISubscriberRecord> = {};

    /** Finds the subscribers a write concerns without scanning all of them. */
    protected subscriberIndex: SubscriberIndex = new SubscriberIndex();
    protected uid: string = getUid();
    protected version: number = 0;

    /** Paths changed since the last emitUpdate. */
    protected writes: TPathSet = new Set<TPath>();

    /** Whether draft was touched: it tells an empty write set from "nothing changed". */
    protected draftTouched: boolean = false;

    /** An emit already scheduled for a later microtask, so the dev check stays quiet. */
    protected pendingEmit: boolean = false;
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

    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        const id = options.id || getUid();

        // A subscription without a path set is a subscription to everything: coarse,
        // but no update can be missed.
        const reads = options.reads ? new Set<TPath>(options.reads) : new Set<TPath>([WILDCARD_PATH]);

        this.subscribers[id] = {callback, reads};
        this.subscriberIndex.add(id, reads);

        return id;
    };

    public unsubscribe = (id: string) => {
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            this.subscriberIndex.remove(id);
            delete this.subscribers[id];
        }
    };

    /** Subscribes outside React — for persistence, logging, analytics. */
    public watch = (reads: TPathSet, callback: TSubscriber): TDisposer => {
        const id = this.subscribe(callback, {reads});

        return () => {
            this.unsubscribe(id);
        };
    };

    /** Called by the batch coordinator when a transaction closes. */
    public notifyWrites = (writes: TPathSet): void => {
        this.subscriberIndex.match(writes).forEach((id: string) => {
            // A subscriber may have unsubscribed while this batch was being delivered.
            const record = this.subscribers[id];

            if (record) {
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

        this.touchDraft();

        if (!isTrackable(data)) {
            return this.data;
        }

        if (!this.draftProxy) {
            this.draftProxy = createWriteProxy(data, this.recordWrite) as T;
        }

        return this.draftProxy;
    }

    /**
     * Mutates and publishes in one step. Writing to `draft` and forgetting `emitUpdate()`
     * changes the data while nobody re-renders, which is why this is the recommended form.
     */
    protected update = (mutate: (draft: T) => void): void => {
        mutate(this.draft);

        this.emitUpdate();
    };

    /** Publishes on the next microtask — for writes made where notifying now is unsafe. */
    protected emitSoon = (): void => {
        this.pendingEmit = true;

        queueMicrotask(() => {
            this.pendingEmit = false;
            this.emitUpdate();
        });
    };

    protected touchDraft = (): void => {
        if (this.draftTouched) {
            return;
        }

        this.draftTouched = true;

        // The message lives inside the guard, not in a method of its own: a class member
        // stays reachable whatever the branch does, so its string would survive into a
        // production bundle.
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            queueMicrotask(() => {
                if (!this.draftTouched || this.pendingEmit) {
                    return;
                }

                diagnostics.report(
                    'a write went through draft, but emitUpdate() was never called, so no ' +
                    'subscriber was notified. Prefer this.update(draft => ...), which does both.'
                );
            });
        }
    };

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
