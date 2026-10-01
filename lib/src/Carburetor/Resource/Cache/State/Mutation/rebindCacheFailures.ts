import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';

/** Keep raw rejection ownership on surviving entries in a replacement graph.
 *
 * @param failures - rejection owners indexed by key.
 * @param from - previous root owning the entries.
 * @param to - replacement root preserving them.
 */
export const rebindCacheFailures = <T>(
    failures: ReadonlyMap<string, {entry: IResourceEntry<T>}>,
    from: IResourceCacheData<T>, to: IResourceCacheData<T>
): void => {
    failures.forEach((failure, key) => {
        if (failure.entry === from.entries[key] && to.entries[key]) failure.entry = to.entries[key];
    });
};
