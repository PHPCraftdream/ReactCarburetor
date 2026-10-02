import {TReadonly} from "@/Carburetor/Models/Base";
import {TPath} from "@/Carburetor/Models/Paths";
import {IReadableCarburetor, ICarburetorSubscription} from "@/Carburetor/Models/Store";
import {IAttemptEntry, IRenderAttempt, ITrackedView} from "@/Carburetor/Component/Models/Connection";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

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
export const buildTrackedView = <T extends object>(
    views: WeakMap<ICarburetorSubscription, ITrackedView<object>>,
    carburetor: IReadableCarburetor<T>,
    getRenderAttempt: () => IRenderAttempt | undefined,
    attempt: IRenderAttempt | undefined,
    entry: IAttemptEntry
): TReadonly<T> => {
    const data = carburetor.getData();

    if (!isTrackable(data)) {
        return carburetor.read((path: TPath) => {
            if (attempt !== undefined) {
                entry.reads.add(path);
            }
        }) as unknown as TReadonly<T>;
    }

    const cached = views.get(carburetor) as ITrackedView<T> | undefined;

    if (cached !== undefined && cached.data === data) {
        cached.attempt = attempt;
        cached.entry = entry;

        return cached.view;
    }

    const tracked: ITrackedView<T> = {data, view: undefined as unknown as TReadonly<T>, attempt, entry};

    tracked.view = carburetor.read((path: TPath) => {
        if (tracked.attempt !== undefined && getRenderAttempt() === tracked.attempt) {
            (tracked.entry as IAttemptEntry).reads.add(path);
        }
    });

    views.set(carburetor, tracked as unknown as ITrackedView<object>);

    return tracked.view;
};
