import {TDisposer} from "@/Carburetor/Models/Base";
import {ICarburetor} from "@/Carburetor/Models/Store";
import {IStorageLike, IPersistOptions} from "@/Carburetor/Models/Tooling";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";

/** Reports a failed restore to onError, or loudly in development when the caller gave none. */
const reportRestoreFailure = (subject: string, error: unknown, onError: ((error: unknown) => void) | undefined): void => {
    if (onError) {
        onError(error);

        return;
    }

    if (IS_DEVELOPMENT) {
        diagnostics.report(
            'persist: stored entry "' + subject + '" could not be restored ('
            + (error instanceof Error ? error.message : String(error))
            + '); the stored data was removed. Pass onError to handle restore failures yourself.'
        );
    }
};

/** Reports a failed cleanup to onError, or rethrows when there is none — the read-path policy. */
const reportRemovalFailure = (onError: ((error: unknown) => void) | undefined, error: unknown): void => {
    if (onError) {
        onError(error);
    } else {
        throw error;
    }
};

type TPersistOptions = Pick<IPersistOptions, "onError" | "coalesce" | "throttleMs" | "partitions">;

/**
 * The partitioned storage layout: one key per branch (`key + "." + branch`), a legacy
 * whole-store entry as the read fallback, a sealed first flush as the write baseline.
 */
const persistPartitions = <T extends object>(
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

        lastWritten[branch] = entry;

        try {
            parsed[branch] = JSON.parse(entry);
        } catch (error: unknown) {
            delete lastWritten[branch];
            reportRestoreFailure(branchKey(branch), error, onError);

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
            reportRestoreFailure(key, error, onError);
            restored.forEach((branch: string) => {
                try {
                    storage.removeItem(branchKey(branch));
                } catch (removeError: unknown) {
                    reportRemovalFailure(onError, removeError);
                }
            });
        }
    } else {
        let legacy: string | null;

        try {
            legacy = storage.getItem(key);
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
            } catch (error: unknown) {
                reportRestoreFailure(key, error, onError);

                try {
                    storage.removeItem(key);
                } catch (removeError: unknown) {
                    reportRemovalFailure(onError, removeError);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queued = false;

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

        // Mark this version as attempted even on failure: dispose must not retry it.
        lastSeenVersion = carburetor.getVersion();

        if (value === lastWritten[branch]) {
            return;
        }

        try {
            if (value === undefined) {
                if (lastWritten[branch] !== undefined) {
                    delete lastWritten[branch];
                    storage.removeItem(branchKey(branch));
                }

                return;
            }

            lastWritten[branch] = value;
            storage.setItem(branchKey(branch), value);
            lastWriteAt = Date.now();
        } catch (error: unknown) {
            if (onError) {
                onError(error);
            }
        }
    };

    // The first write seals the baseline: every partition lands in storage once.
    const writeBranch = (branch: string): void => {
        if (!sealed) {
            sealed = true;
            partitions.forEach(writeBranchDirect);

            return;
        }

        writeBranchDirect(branch);
    };

    const windowRemainder = (): number =>
        throttleMs === undefined ? 0 : Math.max(0, throttleMs - (Date.now() - lastWriteAt));

    const dispatch = (): void => {
        if (pending.size === 0) {
            return;
        }

        const wait = windowRemainder();

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

        const batch = sealed ? Array.from(pending) : partitions.slice();

        pending.clear();
        sealed = true;
        batch.forEach(writeBranchDirect);
    };

    const markDirty = (branch: string): void => {
        pending.add(branch);

        if (!queued && timer === undefined) {
            queued = true;
            queueMicrotask(() => {
                queued = false;
                dispatch();
            });
        }
    };

    const ids = partitions.map((branch: string) =>
        carburetor.subscribe(
            coalesce === false ? () => writeBranch(branch) : () => markDirty(branch),
            {reads: new Set([branch])}
        )
    );

    return () => {
        ids.forEach(id => carburetor.unsubscribe(id));

        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }

        // Undelivered scheduler publications leave the storage behind; reconcile every
        // branch — identical ones skip their write, so this is cheap and exact.
        if (carburetor.getVersion() !== lastSeenVersion || pending.size > 0) {
            sealed = true;
            partitions.forEach(writeBranchDirect);
        }
    };
};

/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
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
 * `throttleMs` window is open covers all dirty branches together. Restore composes the stored
 * branches over the current state — branches without a stored entry keep their value, and a
 * legacy whole-store entry is restored when no partition entries exist yet (it stays in place,
 * shadowed by the partition entries). Each partition entry is written atomically on its own,
 * so a crash between two writes can compose a mixed state across branches. Branch names must
 * be plain top-level keys of the wire form; custom wire forms and other non-plain roots are
 * rejected.
 * A failed storage read is reported without discarding the unread entry; when `onError`
 * returns, the subscription still starts and later writes follow the chosen sync/coalesce
 * policy. Without `onError`, a failed read throws rather than pretending storage was empty.
 * A malformed or unrestorable entry is reported before cleanup; cleanup failures are
 * reported separately. The entry itself is always removed, in production too: without
 * `onError` that removal is silent there, while development reports it through the engine
 * diagnostics.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export const persist = <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer => {
    const {key, storage, coalesce, throttleMs, partitions} = options;

    if (throttleMs !== undefined) {
        if (!Number.isFinite(throttleMs) || throttleMs < 0) {
            throw new RangeError("persist: throttleMs must be a non-negative finite number");
        }

        if (coalesce === false) {
            throw new Error("persist: throttleMs requires the default write coalescing; coalesce: false writes on every notification");
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

        return persistPartitions(carburetor, key, storage, {onError: options.onError, coalesce, throttleMs, partitions});
    }

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
            reportRestoreFailure(key, error, options.onError);

            try {
                storage.removeItem(key);
            } catch (removeError: unknown) {
                reportRemovalFailure(options.onError, removeError);
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
        lastSeenVersion = carburetor.getVersion();

        try {
            // The store's wire form: JSON.stringify invokes its toJSON(), without cloning it.
            storage.setItem(key, JSON.stringify(carburetor));
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
