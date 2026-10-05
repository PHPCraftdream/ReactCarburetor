import {
    IStateInstallation, PATCH_OPAQUE,
    STATE_PUBLIC_REPLACEMENT, TPath,
} from '@/Carburetor/Models/Paths';
import {IStateInstallPort} from '@/Carburetor/Store/Transaction/Models';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';

/** Installs a prepared root, closes its metadata, and publishes even when delivery fails.
 *
 * @param receiver - the typed install port over the store's protected transition state
 * @param data - the prepared root adopted by the operation
 * @param installation - explicit origin/owner/representation, or the ordinary public replacement
 * @param continuation - whether this commit continues an already-filed restore operation
 */
export const installState = <T extends object>(
    receiver: IStateInstallPort<T>, data: T, installation?: IStateInstallation, continuation: boolean = false
): T => {
    const store = receiver;
    const transition: IStateInstallation = installation ?? STATE_PUBLIC_REPLACEMENT;
    if (transition.origin === 'operational' && !transition.owner) {
        throw new Error('Carburetor: operational installation requires its owner');
    }

    const previous = store.data;
    // A caller-assembled root never stores a view (R32-01): the top level is unwrapped here,
    // development normalizes the whole root before the state check, and production relies on
    // the diff walk exchanging every leaked view for its raw target in place.
    const root = (liveViews.readTarget(data) ?? data) as T;
    if (store.aliases !== undefined) {
        liveViews.normalizeAssigned(root, previous);
    }
    store.aliases?.checkState(root, '', previous);
    const changed = diffPaths(previous, root);
    if (isTrackable(previous)) nativeAliasIndex.invalidate(previous);
    if (isTrackable(root)) nativeAliasIndex.invalidate(root);
    store.data = root;
    store.draftProxy = undefined;
    // Deferred observers may still hold a prior mutation after the store fact was closed.
    // Mix in a value-equal installation without scheduling a publication of its own.
    if (changed.size === 0 && !transition.wildcard) {
        store.patchObservers?.markPendingInstall();
    }

    store.touchDraft();
    changed.forEach((path: TPath) => store.recordWrite(path));
    if (transition.wildcard) store.recordWrite(WILDCARD_PATH);
    if (changed.size > 0 || transition.wildcard || store.publicationPending) {
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
    return root;
};
