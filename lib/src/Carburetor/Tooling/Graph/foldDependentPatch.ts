import {IWritePatch} from '../../Models/Paths';
import {isTrackable} from '../../Store/Tracking/isTrackable';

/** Collision-free join of raw segments into one index key (length-prefixed, pipe-separated). */
const joinSegments = (segments: readonly string[]): string => {
    let joined = '';
    for (const segment of segments) {
        if (joined !== '') joined += '|';
        joined += segment.length + ':' + segment;
    }
    return joined;
};

/** Prefix indexes of the pending patches one array has been indexed up to. */
interface IFoldIndex {
    paths: Map<string, number>;
    owned: Map<string, number[]>;
    covered: number;
}

const foldIndexes = new WeakMap<IWritePatch[], IFoldIndex>();

/** Indexes pending patches pushed since the last fold, so the search never rescans them. */
const coverIndex = (patches: IWritePatch[], index: IFoldIndex): void => {
    while (index.covered < patches.length) {
        const patchIndex = index.covered++;
        const patch = patches[patchIndex];
        const joined = joinSegments(patch.segments);
        index.paths.set(joined, patchIndex);
        if (patch.nextExists && isTrackable(patch.next)) {
            const owned = index.owned.get(joined);
            if (owned === undefined) index.owned.set(joined, [patchIndex]);
            else owned.push(patchIndex);
        }
    }
};

/**
 * Folds a later patch at or under an earlier pending patch's owned next into it.
 *
 * Handles both owned object patches and raw scalar leaf patches, whose previous/next
 * are unowned raw scalars: the fold only writes `next` into the earlier owned copy's
 * subtree, or deletes it — `previous` is never retained. The owned `next` is never
 * aliased to user state and installPatch re-clones it during replay, so folding in
 * place is safe.
 *
 * The pending patches are indexed by joined path, so the search walks the new patch's
 * prefix chain once (O(depth)) instead of scanning every pending patch; a pending patch
 * pushed between folds is indexed on demand.
 *
 * @param patches - the patches collected since the last flush, searched from the end.
 * @param patch - the newest patch, not yet appended.
 * @returns whether the patch was folded into an earlier pending patch.
 */
export const foldDependentPatch = (patches: IWritePatch[], patch: IWritePatch): boolean => {
    let index = foldIndexes.get(patches);
    if (index === undefined) {
        index = {paths: new Map<string, number>(), owned: new Map<string, number[]>(), covered: 0};
        foldIndexes.set(patches, index);
    }
    coverIndex(patches, index);
    const segments = patch.segments;
    const depth = segments.length;
    let bestIndex = -1;
    let bestDepth = 0;
    let bestJoined = '';
    let joined = '';
    for (let part = 0; part < depth; part++) {
        const segment = segments[part];
        joined += segment.length + ':' + segment;
        const owned = index.owned.get(joined);
        if (owned !== undefined) {
            const candidate = owned[owned.length - 1];
            if (candidate > bestIndex) {
                bestIndex = candidate;
                bestDepth = part + 1;
                bestJoined = joined;
            }
        }
        joined += '|';
    }
    if (bestIndex < 0) return false;
    const earlier = patches[bestIndex];
    if (bestDepth === depth) {
        patches[bestIndex] = {...earlier, next: patch.next, nextExists: patch.nextExists};
        if (!(patch.nextExists && isTrackable(patch.next))) {
            const owned = index.owned.get(bestJoined)!;
            owned.pop();
            if (owned.length === 0) index.owned.delete(bestJoined);
        }
        return true;
    }
    // An intermediate patch at a path between the two owns the subtree; leave both alone.
    joined = '';
    for (let part = 0; part < depth - 1; part++) {
        if (part > 0) joined += '|';
        joined += segments[part].length + ':' + segments[part];
        const anyIndex = index.paths.get(joined);
        if (anyIndex !== undefined && anyIndex > bestIndex) return false;
    }
    let node: unknown = earlier.next;
    for (let part = bestDepth; part < depth - 1; part++) {
        node = (node as Record<string, unknown>)[segments[part]];
        if (node === null || typeof node !== 'object') return false;
    }
    const holder = node as Record<string, unknown>;
    const key = segments[depth - 1];
    if (!patch.nextExists) delete holder[key];
    else if (key === '__proto__') {
        Object.defineProperty(holder, key,
            {value: patch.next, writable: true, enumerable: true, configurable: true});
    } else holder[key] = patch.next;
    return true;
};
