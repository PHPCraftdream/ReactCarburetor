import { TReadonly } from "../../Models/Base.js";
import { ICarburetor, ICarburetorSubscription } from "../../Models/Store.js";
import { IAttemptEntry, IRenderAttempt, ITrackedView } from "../Models/Connection.js";
/**
 * `useCarburetor`'s root view for one carburetor: one read proxy reused across renders while the
 * data object stays the same, rebuilt when it changes. A non-trackable root is never cached.
 *
 * The recorder reads the record's `attempt`/`entry`, refreshed on every call, so a read counts
 * only while the attempt that last called `useCarburetor` for this carburetor is open. A view
 * captured by an older render and read after the current render's call is attributed to the
 * current attempt: at worst an extra subscribed path, never a missed one.
 *
 * @param views - the component's per-carburetor cache
 * @param carburetor - the store to read
 * @param getRenderAttempt - the attempt open on the owner at read time
 * @param attempt - the attempt open at this call
 * @param entry - this attempt's tracked entry for `carburetor`
 */
export declare const buildTrackedView: <T extends object>(views: WeakMap<ICarburetorSubscription, ITrackedView<object>>, carburetor: ICarburetor<T>, getRenderAttempt: () => IRenderAttempt | undefined, attempt: IRenderAttempt | undefined, entry: IAttemptEntry) => TReadonly<T>;
