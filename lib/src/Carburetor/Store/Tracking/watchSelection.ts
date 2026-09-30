import {TDisposer, TReadonly} from '@/Carburetor/Models/Base';
import {TPath, TPathSet, TPathRecorder} from '@/Carburetor/Models/Paths';
import {ICarburetorSubscription, TSelector} from '@/Carburetor/Models/Store';
import {sameSelection} from '@/Carburetor/Component/Connection/sameSelection';
import {transferReads} from '@/Carburetor/Store/Paths/Markers/transferReads';
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
    let previous: R = detachWatchSelection(initial.value);

    const callback = (): void => {
        const fresh = runSelector(source, select);
        const changed = !sameSelection(previous, fresh.value);
        const last = previous;
        if (changed) previous = detachWatchSelection(fresh.value);
        // Finish comparison/detachment before re-filing tracked live-view reads.
        source.subscribe(callback, transferReads(fresh.reads, id));
        if (changed) onChange(previous, last);
    };
    source.subscribe(callback, transferReads(initial.reads, id));
    return () => { source.unsubscribe(id); };
};
