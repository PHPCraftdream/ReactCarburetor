import { IResourceEntry, IResourceView } from "../../Models/Resource.mjs";
/** Check whether a cached view still reflects its entry.
 *
 * @param view - Previously published view.
 * @param entry - Current stored entry.
 * @param stale - Current freshness verdict.
 */
export declare const isViewCurrent: <T>(view: IResourceView<T>, entry: IResourceEntry<T>, stale: boolean) => boolean;
