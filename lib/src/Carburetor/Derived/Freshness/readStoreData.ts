import {ICarburetorSubscription} from '@/Carburetor/Models/Store';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';

/** The data object a native store holds right now; other sources have no object to strand.
 *
 * @param source - a leaf dependency
 */
export const readStoreData = (source: ICarburetorSubscription): unknown =>
    isNativeStoreSource(source)
        ? (source as ICarburetorSubscription & {getData?: () => unknown}).getData?.() : undefined;
