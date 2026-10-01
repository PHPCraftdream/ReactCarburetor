import {IResourceCacheData} from '@/Carburetor/Models/Resource';
import {omitLockedCacheEntries} from './omitLockedCacheEntries';

/** Remove real dictionary slots before reporting removal to bookkeeping.
 *
 * @param data - current root.
 * @param keys - selected entries.
 * @param deferNotification - schedules publication.
 * @param effects - replacement, attribution and bookkeeping boundaries.
 */
export const removeCacheEntries = <T>(
    data: IResourceCacheData<T>, keys: string[], deferNotification: boolean,
    effects: {
        replace: (previous: IResourceCacheData<T>, next: IResourceCacheData<T>) => void;
        draft: () => IResourceCacheData<T>;
        current: () => IResourceCacheData<T>;
        forgot: (key: string, replaced: boolean) => void;
        publish: (defer: boolean) => void;
    }
): void => {
    const replacement = omitLockedCacheEntries(data, keys);
    if (replacement) {
        effects.replace(data, replacement);
        return;
    }
    const draft = effects.draft();
    keys.forEach((key) => {
        const removed = data.entries[key];
        try {
            delete draft.entries[key];
        } finally {
            if (effects.current() === data && data.entries[key] !== removed) {
                effects.forgot(key, Object.prototype.hasOwnProperty.call(data.entries, key));
            }
        }
    });
    effects.publish(deferNotification);
};
