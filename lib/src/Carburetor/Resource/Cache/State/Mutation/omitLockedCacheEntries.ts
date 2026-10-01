import {IResourceCacheData} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';

/** Prepare a replacement only when a selected slot cannot be deleted in place.
 *
 * @param data - current graph.
 * @param keys - entries omitted from the replacement.
 */
export const omitLockedCacheEntries = <T>(
    data: IResourceCacheData<T>, keys: string[]
): IResourceCacheData<T> | undefined => {
    const entries = data.entries;
    if (!keys.some((key) => Object.getOwnPropertyDescriptor(entries, key)?.configurable === false)) {
        return undefined;
    }
    const omitted = new Set(keys);
    return cloneOwnedGraph(data, undefined, (source, key, descriptor) =>
        source === entries && typeof key === 'string' && omitted.has(key) ? undefined : descriptor, true);
};
