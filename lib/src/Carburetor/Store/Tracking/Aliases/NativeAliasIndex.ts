import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/** Every ordinary own path to each raw object, scoped to one live root. */
const ownership = new WeakMap<object, Map<object, string[]>>();

/** Rebuild only after a real graph mutation, never for another native member of a stable root. */
const indexRoot = (root: object): Map<object, string[]> => {
    const paths = new Map<object, string[]>();
    const ancestors = new Set<object>();
    const walk = (value: object, path: string): void => {
        const aliases = paths.get(value);
        if (aliases === undefined) paths.set(value, [path]);
        else aliases.push(path);
        if (ancestors.has(value)) return;
        ancestors.add(value);
        for (const key of Object.keys(value)) {
            const child = Reflect.getOwnPropertyDescriptor(value, key)?.value;
            if (isTrackable(child)) walk(child, joinPath(path, key));
        }
        ancestors.delete(value);
    };
    walk(root, '');
    ownership.set(root, paths);
    return paths;
};

/** One root-owned index shared by fresh read trees and cached native facades. */
export const nativeAliasIndex = {
    paths: (root: object): Map<object, string[]> => ownership.get(root) ?? indexRoot(root),
    invalidate: (root: object): void => { ownership.delete(root); },
};
