import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {unescapeSegment} from "./unescapeSegment";
import {IPatchNode} from "./Models";

/** More changed paths than this are cheaper to reconcile whole. */
const PATCH_PATH_LIMIT = 64;

/**
 * Turns the paths written since a snapshot into the tree of keys to patch below the selection's root.
 *
 * A path outside the root, and not its ancestor, is ignored: the selection never read it. Anything
 * the patch cannot place exactly asks for the full reconcile: the root itself or an ancestor, a
 * wildcard, a key-set or length change, a branch marker, or too many paths.
 *
 * @param rootPath - the path of the selected view (`''` for the store root)
 * @param paths - the paths written since the snapshot, as the write log lists them
 * @returns the patch tree, or undefined for the full path
 */
export const planSelectionPatch = (rootPath: TPath, paths: ReadonlyArray<TPath>): IPatchNode | undefined => {
    const root: IPatchNode = {leaf: false, children: undefined};
    let used = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        let rest: string;
        if (path === WILDCARD_PATH) return undefined;
        if (rootPath === '') rest = path;
        else if (path === rootPath || rootPath.startsWith(path + PATH_SEPARATOR)) return undefined;
        else if (path.startsWith(rootPath + PATH_SEPARATOR)) rest = path.slice(rootPath.length + 1);
        else continue;
        if (++used > PATCH_PATH_LIMIT) return undefined;
        const segments = rest.split(PATH_SEPARATOR);
        let node = root;
        for (let depth = 0; depth < segments.length && !node.leaf; depth++) {
            const segment = segments[depth];
            if (segment === '~k' || segment === '~p' || segment === 'length') return undefined;
            const key = unescapeSegment(segment);
            if (key === '__proto__') return undefined;
            node.children ??= new Map<string, IPatchNode>();
            let child = node.children.get(key);
            if (child === undefined) node.children.set(key, child = {leaf: false, children: undefined});
            if (depth === segments.length - 1) child.leaf = true;
            node = child;
        }
    }
    return root;
};
