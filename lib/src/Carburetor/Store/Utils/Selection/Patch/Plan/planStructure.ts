import {TPath} from "../../../../../Models/Paths";
import {PATH_SEPARATOR} from "../../../../Paths/PathSeparator";
import {WILDCARD_PATH} from "../../../../Paths/WildcardPath";
import {unescapeSegment} from "./unescapeSegment";

/** The key-set marker segment `keysPath` appends below a container. */
const KEYS_SEGMENT = '~k';

/**
 * Names the root's own keys a batch wrote, when the batch only restructured the selected
 * container itself: every inside path is one of its direct keys (or its key-set marker), and every
 * raw object those writes mutated is the root's raw object.
 *
 * A deeper path means a member changed in place, a marker other than the key set (a branch or raw
 * exposure marker) cannot be placed, and an unrecorded or foreign mutation target makes the write
 * unknown — each answers undefined, for the full reconcile. Outside paths are the caller's proof.
 *
 * @param rootPath - the path of the selected view (`''` for the store root)
 * @param paths - the paths written since the snapshot
 * @param written - the raw objects each written path mutated
 * @param root - the selected container's raw object
 * @returns the unescaped direct keys written (`length` included), or undefined
 */
export const planStructure = (
    rootPath: TPath, paths: ReadonlyArray<TPath>, written: ReadonlyMap<TPath, ReadonlySet<object>>,
    root: object
): Set<string> | undefined => {
    const rootPrefix = rootPath + PATH_SEPARATOR;
    const keys = new Set<string>();
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        let segment: string;
        if (path === WILDCARD_PATH) return undefined;
        if (rootPath === '') segment = path;
        else if (path.startsWith(rootPrefix)) segment = path.slice(rootPrefix.length);
        else if (path === rootPath || rootPath.startsWith(path + PATH_SEPARATOR)) return undefined;
        else continue;
        if (segment.includes(PATH_SEPARATOR)) return undefined;
        // Escaped keys only ever hold `~0`/`~1`; any other `~` segment is a marker.
        if (segment.startsWith('~') && segment !== KEYS_SEGMENT && !/^~[01]/.test(segment)) return undefined;
        const mutated = written.get(path);
        if (mutated === undefined || mutated.size === 0) return undefined;
        for (const target of mutated) {
            if (target !== root) return undefined;
        }
        if (segment === KEYS_SEGMENT) continue;
        const key = unescapeSegment(segment);
        if (key === '__proto__') return undefined;
        keys.add(key);
    }
    return keys;
};
