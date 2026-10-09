import {TDisposer, TReadonly} from '@/Carburetor/Models/Base';
import {TPath, TPathSet} from '@/Carburetor/Models/Paths';
import {ICarburetorSubscription, TSelector} from '@/Carburetor/Models/Store';
import {readCoverage} from '@/Carburetor/Store/Paths/Markers/readCoverage';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {completeObservation} from '@/Carburetor/Store/Tracking/Observation/completeObservation';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {sameReads} from '@/Carburetor/Store/Tracking/Observation/sameReads';
import {TCompletedReads} from '@/Carburetor/Store/Tracking/Observation/Models';
import {PersistentViews} from '@/Carburetor/Store/Tracking/Observation/PersistentViewCache';
import {reconcileFlatSelection} from '@/Carburetor/Store/Utils/Selection/reconcileFlatSelection';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {patchFromWriteLog} from '@/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog';
import {TargetsHold} from '@/Carburetor/Store/Utils/Selection/Patch/TargetsHold';
import {getUid} from '@/Carburetor/Store/Utils/getUid';

type TPathRecorder = (path: TPath) => void;

/** The watch policy for a live class instance met by the fused reconcile. */
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
    select: TSelector<T, R>,
    onChange: (next: TReadonly<R>, previous: TReadonly<R>) => void
): TDisposer => {
    const id = getUid();
    const views = new PersistentViews();
    const reads: {current: TPathSet} = {current: new Set<TPath>()};
    const versionOf = (source as {getVersion?: () => number}).getVersion;
    const initial = runSelector(source, select, reads, views);
    let liveSelection: unknown = initial.value;
    // R37-05: allocated only for an object selection; a primitive verdict needs no ledger.
    let copies: WeakMap<object, unknown> | undefined;
    let version = versionOf?.call(source);
    // R39-04: owns write proofs while a patch ledger exists, and never after the disposer ran.
    let hold: TargetsHold | undefined;
    let stopped = false;
    const own = (on: boolean): void => {
        if (stopped) return;
        if (on) (hold ??= new TargetsHold()).sync(source);
        else hold?.sync(undefined);
    };
    const trace = {shared: false};
    const flatInitial = reconcileFlatSelection(undefined, initial.value);
    if (flatInitial !== undefined) initial.value = flatInitial.value as R;
    else {
        if (initial.value !== null && typeof initial.value === 'object') {
            copies = new WeakMap<object, unknown>();
        }
        initial.value = reconcileSelection(
            undefined, initial.value, rejectWatchInstance, undefined, undefined, copies, trace
        );
    }
    let patchable = !trace.shared;
    const completedInitial = completeObservation(initial);
    let previous: R = completedInitial.value;
    let installed: TCompletedReads = transferCompletedReads(
        completedInitial.reads, id
    ).reads as unknown as TCompletedReads;

    const callback = (): void => {
        const fresh = runSelector(source, select, reads, views);
        const nowVersion = versionOf?.call(source);
        // R36-01: the same live view as last time, so the write log names what changed.
        const viaLog = version !== undefined && fresh.value === liveSelection && copies !== undefined
            ? patchFromWriteLog(
                source, version, previous, fresh.value, copies, rejectWatchInstance, undefined, patchable
            )
            : undefined;
        const flat = viaLog === undefined
            ? reconcileFlatSelection(previous, fresh.value)
            : undefined;
        let next: R;
        if (viaLog !== undefined) {
            next = viaLog;
        } else if (flat !== undefined) {
            next = flat.value as R;
            copies = undefined;
            own(false);
            patchable = true;
        } else if (fresh.value === null || typeof fresh.value !== 'object') {
            // Primitive verdicts cannot be shared, so no graph ledger is retained.
            next = (Object.is(previous, fresh.value) ? previous : fresh.value) as R;
            copies = undefined;
            own(false);
            patchable = true;
        } else {
            const nextCopies = new WeakMap<object, unknown>();
            own(true);
            next = reconcileSelection(
                previous, fresh.value, rejectWatchInstance, undefined, copies, nextCopies, trace
            ) as R;
            copies = nextCopies;
            patchable = !trace.shared;
        }
        liveSelection = fresh.value;
        version = nowVersion;
        const changed = next !== previous;
        const last = previous;
        if (changed) previous = next;
        fresh.value = previous;
        // The read set closes only after selection comparison and detachment finish.
        const completed = {value: fresh.value, reads: viaLog !== undefined
            ? readCoverage.extend(installed, fresh.reads) : completeReads(fresh.reads)};
        // Re-filed only when the read set actually moved: an unchanged set keeps the
        // subscriber index's record and skips the whole diff.
        if (!sameReads(installed, completed.reads as unknown as TCompletedReads)) {
            source.subscribe(callback, transferCompletedReads(completed.reads, id));
            installed = completed.reads as unknown as TCompletedReads;
        }
        if (changed) onChange(completed.value as TReadonly<R>, last as TReadonly<R>);
    };
    source.subscribe(callback, transferCompletedReads(completedInitial.reads, id));
    // Owned only once the disposer exists: a throwing initial walk must not leak an owner.
    if (copies !== undefined) own(true);
    return () => {
        stopped = true;
        hold?.sync(undefined);
        source.unsubscribe(id);
    };
};
