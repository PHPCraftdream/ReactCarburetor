import {IWritePatch, PATCH_ABSENT} from "@/Carburetor/Models/Paths";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";

/**
 * Installs one patch's `previous` (undo) or `next` (redo) into `root` by walking its segments.
 *
 * Segments are raw, unescaped keys, so no path-unescaping is needed. Works on any
 * bracket-indexable target: `draft` (the write then lands through the proxy's own traps and is
 * announced normally) or a plain detached object (`CarburetorHistory`'s baseline mirror). A
 * plain value is deep-cloned before installing, so replaying the same patch again cannot alias
 * it into two places at once (R16-07).
 *
 * @param root - the object the patch's segments are resolved from.
 * @param patch - the patch to install.
 * @param inverse - false installs `next`; true installs `previous`, deleting on PATCH_ABSENT.
 */
export const installPatch = (root: Record<string, unknown>, patch: IWritePatch, inverse: boolean): void => {
    let node: Record<string, unknown> = root;

    for (let i = 0; i < patch.segments.length - 1; i++) {
        const segment = patch.segments[i];
        if (!Object.prototype.hasOwnProperty.call(node, segment)) {
            throw new Error('Carburetor: patch path is missing an own segment');
        }
        node = node[segment] as Record<string, unknown>;
    }

    const key = patch.segments[patch.segments.length - 1];
    const value = inverse ? patch.previous : patch.next;

    if (value === PATCH_ABSENT) {
        delete node[key];
    } else if (key === '__proto__') {
        Object.defineProperty(node, key, {
            value: isTrackable(value) ? deepClone(value) : value,
            writable: true, enumerable: true, configurable: true,
        });
    } else {
        node[key] = isTrackable(value) ? deepClone(value) : value;
    }
};
