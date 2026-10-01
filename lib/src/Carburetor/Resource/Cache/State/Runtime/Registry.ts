import {ICacheRuntime} from './Models';

/** Drops an owner record after its request and raw answer facts are both gone.
 *
 * @param records - current runtime map.
 * @param key - encoded cache key.
 * @param runtime - owner record to retain or remove.
 */
export const trimCacheRuntime = <T>(
    records: Map<string, ICacheRuntime<T>> | undefined, key: string, runtime: ICacheRuntime<T>
): Map<string, ICacheRuntime<T>> | undefined => {
    if (runtime.request || runtime.answer?.failure) return records;
    if (records?.get(key) === runtime) records.delete(key);
    return records?.size === 0 ? undefined : records;
};
