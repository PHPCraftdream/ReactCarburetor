import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {TPathSet} from "@/Carburetor/Models/Paths";
import {IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";

/**
 * Internal types of the derived layer: kept out of the public `Models/` barrel on purpose.
 */

/**
 * What a computed's live-read diagnostic needs to know about the component whose render is
 * currently on the stack; see `Derived/renderOwner.ts`.
 */
export interface IRenderOwner {
    /** The id this component would subscribe to a computed under. */
    uid: string;
    /**
     * Whether `source` is already tracked as a dependency of this render attempt — a
     * `useComputed(source)` call earlier in the same render body.
     *
     * @param source - the computed to check for
     */
    hasTracked: (source: ICarburetorSubscription) => boolean;
}

/**
 * A dependency's source, with the store-only hook a live leaf read amends through. A computed
 * source never carries the internal extend symbol — it notifies at the granularity of its whole
 * value — so the protocol members stay optional rather than widening `ICarburetorSubscription`
 * itself for one caller.
 */
export interface IDependencySource extends ICarburetorSubscription, IInternalSubscriptionProtocol {
}

/** One source's read set for one recompute cycle, plus attachDependencies' own bookkeeping. */
export interface IDependency {
    source: IDependencySource;
    reads: TPathSet;
    /** Set by attachDependencies once this becomes the published dependencies entry. */
    published: boolean;
    observed: boolean;
    /** Prior cycle's dependency for the same source, read only to count `overlap`. */
    previous: IDependency | undefined;
    /** Paths added to `reads` this cycle that `previous.reads` already held. */
    overlap: number;
}

/** The slot a source's persistent view records through: the dependency of the run in progress,
 * then the published one once a recompute has attached.
 */
export interface IActiveReadSlot {
    current: IDependency | undefined;
}
