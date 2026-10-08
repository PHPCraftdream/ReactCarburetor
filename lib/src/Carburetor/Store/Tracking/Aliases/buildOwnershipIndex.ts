import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/** Walk ordinary own enumerable string data, recording cycle backlinks but not recursing
 * through them. A visitor streams the same walk without allocating a full result map.
 *
 * @param root - Root object to walk.
 * @param path - Starting ownership path.
 * @param visit - Optional visitor for each object and path; false stops that branch.
 */
export const buildOwnershipIndex = (
    root: object,
    path = '',
    visit?: (value: object, path: string) => void | boolean,
): Map<object, string[]> => {
    const paths = new Map<object, string[]>();
    const ancestors = new Set<object>();
    const walk = (value: object, currentPath: string): void => {
        if (visit !== undefined) {
            if (visit(value, currentPath) === false) return;
        } else {
            const aliases = paths.get(value);
            if (aliases === undefined) paths.set(value, [currentPath]);
            else aliases.push(currentPath);
        }
        if (ancestors.has(value)) return;
        ancestors.add(value);
        for (const key of Object.keys(value)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
            if (descriptor?.enumerable && 'value' in descriptor && isTrackable(descriptor.value)) {
                walk(descriptor.value, joinPath(currentPath, key));
            }
        }
        ancestors.delete(value);
    };
    walk(root, path);
    return paths;
};
