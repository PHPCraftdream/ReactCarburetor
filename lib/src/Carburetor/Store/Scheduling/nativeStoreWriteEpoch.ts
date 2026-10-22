import {ICarburetorSubscription} from "../../Models/Store";
import {sharedSingleton} from "../Utils/sharedSingleton";

/** Base methods whose writes and versions are covered by the shared epoch. */
interface INativeStoreMethods {
    getVersion: () => number;
    emitUpdate: () => void;
}

/** Advances before deferred native-store delivery; shared across package copies. */
export const nativeStoreWriteEpoch = sharedSingleton('nativeStoreWriteEpoch', () => ({
    value: 0,
    sources: new WeakMap<ICarburetorSubscription, INativeStoreMethods>(),
}));

