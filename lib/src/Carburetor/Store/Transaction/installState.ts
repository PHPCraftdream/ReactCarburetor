import {
    IStateInstallation, PATCH_OPAQUE,
    STATE_PUBLIC_REPLACEMENT, TPath,
} from '@/Carburetor/Models/Paths';
import {IStateInstallPort} from '@/Carburetor/Store/Transaction/Models';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';

/** Installs a prepared root, closes its metadata, and publishes even when delivery fails.
 *
 * @param receiver - the typed install port over the store's protected transition state
 * @param data - the prepared root adopted by the operation
 * @param installation - explicit origin/owner/representation, or a pending exact restore claim
 * @param continuation - whether this commit continues an already-filed restore operation
 */
export const installState = <T extends object>(
    receiver: IStateInstallPort<T>, data: T, installation?: IStateInstallation, continuation: boolean = false
): T => {
    const store = receiver;
    const claim = store.patchObservers?.consumeRestoreClaim(data);
    const transition: IStateInstallation = claim
        && (installation === undefined || installation.origin === 'replacement')
        ? {origin: 'restore', owner: claim.owner, representation: claim.representation}
        : installation ?? STATE_PUBLIC_REPLACEMENT;
    if (transition.origin === 'operational' && !transition.owner) {
        throw new Error('Carburetor: operational installation requires its owner');
    }

    const previous = store.data;
    store.aliases?.checkState(data, '', previous);
    const changed = diffPaths(previous, data);
    if (isTrackable(previous)) nativeAliasIndex.invalidate(previous);
    if (isTrackable(data)) nativeAliasIndex.invalidate(data);
    store.data = data;
    store.draftProxy = undefined;

    store.touchDraft();
    changed.forEach((path: TPath) => store.recordWrite(path));
    if (transition.wildcard) store.recordWrite(WILDCARD_PATH);
    if (changed.size > 0 || transition.wildcard) {
        if (!continuation || !store.publicationPending || store.pendingPublication !== transition) {
            store.rememberPublication(transition);
        }
    }
    let failed = false;
    let firstError: unknown;
    try {
        store.didSetData();
    } catch (error: unknown) {
        failed = true;
        firstError = error;
    }
    if (changed.size > 0 || transition.wildcard) {
        try {
            store.patchPort.listener?.(PATCH_OPAQUE);
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }

    if (store.draftTouched || store.writes.size > 0) {
        try {
            if (transition.publication === 'deferred') {
                store.emitSoon(undefined, true);
            } else {
                store.emitUpdate(undefined, true);
            }
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }
    if (failed) throw firstError;
    return data;
};
