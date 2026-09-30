import {ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {nativeStoreWriteEpoch} from "./nativeStoreWriteEpoch";

/** Excludes adapters overriding the version reader or publication path.
 *
 * @param source - a flattened leaf dependency
 */
export const isNativeStoreSource = (source: ICarburetorSubscription): boolean => {
    const methods = nativeStoreWriteEpoch.sources.get(source);

    return methods !== undefined && source.getVersion === methods.getVersion
        && (source as ICarburetorSubscription & {emitUpdate?: () => void}).emitUpdate === methods.emitUpdate;
};
