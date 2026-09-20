import * as React from "react";
import {ICarburetor, ICarburetorSubscription, IDict, TEffect, TPath, TPathSet} from "./Models";
import {getUid} from "./Utils/getUid";

interface ITrackedCarburetor {
    carburetor: ICarburetorSubscription;
    reads: TPathSet;
    version: number;
    generation: number;
}

/**
 * Base component that reads its state straight from carburetors.
 *
 * Contract: the lifecycle belongs to the base class. Subclasses override
 * useEffects/unUseEffects, not componentDidMount/componentDidUpdate/componentWillUnmount.
 * If you do override those, call the super implementation — otherwise effects and
 * subscription cleanup will not run.
 */
export class AntiHookComponent<P = {}, S = {}> extends React.Component<P, S> {
    protected uid: string = getUid();
    protected lastValues: IDict<unknown> = {};

    /** Carburetors read by this component: what was read, and in which render. */
    protected tracked: IDict<ITrackedCarburetor> = {};

    /** Number of the current, not yet committed render. */
    protected renderGeneration: number = 0;

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
        this.releaseSubscriptions();
    }

    /**
     * The only way to read state in render: returns tracked data. The component
     * subscribes to exactly the fields it actually reads, and re-renders only when
     * those fields change.
     */
    public useCarburetor = <T extends {}>(carburetor: ICarburetor<T>): T => {
        const cuid = carburetor.getUID();
        const known = this.tracked[cuid];

        const tracked: ITrackedCarburetor = known && known.generation === this.renderGeneration
            ? known
            : {
                carburetor,
                reads: new Set<TPath>(),
                version: carburetor.getVersion(),
                generation: this.renderGeneration
            };

        this.tracked[cuid] = tracked;

        return carburetor.read((path: TPath) => {
            tracked.reads.add(path);
        });
    };

    protected useEffects(): void {
    }

    // noinspection JSUnusedLocalSymbols
    protected unUseEffects(_prevProps: P): void {
    }

    protected useEffect = <TDep extends unknown>(callBack: TEffect, name: string, lastValue: TDep) => {
        if (name in this.lastValues) {
            if (this.lastValues[name] === lastValue) {
                return;
            }
        }

        this.lastValues[name] = lastValue;
        callBack();
    };

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

            // A copy, not the live set: reads outside render (in an event handler, say)
            // must not append paths to an already established subscription.
            tracked.carburetor.subscribe(this.onCarburetorUpdate, this.uid, new Set<TPath>(tracked.reads));

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
