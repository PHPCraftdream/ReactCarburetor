import {ICarburetorSubscription} from '@/Carburetor/Models/Store';

export interface ILeafVersion {
    source: ICarburetorSubscription;
    version: number;
    /** Paths tracked by native store leaves, including paths flattened through a native chain. */
    reads?: ReadonlySet<string>;
    /** Constituent filed pairs of a fan-in merged leaf; drift is asked per part. */
    parts?: ReadonlyArray<{version: number; reads: ReadonlySet<string>}>;
    /** The store's data object at capture: replacing it strands live views of the old one. */
    data?: unknown;
}

export interface IReadSet {
    source: ICarburetorSubscription;
    reads: ReadonlySet<string>;
}
