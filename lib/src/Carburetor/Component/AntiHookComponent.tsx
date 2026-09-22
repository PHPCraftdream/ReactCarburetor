import * as React from "react";
import {IDict, TEffect, TEffectCleanup, TEffectDeps, TReadonly} from "@/Carburetor/Models/Base";
import {IComputed} from "@/Carburetor/Models/Derived";
import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceSource, IResourceView} from "@/Carburetor/Models/Resource";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ICarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {shallowEqual} from "./shallowEqual";

interface ITrackedCarburetor {
    carburetor: ICarburetorSubscription;
    reads: TPathSet;
    version: number;
    generation: number;
    /** Read set as last actually registered; undefined means nothing is currently registered. */
    committed: TPathSet | undefined;
}

interface IEffectRecord {
    deps: TEffectDeps;
    cleanup: TEffectCleanup | undefined;
}

/**
 * Membership equality for path sets: same size, every member present — the identity of the
 * Set plays no role.
 */
const sameReads = (a: TPathSet, b: TPathSet): boolean => {
    if (a.size !== b.size) {
        return false;
    }

    for (const path of a) {
        if (!b.has(path)) {
            return false;
        }
    }

    return true;
};

/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount
 * or shouldComponentUpdate. If you do override those, call the super implementation —
 * otherwise effects, subscription cleanup or the props gate will not work.
 */
export class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    protected uid: string = getUid();

    /** Per-effect state: the deps it last ran with, and the cleanup it returned. */
    protected effects: IDict<IEffectRecord> = {};

    /**
     * Carburetors read by this component: what was read, and in which render.
     *
     * The records outlive unmount: releaseSubscriptions keeps them, so a replayed mount
     * lifecycle can restore the subscriptions without a render to refill them.
     */
    protected tracked: IDict<ITrackedCarburetor> = {};

    /** Number of the current, not yet committed render. */
    protected renderGeneration: number = 0;

    /** Stale entries this render found. Fetched after the commit — never during render. */
    protected staleResources: (() => void)[] = [];

    /**
     * A re-render of the parent must not cascade down the tree. Precise invalidation only
     * governs updates coming from a carburetor; without this gate every parent render would
     * re-render every descendant, which is the very cost the engine exists to avoid.
     *
     * This is safe here because a component does not depend on its parent to learn about
     * state: when its own data changes it re-renders itself through forceUpdate, which
     * bypasses shouldComponentUpdate.
     */
    public shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean {
        return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
    }

    /** Establishes the subscriptions this render collected, then fetches and runs effects. */
    public componentDidMount(): void {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.useEffects();
    }

    /** The same commit work as on mount, with the previous props' effects torn down first. */
    public componentDidUpdate(prevProps: Readonly<P>): void {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.unUseEffects(prevProps);
        this.useEffects();
    }

    /** Releases everything this component holds: effect cleanups first, subscriptions last. */
    public componentWillUnmount(): void {
        this.unUseEffects(this.props);
        this.releaseEffects();
        this.releaseSubscriptions();
    }

    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     */
    public useCarburetor = <T extends object>(carburetor: ICarburetor<T>): TReadonly<T> => {
        const tracked = this.track(carburetor);

        return carburetor.read((path: TPath) => {
            tracked.reads.add(path);
        });
    };

    /**
     * Reads a memoized derived value. The component subscribes to the computed itself,
     * not to its inputs, so it re-renders only when the derived value changes.
     */
    public useComputed = <R extends unknown>(computed: IComputed<R>): R => {
        this.track(computed).reads.add(WILDCARD_PATH);

        return computed.get();
    };

    /**
     * Reads one entry of a resource cache, and subscribes to that entry alone.
     *
     * A stale entry is not fetched here: a write during render notifies subscribers mid-render, which
     * is the hazard the rules report. The fetch is queued and runs after the commit, by which time
     * the subscription exists — so the answer reaches this component.
     *
     * An entry that failed is left alone. Retrying it from render would loop: the failure re-renders
     * the component, which would queue the same request again. A failed entry waits for an explicit
     * `refresh`, which is what the documented behaviour promises.
     */
    public useResource = <T extends unknown, TArgs extends unknown>(
        source: IResourceSource<T, TArgs>,
        args: TArgs
    ): IResourceView<T> => {
        this.track(source).reads.add(source.pathOf(args));

        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error;

        if (worthFetching) {
            this.staleResources.push(() => {
                void source.load(args);
            });
        }

        return view;
    };

    /** Runs the fetches render queued, now that the subscriptions they need exist. */
    protected loadStaleResources(): void {
        const queued = this.staleResources;

        this.staleResources = [];

        queued.forEach((load: () => void) => load());
    }

    /**
     * The read record for one source in the current render.
     *
     * A record from an earlier generation is replaced rather than extended, so reads that are
     * gone from this render do not keep the component subscribed to their paths.
     */
    protected track(source: ICarburetorSubscription): ITrackedCarburetor {
        const cuid = source.getUID();
        const known = this.tracked[cuid];

        const tracked: ITrackedCarburetor = known && known.generation === this.renderGeneration
            ? known
            : {
                carburetor: source,
                reads: new Set<TPath>(),
                version: source.getVersion(),
                generation: this.renderGeneration,
                committed: known ? known.committed : undefined
            };

        this.tracked[cuid] = tracked;

        return tracked;
    }

    /** Where a subclass declares its effects; called after every commit. */
    protected useEffects(): void {
    }

    // noinspection JSUnusedLocalSymbols
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void {
    }

    /**
     * Runs `callBack` when its dependencies changed since the last run.
     *
     * Whatever the effect returns is treated as its cleanup and is run before the effect runs
     * again, and on unmount — so setup and teardown stay paired per effect rather than being
     * one global hook for the whole component.
     */
    protected useEffect = (callBack: TEffect, name: string, deps: TEffectDeps): void => {
        const known = this.effects[name];

        if (known && shallowEqual(known.deps, deps)) {
            return;
        }

        if (known && known.cleanup) {
            known.cleanup();
        }

        const cleanup = callBack();

        this.effects[name] = {
            deps,
            cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        };
    };

    /** Runs every effect's cleanup once, on unmount, and forgets them. */
    protected releaseEffects(): void {
        Object.keys(this.effects).forEach((name: string) => {
            const cleanup = this.effects[name].cleanup;

            if (cleanup) {
                cleanup();
            }
        });

        this.effects = {};
    }

    /**
     * What a carburetor calls when a path this component read was written.
     *
     * `forceUpdate` deliberately skips `shouldComponentUpdate`: the props gate must not be able
     * to swallow an update the component is itself subscribed to.
     */
    protected onCarburetorUpdate = (): void => {
        this.forceUpdate();
    };

    /**
     * Establishes this render's subscriptions and drops the ones it no longer needs.
     *
     * Subscribing happens here rather than in render: render has to stay pure, otherwise an
     * abandoned concurrent render would leave subscriptions pointing at a component that was
     * never committed. The price is the window between render and commit, which is closed by
     * comparing the carburetor version.
     */
    protected commitSubscriptions(): void {
        const generation = this.renderGeneration;
        let changedDuringRender = false;

        Object.keys(this.tracked).forEach((cuid: string) => {
            const tracked = this.tracked[cuid];

            if (tracked.generation !== generation) {
                tracked.carburetor.unsubscribe(this.uid);
                delete this.tracked[cuid];

                return;
            }

            // An unchanged read set skips re-registering: SubscriberIndex would remove and
            // re-walk every ancestor of every path only to arrive at the same entries — pure
            // cost. The version check below still runs either way.
            if (tracked.committed === undefined || !sameReads(tracked.committed, tracked.reads)) {
                // Subscribing with the component's own id replaces the previous registration
                // instead of adding a second one. The carburetor copies the read set, so reads
                // happening later outside render cannot extend an established subscription.
                tracked.carburetor.subscribe(this.onCarburetorUpdate, {id: this.uid, reads: tracked.reads});

                tracked.committed = new Set<TPath>(tracked.reads);
            }

            if (tracked.carburetor.getVersion() !== tracked.version) {
                changedDuringRender = true;
            }
        });

        this.renderGeneration = generation + 1;

        if (changedDuringRender) {
            this.forceUpdate();
        }
    }

    /**
     * Unsubscribes from every tracked source, so a carburetor stops holding this instance.
     *
     * The read records survive the teardown: a commit can follow without a render to refill
     * them, because StrictMode replays the mount lifecycles (mount, unmount, mount) in
     * development, and that commit rebuilds the subscriptions from the records — render is
     * what fills them, and it does not run again.
     *
     * The records are re-stamped so the next commit accepts them: `commitSubscriptions` moves
     * `renderGeneration` past the generation that stamped the record, so a record kept as it
     * stood would read as stale and be dropped. No render runs between this method and that
     * commit, so the re-stamp cannot be mistaken for a future render's marks — a real render
     * stamps its reads with a fresh generation, which is what still lets it drop the reads it
     * no longer makes.
     *
     * `committed` is reset along with the subscriptions: the replayed mount's commit must
     * subscribe for real again even though its read set is identical — letting it count as
     * unchanged would leave the restore silently skipped.
     */
    protected releaseSubscriptions(): void {
        Object.keys(this.tracked).forEach((cuid: string) => {
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
            this.tracked[cuid].generation = this.renderGeneration;
            this.tracked[cuid].committed = undefined;
        });
    }
}
