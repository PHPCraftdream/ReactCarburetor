import {
    IStateInstallation, PATCH_OPAQUE, TPath, TPathSet,
} from '@/Carburetor/Models/Paths';
import {IStorePublicationPort} from '@/Carburetor/Store/Transaction/Models';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {nativeStoreWriteEpoch} from '@/Carburetor/Store/Scheduling/nativeStoreWriteEpoch';
import {updateBatch} from '@/Carburetor/Store/Transaction/UpdateBatchInstance';

/** Closes writes, records their publication owner and delivers despite earlier observer failure.
 *
 * @param receiver - the typed publication port over the store's mutation and delivery state
 * @param installation - an explicit root transition, when this write set installs one
 * @param deferredContinuation - whether its publication fact was already queued
 */
export const emitStoreUpdate = <T extends object>(
    receiver: IStorePublicationPort<T>, installation?: IStateInstallation, deferredContinuation: boolean = false
): void => {
    const store = receiver;
    let failed = false;
    let firstError: unknown;
    try {
        store.preEmit();
    } catch (error: unknown) {
        failed = true;
        firstError = error;
    }
    // Raw writes followed by emitUpdate bypass draft traps entirely.
    if (isTrackable(store.data) && !store.draftTouched && store.writes.size === 0) {
        nativeAliasIndex.invalidate(store.data);
    }

    const touched = store.draftTouched;
    // Handed off, not copied: a fresh Set takes over as this.writes, so the caller below
    // (notifyWrites, or the update batch) owns this one exclusively and may keep it as is.
    // An empty writes Set is never handed off anywhere, so it is reused as-is instead of
    // being replaced on every emit, including the (common) no-op ones.
    const changed: TPathSet | undefined = store.writes.size > 0 ? store.writes : undefined;

    if (changed) {
        store.writes = new Set<TPath>();
    }

    store.draftTouched = false;

    // Draft was used, but no value actually changed — there is nobody to wake.
    if (!changed && touched) {
        if (failed) throw firstError;
        return;
    }

    if (!deferredContinuation || !store.publicationPending) {
        store.rememberPublication(installation);
    }

    // Writes bypassed draft: unknown and opaque, same as the wildcard itself (R16-07).
    const writes: TPathSet = changed || new Set<TPath>([WILDCARD_PATH]);
    store.version++;
    nativeStoreWriteEpoch.value++;
    store.writeLog.record(store.version, writes);
    if (!changed) {
        try {
            store.patchPort.listener?.(PATCH_OPAQUE);
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }

    if (updateBatch.isActive()) {
        updateBatch.add(store, writes);
    } else {
        try {
            store.notifyWrites(writes);
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }
    if (failed) throw firstError;
};
