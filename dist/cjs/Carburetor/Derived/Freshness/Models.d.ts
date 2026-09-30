import { ICarburetorSubscription } from '../../Models/Store.js';
export interface ILeafVersion {
    source: ICarburetorSubscription;
    version: number;
    /** Paths tracked by native store leaves, including paths flattened through a native chain. */
    reads?: ReadonlySet<string>;
}
export interface IReadSet {
    source: ICarburetorSubscription;
    reads: ReadonlySet<string>;
}
