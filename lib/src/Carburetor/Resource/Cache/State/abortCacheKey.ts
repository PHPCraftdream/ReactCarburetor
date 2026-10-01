import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceCacheData} from '@/Carburetor/Models/Resource';

/** Remove ownership before abort listeners; never reset a replacement request.
 *
 * @param key - encoded request key.
 * @param controllers - current request controllers.
 * @param requests - joinable promises.
 * @param failures - raw failure owners.
 * @param failedRetries - controllers retrying a failed answer.
 * @param current - reads the current state after reentry.
 * @param update - applies and publishes the surviving cancellation.
 */
export const abortCacheKey = <T>(
    key: string, controllers: Map<string, AbortController>, requests: Map<string, Promise<void>>,
    failures: Map<string, unknown>, failedRetries: WeakSet<AbortController> | undefined,
    current: () => IResourceCacheData<T>,
    update: (change: (draft: IResourceCacheData<T>) => void) => void
): void => {
    const controller = controllers.get(key);
    if (!controller) return;
    controllers.delete(key);
    requests.delete(key);
    controller.abort();
    if (controllers.has(key)) return;
    const entry = current().entries[key];
    if (!entry || (entry.status !== EResourceStatus.Pending && !entry.refreshing)) return;
    const retryFailed = failedRetries?.has(controller) || failures.has(key);
    update((draft) => {
        if (entry.status === EResourceStatus.Pending) draft.entries[key].status = EResourceStatus.Idle;
        else draft.entries[key].refreshing = false;
        draft.entries[key].failed ||= retryFailed;
    });
};
