import {IWritePatch} from '@/Carburetor/Models/Paths';
import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';

/**
 * Folds a later patch at or under an earlier pending patch's owned next into it.
 *
 * Handles both owned object patches and raw scalar leaf patches, whose previous/next
 * are unowned raw scalars: the fold only writes `next` into the earlier owned copy's
 * subtree, or deletes it — `previous` is never retained. The owned `next` is never
 * aliased to user state and installPatch re-clones it during replay, so folding in
 * place is safe.
 *
 * @param patches - the patches collected since the last flush, searched from the end.
 * @param patch - the newest patch, not yet appended.
 * @returns whether the patch was folded into an earlier pending patch.
 */
export const foldDependentPatch = (patches: IWritePatch[], patch: IWritePatch): boolean => {
    for (let index = patches.length - 1; index >= 0; index--) {
        const earlier = patches[index];
        if (!earlier.nextExists || !isTrackable(earlier.next) ||
            earlier.segments.length > patch.segments.length ||
            !earlier.segments.every((segment, part) => segment === patch.segments[part])) continue;
        if (earlier.segments.length === patch.segments.length) {
            patches[index] = {...earlier, next: patch.next, nextExists: patch.nextExists};
            return true;
        }
        // An intermediate patch at a path between the two owns the subtree; leave both alone.
        if (patches.slice(index + 1).some(later =>
            later.segments.length < patch.segments.length &&
            later.segments.every((segment, part) => segment === patch.segments[part]))) return false;
        let node: unknown = earlier.next;
        for (let part = earlier.segments.length; part < patch.segments.length - 1; part++) {
            node = (node as Record<string, unknown>)[patch.segments[part]];
            if (node === null || typeof node !== 'object') return false;
        }
        const holder = node as Record<string, unknown>;
        const key = patch.segments[patch.segments.length - 1];
        if (patch.nextExists) holder[key] = patch.next;
        else delete holder[key];
        return true;
    }
    return false;
};
