import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';

const requestFields: Readonly<Record<string, true>> = {
    status: true, data: true, error: true, updatedAt: true,
    refreshing: true, invalidated: true, failed: true,
};
const requestFieldNames = Object.keys(requestFields);

/** Reserve publication and settlement capabilities without modifying a live endpoint.
 *
 * @param data - current root.
 * @param key - encoded request key.
 * @param entry - prior answer requiring capability checks.
 */
export const prepareCacheRequest = <T>(
    data: IResourceCacheData<T>, key: string, entry: IResourceEntry<T> | undefined
): IResourceCacheData<T> | undefined => {
    if (!entry) return undefined;
    const entries = data.entries;
    const slot = Object.getOwnPropertyDescriptor(entries, key);
    let restricted = slot?.writable === false || slot?.configurable === false;
    for (const field of requestFieldNames) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, field);
        if (descriptor?.writable === false) restricted = true;
    }
    if (!restricted) return undefined;

    const prepared = cloneOwnedGraph(data, undefined, (source, field, descriptor) => {
        if (source === entries && field === key) {
            descriptor.writable = true;
            descriptor.configurable = true;
        } else if (source === entry && typeof field === 'string' && requestFields[field]) {
            descriptor.writable = true;
            descriptor.configurable = true;
        }
        return descriptor;
    }, 'operational');
    const next = prepared.entries[key];
    if (entry.status === EResourceStatus.Success) next.refreshing = true;
    else {
        next.status = EResourceStatus.Pending;
        next.error = undefined;
    }
    return prepared;
};
