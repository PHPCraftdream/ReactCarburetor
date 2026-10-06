import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";
import {rejectArraySubclass} from "@/Carburetor/Store/Utils/Selection/rejectArraySubclass";
import {patchFromWriteLog} from "./patchFromWriteLog";
import {IReuseConnection} from "./Models";

/**
 * R36-01: a render that gets the same live selection as the last one keeps its snapshot, and the
 * connection's filed read set, without walking the selection.
 *
 * With no write since the committed description that concerns its reads, the snapshot stands as
 * it is. With one, the write log names the changed paths and only those subtrees are patched.
 * Either way the attempt adopts the committed read set by identity (see `IAttemptEntry.sharedReads`),
 * grown only by paths the patch newly read, so the commit finds the subscription unchanged.
 * Anything else (another store, a read outside the filed set, a log that cannot answer, a snapshot
 * with shared references) returns undefined and the caller runs the full reconcile.
 *
 * @param connection - the selection's connection, read after the selector ran in this attempt
 * @param previous - the snapshot of the last render
 * @param live - the selector's result, already known to be the live view the snapshot mirrors
 * @param ledger - the raw to copy ledger of the last full reconcile
 * @param patchable - whether that reconcile saw no shared reference
 * @returns the snapshot to hand out, or undefined for the full reconcile
 */
export const reuseSelection = <R>(
    connection: IReuseConnection, previous: R, live: object,
    ledger: WeakMap<object, unknown>, patchable: boolean
): R | undefined => {
    const committed = connection.committed;
    const entry = connection.attemptEntry;

    if (committed === undefined || entry === undefined || committed.carburetor !== entry.source) {
        return undefined;
    }

    for (const path of entry.reads) {
        if (!committed.reads.has(path)) return undefined;
    }

    const store = committed.carburetor as IInternalSubscriptionProtocol;
    const hasDrift = store[CARBURETOR_HAS_DRIFT];

    if (hasDrift === undefined) {
        return undefined;
    }

    let value = previous;
    let sharedReads = true;

    if (hasDrift.call(store, committed.baselineVersion, committed.reads)) {
        const patched = patchable
            ? patchFromWriteLog(
                store, committed.baselineVersion, previous, live, ledger, undefined, rejectArraySubclass
            )
            : undefined;

        if (patched === undefined) {
            return undefined;
        }

        value = patched;

        for (const path of entry.reads) {
            if (!committed.reads.has(path)) sharedReads = false;
        }
    }

    if (sharedReads) {
        entry.reads = committed.reads as Set<string>;
        entry.sharedReads = true;
    } else {
        entry.reads = new Set<string>([...committed.reads, ...entry.reads]);
    }

    return value;
};
