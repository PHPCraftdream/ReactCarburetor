import {TDisposer} from "../../Models/Base";
import {ICarburetor} from "../../Models/Store";
import {IStorageLike, IPersistOptions} from "../../Models/Tooling";
import {CARBURETOR_PERSIST_DRAIN} from "../../Store/Utils/Models";
import {readFallback} from "./ReadFallback";
import {reportRemovalFailure} from "./ReportRemovalFailure";
import {reportRestoreFailure} from "./ReportRestoreFailure";

type TPersistOptions = Pick<IPersistOptions, "onError" | "coalesce" | "throttleMs" | "partitions" | "previousKeys">;

/** The partitioned storage layout: one key per branch (`key + "." + branch`), a legacy
 * whole-store entry as the read fallback, a sealed first flush as the write baseline.
 *
 * @param carburetor - both read and written: stored branches are restored into it, live
 * branches are stringified on flush.
 * @param key - the storage key prefix; partition entries live at `key + "." + branch`.
 * @param storage - the storage adapter holding the partition entries.
 * @param options - the validated subset of persist options the layout needs.
 */
export const persistPartitions = <T extends object>(
    carburetor: ICarburetor<T>,
    key: string,
    storage: IStorageLike,
    options: TPersistOptions
): TDisposer => {
    const {onError, coalesce, throttleMs} = options;
    const partitions = options.partitions as ReadonlyArray<string>;
    const branchKey = (branch: string): string => key + "." + branch;
    const wire = carburetor.toJSON();

    if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
        throw new Error("persist: partitions need a plain-object wire form (toJSON) with one key per branch");
    }
    const wireRecord = wire as Record<string, unknown>;
    partitions.forEach((branch: string) => {
        if (!Object.prototype.hasOwnProperty.call(wireRecord, branch)) {
            throw new Error('persist: partition "' + branch + '" is not a top-level key of the wire form');
        }
    });

    // Restore: stored branches replace the live ones; branches without a stored entry stay
    // as they are. With no partition entries at all, the legacy single entry is restored.
    const parsed: Record<string, unknown> = Object.create(null);
    const restored: string[] = [];
    // The last stored string per branch: identical writes to storage are skipped.
    const lastWritten: Record<string, string | undefined> = Object.create(null);
    let hasPartitionEntry = false;
    partitions.forEach((branch: string) => {
        let entry: string | null;
        try {
            entry = storage.getItem(branchKey(branch));
        } catch (error: unknown) {
            if (onError) {
                onError(error);
                entry = null;
            } else {
                throw error;
            }
        }
        if (entry === null) {
            return;
        }
        hasPartitionEntry = true;
        lastWritten[branch] = entry;
        try {
            parsed[branch] = JSON.parse(entry);
        } catch (error: unknown) {
            delete lastWritten[branch];
            reportRestoreFailure(branchKey(branch), error, onError, 'the stored data was removed');
            try {
                storage.removeItem(branchKey(branch));
            } catch (removeError: unknown) {
                reportRemovalFailure(onError, removeError);
            }
            return;
        }
        restored.push(branch);
    });

    if (restored.length > 0) {
        const target: Record<string, unknown> = {...wireRecord};
        restored.forEach((branch: string) => {
            target[branch] = parsed[branch];
        });
        try {
            carburetor.restore(target as T);
        } catch (error: unknown) {
            if (partitions.length === 1) {
                // The only configured partition is the known culprit: report, then drop its
                // entry like a malformed one, so the next connection starts from defaults.
                const [branch] = partitions;
                reportRestoreFailure(branchKey(branch), error, onError, 'the stored data was removed');
                delete lastWritten[branch];
                try {
                    storage.removeItem(branchKey(branch));
                } catch (removeError: unknown) {
                    reportRemovalFailure(onError, removeError);
                }
            } else {
                // Several partitions are configured: the guilty one is unknown, so no stored
                // entry is deleted — the next connection can retry once this is fixed.
                reportRestoreFailure(key, error, onError, 'the stored data is kept');
            }
        }
    } else {
        let legacy: string | null;
        let oldKey: string | undefined;
        try {
            legacy = storage.getItem(key);
            if (legacy === null && !hasPartitionEntry) {
                const fallback = readFallback(storage, options.previousKeys);
                legacy = fallback?.value ?? null;
                oldKey = fallback?.source;
            }
        } catch (error: unknown) {
            if (onError) {
                onError(error);
                legacy = null;
            } else {
                throw error;
            }
        }
        if (legacy !== null) {
            try {
                carburetor.restore(JSON.parse(legacy) as T);
                if (oldKey !== undefined) {
                    storage.setItem(key, JSON.stringify(carburetor));
                    storage.removeItem(oldKey);
                }
            } catch (error: unknown) {
                reportRestoreFailure(
                    oldKey ?? key,
                    error,
                    onError,
                    oldKey ? 'the stored data is kept' : 'the stored data was removed'
                );
                if (oldKey === undefined) {
                    try {
                        storage.removeItem(key);
                    } catch (removeError: unknown) {
                        reportRemovalFailure(onError, removeError);
                    }
                }
            }
        }
    }

    // Writes: each branch is stringified on its own, so a flush pays for the dirty
    // partitions only. The first flush seals the baseline by writing every branch.
    let lastSeenVersion = carburetor.getVersion();
    let lastWriteAt = 0;
    let sealed = false;
    const pending: Set<string> = new Set<string>();
    const failed: Set<string> = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queued = false;
    let disposed = false;

    /** Writes one branch, keeping `lastWritten` truthful and failed attempts retryable.
     *
     * @param branch - the partition to stringify and store.
     */
    const writeBranchDirect = (branch: string): void => {
        let value: string | undefined;
        try {
            const current = carburetor.toJSON() as Record<string, unknown>;
            value = JSON.stringify(current[branch]);
        } catch (error: unknown) {
            if (onError) {
                onError(error);
            }
            return;
        }
        // Version seen: a branch whose write failed stays in `failed` and is retried by itself.
        lastSeenVersion = carburetor.getVersion();
        if (value === lastWritten[branch]) {
            failed.delete(branch);
            return;
        }
        try {
            if (value === undefined) {
                if (lastWritten[branch] !== undefined) {
                    storage.removeItem(branchKey(branch));
                    delete lastWritten[branch];
                }
                failed.delete(branch);
                return;
            }
            storage.setItem(branchKey(branch), value);
            lastWritten[branch] = value;
            lastWriteAt = Date.now();
            failed.delete(branch);
        } catch (error: unknown) {
            // The partition stays failed: the next dispatch (or the disposer) retries it.
            failed.add(branch);
            if (onError) {
                onError(error);
            }
        }
    };

    /** Writes one branch, sealing the whole baseline on the first call.
     *
     * @param branch - the partition the notification named.
     */
    const writeBranch = (branch: string): void => {
        if (!sealed) {
            sealed = true;
            partitions.forEach(writeBranchDirect);
            return;
        }
        if (failed.size === 0) {
            writeBranchDirect(branch);
            return;
        }
        // Retry every failed partition alongside the notified one; identical content is
        // skipped and a still-failing partition is reported once per attempt.
        const batch = new Set(failed);
        batch.add(branch);
        batch.forEach(writeBranchDirect);
    };
    const windowRemainder = (): number =>
        throttleMs === undefined ? 0 : Math.max(0, throttleMs - (Date.now() - lastWriteAt));

    /** Writes every dirty branch once the throttle window allows it. */
    const dispatch = (forced: boolean = false): void => {
        if (disposed || (pending.size === 0 && failed.size === 0)) {
            return;
        }
        const wait = forced ? 0 : windowRemainder();
        if (wait > 0) {
            if (timer === undefined) {
                timer = setTimeout(() => {
                    timer = undefined;
                    dispatch();
                }, wait);
            }
            return;
        }
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        const batch = sealed
            ? Array.from(new Set([...pending, ...failed]))
            : partitions.slice();
        pending.clear();
        failed.clear();
        sealed = true;
        batch.forEach(writeBranchDirect);
    };

    /** Marks one branch for the next coalesced dispatch.
     *
     * @param branch - the partition a notification touched.
     */
    const markDirty = (branch: string): void => {
        if (disposed) {
            return;
        }
        pending.add(branch);
        if (!queued && timer === undefined) {
            queued = true;
            queueMicrotask(() => {
                queued = false;
                dispatch();
            });
        }
    };
    const drains = coalesce === false ? undefined : ((carburetor as ICarburetor<T> & {
        [CARBURETOR_PERSIST_DRAIN]?: Set<() => void>;
    })[CARBURETOR_PERSIST_DRAIN] ??= new Set<() => void>());
    const drain = (): void => dispatch(true);
    drains?.add(drain);
    const ids = partitions.map((branch: string) =>
        carburetor.subscribe(
            coalesce === false ? () => writeBranch(branch) : () => markDirty(branch),
            {reads: new Set([branch])}
        )
    );
    return () => {
        disposed = true;
        drains?.delete(drain);
        ids.forEach(id => carburetor.unsubscribe(id));
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        // Undelivered scheduler publications leave the storage behind; reconcile every
        // branch — identical ones skip their write, so this is cheap and exact. Failed
        // partitions are retried here even without new changes.
        if (carburetor.getVersion() !== lastSeenVersion || failed.size > 0) {
            sealed = true;
            partitions.forEach(writeBranchDirect);
        }
    };
};
