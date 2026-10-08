import {IReplayAttempt} from './IReplayAttempt';
import {sameHistoryGraph} from './sameHistoryGraph';
import {isSafeScalarPatch} from './isSafeScalarPatch';
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
    replayAttempts: WeakMap<object, IReplayAttempt>;
    reconcileBaseline(): void;
    carburetor: Pick<ICarburetor<T>, 'restore' | 'getData'> & IPatchSource & IInternalSubscriptionProtocol;
}

/**
 * Replays a history entry's patches through the store's draft — one O(patches) pass instead of
 * reconstruct-and-restore's O(state) copies and diff (R34-03) — and advances the history's
 * owned baseline by the same patches, sharing the write path entry recording uses.
 *
 * The replay's installation fact carries the operation's owner token, so `record` suppresses
 * the publication at delivery time however deferred that is, and a fresh write landing in the
 * window still branches from the installed replay state. Falls back to false for snapshot
 * entries, restricted baselines, unsafe native paths, and any store that does not implement the protocol
 * or overrides `restore()`.
 *
 * @param host - the history's private replay state.
 * @param patches - the entry's patches, in the order originally recorded.
 * @param inverse - true undoes the entry (patches in reverse); false redoes it.
 * @param attempt - the initiating call's owner-scoped installation and refusal verdict.
 * @returns whether the entry was installed through the draft.
 */
export function applyPatchesEntryOnDraft<T extends object>(
    host: IReplayHost<T>, patches: readonly IWritePatch[], inverse: boolean, attempt: IReplayAttempt
): boolean {
    const replay = host.carburetor[CARBURETOR_REPLAY_PATCHES];
    if (replay === undefined || host.baselineContainsLockedArray ||
        host.baselineContainsRestricted || host.carburetor.restore !== Carburetor.prototype.restore) {
        return false;
    }

    if (host.baselineContainsExotic &&
        !patches.every(patch => isSafeScalarPatch(host.baseline, patch, inverse))) return false;

    const owner = attempt.owner;
    host.replayOwners.add(owner);
    host.replayOwner = owner;
    host.pendingReplayOwner = owner;
    host.replayAttempts.set(owner, attempt);
    attempt.reconcile = () => {
        if (!matchesInstalledPaths(host, patches)) host.reconcileBaseline();
    };
    try {
        // R39-02: stage once before publication; nested writes own every later baseline change.
        advanceBaseline(host, patches, inverse);
        // Method-call form: the replay reads the store's transition state through `this`.
        host.carburetor[CARBURETOR_REPLAY_PATCHES]!(
            patches, inverse, {origin: 'restore', owner, representation: 'history-owned'}
        );
    } catch (error) {
        // An observer can stop a batch after its first live patch, or refuse it before any write.
        attempt.refused = !attempt.started;
        host.reconcileBaseline();
        if (host.pendingReplayOwner === owner) host.pendingReplayOwner = undefined;
        host.replayAttempts.delete(owner);
        attempt.reconcile = undefined;
        throw error;
    } finally {
        if (host.replayOwner === owner) host.replayOwner = undefined;
    }
    return true;
}

/** Checks final changed paths, including a batch interrupted before later patches landed.
 *
 * @param host - the history's private replay state.
 * @param patches - the paths staged on the owned baseline.
 */
function matchesInstalledPaths<T extends object>(host: IReplayHost<T>, patches: readonly IWritePatch[]): boolean {
    const live = host.carburetor.getData();
    for (const patch of patches) {
        let before: unknown = host.baseline;
        let after: unknown = live;
        for (const key of patch.segments) {
            const owned = before !== null && typeof before === 'object'
                ? Object.getOwnPropertyDescriptor(before, key) : undefined;
            const installed = after !== null && typeof after === 'object'
                ? Object.getOwnPropertyDescriptor(after, key) : undefined;
            if ((owned === undefined) !== (installed === undefined)) return false;
            if (owned === undefined || installed === undefined) {
                before = undefined; after = undefined;
                break;
            }
            if (!('value' in owned) || !('value' in installed)) return false;
            before = owned.value;
            after = installed.value;
        }
        if (!sameHistoryGraph(before, after)) return false;
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
