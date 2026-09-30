import { ICarburetorSubscription } from "../../Models/Store.js";
/** Excludes adapters overriding the version reader or publication path.
 *
 * @param source - a flattened leaf dependency
 */
export declare const isNativeStoreSource: (source: ICarburetorSubscription) => boolean;
