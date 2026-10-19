import {TDisposer, TReadonly} from '@/Carburetor/Models/Base';
import {TPath} from '@/Carburetor/Models/Paths';
import {ICarburetorSubscription, TSelector} from '@/Carburetor/Models/Store';
import {readCoverage} from '@/Carburetor/Store/Paths/Markers/readCoverage';
import {ReadLedger} from '@/Carburetor/Store/Paths/Markers/ReadLedger';
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

/** Runs the selector into the ledger's recording, matched against the filed set's recording. */
const runSelector = <T, R>(
    source: {read: (record: TPathRecorder) => TReadonly<T>}, select: TSelector<T, R>,
    ledger: ReadLedger, installed: TCompletedReads | undefined, views: PersistentViews
): {value: R} => {
    if (!ledger.open(source, installed)) ledger.begin(new Set<TPath>());
    const view = views.view(source, (path: TPath) => {
        ledger.record(path);
    });
    return {value: select(view)};
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
    const ledger = new ReadLedger();
    const versionOf = (source as {getVersion?: () => number}).getVersion;
    const initial = runSelector(source, select, ledger, undefined, views);
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
    const initialReads = ledger.close(false);
    let previous: R = initial.value;
    let installed: TCompletedReads = transferCompletedReads(initialReads, id).reads as unknown as TCompletedReads;

    const callback = (): void => {
        const fresh = runSelector(source, select, ledger, installed, views);
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
        const changed = !Object.is(next, previous);
        const last = previous;
        if (changed) previous = next;
        fresh.value = previous;
        // The read set closes only after selection comparison and detachment finish.
        let reads: TCompletedReads;
        if (viaLog === undefined) reads = ledger.close(true);
        else {
            reads = ledger.covered(installed) ? installed : readCoverage.extend(installed, ledger.spill());
            ledger.abandon();
        }
        // Re-filed only when the read set actually moved: an unchanged set keeps the
        // subscriber index's record and skips the whole diff.
        if (!sameReads(installed, reads)) {
            source.subscribe(callback, transferCompletedReads(reads, id));
            installed = reads;
        } else if (reads !== installed) {
            ledger.adopt(reads, installed);
        }
        if (changed) onChange(fresh.value as TReadonly<R>, last as TReadonly<R>);
    };
    source.subscribe(callback, transferCompletedReads(initialReads, id));
    // Owned only once the disposer exists: a throwing initial walk must not leak an owner.
    if (copies !== undefined) own(true);
    return () => {
        stopped = true;
        hold?.sync(undefined);
        source.unsubscribe(id);
    };
};
