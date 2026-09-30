import { ICarburetorSubscription } from "../../Models/Store.mjs";
/** Base methods whose writes and versions are covered by the shared epoch. */
interface INativeStoreMethods {
    getVersion: () => number;
    emitUpdate: () => void;
}
/** Advances before deferred native-store delivery; shared across package copies. */
export declare const nativeStoreWriteEpoch: {
    value: number;
    sources: WeakMap<ICarburetorSubscription, INativeStoreMethods>;
};
export {};
