import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IPersistOptions} from "@/Carburetor/Models/Tooling";
import {mergeSaved} from '@/Carburetor/Tooling/Persist/MergeSaved';
import {persistPartitions} from '@/Carburetor/Tooling/Persist/PersistPartitions';
import {readFallback} from '@/Carburetor/Tooling/Persist/ReadFallback';
import {readVersioned} from '@/Carburetor/Tooling/Persist/ReadVersioned';
import {reportRemovalFailure} from '@/Carburetor/Tooling/Persist/ReportRemovalFailure';
import {reportRestoreFailure} from '@/Carburetor/Tooling/Persist/ReportRestoreFailure';

/** Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes its wire form (`toJSON()`) on every change. Returns a disposer that stops the mirroring.
 *
 * Writes are coalesced by default: one stringify per microtask instead of one per write (R33-07)
 * — the latest state is still what gets stored, and the disposer writes any state a deferred
 * scheduler had not yet delivered. `coalesce: false` writes on every notification, so with the
 * default immediate delivery a write lands in storage before the call that caused it returns; a
 * deferring scheduler or a transaction delays the notification, and the write with it.
 * `throttleMs` bounds how often storage is written: the first write still happens right away,
 * later flushes wait until the window since the previous write has passed, and the disposer
 * writes a state still held back.
 * `partitions` stores one key per named top-level branch (`key + "." + branch`) and rewrites
 * only the branches that changed, which keeps a flush proportional to the dirty branches
 * instead of the whole state. The first flush seals every partition once; a flush while a
 * `throttleMs` window is open covers all dirty branches together, and a partition whose
 * write or removal failed is retried by the next flush and by the disposer. Restore composes the stored
 * branches over the current state — branches without a stored entry keep their value, and a
 * legacy whole-store entry is restored when no partition entries exist yet (it stays in place,
 * shadowed by the partition entries). Each partition entry is written atomically on its own,
 * so a crash between two writes can compose a mixed state across branches. Branch names must
 * be plain top-level keys of the wire form; custom wire forms and other non-plain roots are
 * rejected.
 * A failed storage read is reported without discarding the unread entry; when `onError`
 * returns, the subscription still starts and later writes follow the chosen sync/coalesce
 * policy. Without `onError`, a failed read throws rather than pretending storage was empty.
 * A malformed entry and a restore the store rejects are reported before cleanup; cleanup
 * failures are reported separately. The stored data is removed when the culprit is known —
 * one key, or the single stored partition — in production too: without `onError` that
 * removal is silent there, while development reports it through the engine diagnostics. A
 * composite restore over several stored partitions keeps every entry (the culprit is unknown)
 * and is only reported. With `version`, a failed migration or a newer stored version keeps the
 * entry untouched and blocks this subscription's writes.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
    const {key, storage, coalesce, throttleMs, partitions, version, migrate, prune, previousKeys} = options;

    if (previousKeys !== undefined && (!Array.isArray(previousKeys)
        || previousKeys.some(
            previousKey => typeof previousKey !== 'string' || previousKey.length === 0 || previousKey === key
        )
        || new Set(previousKeys).size !== previousKeys.length)) {
        throw new RangeError('persist: previousKeys must contain unique non-empty keys distinct from key');
    }
    if (migrate !== undefined && version === undefined) {
        throw new Error('persist: migrate requires version');
    }
    if (version !== undefined && (!Number.isInteger(version) || version < 0)) {
        throw new RangeError('persist: version must be a non-negative integer');
    }
    if (version !== undefined) {
        for (let step = 1; step <= version; step++) {
            if (typeof migrate?.[step] !== 'function') {
                throw new Error('persist: missing migration step ' + step);
            }
        }
    }
    if (partitions !== undefined && (version !== undefined || migrate !== undefined || prune !== undefined)) {
        throw new Error('persist: version, migrate, and prune cannot be combined with partitions');
    }
    if (throttleMs !== undefined) {
        if (!Number.isFinite(throttleMs) || throttleMs < 0) {
            throw new RangeError("persist: throttleMs must be a non-negative finite number");
        }
        if (coalesce === false) {
            throw new Error("persist: throttleMs requires the default write coalescing;"
                + " coalesce: false writes on every notification");
        }
    }
    if (partitions !== undefined) {
        if (!Array.isArray(partitions) || partitions.length === 0) {
            throw new RangeError("persist: partitions must be a non-empty array of top-level branch names");
        }
        if (partitions.some((branch: string) => typeof branch !== "string" || branch.includes("."))) {
            throw new RangeError('persist: partitions must be plain top-level names without the "." path separator');
        }
        if (new Set(partitions).size !== partitions.length) {
            throw new RangeError("persist: partitions must not repeat a branch");
        }
        return persistPartitions(carburetor, key, storage, {
            onError: options.onError, coalesce, throttleMs, partitions, previousKeys,
        });
    }

    let stored: string | null;
    let source = key;
    try {
        stored = storage.getItem(key);
        if (stored === null) {
            const fallback = readFallback(storage, previousKeys);
            if (fallback) {
                stored = fallback.value;
                source = fallback.source;
            }
        }
    } catch (error: unknown) {
        if (!options.onError) {
            throw error;
        }
        options.onError(error);
        stored = null;
    }

    let blocked = false;
    if (stored !== null) {
        let data: unknown;
        try {
            data = JSON.parse(stored);
        } catch (error: unknown) {
            if (source !== key || version !== undefined || typeof prune === 'function') {
                blocked = source === key;
                if (source === key && !options.onError) {
                    throw error;
                }
                reportRestoreFailure(source, error, options.onError, 'the stored data is kept');
                stored = null;
            } else {
                reportRestoreFailure(key, error, options.onError, 'the stored data was removed');
                try {
                    storage.removeItem(key);
                } catch (removeError: unknown) {
                    reportRemovalFailure(options.onError, removeError);
                }
                stored = null;
            }
        }

        if (stored !== null) {
            let restored = false;
            try {
                if (version !== undefined) {
                    const decoded = readVersioned(data, version, migrate as NonNullable<typeof migrate>);
                    data = decoded.data;
                }
                const needsWireBaseline = version !== undefined || prune === true || typeof prune === 'function';
                const currentWire = needsWireBaseline ? carburetor.toJSON() : undefined;
                if (typeof prune === 'function') {
                    data = prune(data, currentWire);
                }
                if (version !== undefined || prune === true) {
                    data = mergeSaved(data, currentWire, prune === true, carburetor.getData());
                }
                carburetor.restore(data as T);
                restored = true;
            } catch (error: unknown) {
                if (version !== undefined || typeof prune === 'function') {
                    blocked = true;
                    if (source === key && !options.onError) {
                        throw error;
                    }
                    reportRestoreFailure(source, error, options.onError, 'the stored data is kept');
                } else if (source !== key) {
                    reportRestoreFailure(source, error, options.onError, 'the stored data is kept');
                } else {
                    reportRestoreFailure(key, error, options.onError, 'the stored data was removed');
                    try {
                        storage.removeItem(key);
                    } catch (removeError: unknown) {
                        reportRemovalFailure(options.onError, removeError);
                    }
                }
            }
            if (restored && source !== key && !blocked) {
                try {
                    const value = version === undefined
                        ? JSON.stringify(carburetor)
                        : JSON.stringify({__carburetorVersion: version, data: carburetor.toJSON()});
                    storage.setItem(key, value);
                    storage.removeItem(source);
                } catch (error: unknown) {
                    if (options.onError) {
                        options.onError(error);
                    } else {
                        throw error;
                    }
                }
            }
        }
    }

    // Version tracking defeats a deferred scheduler: a write queued at dispose time gets
    // cancelled by unsubscribe, so any version drift is written out explicitly below.
    let lastSeenVersion = carburetor.getVersion();
    let lastWriteAt = 0;

    // A failing write must reach onError like a failed restore does, and must not cut off the
    // subscribers notified after this one; the last good entry stays in place.
    const write = (): void => {
        // Mark this version as attempted even on failure: dispose must not retry a failed
        // write, which would report the same error twice.
        if (blocked) return;
        lastSeenVersion = carburetor.getVersion();
        try {
            // The store's wire form: JSON.stringify invokes its toJSON(), without cloning it.
            const value = version === undefined
                ? JSON.stringify(carburetor)
                : JSON.stringify({__carburetorVersion: version, data: carburetor.toJSON()});
            storage.setItem(key, value);
            lastWriteAt = Date.now();
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
    // stringify, since write() reads fresh state rather than a scheduled snapshot. A
    // throttleMs window holds the write back until the time since the previous write passed.
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (forced: boolean = false): void => {
        if (!pending) {
            return;
        }
        if (!forced && throttleMs !== undefined) {
            const wait = Math.max(0, throttleMs - (Date.now() - lastWriteAt));
            if (wait > 0) {
                if (timer === undefined) {
                    timer = setTimeout(() => {
                        timer = undefined;
                        flush();
                    }, wait);
                }
                return;
            }
        }
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        pending = false;
        write();
    };
    const id = carburetor.subscribe(() => {
        if (pending) {
            return;
        }
        pending = true;
        queueMicrotask(() => flush());
    });
    return () => {
        carburetor.unsubscribe(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        // A flush the scheduler had not delivered yet was cancelled by unsubscribe; persist
        // any drift. Forced: a write held back by the throttle window must not be lost.
        flush(true);
        if (carburetor.getVersion() !== lastSeenVersion) {
            write();
        }
    };
};
