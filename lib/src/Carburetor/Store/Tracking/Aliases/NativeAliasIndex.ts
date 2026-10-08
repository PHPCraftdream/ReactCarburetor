import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {buildOwnershipIndex} from "./buildOwnershipIndex";

/** Every ordinary own path to each raw object, scoped to one live root. */
const ownership = new WeakMap<object, Map<object, string[]>>();

/** Bumped on every topological change, so caches can detect staleness cheaply. */
const generations = new WeakMap<object, number>();

/** Rebuild only after an unknown graph mutation. */
const indexRoot = (root: object): Map<object, string[]> => {
    const paths = buildOwnershipIndex(root);
    ownership.set(root, paths);
    return paths;
};

/** One root-owned index shared by fresh read trees and cached native facades. */
export const nativeAliasIndex = {
    paths: (root: object): Map<object, string[]> => ownership.get(root) ?? indexRoot(root),
    generation: (root: object): number => generations.get(root) ?? 0,
    invalidate: (root: object): void => {
        generations.set(root, (generations.get(root) ?? 0) + 1);
        ownership.delete(root);
    },
    /** Repair only proven uniquely owned, disjoint subtrees. Unknown effects discard the
     * index; no root walk or whole-index scan occurs here, and an unbuilt index stays lazy.
     */
    noteChange: (
        root: object, target: object, key: string, previous: unknown, next: unknown, path: string,
    ): void => {
        generations.set(root, (generations.get(root) ?? 0) + 1);
        const index = ownership.get(root);
        if (index === undefined) return;
        const fallback = (): void => { ownership.delete(root); };
        const targetPaths = index.get(target);
        if (Object.is(previous, next) || (Array.isArray(target) && key === 'length')
            || targetPaths?.length !== 1 || joinPath(targetPaths[0], key) !== path) {
            fallback();
            return;
        }
        // Exactly one target descriptor lookup: setters, inherited/hidden data and a
        // reported value different from the actual result are not local ownership proofs.
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (descriptor === undefined ? next !== undefined
            : !descriptor.enumerable || !('value' in descriptor) || !Object.is(descriptor.value, next)) {
            fallback();
            return;
        }
        const oldPaths = isTrackable(previous) ? buildOwnershipIndex(previous, path) : new Map<object, string[]>();
        for (const [value, paths] of oldPaths) {
            const existing = index.get(value);
            // Multiple paths also detect cycles. External aliases mean removing this edge
            // cannot safely remove the node; retain no partially repaired index.
            if (paths.length !== 1 || existing?.length !== 1 || existing[0] !== paths[0]) {
                fallback();
                return;
            }
        }
        const newPaths = new Map<object, string[]>();
        let ambiguous = false;
        if (isTrackable(next)) buildOwnershipIndex(next, path, (value, valuePath) => {
            // Pending nested views are normalized later by diffPaths, not by this hook.
            // Reject before indexing or enumerating them, including connected facades.
            if (liveViews.readTarget(value) !== undefined) {
                ambiguous = true;
                return false;
            }
            // Test against the OLD index, even when this node would be removed below.
            if (index.has(value) || newPaths.has(value)) {
                ambiguous = true;
                return false;
            }
            newPaths.set(value, [valuePath]);
        });
        if (ambiguous) {
            fallback();
            return;
        }
        // Every old pair was validated before any mutation; each node has just that pair.
        for (const value of oldPaths.keys()) index.delete(value);
        for (const [value, paths] of newPaths) index.set(value, paths);
    },
};
