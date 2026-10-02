import {IReadableCarburetor, ISubscribeOptions, TReadonly, TSubscriber} from '@/Carburetor';

interface IListener {
    callback: TSubscriber;
    reads: ReadonlySet<string> | undefined;
}

let nextAdapterId = 0;

/** Rejects mutation through a tracked view while leaving getData() raw. */
const rejectReadOnlyWrite = (): never => {
    throw new Error('read-only');
};

/** A six-method external source with its own path names and publication lifecycle. */
export class ReadableAdapter<T extends object> implements IReadableCarburetor<T> {
    private readonly uid = `readable-${++nextAdapterId}`;
    private readonly listeners = new Map<string, IListener>();
    private readonly pathsRead = new Set<string>();
    private nextSubscriptionId = 0;
    private version = 0;

    constructor(private data: T) {}

    public getUID(): string {
        return this.uid;
    }

    public getVersion(): number {
        return this.version;
    }

    public getData(): T {
        return this.data;
    }

    public read(record: (path: string) => void): TReadonly<T> {
        return this.track(this.data, '', record);
    }

    public subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = options.id ?? `${this.uid}:${++this.nextSubscriptionId}`;
        this.listeners.set(id, {
            callback,
            reads: options.reads === undefined ? undefined : new Set(options.reads),
        });
        return id;
    }

    public unsubscribe(id: string): void {
        this.listeners.delete(id);
    }

    public replace(data: T, changedPaths: ReadonlyArray<string>, notify = true): void {
        this.data = data;
        this.version++;

        if (!notify) {
            return;
        }

        const listeners = Array.from(this.listeners.values());
        for (const listener of listeners) {
            if (this.isRelevant(listener.reads, changedPaths)) {
                listener.callback();
            }
        }
    }

    public get subscriberCount(): number {
        return this.listeners.size;
    }

    /**
     * Returns the tracked type view: plain objects and arrays wrap nested values recursively;
     * non-plain objects keep the same behavior as the source's TReadonly surface.
     *
     * @param target - source object behind this layer of the view
     * @param prefix - path already read before reaching this layer
     * @param record - receives the path of each property read
     */
    private track<V extends object>(target: V, prefix: string, record: (path: string) => void): TReadonly<V>;
    private track(target: object, prefix: string, record: (path: string) => void): unknown {
        if (!Array.isArray(target) && Object.getPrototypeOf(target) !== Object.prototype &&
            Object.getPrototypeOf(target) !== null) {
            return target;
        }

        return new Proxy(target, {
            get: (current, key, receiver) => {
                if (typeof key !== 'string') {
                    return Reflect.get(current, key, receiver);
                }

                const path = prefix === '' ? key : `${prefix}.${key}`;
                this.pathsRead.add(path);
                record(path);

                const value = Reflect.get(current, key, receiver);

                if (value !== null && typeof value === 'object' &&
                    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype ||
                        Object.getPrototypeOf(value) === null)) {
                    return this.track(value, path, record);
                }

                return value;
            },
            set: rejectReadOnlyWrite,
            deleteProperty: rejectReadOnlyWrite,
            defineProperty: rejectReadOnlyWrite,
            setPrototypeOf: rejectReadOnlyWrite,
            preventExtensions: rejectReadOnlyWrite,
        });
    }

    private isRelevant(reads: ReadonlySet<string> | undefined, changedPaths: ReadonlyArray<string>): boolean {
        if (reads === undefined || reads.size === 0) {
            return reads === undefined;
        }

        // connect() records the engine's opaque paths instead of calling this adapter's read();
        // those paths are intentionally treated as whole-source subscriptions here.
        for (const read of reads) {
            if (!this.pathsRead.has(read)) {
                return true;
            }

            if (changedPaths.some((changed) => changed === read || changed.startsWith(`${read}.`) ||
                read.startsWith(`${changed}.`))) {
                return true;
            }
        }

        return false;
    }
}
