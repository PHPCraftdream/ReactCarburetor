import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {unescapeSegment} from "./unescapeSegment";
import {IPatchNode} from "./Models";

/**
 * R37-04: the decision to patch is relative, not an absolute path count. The estimated patch work
 * (one unit per path segment walked and per spine copied) is compared against the cost of a whole
 * reconcile, approximated by the selection's shallow size. Small batches on large selections patch;
 * genuinely dense batches honestly take the full walk. A ceiling on a tiny selection keeps the
 * bookkeeping from dominating.
 */
const MIN_FULL_COST = 16;

/**
 * Turns the paths written since a snapshot into the tree of keys to patch below the selection's root.
 *
 * A path outside the root, and not its ancestor, is ignored: the selection never read it. Anything
 * the patch cannot place exactly asks for the full reconcile: the root itself or an ancestor, a
 * wildcard, a key-set or length change, or a branch marker — as does a batch whose estimated work
 * exceeds the whole reconcile.
 *
 * @param rootPath - the path of the selected view (`''` for the store root)
 * @param paths - the paths written since the snapshot, as the write log lists them
 * @param fullCost - approximate cost of a whole reconcile: the selection's shallow size (length,
 * size or own key count of the previous snapshot)
 * @returns the patch tree, or undefined for the full path
 */
export const planSelectionPatch = (
    rootPath: TPath, paths: ReadonlyArray<TPath>, fullCost: number
): IPatchNode | undefined => {
    const budget = Math.max(fullCost, MIN_FULL_COST);
    const root: IPatchNode = {leaf: false, children: undefined};
    let work = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        let rest: string;
        if (path === WILDCARD_PATH) return undefined;
        if (rootPath === '') rest = path;
        else if (path === rootPath || rootPath.startsWith(path + PATH_SEPARATOR)) return undefined;
        else if (path.startsWith(rootPath + PATH_SEPARATOR)) rest = path.slice(rootPath.length + 1);
        else continue;
        const segments = rest.split(PATH_SEPARATOR);
        // One unit per segment walked while placing the path, plus one per spine node created.
        work += segments.length;
        if (work > budget) return undefined;
        let node = root;
        for (let depth = 0; depth < segments.length; depth++) {
            const segment = segments[depth];
            if (segment === '~k' || segment === '~p' || segment === 'length') return undefined;
            const key = unescapeSegment(segment);
            if (key === '__proto__') return undefined;
            if (node.leaf) continue;
            if (node.children === undefined) {
                node.children = new Map<string, IPatchNode>();
                work++;
                if (work > budget) return undefined;
            }
            let child = node.children.get(key);
            if (child === undefined) node.children.set(key, child = {leaf: false, children: undefined});
            if (depth === segments.length - 1) child.leaf = true;
            node = child;
        }
    }
    return root;
};
