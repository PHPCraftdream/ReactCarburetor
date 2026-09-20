import * as React from "react";
import {IDict, TEffect, TEffectCleanup, TEffectDeps, TReadonly} from "../Models/Base";
import {IComputed} from "../Models/Derived";
import {TPath, TPathSet} from "../Models/Paths";
import {ICarburetor, ICarburetorSubscription} from "../Models/Store";
import {getUid} from "../Store/Utils/getUid";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";
import {shallowEqual} from "./shallowEqual";

interface ITrackedCarburetor {
    carburetor: ICarburetorSubscription;
    reads: TPathSet;
    version: number;
    generation: number;
}

interface IEffectRecord {
    deps: TEffectDeps;
    cleanup: TEffectCleanup | undefined;
}

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

    /** Carburetors read by this component: what was read, and in which render. */
    protected tracked: IDict<ITrackedCarburetor> = {};

    /** Number of the current, not yet committed render. */
    protected renderGeneration: number = 0;

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

    public componentDidMount(): void {
        this.commitSubscriptions();
        this.useEffects();
    }

    public componentDidUpdate(prevProps: Readonly<P>): void {
        this.commitSubscriptions();
        this.unUseEffects(prevProps);
        this.useEffects();
    }

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

    protected track(source: ICarburetorSubscription): ITrackedCarburetor {
        const cuid = source.getUID();
        const known = this.tracked[cuid];

        const tracked: ITrackedCarburetor = known && known.generation === this.renderGeneration
            ? known
            : {
                carburetor: source,
                reads: new Set<TPath>(),
                version: source.getVersion(),
                generation: this.renderGeneration
            };

        this.tracked[cuid] = tracked;

        return tracked;
    }

    protected useEffects(): void {
    }

    // noinspection JSUnusedLocalSymbols
    protected unUseEffects(_prevProps: P): void {
    }

    /**
     * Runs `callBack` when its dependencies changed since the last run. Whatever the effect
     * returns is treated as its cleanup and is run before the effect runs again, and on
     * unmount — so setup and teardown stay paired per effect rather than being one global
     * hook for the whole component.
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

    protected releaseEffects(): void {
        Object.keys(this.effects).forEach((name: string) => {
            const cleanup = this.effects[name].cleanup;

            if (cleanup) {
                cleanup();
            }
        });

        this.effects = {};
    }

    protected onCarburetorUpdate = (): void => {
        this.forceUpdate();
    };

    /**
     * Subscribing happens here rather than in render: render has to stay pure, otherwise
     * an abandoned concurrent render would leave subscriptions pointing at a component
     * that was never committed. The price is the window between render and commit,
     * which is closed by comparing the carburetor version.
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

            // Subscribing with the component's own id replaces the previous registration
            // instead of adding a second one. The carburetor copies the read set, so reads
            // happening later outside render cannot extend an established subscription.
            tracked.carburetor.subscribe(this.onCarburetorUpdate, {id: this.uid, reads: tracked.reads});

            if (tracked.carburetor.getVersion() !== tracked.version) {
                changedDuringRender = true;
            }
        });

        this.renderGeneration = generation + 1;

        if (changedDuringRender) {
            this.forceUpdate();
        }
    }

    protected releaseSubscriptions(): void {
        Object.keys(this.tracked).forEach((cuid: string) => {
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
        });

        this.tracked = {};
    }
}
