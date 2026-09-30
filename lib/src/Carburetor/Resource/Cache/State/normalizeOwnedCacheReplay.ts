import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';

/** Normalize only cache entries, preserving every other descriptor and native backlink.
 *
 * @param data - freshly owned replay graph.
 * @param liveDictionary - current dictionary providing newer request slot capabilities.
 * @param liveEntries - reentrant requests that supersede captured entries.
 */
export const normalizeOwnedCacheReplay = <T>(
    data: IResourceCacheData<T>, liveDictionary: IResourceCacheData<T>['entries'],
    liveEntries?: Map<string, IResourceEntry<T>>
): IResourceCacheData<T> => {
    const entries = data.entries;
    const keys = Object.keys(entries);
    let needsCopy = false;

    for (const key of keys) {
        if (liveEntries?.has(key)) {
            const slot = Object.getOwnPropertyDescriptor(entries, key);
            if (slot?.writable === false && slot.configurable === false) needsCopy = true;
            continue;
        }
        const entry = entries[key];
        if (entry.refreshing) {
            const refreshing = Object.getOwnPropertyDescriptor(entry, 'refreshing');
            if (refreshing?.writable === false && refreshing.configurable === false) needsCopy = true;
        }
        if (entry.status === EResourceStatus.Pending) {
            const status = Object.getOwnPropertyDescriptor(entry, 'status');
            if (status?.writable === false && status.configurable === false) needsCopy = true;
        }
    }

    if (needsCopy) {
        const actualEntries = new Set<object>();
        for (const key of keys) {
            if (!liveEntries?.has(key)) actualEntries.add(entries[key]);
        }
        // A locked entry (or dictionary slot) cannot be changed after ownership. Replace
        // its value during one complete graph copy, before installing the captured flags.
        const copied = cloneOwnedGraph(data, undefined, (source, key, descriptor) => {
            if (source === entries && typeof key === 'string' && liveEntries?.has(key)) {
                // Reserve the original key order without cloning an unrelated live request.
                descriptor.value = undefined;
                descriptor.configurable = true;
                descriptor.writable = true;
            } else if (actualEntries.has(source)) {
                if (key === 'status' && descriptor.value === EResourceStatus.Pending) {
                    descriptor.value = EResourceStatus.Idle;
                } else if (key === 'refreshing' && descriptor.value) {
                    descriptor.value = false;
                }
            }
            return descriptor;
        });
        if (liveEntries) {
            for (const [key, live] of liveEntries) {
                // A newer request needs its own dictionary slot flags: adopting a captured
                // readonly slot would make its subsequent draft settlement impossible.
                const slot = Object.getOwnPropertyDescriptor(liveDictionary, key);
                if (slot) {
                    slot.value = live;
                    Object.defineProperty(copied.entries, key, slot);
                }
                else copied.entries[key] = live;
            }
        }
        return copied;
    }

    for (const key of keys) {
        if (liveEntries?.has(key)) continue;
        const entry = entries[key];
        if (entry.refreshing) {
            const descriptor = Object.getOwnPropertyDescriptor(entry, 'refreshing');
            if (descriptor?.writable === false) {
                descriptor.value = false;
                Object.defineProperty(entry, 'refreshing', descriptor);
            } else {
                entry.refreshing = false;
            }
        }
        if (entry.status === EResourceStatus.Pending) {
            const descriptor = Object.getOwnPropertyDescriptor(entry, 'status');
            if (descriptor?.writable === false) {
                descriptor.value = EResourceStatus.Idle;
                Object.defineProperty(entry, 'status', descriptor);
            } else {
                entry.status = EResourceStatus.Idle;
            }
        }
    }
    if (liveEntries) {
        for (const [key, live] of liveEntries) {
            const slot = Object.getOwnPropertyDescriptor(entries, key);
            if (slot?.writable === false) {
                const current: PropertyDescriptor = Object.getOwnPropertyDescriptor(liveDictionary, key)
                    ?? {writable: true, configurable: true, enumerable: true};
                current.value = live;
                Object.defineProperty(entries, key, current);
            } else {
                entries[key] = live;
            }
        }
    }
    return data;
};
