import {TDisposer, TReadonly} from '@/Carburetor/Models/Base';
import {TPath, TPathSet, TPathRecorder} from '@/Carburetor/Models/Paths';
import {ICarburetorSubscription, TSelector} from '@/Carburetor/Models/Store';
import {sameSelection} from '@/Carburetor/Component/Connection/sameSelection';
import {completeObservation} from '@/Carburetor/Store/Tracking/Observation/completeObservation';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {detachWatchSelection} from '@/Carburetor/Store/Utils/Selection/detachWatchSelection';
import {getUid} from '@/Carburetor/Store/Utils/getUid';

/** Collects the selector's value and tracked reads without a per-watch runner closure. */
const runSelector = <T, R>(
    source: {read: (record: TPathRecorder) => TReadonly<T>}, select: TSelector<T, R>
): {value: R; reads: TPathSet} => {
    const reads = new Set<TPath>();
    const view = source.read((path: TPath) => reads.add(path));
    return {value: select(view), reads};
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
    const initial = runSelector(source, select);
    initial.value = detachWatchSelection(initial.value);
    const completedInitial = completeObservation(initial);
    let previous: R = completedInitial.value;

    const callback = (): void => {
        const fresh = runSelector(source, select);
        const changed = !sameSelection(previous, fresh.value);
        const last = previous;
        if (changed) previous = detachWatchSelection(fresh.value);
        fresh.value = previous;
        // The read set closes only after selection comparison and detachment finish.
        const completed = completeObservation(fresh);
        source.subscribe(callback, transferCompletedReads(completed.reads, id));
        if (changed) onChange(completed.value, last);
    };
    source.subscribe(callback, transferCompletedReads(completedInitial.reads, id));
    return () => { source.unsubscribe(id); };
};
