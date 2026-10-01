import {IResourceCacheData} from '@/Carburetor/Models/Resource';

/** Apply only effective invalidation changes, leaving locked no-op fields untouched.
 *
 * @param data - original values used to decide which writes change state.
 * @param draft - writable draft of the same graph.
 * @param keyOrKeys - selected entry or entries.
 */
export const applyCacheInvalidation = <T>(
    data: IResourceCacheData<T>, draft: IResourceCacheData<T>, keyOrKeys: string | readonly string[]
): void => {
    if (typeof keyOrKeys === 'string') {
        const entry = data.entries[keyOrKeys];
        if (entry?.invalidated !== true) draft.entries[keyOrKeys].invalidated = true;
        if (entry?.failed !== false) draft.entries[keyOrKeys].failed = false;
        return;
    }
    for (const key of keyOrKeys) {
        const entry = data.entries[key];
        if (entry.invalidated !== true) draft.entries[key].invalidated = true;
        if (entry.failed !== false) draft.entries[key].failed = false;
    }
};
