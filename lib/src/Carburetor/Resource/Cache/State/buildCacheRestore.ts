import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {deepClone} from '@/Carburetor/Store/Utils/deepClone';
import {normalizeOwnedCacheReplay} from './normalizeOwnedCacheReplay';

/** Assemble restored entries with newer requests created by abort listeners.
 *
 * @param data - replay or ordinary snapshot.
 * @param owned - preserves captured descriptors and native topology.
 * @param current - current live request state.
 * @param liveKeys - keys still owned by controllers.
 * @param touch - initializes eviction ordering.
 * @param wasTouched - keeps newer reentrant ordering.
 */
export const buildCacheRestore = <T>(
    data: IResourceCacheData<T>, owned: boolean, current: IResourceCacheData<T>,
    liveKeys: Iterable<string>, touch: (key: string) => void, wasTouched: (key: string) => boolean
): IResourceCacheData<T> => {
    const entries: IResourceCacheData<T>['entries'] = owned ? data.entries : {};
    let liveEntries: Map<string, IResourceEntry<T>> | undefined;
    Object.keys(data.entries).forEach((key) => {
        const entry = data.entries[key];
        if (!owned) {
            const status = entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status;
            entries[key] = {...entry, refreshing: false, status};
        }
        if (!wasTouched(key)) touch(key);
    });
    for (const key of liveKeys) {
        const entry = current.entries[key];
        if (!entry) continue;
        if (owned) (liveEntries ||= new Map()).set(key, entry);
        else entries[key] = entry;
    }
    return owned ? normalizeOwnedCacheReplay(data, current.entries, liveEntries) : deepClone({entries});
};
