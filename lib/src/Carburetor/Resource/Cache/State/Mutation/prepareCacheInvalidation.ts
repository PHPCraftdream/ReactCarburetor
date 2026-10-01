import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';

const needsOwnership = <T>(data: IResourceCacheData<T>, key: string): boolean => {
    const entry = data.entries[key];
    if (!entry || (entry.invalidated === true && entry.failed === false)) return false;
    const slot = Object.getOwnPropertyDescriptor(data.entries, key);
    if (slot?.writable === false && slot.configurable === false) return true;
    return (entry.invalidated !== true && Object.getOwnPropertyDescriptor(entry, 'invalidated')?.writable === false)
        || (entry.failed !== false && Object.getOwnPropertyDescriptor(entry, 'failed')?.writable === false);
};

/** Reserve changed invalidation fields on a detached operational graph before publication.
 * An ordinary writable or already-invalidated entry needs no copy.
 *
 * @param data - current cache graph.
 * @param keyOrKeys - one key or all keys selected for invalidation.
 */
export const prepareCacheInvalidation = <T>(
    data: IResourceCacheData<T>, keyOrKeys: string | readonly string[]
): IResourceCacheData<T> | undefined => {
    if (typeof keyOrKeys === 'string') {
        if (!needsOwnership(data, keyOrKeys)) return undefined;
    } else {
        let restricted = false;
        for (const key of keyOrKeys) {
            if (needsOwnership(data, key)) { restricted = true; break; }
        }
        if (!restricted) return undefined;
    }

    const entries = data.entries;
    const keys = new Set<string>();
    const targets = new Set<IResourceEntry<T>>();
    if (typeof keyOrKeys === 'string') keys.add(keyOrKeys);
    else for (const key of keyOrKeys) keys.add(key);
    for (const key of keys) {
        const entry = entries[key];
        if (entry) targets.add(entry);
    }
    const prepared = cloneOwnedGraph(data, undefined, (source, field, descriptor) => {
        if (source === entries && typeof field === 'string' && keys.has(field) &&
            descriptor.writable === false && descriptor.configurable === false) {
            descriptor.writable = true;
            descriptor.configurable = true;
        } else if (targets.has(source as IResourceEntry<T>) &&
            ((field === 'invalidated' && descriptor.value !== true) ||
                (field === 'failed' && descriptor.value !== false)) && descriptor.writable === false) {
            descriptor.writable = true;
            descriptor.configurable = true;
        }
        return descriptor;
    }, true);
    for (const key of keys) {
        const entry = prepared.entries[key];
        if (!entry) continue;
        if (entry === entries[key]) throw new Error('ResourceCache: cannot own an opaque cache entry');
        if (entry.invalidated !== true) entry.invalidated = true;
        if (entry.failed !== false) entry.failed = false;
    }
    return prepared;
};
