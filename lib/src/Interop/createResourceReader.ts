import {IResourceResolution, IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';
import {TReadonly} from '@/Carburetor/Models/Base';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {TPath} from '@/Carburetor/Models/Paths';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {sameReads} from '@/Carburetor/Store/Tracking/Observation/sameReads';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {TCompletedReads} from '@/Carburetor/Store/Tracking/Observation/Models';
import {joinPath} from '@/Carburetor/Store/Paths/joinPath';
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';
import {reconcileFlatSelection} from '@/Carburetor/Store/Utils/Selection/reconcileFlatSelection';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {detachOpaque} from '@/Carburetor/Store/Utils/Selection/detachOpaque';
import {sameSelection} from '@/Carburetor/Component/Connection/sameSelection';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {VIEW_PATH} from '@/Carburetor/Store/Tracking/Models';
import {TargetsHold} from '@/Carburetor/Store/Utils/Selection/Patch/TargetsHold';
import {patchFromWriteLog} from '@/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog';
import {readCoverage} from '@/Carburetor/Store/Paths/Markers/readCoverage';
import {getUid} from '@/Carburetor/Store/Utils/getUid';
import {TSelector, TValueComparator} from './Models';

interface IObservation<T, TArgs, R> {
    args: TArgs;
    select: TSelector<IResourceView<T>, R>;
    isEqual: TValueComparator<R>;
    resolution: IResourceResolution<T>;
    version: number;
    value: R;
    reads: TCompletedReads;
    selectorReads: TCompletedReads | undefined;
    token: object;
    raw: object | undefined;
    branchPath: string | undefined;
    copies: WeakMap<object, unknown> | undefined;
    patchable: boolean;
}

/** Rejects values without a detached selection representation. */
const rejectInstance = (instance: object): never => {
    throw new Error('useResourceValue() cannot select a live ' +
        (Object.getPrototypeOf(instance)?.constructor?.name || 'class') +
        ' instance. Select rendered fields as plain values.');
};

/** One canonical resource owner, with closed observations and independently committed configuration.
 *
 * @param source - resource source.
 * @param path - canonical entry path.
 */
export const createResourceReader = <T, TArgs, R>(source: IResourceSource<T, TArgs>, path: TPath) => {
    let committed: IObservation<T, TArgs, R> | undefined;
    let cached: IObservation<T, TArgs, R> | undefined;
    let active: {id: string; reads: TCompletedReads} | undefined;
    let notify: (() => void) | undefined;
    let generation = 0;
    let token: object = {};
    let targets: TargetsHold | undefined;
    let settlement: Promise<void> | undefined;
    let installing = false;

    const evaluate = (
        args: TArgs, resolution: IResourceResolution<T>, select: TSelector<IResourceView<T>, R>,
        isEqual: TValueComparator<R>, previous?: IObservation<T, TArgs, R>, allowPatch = false
    ): IObservation<T, TArgs, R> => {
        const version = source.getVersion();
        const drift = (source as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT];
        if (previous && previous.select === select && previous.isEqual === isEqual
            && previous.resolution.present === resolution.present
            && previous.resolution.view.stale === resolution.view.stale
            && (previous.version === version || (drift !== undefined
                && !drift.call(source, previous.version, previous.reads)))) {
            // Equivalent arguments replace only this candidate's configuration, never the committed owner.
            if (previous.args === args && previous.version === version && previous.resolution === resolution) {
                return previous;
            }
            return {...previous, args, resolution, version};
        }
        const pending = new Set<TPath>();
        let collecting = true;
        const record = (read: TPath): void => { if (collecting) pending.add(read); };
        resourceReader.collect(resolution, record);
        let data: {data: T | undefined} | undefined;
        // This proxy is evaluation scoped. Its recorder is sealed even if the selector/capture throws.
        const input = new Proxy({...resolution.view}, {
            get(target, key, receiver): unknown {
                if (resolution.fieldView === undefined) return Reflect.get(target, key, receiver);
                if (key === 'data' && isTrackable(target.data)) {
                    data ??= createReadProxy({data: target.data}, record, resolution.path);
                    return data.data;
                }
                if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key)) {
                    if (key === 'stale') {
                        record(joinPath(path, 'invalidated'));
                        record(joinPath(path, 'updatedAt'));
                    } else {
                        record(joinPath(path, key));
                        if (key === 'refreshing') record(joinPath(path, 'updatedAt'));
                    }
                }
                return Reflect.get(target, key, receiver);
            },
        });
        let value: R;
        let raw: object | undefined;
        let branchPath: string | undefined;
        let copies: WeakMap<object, unknown> | undefined;
        let patched = false;
        let selectorReads: TCompletedReads | undefined;
        const trace = {shared: false};
        try {
            const fresh = select(input as TReadonly<IResourceView<T>>);
            if (isEqual === sameSelection) {
                if (fresh !== null && typeof fresh === 'object') {
                    raw = liveViews.readTarget(fresh);
                    const capturedPath = (fresh as {[VIEW_PATH]?: unknown})[VIEW_PATH];
                    if (typeof capturedPath === 'string') branchPath = capturedPath;
                }
                const selectorReadCount = pending.size;
                // A new scoped proxy is not a replacement branch. Patch only a committed ledger
                // with the same raw branch/path, retained log coverage and supported topology.
                const patchCandidate = allowPatch && previous !== undefined && previous === committed && active
                    && targets && raw !== undefined
                    && raw === previous.raw && branchPath === previous.branchPath
                    && previous.select === select && previous.selectorReads !== undefined
                    && previous.copies !== undefined && previous.isEqual === sameSelection;
                let flat = patchCandidate ? undefined : reconcileFlatSelection(previous?.value, fresh);
                if (flat === undefined && raw !== undefined && branchPath !== undefined) {
                    // Capture can append reads; only the original selector prefix guards branch switches.
                    const footprint = new Set<TPath>();
                    let remaining = selectorReadCount;
                    for (const read of pending) {
                        if (remaining-- === 0) break;
                        footprint.add(read);
                    }
                    selectorReads = completeReads(footprint);
                }
                const viaLog = patchCandidate && selectorReads !== undefined
                    && sameReads(previous!.selectorReads!, selectorReads)
                    ? patchFromWriteLog(source, previous!.version, previous!.value, fresh, previous!.copies!,
                        rejectInstance, rejectInstance, previous!.patchable) : undefined;
                if (patchCandidate && viaLog === undefined) flat = reconcileFlatSelection(previous?.value, fresh);
                if (viaLog !== undefined) {
                    value = viaLog;
                    copies = previous!.copies;
                    patched = true;
                } else if (flat !== undefined) {
                    value = flat.value as R;
                } else {
                    if (fresh !== null && typeof fresh === 'object') copies = new WeakMap<object, unknown>();
                    value = reconcileSelection(previous?.value, fresh, rejectInstance, rejectInstance,
                        previous?.copies, copies, trace) as R;
                }
            } else {
                const detached = detachOpaque(fresh, rejectInstance, rejectInstance);
                value = previous && isEqual(previous.value as TReadonly<R>, detached as TReadonly<R>)
                    ? previous.value : detached;
            }
        } finally {
            collecting = false;
        }
        const reads = patched ? readCoverage.extend(previous!.reads, pending) : completeReads(pending);
        const old = previous?.resolution.view;
        const view = resolution.view;
        const previousReads = previous?.reads ?? reads;
        const missingPending = previous?.resolution.present === false && resolution.present === true
            && old?.status === EResourceStatus.Idle && view.status === EResourceStatus.Pending
            && !previousReads.has(joinPath(path, 'status')) && !previousReads.has(path)
            && old.data === undefined && view.data === undefined
            && old.error === undefined && view.error === undefined
            && old.updatedAt === undefined && view.updatedAt === undefined
            && !old.refreshing && !view.refreshing
            && !old.invalidated && !view.invalidated && !old.failed && !view.failed;
        // Loading dependencies have their own token, even when the selected result is equal.
        // Refreshing itself is conditional: an ordinary equal refresh retains the R40 two-render contract.
        const lifecycleChanged = old !== undefined && !missingPending && (
            previous!.resolution.present !== resolution.present
            || old.invalidated !== view.invalidated || old.failed !== view.failed
            || ((previousReads.has(joinPath(path, 'status')) || previousReads.has(path)) && old.status !== view.status)
            || (old.invalidated && previousReads.has(joinPath(path, 'refreshing'))
                && old.refreshing !== view.refreshing)
        );
        return {args, select, isEqual, resolution, version, value, reads, selectorReads, raw, branchPath, copies,
            patchable: patched ? previous!.patchable : !trace.shared,
            token: previous && Object.is(previous.value, value) && !lifecycleChanged ? previous.token : {}};
    };
    const install = (): void => {
        if (!notify || !committed) return;
        if (active && sameReads(active.reads, committed.reads)) {
            committed.reads = active.reads;
        } else {
            // Failed attachment leaves the old subscription and its proof owner authoritative.
            const reads = committed.reads;
            const requestedId = getUid();
            let id: string;
            installing = true;
            try {
                id = source.subscribe(onSourceChange, transferCompletedReads(reads, requestedId));
            } catch (error) {
                // A source can register before throwing; the explicit id makes rollback possible.
                source.unsubscribe(requestedId);
                throw error;
            } finally {
                installing = false;
            }
            const previous = active;
            active = {id, reads};
            if (previous) source.unsubscribe(previous.id);
        }
        if (committed.copies !== undefined && committed.raw !== undefined && committed.branchPath !== undefined) {
            (targets ??= new TargetsHold()).sync(source);
        } else targets?.sync(undefined);
    };
    const refresh = (): boolean => {
        if (!committed) return false;
        // Attachment may publish synchronously, even without delivering its callback. Recheck
        // after each new attachment; an unchanged filed set takes install's no-churn fast path.
        do {
            const previous = committed;
            const next = evaluate(
                previous.args, source.resolve(previous.args), previous.select, previous.isEqual, previous, true
            );
            committed = next;
            try {
                install();
            } catch (error) {
                committed = previous;
                throw error;
            }
        } while (active && source.getVersion() !== committed.version);
        const changed = token !== committed.token;
        token = committed.token;
        return changed;
    };
    const release = (): void => {
        generation++;
        settlement = undefined;
        notify = undefined;
        if (active) source.unsubscribe(active.id);
        active = undefined;
        targets?.sync(undefined);
        targets = undefined;
        committed = undefined;
        cached = undefined;
    };
    const onSourceChange = (): void => {
        // Synchronous attachment callbacks are covered by the post-attachment recheck.
        if (!installing && refresh()) notify?.();
    };
    return {
        path,
        evaluate(args: TArgs, resolution: IResourceResolution<T>, select: TSelector<IResourceView<T>, R>,
            isEqual: TValueComparator<R> = sameSelection): IObservation<T, TArgs, R> {
            // Reconciliation policy always starts from the published result when one exists;
            // a speculative comparator may not establish the next committed equality baseline.
            const candidate = evaluate(args, resolution, select, isEqual, committed ?? cached);
            // Mounted candidates are captured by their render, not retained in a second reader slot.
            if (committed === undefined) cached = candidate;
            return candidate;
        },
        getSnapshot(candidate: IObservation<T, TArgs, R>): object {
            return committed === undefined || committed.select !== candidate.select
                || committed.isEqual !== candidate.isEqual ? candidate.token : token;
        },
        commit(candidate: IObservation<T, TArgs, R>): void {
            // Resolve/capture can throw. Finish the drift recheck before publishing any ownership.
            const next = evaluate(candidate.args, source.resolve(candidate.args),
                candidate.select, candidate.isEqual, candidate);
            const previous = committed;
            committed = next;
            try {
                install();
            } catch (error) {
                committed = previous;
                throw error;
            }
            cached = undefined;
            token = next.token;
            // In subscribe-before-layout order this is the first attachment. Do not publish the
            // pre-attachment token over a synchronous write made by source.subscribe itself.
            const attachmentChanged = refresh();
            if (attachmentChanged || token !== candidate.token) notify?.();
        },
        subscribe(onChange: () => void): () => void {
            notify = onChange;
            try {
                install();
                if (refresh()) notify?.();
            } catch (error) {
                // React receives no disposer when attachment throws, so release here before propagating.
                release();
                throw error;
            }
            return release;
        },
        load(): void {
            if (!active || !committed) return;
            const current = committed;
            const resolution = source.resolve(current.args);
            if (!resourceReader.worthFetching(resolution.view)) return;
            const started = generation;
            const startedArgs = current.args;
            const loading = source.load(startedArgs);
            // A cache may suppress the first default-only Pending callback. Adopt its present
            // resolution and loading reads anyway, so a later removal is not absent-to-absent.
            // The exact absent-to-Pending transition keeps its token for data-only selectors.
            if (refresh()) notify?.();
            if (resolution.fieldView === undefined) { void loading; return; }
            if (settlement === loading) return;
            settlement = loading;
            void loading.then(() => {
                if (settlement !== loading) return;
                settlement = undefined;
                if (started !== generation || !active || !committed) return;
                if (!resourceReader.rearm(source.resolve(committed.args).view)) return;
                token = {};
                committed = {...committed, token};
                notify?.();
            });
        },
    };
};
