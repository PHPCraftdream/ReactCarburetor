import {IResourceEntry, IResourceView} from "@/Carburetor/Models/Resource";

/** Check whether a cached view still reflects its entry.
 *
 * @param view - Previously published view.
 * @param entry - Current stored entry.
 * @param stale - Current freshness verdict.
 */
export const isViewCurrent = <T>(view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean): boolean =>
    view.stale === stale
    && view.status === entry.status
    && Object.is(view.data, entry.data)
    && view.error === entry.error
    && view.updatedAt === entry.updatedAt
    && view.refreshing === entry.refreshing
    && view.invalidated === entry.invalidated
    && view.failed === entry.failed;
