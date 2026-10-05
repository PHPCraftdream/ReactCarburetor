import {TDisposer, TReadonly} from '@/Carburetor/Models/Base';
import {TPath, TPathSet} from '@/Carburetor/Models/Paths';
import {ICarburetorSubscription, TSelector} from '@/Carburetor/Models/Store';
import {completeObservation} from '@/Carburetor/Store/Tracking/Observation/completeObservation';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {sameReads} from '@/Carburetor/Store/Tracking/Observation/sameReads';
import {TCompletedReads} from '@/Carburetor/Store/Tracking/Observation/Models';
import {PersistentViews} from '@/Carburetor/Store/Tracking/Observation/PersistentViewCache';
import {detachWatchSelection} from '@/Carburetor/Store/Utils/Selection/detachWatchSelection';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {getUid} from '@/Carburetor/Store/Utils/getUid';

type TPathRecorder = (path: TPath) => void;

/** Same policy as detachWatchSelection, reused by the fused reconcile on changed branches. */
const rejectWatchInstance = (instance: object): never => {
    throw new Error(
        'watch() cannot select a live ' +
        (Object.getPrototypeOf(instance)?.constructor?.name || 'class') +
        ' instance because in-place changes cannot produce a safe comparison. Select the ' +
        'fields the callback needs, or return a plain object of those fields.'
    );
};

/** Collects the selector's value and tracked reads without a per-watch runner closure. */
const runSelector = <T, R>(
    source: {read: (record: TPathRecorder) => TReadonly<T>}, select: TSelector<T, R>,
    reads: {current: TPathSet}, views: PersistentViews
): {value: R; reads: TPathSet} => {
    reads.current = new Set<TPath>();
    const view = views.view(source, (path: TPath) => {
        reads.current.add(path);
    });
    return {value: select(view), reads: reads.current};
};

/** A watch's read set follows the selector even when its selected value stays unchanged.
 *
 * @param source - the tracked read and subscription source.
 * @param select - computes the selected value.
 * @param onChange - receives changed detached values.
 */
export const watchSelection = <T, R>(
    source: ICarburetorSubscription & {read: (record: TPathRecorder) => TReadonly<T>},
    select: TSelector<T, R>, onChange: (next: R, previous: R) => void
): TDisposer => {
    const id = getUid();
    const views = new PersistentViews();
    const reads: {current: TPathSet} = {current: new Set<TPath>()};
    const initial = runSelector(source, select, reads, views);
    initial.value = detachWatchSelection(initial.value);
    const completedInitial = completeObservation(initial);
    let previous: R = completedInitial.value;
    let installed: TCompletedReads = transferCompletedReads(
        completedInitial.reads, id
    ).reads as unknown as TCompletedReads;

    const callback = (): void => {
        const fresh = runSelector(source, select, reads, views);
        const next = reconcileSelection(previous, fresh.value, rejectWatchInstance) as R;
        const changed = next !== previous;
        const last = previous;
        if (changed) previous = next;
        fresh.value = previous;
        // The read set closes only after selection comparison and detachment finish.
        const completed = completeObservation(fresh);
        // Re-filed only when the read set actually moved: an unchanged set keeps the
        // subscriber index's record and skips the whole diff.
        if (!sameReads(installed, completed.reads as unknown as TCompletedReads)) {
            source.subscribe(callback, transferCompletedReads(completed.reads, id));
            installed = completed.reads as unknown as TCompletedReads;
        }
        if (changed) onChange(completed.value, last);
    };
    source.subscribe(callback, transferCompletedReads(completedInitial.reads, id));
    return () => { source.unsubscribe(id); };
};
