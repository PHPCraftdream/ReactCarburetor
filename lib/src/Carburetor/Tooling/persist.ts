import {TDisposer} from "../Models/Base";
import {ICarburetor} from "../Models/Store";
import {IPersistOptions} from "../Models/Tooling";
import {CARBURETOR_PERSIST_DRAIN} from '../Store/Utils/Models';
import {mergeSaved} from './Persist/MergeSaved';
import {persistPartitions} from './Persist/PersistPartitions';
import {readFallback} from './Persist/ReadFallback';
import {readVersioned} from './Persist/ReadVersioned';
import {reportRemovalFailure} from './Persist/ReportRemovalFailure';
import {reportRestoreFailure} from './Persist/ReportRestoreFailure';

/** Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes its wire form (`toJSON()`) on every change. Returns a disposer that stops the mirroring.
 *
 * Writes are coalesced by default: one stringify per microtask instead of one per write (R33-07)
 * — the latest state is still what gets stored, and `flush()` forces any pending persistence,
 * ignoring the throttle window. The disposer writes any state a deferred scheduler had not yet
 * delivered. `coalesce: false` writes on every notification, so with the
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
 * entry untouched and blocks this subscription's writes. With `onCorrupt: 'reset'`, an
 * unparseable entry or a restore the store rejects is removed and reported even under `version`
 * or a function `prune`, and the subscription keeps writing instead of blocking; failed
 * migrations, newer stored versions, throwing prune callbacks, and fallback keys still keep the
 * entry and block.
 * With a function `prune`, the callback sees migrated saved data before merging and the current
 * wire baseline. `saved` stays `unknown` (raw stored JSON — validate it yourself); `current` is
 * typed as the store's data type `T`, exact only for stores whose wire form (`toJSON()`) equals
 * their data type — stores overriding `toJSON` see their wire form instead. The third argument
 * is an opt-in `merge(saved): T` helper that fills defaults and prunes unknown keys; a callback
 * that ignores it behaves as before, and its result is what `restore()` receives.
 * Partitions reject `version`, `migrate`, `prune`, and `onCorrupt` unchanged.
 * After a successful restore from `key`, `writeAfterRestore` decides whether the restored state
 * is written back: 'changed' (default) rewrites only when the wire form no longer matches the
 * stored text — prune, migration, or default filling then clean up stale entries at connect —
 * 'always' rewrites after every restore from `key`, and 'never' keeps the previous
 * write-only-on-change behaviour. The write never moves the `throttleMs` window and does not
 * apply to a `previousKeys` fallback source, whose transfer write already covers it.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions<T>): TDisposer => {
    const {key, storage, coalesce, throttleMs, partitions, version, migrate, prune, previousKeys, onCorrupt,
        writeAfterRestore} = options;

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
    if (onCorrupt !== undefined && onCorrupt !== 'keep' && onCorrupt !== 'reset') {
        throw new RangeError("persist: onCorrupt must be 'keep' or 'reset'");
    }
    if (writeAfterRestore !== undefined
        && writeAfterRestore !== 'changed' && writeAfterRestore !== 'always' && writeAfterRestore !== 'never') {
        throw new RangeError("persist: writeAfterRestore must be 'changed', 'always', or 'never'");
    }
    if (partitions !== undefined
        && (version !== undefined || migrate !== undefined || prune !== undefined || onCorrupt !== undefined
            || writeAfterRestore !== undefined)) {
        throw new Error(
            'persist: version, migrate, prune, onCorrupt, and writeAfterRestore cannot be combined with partitions');
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

    const keepCorrupt = version !== undefined || typeof prune === 'function';
    let blocked = false;
    let restoredFromKey = false;
    if (stored !== null) {
        let data: unknown;
        try {
            data = JSON.parse(stored);
        } catch (error: unknown) {
            if (source !== key || (keepCorrupt && onCorrupt !== 'reset')) {
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
            let restoreFailed = false;
            try {
                if (version !== undefined) {
                    const decoded = readVersioned(data, version, migrate as NonNullable<typeof migrate>);
                    data = decoded.data;
                }
                const needsWireBaseline = version !== undefined || prune === true || typeof prune === 'function';
                const currentWire = needsWireBaseline ? carburetor.toJSON() : undefined;
                if (typeof prune === 'function') {
                    // `data` is unknown here (stored JSON, possibly migrated); the prune result is
                    // typed T but the runtime cannot verify raw stored data.
                    data = prune(data, currentWire as T, saved =>
                        mergeSaved(saved, currentWire, true, carburetor.getData()) as T);
                }
                if (version !== undefined || prune === true) {
                    data = mergeSaved(data, currentWire, prune === true, carburetor.getData());
                }
                restoreFailed = true;
                carburetor.restore(data as T);
                restoreFailed = false;
                restored = true;
                restoredFromKey = source === key;
            } catch (error: unknown) {
                // A migration or prune-callback throw is never reset: only a restore rejection is.
                if (keepCorrupt && (onCorrupt !== 'reset' || !restoreFailed)) {
                    blocked = true;
                    if (source === key && !options.onError) {
                        throw error;
                    }
                    reportRestoreFailure(source, error, options.onError, 'the stored data is kept');
                } else if (restoreFailed && onCorrupt === 'reset' && source === key) {
                    reportRestoreFailure(key, error, options.onError, 'the stored data was removed');
                    try {
                        storage.removeItem(key);
                    } catch (removeError: unknown) {
                        reportRemovalFailure(options.onError, removeError);
                    }
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

    // The store's wire form: JSON.stringify invokes its toJSON(), without cloning it.
    const serialize = (): string => version === undefined
        ? JSON.stringify(carburetor)
        : JSON.stringify({__carburetorVersion: version, data: carburetor.toJSON()});

    // Fix up what restore changed (prune, migration, defaults) at connect instead of waiting for
    // the first change. It must not move the throttle window; the previousKeys transfer above
    // already wrote the new key.
    if (writeAfterRestore !== 'never' && restoredFromKey && stored !== null) {
        const value = serialize();
        if (writeAfterRestore === 'always' || value !== stored) {
            lastSeenVersion = carburetor.getVersion();
            try {
                storage.setItem(key, value);
            } catch (error: unknown) {
                if (options.onError) {
                    options.onError(error);
                }
            }
        }
    }

    // A failing write must reach onError like a failed restore does, and must not cut off the
    // subscribers notified after this one; the last good entry stays in place.
    const write = (): void => {
        // Mark this version as attempted even on failure: dispose must not retry a failed
        // write, which would report the same error twice.
        if (blocked) return;
        lastSeenVersion = carburetor.getVersion();
        try {
            storage.setItem(key, serialize());
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
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (forced: boolean = false): void => {
        if (disposed || !pending) {
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
    const drains = ((carburetor as ICarburetor<T> & {
        [CARBURETOR_PERSIST_DRAIN]?: Set<() => void>;
    })[CARBURETOR_PERSIST_DRAIN] ??= new Set<() => void>());
    const drain = (): void => flush(true);
    drains.add(drain);
    const id = carburetor.subscribe(() => {
        if (pending) {
            return;
        }
        pending = true;
        queueMicrotask(() => flush());
    });
    return () => {
        drains.delete(drain);
        carburetor.unsubscribe(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        flush(true);
        disposed = true;
        if (carburetor.getVersion() !== lastSeenVersion) {
            write();
        }
    };
};
