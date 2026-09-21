import {IDict, TSubscriber} from "@/Carburetor/Models/Base";
import {IComputed, TComputeBody, TComputedReader} from "@/Carburetor/Models/Derived";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetor, ICarburetorSubscription, ISubscribeOptions} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

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

    /** Takes the body whose reads become this value's dependencies. */
    constructor(protected body: TComputeBody<R>) {
    }

    /** The identity a component or another computed subscribes by. */
    public getUID = (): string => {
        return this.uid;
    };

    /** Bumped only when the value actually changed, not on every recompute. */
    public getVersion = (): number => {
        return this.version;
    };

    /** The value, recomputing first if a dependency invalidated it. */
    public get = (): R => {
        if (!this.valid) {
            this.recompute();
        }

        return this.value as R;
    };

    /**
     * `options.reads` is accepted for interface compatibility and deliberately ignored:
     * a computed notifies at the granularity of its whole value, so there is no finer
     * path inside it to depend on.
     */
    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        const id = options.id || getUid();
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

    /**
     * Drops a subscriber, and stops observing dependencies once the last one leaves.
     *
     * The value is invalidated at the same time: while unobserved it receives no
     * invalidations, so what it holds cannot be trusted when someone subscribes again.
     */
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

    /** Runs the body, collecting the paths it reads as this computed's dependencies. */
    protected recompute = (): void => {
        const collected: IDict<IDependency> = {};

        const track = (source: ICarburetor<object> | IComputed<unknown>): unknown => {
            const cuid = source.getUID();
            const dependency = collected[cuid] || {source, reads: new Set<TPath>()};

            collected[cuid] = dependency;

            if ('read' in source) {
                return source.read((path: TPath) => {
                    dependency.reads.add(path);
                });
            }

            // Another computed notifies at the granularity of its whole value,
            // so there is no finer path to depend on than "it changed".
            dependency.reads.add(WILDCARD_PATH);

            return source.get();
        };

        this.value = this.body(track as TComputedReader);
        this.valid = true;

        this.attachDependencies(collected);
    };

    /** Swaps in a fresh dependency set, releasing the previous one first. */
    protected attachDependencies = (collected: IDict<IDependency>): void => {
        this.releaseDependencies();
        this.dependencies = collected;

        // Dependencies are only observed while somebody is listening to the computed.
        if (Object.keys(this.subscribers).length === 0) {
            return;
        }

        this.observeDependencies();
    };

    /** Subscribes to every dependency under this computed's own id. */
    protected observeDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            const dependency = this.dependencies[cuid];

            dependency.source.subscribe(this.onDependencyChanged, {id: this.uid, reads: dependency.reads});
        });
    };

    /** Unsubscribes from every dependency and forgets them. */
    protected releaseDependencies = (): void => {
        Object.keys(this.dependencies).forEach((cuid: string) => {
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });

        this.dependencies = {};
    };

    /** Recomputes on a dependency write, and wakes subscribers only if the result moved. */
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
