import {IStorageLike} from "../../Models/Tooling";

/** Reads previous storage keys in priority order after the current key was already read.
 *
 * @param storage - the adapter used for persistence.
 * @param previousKeys - candidate keys ordered from highest to lowest priority.
 * @returns the first present value and its key, if any.
 */
export const readFallback = (
    storage: IStorageLike,
    previousKeys: readonly string[] | undefined
): {value: string; source: string} | undefined => {
    for (const source of previousKeys ?? []) {
        const value = storage.getItem(source);

        if (value !== null) {
            return {value, source};
        }
    }

    return undefined;
};
