import {renameSync, unlinkSync, writeFileSync} from "node:fs";

/**
 * Writes `content` so a reader only ever sees it complete: a temp name, then one atomic rename.
 *
 * @param target - the destination path the content ends up at
 * @param content - the full text to publish at `target` in one step
 */
export const writeAtomic = (target: string, content: string): void => {
    const tmp = `${target}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;

    writeFileSync(tmp, content);

    try {
        renameSync(tmp, target);
    } catch (error) {
        try {
            unlinkSync(tmp);
        } catch {
            // Best-effort; the rename failure below is the one that matters.
        }

        throw error;
    }
};
