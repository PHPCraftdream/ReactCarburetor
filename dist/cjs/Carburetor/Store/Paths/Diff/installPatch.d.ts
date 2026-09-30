import { IWritePatch } from "../../../Models/Paths.js";
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
export declare const installPatch: (root: Record<string, unknown>, patch: IWritePatch, inverse: boolean) => void;
