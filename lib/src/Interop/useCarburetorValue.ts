"use client";

import {useCallback, useLayoutEffect, useRef, useSyncExternalStore} from "react";
import {IReadableCarburetor, TReadonly, TSubscriber} from "@/Carburetor";
import {TPath, TPathRecorder, TPathSet} from "@/Carburetor/Models/Paths";
import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";
import {reconcileSelection} from "@/Carburetor/Store/Utils/Selection/reconcileSelection";
import {reconcileFlatSelection} from "@/Carburetor/Store/Utils/Selection/reconcileFlatSelection";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {patchFromWriteLog} from "@/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog";
import {completeObservation} from "@/Carburetor/Store/Tracking/Observation/completeObservation";
import {completeReads} from "@/Carburetor/Store/Tracking/Observation/completeReads";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {TCompletedReads} from "@/Carburetor/Store/Tracking/Observation/Models";
import {transferCompletedReads} from "@/Carburetor/Store/Tracking/Observation/transferCompletedReads";
import {sameReads} from "@/Carburetor/Store/Tracking/Observation/sameReads";
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {TSelector, TValueComparator} from "./Models";

interface ICacheEntry<T extends object, R> {
    carburetor: IReadableCarburetor<T> | undefined;
    select: TSelector<T, R> | undefined;
    isEqual: TValueComparator<R> | undefined;
    version: number;
    value: R;
    liveSelection: unknown;
    reads: TCompletedReads | undefined;
    filled: boolean;
    /** Undefined for primitive selections, which need no copy ledger (R37-05). */
    copies: WeakMap<object, unknown> | undefined;
    /** The snapshot mirrors one tree of the store without shared references, so write-log patching is exact. */
    patchable: boolean;
}

/** The one live subscription: enough to undo it and to tell a moved read set from a stable one. */
interface IActiveSubscription<T extends object> {
    carburetor: IReadableCarburetor<T>;
    id: string;
    reads: TCompletedReads;
}

/** getSnapshot's persistent root view for one hook instance, rebuilt only when it goes stale. */
interface IRootView<T extends object> {
    carburetor: IReadableCarburetor<T>;
    data: T;
    view: TReadonly<T>;
}

/**
 * The tracked root view getSnapshot reads through: one read proxy tree reused across calls while
 * the carburetor and its data object stay the same, rebuilt when either moves. A non-trackable
 * root (a Map, Set or class instance at the store's own root) is never cached — carburetor.read()
 * already hands that back raw and un-proxied, so the only per-call work is re-recording its
 * wildcard read, which a cached view would skip.
 *
 * @param cached - the previous call's view, or null before the first read
 * @param carburetor - the store to read
 * @param record - reports every path a read touches while it is the active recorder
 */
const resolveView = <T extends object>(
    cached: IRootView<T> | null,
    carburetor: IReadableCarburetor<T>,
    record: TPathRecorder
): IRootView<T> => {
    const data: T = carburetor.getData();

    if (cached !== null && cached.carburetor === carburetor && cached.data === data && isTrackable(data)) {
        return cached;
    }

    return {carburetor, data, view: carburetor.read(record)};
};

/** The filed read set when `reads` adds nothing to it, else a new set holding both. */
const coverReads = (filed: TCompletedReads, reads: TPathSet): TPathSet => {
    let grown: Set<TPath> | undefined;
    for (const path of reads) {
        if (filed.has(path)) continue;
        grown ??= new Set<TPath>(filed);
        grown.add(path);
    }
    return grown ?? (filed as unknown as TPathSet);
};

/** Names a class value in the selector error when its class name is available. */
const describeInstance = (instance: object): string =>
    Object.getPrototypeOf(instance)?.constructor?.name || 'class';

/**
 * A detached copy of a selection. Class instances have no generic safe copy: passing one through
 * would let useSyncExternalStore certify in-place changes as unchanged, so they are rejected in
 * every build, nested ones included.
 *
 * @param value - the selector's result, possibly a live branch
 */
const rejectLiveInstance = (instance: object): never => {
    throw new Error(
        'useCarburetorValue() cannot select a live ' + describeInstance(instance) +
        ' instance because in-place changes cannot produce a safe React snapshot. ' +
        'Select the fields the component renders or return a plain object of those fields.'
    );
};

const detach = <R>(value: R): R => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    return detachOpaque(value, rejectLiveInstance);
};

/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is reused across store versions: a cached result is kept while no
 * write has touched any path the selector read, so useSyncExternalStore sees a stable snapshot.
 *
 * The staleness check goes through the store's path-precise drift answer, which keys on the
 * exact read set the subscription filed; the result cache and the install step both adopt that
 * filed set back on content-equal re-subscription, so the O(1) identity path survives.
 *
 * A selected class instance cannot be detached safely and throws; select its rendered
 * fields as plain values instead.
 * Read primitive values with ordinary property access or `Reflect.get` inside `select`.
 * `Object.getOwnPropertyDescriptor(view, key)?.value` and `hasOwnProperty` inspect structure
 * without registering that value as a leaf dependency.
 *
 * @param carburetor - the store read and subscribed to; swapping it unsubscribes the previous
 * one and reconciles against the new read set
 * @param select - run on a tracked read of the store, so the paths it touches become exactly
 * what the subscription watches
 * @param isEqual - decides whether a recomputed result counts as changed; true keeps the old
 * reference, so React never sees a re-render. Defaults to the same structural comparison
 * `connectSelection` uses: own enumerable string keys and `Object.is` values, recursively through
 * plain objects and arrays. detachOpaque() rebuilds every plain container fresh, so `Object.is`
 * itself could never call two detached objects equal — pass it explicitly to restore that
 * stricter, reference-only behavior. A detached `Date` compares by time and a `Map`/`Set` by
 * content when its keys are primitives; object keys and class instances always count as changed.
 */
export const useCarburetorValue = <T extends object, R>(
    carburetor: IReadableCarburetor<T>,
    select: TSelector<T, R>,
    isEqual: TValueComparator<R> = sameSelection
): TReadonly<R> => {
    // Initialized lazily: the initializers below are per-render arguments otherwise, evaluated
    // and discarded after the first render (R30-10).
    const cache = useRef<ICacheEntry<T, R> | null>(null);

    // What the selector read last, and the subscription it produced. getSnapshot refreshes
    // the read set on every call; the commit-phase effect at the bottom acts on it.
    const pendingReads = useRef<TCompletedReads | null>(null);
    const active = useRef<IActiveSubscription<T> | null>(null);
    const notify = useRef<TSubscriber | null>(null);

    // The persistent root view getSnapshot reads through, and the slot its recorder reports
    // into. The slot holds a Set only while a getSnapshot call is walking the view — a read
    // through a snapshot captured earlier and touched outside that window records nothing.
    const view = useRef<IRootView<T> | null>(null);
    const currentReads = useRef<TPathSet | undefined>(undefined);
    const recordRead = useCallback((path: TPath): void => {
        currentReads.current?.add(path);
    }, []);

    const install = useCallback((): void => {
        const onStoreChange = notify.current;

        if (!onStoreChange) {
            return;
        }

        const reads = pendingReads.current ?? (pendingReads.current = completeReads(new Set<TPath>()));
        const current = active.current;

        // The common case — the read set did not move — leaves the subscriber index alone.
        if (current && current.carburetor === carburetor && sameReads(current.reads, reads)) {
            // Equal content: adopt the set the subscriber index filed, so the drift probe of
            // the next getSnapshot takes the O(1) identity path.
            if (current.reads !== reads) {
                pendingReads.current = current.reads;
                const entry = cache.current;
                if (entry !== null && entry.reads === reads) {
                    cache.current = {...entry, reads: current.reads};
                }
            }
            return;
        }

        if (current) {
            current.carburetor.unsubscribe(current.id);
        }

        // The subscription receives this hook's closed set by identity after selection finished.
        const id = carburetor.subscribe(onStoreChange, transferCompletedReads(reads));

        active.current = {carburetor, id, reads};
    }, [carburetor]);

    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            // A wake can move the read paths without moving the value: the selector flips to
            // another branch, isEqual still calls it equal, React never re-renders, and the
            // commit-phase effect below never runs. Reconcile on the wake itself — this is a
            // store notification, not render.
            notify.current = () => {
                onStoreChange();
                install();
            };

            install();

            return () => {
                const current = active.current;

                if (current) {
                    // Read through the ref: a reconciliation may have swapped the id since
                    // this subscription was installed.
                    current.carburetor.unsubscribe(current.id);
                    active.current = null;
                }
            };
        },
        // Re-subscribing follows `install`: it flips exactly when the carburetor does.
        // A new selector re-reconciles through getSnapshot instead of tearing the
        // subscription down.
        [install]
    );

    const getSnapshot = useCallback((): R => {
        const entry = cache.current;
        const version = carburetor.getVersion();
        const sameCarburetor = entry !== null && entry.carburetor === carburetor;
        const driftEntry = entry !== null && entry.filled && entry.reads !== undefined &&
            sameCarburetor && entry.isEqual === isEqual;
        // The write-log probe runs only when the store moved since the entry; an equal version needs none.
        const drift = driftEntry && entry!.version !== version
            ? (carburetor as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT] : undefined;
        const canUseDrift = drift !== undefined && !drift.call(carburetor, entry!.version, entry!.reads!);
        const noReadDrift = entry !== null && entry.filled && entry.reads !== undefined &&
            sameCarburetor && entry.isEqual === isEqual &&
            (canUseDrift || entry.version === version);

        // An entry is valid only for the store, selector and comparator that produced it:
        // changing comparison policy must reconsider a result suppressed at this version.
        if (noReadDrift && entry !== null && entry.select === select) {
            entry.version = version;
            pendingReads.current = entry.reads!;
            return entry.value;
        }

        if (entry !== null && entry.filled && entry.reads !== undefined &&
            entry.carburetor === carburetor && entry.select === select &&
            entry.isEqual === isEqual && entry.version === version) {
            // Restore the read set paired with this cached value if a nested observation moved it.
            pendingReads.current = entry.reads!;
            return entry.value;
        }

        view.current = resolveView(view.current, carburetor, recordRead);

        const reads = new Set<TPath>();

        currentReads.current = reads;

        let result: R;
        let liveSelection: R | undefined;
        // R37-05: allocated on the first object-shaped need; a primitive verdict keeps zero ledgers.
        let copies: WeakMap<object, unknown> | undefined;
        let flat: {value: unknown} | undefined;
        const trace = {shared: false};
        let patched = false;

        // Closed however the walk ends: detach() throws for a class instance by design.
        try {
            const fresh: R = select(view.current.view);
            liveSelection = fresh;

            const readsCoverSelection = noReadDrift && entry !== null &&
                Array.from(reads).every((path) => entry.reads!.has(path));
            const canReuseInlineSelection = noReadDrift && sameCarburetor && entry !== null &&
                entry.isEqual === isEqual && isEqual === sameSelection &&
                fresh === entry.liveSelection && readsCoverSelection;

            if (canReuseInlineSelection) {
                pendingReads.current = entry.reads!;
                cache.current = {...entry, select, version, liveSelection, copies: entry.copies};
                return entry.value;
            }

            // Comparison and detachment can add reads, so publish the set only after both succeed.

            // The default comparison is fused with detachment: reconcile keeps every unchanged
            // subtree at its previous reference. A custom comparator always gets detached values.
            const liveCompare = isEqual === sameSelection;

            // R36-01: the same live view as last time, so the write log names what changed and only
            // those subtrees are reconciled; every other shape takes the full walk below.
            const viaLog = liveCompare && !noReadDrift && entry !== null && entry.filled &&
                entry.copies !== undefined &&
                sameCarburetor && entry.isEqual === isEqual && fresh === entry.liveSelection
                ? patchFromWriteLog(
                    carburetor, entry.version, entry.value, fresh, entry.copies, rejectLiveInstance,
                    undefined, entry.patchable
                )
                : undefined;
            flat = viaLog === undefined && liveCompare
                ? reconcileFlatSelection(entry?.filled ? entry.value : undefined, fresh)
                : undefined;

            if (viaLog !== undefined) {
                result = viaLog;
                copies = entry!.copies;
                patched = true;
            } else if (flat !== undefined) {
                result = flat.value as R;
            } else if (liveCompare) {
                if (fresh !== null && typeof fresh === 'object') {
                    copies ??= new WeakMap<object, unknown>();
                }
                result = entry !== null && entry.filled
                    ? (reconcileSelection(
                        entry.value, fresh, rejectLiveInstance, undefined, entry.copies, copies, trace
                    ) as R)
                    : (reconcileSelection(
                        undefined, fresh, rejectLiveInstance, undefined, undefined, copies, trace
                    ) as R);
            } else {
                const candidate: R = detach(fresh);

                result = entry !== null && entry.filled &&
                    isEqual(entry.value as TReadonly<R>, candidate as TReadonly<R>)
                    ? entry.value
                    : candidate;
            }
        } finally {
            currentReads.current = undefined;
        }

        // A patched pass keeps the filed read set by identity unless the patch read a path it lacks
        // (a branch replaced by new leaves): then the set grows, and the subscription re-files.
        // Paths of branches the patch replaced stay in the set; a superset only wakes more.
        const patchedReads = patched ? coverReads(entry!.reads!, reads) : reads;
        const completed = completeObservation({
            carburetor, select, isEqual, version, value: result, reads: patchedReads, filled: true,
        });
        pendingReads.current = completed.reads;
        // R37-01: patchability always describes the latest full reconcile's graph verdict. A patch
        // cannot introduce sharing (container leaves fall back to the full walk), so a patched pass
        // keeps the tree verdict it was granted.
        cache.current = {...completed, liveSelection, copies, patchable: patched ? entry!.patchable : !trace.shared};

        return result;
    }, [carburetor, select, isEqual, recordRead]);
    // React only re-runs subscribe when the callback identity changes, but a selector's read
    // paths can move on their own — a conditional selector flips to another branch. Render
    // stays pure, so reconciliation lives in the commit: every commit compares what the
    // selector last read against what is subscribed, and a stable read set costs nothing but
    // that comparison.
    useLayoutEffect(() => {
        install();
    });

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as TReadonly<R>;
};
