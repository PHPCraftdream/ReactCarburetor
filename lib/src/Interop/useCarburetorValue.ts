import {useCallback, useLayoutEffect, useRef, useSyncExternalStore} from "react";
import {deepClone, ICarburetor, isTrackable, TPath, TPathSet, TSubscriber} from "@/Carburetor";
import {TSelector, TValueComparator} from "./Models";

interface ICacheEntry<T extends object, R> {
    carburetor: ICarburetor<T> | undefined;
    select: TSelector<T, R> | undefined;
    version: number;
    value: R;
    filled: boolean;
}

/** The one live subscription: enough to undo it and to tell a moved read set from a stable one. */
interface IActiveSubscription<T extends object> {
    carburetor: ICarburetor<T>;
    id: string;
    reads: TPathSet;
}

/** Whether two read sets would wake their subscriber on exactly the same writes. */
const sameReads = (a: TPathSet, b: TPathSet): boolean => {
    if (a.size !== b.size) {
        return false;
    }

    for (const path of a) {
        if (!b.has(path)) {
            return false;
        }
    }

    return true;
};

/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 *
 * @param carburetor - the store read and subscribed to; swapping it unsubscribes the previous
 * one and reconciles against the new read set
 * @param select - run on a tracked read of the store, so the paths it touches become exactly
 * what the subscription watches
 * @param isEqual - decides whether a recomputed result counts as changed; true keeps the old
 * reference, so React never sees a re-render
 */
export const useCarburetorValue = <T extends object, R>(
    carburetor: ICarburetor<T>,
    select: TSelector<T, R>,
    isEqual: TValueComparator<R> = Object.is
): R => {
    const cache = useRef<ICacheEntry<T, R>>({
        carburetor: undefined,
        select: undefined,
        version: -1,
        value: undefined as unknown as R,
        filled: false,
    });

    // What the selector read last, and the subscription it produced. getSnapshot refreshes
    // the read set on every call; the commit-phase effect at the bottom acts on it.
    const pendingReads = useRef<TPathSet>(new Set<TPath>());
    const active = useRef<IActiveSubscription<T> | null>(null);
    const notify = useRef<TSubscriber | null>(null);

    const install = useCallback((): void => {
        const onStoreChange = notify.current;

        if (!onStoreChange) {
            return;
        }

        const reads = pendingReads.current;
        const current = active.current;

        // The common case — the read set did not move — leaves the subscriber index alone.
        if (current && current.carburetor === carburetor && sameReads(current.reads, reads)) {
            return;
        }

        if (current) {
            current.carburetor.unsubscribe(current.id);
        }

        const id = carburetor.subscribe(onStoreChange, {reads});

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

        // An entry is valid only for the pairing that produced it: a new selector or a new
        // carburetor can return something else at the same version, so the version alone lies.
        if (entry.filled && entry.carburetor === carburetor && entry.select === select && entry.version === version) {
            return entry.value;
        }

        const reads = new Set<TPath>();
        let next: R = select(carburetor.read((path: TPath) => reads.add(path)));

        // A selector returning a branch hands back the live proxy, and traversal records no
        // read — the subscription would watch nothing and the value would mutate in place.
        // Cloning through the proxy fixes both at once: its ownKeys records the branch, every
        // leaf is recorded on the way out, and the caller gets a detached copy. Selector-built
        // fresh objects take the same copy, which keeps one rule instead of a proxy-detection
        // heuristic.
        if (isTrackable(next)) {
            next = deepClone(next);
        }

        pendingReads.current = reads;

        if (entry.filled && isEqual(entry.value, next)) {
            // Same value from a new pairing: keep the old reference — a stable snapshot avoids
            // a pointless re-render — but re-key the entry so later calls hit the cache.
            cache.current = {carburetor, select, version, value: entry.value, filled: true};

            return entry.value;
        }

        cache.current = {carburetor, select, version, value: next, filled: true};

        return next;
    }, [carburetor, select, isEqual]);

    // React only re-runs subscribe when the callback identity changes, but a selector's read
    // paths can move on their own — a conditional selector flips to another branch. Render
    // stays pure, so reconciliation lives in the commit: every commit compares what the
    // selector last read against what is subscribed, and a stable read set costs nothing but
    // that comparison.
    useLayoutEffect(() => {
        install();
    });

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
