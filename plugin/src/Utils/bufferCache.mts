/**
 * Findings per unsaved buffer, one binary spawn per distinct text.
 *
 * Keyed by the buffer's own hash, so retyping the same text never respawns, and bounded,
 * so a long-lived host cannot accumulate one entry per edit. Editors revisit few files, and
 * every carburetor rule of one run asks for the same file's slice, so the cache turns
 * what would be one spawn per rule into at most one per keystroke.
 */
import {createHash} from "node:crypto";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";

/** How many distinct unsaved buffers keep their findings at once. */
const FILE_CACHE_LIMIT = 32;

const fileResults = new Map<string, INativeDiagnostic[]>();

/** Returns `compute()`'s findings for this buffer, running it at most once per distinct text.
 *
 * @param filename - the absolute path the buffer is analyzed as; part of the cache key
 * @param text - the buffer's own text; the rest of the cache key
 * @param compute - produces the findings when neither this text nor this file was seen yet
 * @param scope - an additional cache-key part separating otherwise identical buffers, e.g. the
 * base-class configuration the run used
 */
export const cachedFileResult = (
    filename: string,
    text: string,
    compute: () => INativeDiagnostic[],
    scope = '',
): INativeDiagnostic[] => {
    const key = `${scope}\u0000${filename}\u0000${createHash('sha256').update(text).digest('hex')}`;
    const held = fileResults.get(key);

    if (held) {
        return held;
    }

    const fresh = compute();

    while (fileResults.size >= FILE_CACHE_LIMIT) {
        fileResults.delete(fileResults.keys().next().value as string);
    }

    fileResults.set(key, fresh);

    return fresh;
};
