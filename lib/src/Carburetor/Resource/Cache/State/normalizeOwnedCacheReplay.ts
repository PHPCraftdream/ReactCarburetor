import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {cloneOwnedGraph} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';

const statusFlags = ['isIdle', 'isPending', 'isSuccess', 'isError'] as const;
type TFlagField = typeof statusFlags[number];

/** The normalized status and its derived flags for one captured entry. */
interface INormalizedEntry {
    status: EResourceStatus;
    flags: ReturnType<typeof resourceStatusFlags>;
}

/** Descriptor-aware write: replaces a locked value in place, assigns a writable one.
 *
 * A non-configurable, non-writable field cannot be redefined at all: the caller must
 * have forced the graph copy (needsCopy), and an equal value is never written so the
 * copied descriptor stays intact.
 */
const writeValue = (entry: object, field: string, value: unknown): void => {
    const descriptor = Object.getOwnPropertyDescriptor(entry, field);
    if (descriptor && Object.is(descriptor.value, value)) return;
    if (descriptor?.writable === false) {
        if (descriptor.configurable === false) return;
        descriptor.value = value;
        Object.defineProperty(entry, field, descriptor);
    } else {
        (entry as Record<string, unknown>)[field] = value;
    }
};

/** Normalize only cache entries, preserving every other descriptor and native backlink.
 *
 * Status flags are always derived here; incoming flag values are ignored.
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
    const normalized = new Map<object, INormalizedEntry>();

    for (const key of keys) {
        if (liveEntries?.has(key)) {
            const slot = Object.getOwnPropertyDescriptor(entries, key);
            if (slot?.writable === false && slot.configurable === false) needsCopy = true;
            continue;
        }
        const entry = entries[key];
        const status = entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status;
        const info: INormalizedEntry = {status, flags: resourceStatusFlags(status)};
        normalized.set(entry, info);
        if (entry.refreshing) {
            const refreshing = Object.getOwnPropertyDescriptor(entry, 'refreshing');
            if (refreshing?.writable === false && refreshing.configurable === false) needsCopy = true;
        }
        for (const field of ['status', 'refreshing', ...statusFlags] as const) {
            const descriptor = Object.getOwnPropertyDescriptor(entry, field);
            // A missing or writable field is fixed in place after the pass; only a fully
            // locked one forces the graph copy.
            if (descriptor?.writable === false && descriptor.configurable === false) needsCopy = true;
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
            } else {
                const info = normalized.get(source);
                if (info) {
                    if (key === 'status') descriptor.value = info.status;
                    else if (typeof key === 'string' && (statusFlags as readonly string[]).includes(key)) {
                        descriptor.value = info.flags[key as TFlagField];
                    } else if (key === 'refreshing' && descriptor.value) {
                        descriptor.value = false;
                    }
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
        for (const key of keys) {
            if (liveEntries?.has(key)) continue;
            const info = normalized.get(copied.entries[key]);
            if (!info) continue;
            for (const field of statusFlags) {
                writeValue(copied.entries[key], field, info.flags[field]);
            }
        }
        return copied;
    }

    for (const key of keys) {
        if (liveEntries?.has(key)) continue;
        const entry = entries[key];
        const info = normalized.get(entry)!;
        if (entry.refreshing) {
            writeValue(entry, 'refreshing', false);
        }
        writeValue(entry, 'status', info.status);
        for (const field of statusFlags) {
            writeValue(entry, field, info.flags[field]);
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
