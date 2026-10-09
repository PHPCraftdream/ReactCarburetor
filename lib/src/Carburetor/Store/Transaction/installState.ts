import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {
    IStateInstallation, PATCH_OPAQUE,
    STATE_PUBLIC_REPLACEMENT, TPath,
} from '@/Carburetor/Models/Paths';
import {IStateInstallPort} from '@/Carburetor/Store/Transaction/Models';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {deliverPatches} from '@/Carburetor/Store/Tracking/Proxy/deliverPatches';
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';

/** Maximum detailed history patches retained for one public replacement. */
const PATCH_HISTORY_CAP = 1_000;

type Patch = Parameters<NonNullable<IStateInstallPort<object>[typeof S.patchPort]['listener']>>[0];

const createPatchCollector = (): {
    patches: Patch[];
    exceeded: () => boolean;
} => {
    const patches: Patch[] = [];
    let exceeded = false;
    const push = patches.push.bind(patches);
    patches.push = (...items) => {
        if (exceeded) return patches.length;
        if (patches.length + items.length > PATCH_HISTORY_CAP) {
            exceeded = true;
            patches.length = 0;
            push(PATCH_OPAQUE);
            return patches.length;
        }
        return push(...items);
    };
    return {patches, exceeded: () => exceeded};
};

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

    const previous = store[S.data];
    // A caller-assembled root never stores a view (R32-01): the top level is unwrapped here,
    // development normalizes the whole root before the state check, and production relies on
    // the diff walk exchanging every leaked view for its raw target in place.
    const root = (liveViews.readTarget(data) ?? data) as T;
    if (store[S.aliases] !== undefined) {
        liveViews.normalizeAssigned(root, previous);
    }
    store[S.aliases]?.checkState(root, '', previous);
    const collected = store[S.patchPort].listener === undefined ? undefined : createPatchCollector();
    const changed = diffPaths(previous, root, '', [], collected?.patches);
    if (isTrackable(previous)) nativeAliasIndex.invalidate(previous);
    if (isTrackable(root)) nativeAliasIndex.invalidate(root);
    store[S.data] = root;
    store[S.draftProxy] = undefined;
    // Deferred observers may still hold a prior mutation after the store fact was closed.
    // Mix in a value-equal installation without scheduling a publication of its own.
    if (changed.size === 0 && !transition.wildcard) {
        store[S.patchObservers]?.markPendingInstall();
    }

    store[S.touchDraft]();
    changed.forEach((path: TPath) => store[S.recordWrite](path));
    if (transition.wildcard) store[S.recordWrite](WILDCARD_PATH);
    if (changed.size > 0 || transition.wildcard || store[S.publicationPending]) {
        if (!continuation || !store[S.publicationPending] || store[S.pendingPublication] !== transition) {
            store[S.rememberPublication](transition);
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
            const listener = store[S.patchPort].listener;
            if (listener !== undefined) {
                if (transition.wildcard || collected?.exceeded() || collected?.patches.some(patch => typeof patch === 'symbol')) {
                    listener(PATCH_OPAQUE);
                }
                // R37-02: a throwing observer must not abort the rest of the already-applied
                // batch; deliverPatches delivers every patch and rethrows only the first error.
                else deliverPatches(listener, collected?.patches ?? []);
            }
        } catch (error: unknown) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }

    if (store[S.draftTouched] || store[S.writes].size > 0) {
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
