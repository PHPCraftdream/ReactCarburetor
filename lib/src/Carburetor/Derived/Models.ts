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
    /** Diff marks membership directly; ordered fresh ids still own setup and rollback. */
    fresh?: boolean;
}

/** The slot a source's persistent view records through: the dependency of the run in progress,
 * then the published one once a recompute has attached.
 */
export interface IActiveReadSlot {
    /** Cleared on retirement and last release: retained views must not hold a retired source.
     * Slot identity is filed only by weak source keys, never by a source back-reference.
     */
    current: IDependency | undefined;
}

/** Module-private engine keys: symbol fields match StoreIdentity without ES2020 private lowering. */
export class C {
    /** Dependency identity independent of domain uid. */
    public static readonly uid = Symbol('computed.uid');
    /** Delivered-change revision. */
    public static readonly version = Symbol('computed.version');
    /** Unobserved evaluation revision. */
    public static readonly snapshotRevision = Symbol('computed.snapshotRevision');
    /** Observer registrations. */
    public static readonly subscribers = Symbol('computed.subscribers');
    /** Closed-observation generation. */
    public static readonly observationGeneration = Symbol('computed.observationGeneration');
    /** Registration generation. */
    public static readonly subscriptionGeneration = Symbol('computed.subscriptionGeneration');
    /** Published dependency edges. */
    public static readonly dependencies = Symbol('computed.dependencies');
    /** Persistent tracked view cache. */
    public static readonly views = Symbol('computed.views');
    /** Lazy weak source-identity recorder filing. */
    public static readonly readSlots = Symbol('computed.readSlots');
    /** Strong filing for current read routes. */
    public static readonly activeReads = Symbol('computed.activeReads');
    /** Independently captured evaluation leaf versions. */
    public static readonly versions = Symbol('computed.versions');
    /** Native epoch coverage. */
    public static readonly allNativeSources = Symbol('computed.allNativeSources');
    /** Last validated native epoch. */
    public static readonly validatedEpoch = Symbol('computed.validatedEpoch');
    /** Observer-only value and version baseline. */
    public static readonly announced = Symbol('computed.announced');
    /** Cached evaluation value. */
    public static readonly value = Symbol('computed.value');
    /** Evaluation validity. */
    public static readonly valid = Symbol('computed.valid');
    /** Constructor-supplied body. */
    public static readonly body = Symbol('computed.body');
    /** Constructor-supplied equality options. */
    public static readonly options = Symbol('computed.options');
    /** Evaluation freshness method. */
    public static readonly isStale = Symbol('computed.isStale');
    /** Leaf drift method. */
    public static readonly hasDrifted = Symbol('computed.hasDrifted');
    /** Evaluation method. */
    public static readonly recompute = Symbol('computed.recompute');
    /** Persistent recorder factory isolated from evaluation state. */
    public static readonly createReadRecorder = Symbol('computed.createReadRecorder');
    /** Live read extension method. */
    public static readonly recordDependencyRead = Symbol('computed.recordDependencyRead');
    /** Ordered attachment transaction. */
    public static readonly attachDependencies = Symbol('computed.attachDependencies');
    /** Direct fresh-edge membership diff. */
    public static readonly diffDependencies = Symbol('computed.diffDependencies');
    /** Leaf version capture method. */
    public static readonly recordVersions = Symbol('computed.recordVersions');
    /** Observation close method. */
    public static readonly releaseDependencies = Symbol('computed.releaseDependencies');
    /** Stable upstream invalidation callback. */
    public static readonly onDependencyChanged = Symbol('computed.onDependencyChanged');
    /** Stable downstream staleness callback. */
    public static readonly markStale = Symbol('computed.markStale');
    /** Lazy generation-bound queued callback. */
    public static readonly queuedSettlement = Symbol('computed.queuedSettlement');
    /** Stable settlement callback. */
    public static readonly settle = Symbol('computed.settle');
    /** Observer delivery method. */
    public static readonly deliver = Symbol('computed.deliver');
}
