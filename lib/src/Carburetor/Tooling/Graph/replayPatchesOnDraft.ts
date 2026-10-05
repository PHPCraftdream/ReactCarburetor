import {IStateInstallation, IWritePatch, TPath} from '@/Carburetor/Models/Paths';
import {ICarburetor, IPatchSource} from '@/Carburetor/Models/Store';
import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {installPatch} from '@/Carburetor/Store/Paths/Diff/installPatch';
import {cloneOwnedGraph as own} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';
import {createWriteProxy} from '@/Carburetor/Store/Tracking/createWriteProxy';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {IStateInstallPort} from '@/Carburetor/Store/Transaction/Models';
import {
    CARBURETOR_REPLAY_PATCHES, IInternalSubscriptionProtocol,
} from '@/Carburetor/Store/Utils/Models';

/** The private history state the draft replay drives; realized by CarburetorHistory. */
interface IReplayHost<T extends object> {
    baseline: T;
    baselineShared: boolean;
    baselineContainsExotic: boolean;
    baselineContainsLockedArray: boolean;
    baselineContainsRestricted: boolean;
    replayOwners: WeakSet<object>;
    replayOwner: object | undefined;
    pendingReplayOwner: object | undefined;
    fastReplayOwner: object | undefined;
    carburetor: Pick<ICarburetor<T>, 'restore'> & IPatchSource & IInternalSubscriptionProtocol;
}

// The draft replay protocol is implemented by the base store; installing it here keeps
// Carburetor.ts at its line budget and arms it exactly when a history consumer loads.
(Carburetor.prototype as unknown as {
    [CARBURETOR_REPLAY_PATCHES]?: typeof replayPatchesOnDraft;
})[CARBURETOR_REPLAY_PATCHES] = replayPatchesOnDraft;

/**
 * Replays a history entry's patches through the store's draft — one O(patches) pass instead of
 * reconstruct-and-restore's O(state) copies and diff (R34-03) — and advances the history's
 * owned baseline by the same patches, sharing the write path entry recording uses.
 *
 * The replay's installation fact carries the operation's owner token, so `record` suppresses
 * the publication at delivery time however deferred that is, and a fresh write landing in the
 * window still branches from the installed replay state. Falls back to false for snapshot
 * entries, restricted or native baselines, and any store that does not implement the protocol
 * or overrides `restore()`.
 *
 * @param host - the history's private replay state.
 * @param patches - the entry's patches, in the order originally recorded.
 * @param inverse - true undoes the entry (patches in reverse); false redoes it.
 * @returns whether the entry was installed through the draft.
 */
export function applyPatchesEntryOnDraft<T extends object>(
    host: IReplayHost<T>, patches: readonly IWritePatch[], inverse: boolean
): boolean {
    const replay = host.carburetor[CARBURETOR_REPLAY_PATCHES];
    if (replay === undefined || host.baselineContainsExotic || host.baselineContainsLockedArray ||
        host.baselineContainsRestricted || host.carburetor.restore !== Carburetor.prototype.restore) {
        return false;
    }

    const owner = {};
    host.replayOwners.add(owner);
    host.replayOwner = owner;
    host.pendingReplayOwner = owner;
    host.fastReplayOwner = owner;
    let installed = false;
    try {
        // Method-call form: the replay reads the store's transition state through `this`.
        host.carburetor[CARBURETOR_REPLAY_PATCHES]!(
            patches, inverse, {origin: 'restore', owner, representation: 'history-owned'}
        );
        installed = true;
    } finally {
        if (installed) {
            advanceBaseline(host, patches, inverse);
        } else {
            host.pendingReplayOwner = undefined;
            host.fastReplayOwner = undefined;
        }
        host.replayOwner = undefined;
    }
    return true;
}

/**
 * Replays the patches through the store's draft and keeps the owner's fact on the closed
 * publication, so a throttled delivery or a transaction drain recognizes it like a restore.
 *
 * @param this - the store's install port, through the protocol member's receiver.
 * @param patches - the patches to install, in the order originally recorded.
 * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
 * @param installation - the replay owner's installation fact.
 */
function replayPatchesOnDraft(
    this: IStateInstallPort<object>, patches: readonly IWritePatch[], inverse: boolean,
    installation: IStateInstallation
): void {
    replayPatchesOnPort(this, patches, inverse, installation);
}

/** The replay body over an explicit port; the protocol member hands its receiver over.
 *
 * @param store - the store's install port.
 * @param patches - the patches to install, in the order originally recorded.
 * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
 * @param installation - the replay owner's installation fact.
 */
const replayPatchesOnPort = (
    store: IStateInstallPort<object>, patches: readonly IWritePatch[], inverse: boolean,
    installation: IStateInstallation
): void => {
    const data: unknown = store.data;
    if (!isTrackable(data)) {
        throw new Error('Carburetor: patch replay requires a trackable root');
    }

    let error: unknown;
    store.touchDraft();
    try {
        store.draftProxy ??= createWriteProxy(
            data, (path: TPath) => store.recordWrite(path), '', store.aliases, undefined, store.patchPort
        );
        const draft = store.draftProxy as unknown as Record<string, unknown>;
        const ordered = inverse ? [...patches].reverse() : patches;

        for (const patch of ordered) {
            installPatch(draft, patch, inverse);
        }
    } catch (caught: unknown) {
        error = caught;
    }

    if (store.writes.size > 0 || store.publicationPending) {
        store.rememberPublication(installation);
    }
    store.emitUpdate(undefined, true);

    if (error !== undefined) {
        throw error;
    }
}

/**
 * Brings the owned mirror to the replayed state by installing the same patches; unchanged
 * branches keep their identity.
 *
 * @param host - the history's private replay state.
 * @param patches - the entry's patches, in the order originally recorded.
 * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
 */
function advanceBaseline<T extends object>(
    host: IReplayHost<T>, patches: readonly IWritePatch[], inverse: boolean
): void {
    if (host.baselineShared) host.baseline = own(host.baseline);
    const target = host.baseline as unknown as Record<string, unknown>;
    const ordered = inverse ? [...patches].reverse() : patches;

    for (const patch of ordered) {
        installPatch(target, patch, inverse);
    }

    host.baselineShared = false;
}
