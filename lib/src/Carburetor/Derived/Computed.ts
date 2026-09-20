import {IDict, TReadonly, TSubscriber} from "../Models/Base";
import {TComputeBody, TComputedReader, IComputed} from "../Models/Derived";
import {TPath, TPathSet} from "../Models/Paths";
import {ICarburetor, ICarburetorSubscription} from "../Models/Store";
import {getUid} from "../Store/getUid";

interface IDependency {
    source: ICarburetorSubscription;
    reads: TPathSet;
}

/**
 * A memoized derived value. The paths its body reads become its dependencies, so it is
 * recomputed only when one of them is written — never on every store update. Subscribers
 * are woken only when the derived value actually changed, so a write that does not move
 * the result (editing a title while a counter stays the same) re-renders nobody.
 */
export class Computed<R> implements IComputed<R> {
    protected uid: string = getUid();
    protected version: number = 0;
    protected subscribers: IDict<TSubscriber> = {};
    protected dependencies: IDict<IDependency> = {};
    protected value: R | undefined = undefined;
    protected valid: boolean = false;

    constructor(protected body: TComputeBody<R>) {
    }

    public getUID = (): string => {
        return this.uid;
    };

    public getVersion = (): number => {
        return this.version;
    };

    public get = (): R => {
        if (!this.valid) {
            this.recompute();
        }

        return this.value as R;
    };

    public subscribe = (callback: TSubscriber, customId?: string): string => {
        const id = customId || getUid();
        const wasUnobserved = Object.keys(this.subscribers).length === 0;

        this.subscribers[id] = callback;

        // A value nobody reads is not worth keeping fresh, so dependencies are only
        // observed once someone is listening — including the case where the value was
        // already computed by an unobserved read.
        if (!this.valid) {
            this.recompute();
        } else if (wasUnobserved) {
            this.observeDependencies();
        }

        return id;
    };

    public unsubscribe = (id: string) => {
        if (!(id in this.subscribers)) {
            return;
        }

        delete this.subscribers[id];

        if (Object.keys(this.subscribers).length === 0) {
            this.releaseDependencies();
            this.valid = false;
        }
    };

    protected recompute = (): void => {
        const collected: IDict<IDependency> = {};

        const read: TComputedReader = <T extends {}>(carburetor: ICarburetor<T>): TReadonly<T> => {
            const cuid = carburetor.getUID();
            const dependency = collected[cuid] || {source: carburetor, reads: new Set<TPath>()};

            collected[cuid] = dependency;

            return carburetor.read((path: TPath) => {
                dependency.reads.add(path);
            });
        };

        this.value = this.body(read);
        this.valid = true;

        this.attachDependencies(collected);
    };

    protected attachDependencies = (collected: IDict<IDependency>): void => {
        this.releaseDependencies();
        this.dependencies = collected;

        // Dependencies are only observed while somebody is listening to the computed.
        if (Object.keys(this.subscribers).length === 0) {
            return;
        }

        this.observeDependencies();
    };

    protected observeDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            const dependency = this.dependencies[cuid];

            dependency.source.subscribe(this.onDependencyChanged, this.uid, new Set<TPath>(dependency.reads));
        });
    };

    protected releaseDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });

        this.dependencies = {};
    };

    protected onDependencyChanged = (): void => {
        const previous = this.value;

        this.valid = false;
        this.recompute();

        if (Object.is(previous, this.value)) {
            return;
        }

        this.version++;

        Object.keys(this.subscribers).forEach((id: string) => {
            // A subscriber may have left while this very batch was being delivered.
            const callback = this.subscribers[id];

            if (callback) {
                callback();
            }
        });
    };
}
