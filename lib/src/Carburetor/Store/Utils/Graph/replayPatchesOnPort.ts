import {IStateInstallation, IWritePatch} from '@/Carburetor/Models/Paths';
import {installPatch} from '@/Carburetor/Store/Paths/Diff/installPatch';
import {IStateInstallPort} from '@/Carburetor/Store/Transaction/Models';

/**
 * Replays history patches through the store's draft and keeps the owner's fact on the closed
 * publication, so a throttled delivery or a transaction drain recognizes it like a restore.
 *
 * @param store - the store's install port.
 * @param draftOf - hands out the store's own draft proxy, created the way every draft write is.
 * @param patches - the patches to install, in the order originally recorded.
 * @param inverse - true installs `previous` in reverse order; false installs `next` forward.
 * @param installation - the replay owner's installation fact.
 */
export const replayPatchesOnPort = (
    store: IStateInstallPort<object>, draftOf: () => unknown, patches: readonly IWritePatch[],
    inverse: boolean, installation: IStateInstallation
): void => {
    let error: unknown;

    try {
        const draft = draftOf() as Record<string, unknown>;
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
};
