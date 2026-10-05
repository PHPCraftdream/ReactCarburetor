import {IWritePatch} from '@/Carburetor/Models/Paths';
import {ICarburetor, IPatchSource} from '@/Carburetor/Models/Store';
import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {installPatch} from '@/Carburetor/Store/Paths/Diff/installPatch';
import {cloneOwnedGraph as own} from '@/Carburetor/Store/Utils/Graph/cloneOwnedGraph';
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
