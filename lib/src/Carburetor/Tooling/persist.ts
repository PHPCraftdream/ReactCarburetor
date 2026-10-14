import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IPersistOptions} from "@/Carburetor/Models/Tooling";

/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes its wire form (`toJSON()`) on every change. Returns a disposer that stops the mirroring.
 *
 * Writes are coalesced by default: one stringify per microtask instead of one per write (R33-07)
 * — the latest state is still what gets stored, and the disposer writes any state a deferred
 * scheduler had not yet delivered. `coalesce: false` writes on every notification, so with the
 * default immediate delivery a write lands in storage before the call that caused it returns; a
 * deferring scheduler or a transaction delays the notification, and the write with it.
 * A failed storage read is reported without discarding the unread entry; when `onError`
 * returns, the subscription still starts and later writes follow the chosen sync/coalesce
 * policy. Without `onError`, a failed read throws rather than pretending storage was empty.
 * A malformed entry is reported before cleanup; cleanup failures are reported separately.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
    const {key, storage, coalesce} = options;
    let stored: string | null;

    try {
        stored = storage.getItem(key);
    } catch (error: unknown) {
        if (!options.onError) {
            throw error;
        }

        options.onError(error);
        stored = null;
    }

    if (stored !== null) {
        try {
            carburetor.restore(JSON.parse(stored) as T);
        } catch (error: unknown) {
            options.onError?.(error);

            try {
                storage.removeItem(key);
            } catch (removeError: unknown) {
                if (options.onError) {
                    options.onError(removeError);
                } else {
                    throw removeError;
                }
            }
        }
    }

    // Version tracking defeats a deferred scheduler: a write queued at dispose time gets
    // cancelled by unsubscribe, so any version drift is written out explicitly below.
    let lastSeenVersion = carburetor.getVersion();

    // A failing write must reach onError like a failed restore does, and must not cut off the
    // subscribers notified after this one; the last good entry stays in place.
    const write = (): void => {
        // Mark this version as attempted even on failure: dispose must not retry a failed
        // write, which would report the same error twice.
        lastSeenVersion = carburetor.getVersion();

        try {
            // The store's wire form: JSON.stringify invokes its toJSON(), without cloning it.
            storage.setItem(key, JSON.stringify(carburetor));
        } catch (error: unknown) {
            if (options.onError) {
                options.onError(error);
            }
        }
    };

    // persist() needs "every write" — subscribe with no `reads` is the engine's own way to say
    // that, cheaper than a watch(select, onChange) whose selector would have to read (and diff)
    // the whole tree to notice anything.
    if (coalesce === false) {
        const id = carburetor.subscribe(write);

        return () => {
            carburetor.unsubscribe(id);

            // The write was this subscriber and just got cancelled; persist any drift.
            if (carburetor.getVersion() !== lastSeenVersion) {
                write();
            }
        };
    }

    // One write per microtask: further changes before it runs just move the value it will
    // stringify, since write() reads fresh state rather than a scheduled snapshot.
    let pending = false;

    const flush = (): void => {
        if (!pending) {
            return;
        }

        pending = false;
        write();
    };

    const id = carburetor.subscribe(() => {
        if (pending) {
            return;
        }

        pending = true;
        queueMicrotask(flush);
    });

    return () => {
        carburetor.unsubscribe(id);
        flush();

        // A flush the scheduler had not delivered yet was cancelled by unsubscribe; persist any drift.
        if (carburetor.getVersion() !== lastSeenVersion) {
            write();
        }
    };
};
