import {TPath, TPathSet} from "./Models";

/** The "everything changed" path: a subscriber holding it receives every update. */
export const WILDCARD_PATH: TPath = '*';

const PATH_SEPARATOR: string = '.';

export const joinPath = (basePath: TPath, key: string): TPath => {
    return basePath ? basePath + PATH_SEPARATOR + key : key;
};

/**
 * A write touches a read when the paths are equal or one is nested in the other:
 * a write to `items.workTodo1` matters to whoever read `items.workTodo1.title`
 * and to whoever read `items` as a whole — but not to a reader of `items.workTodo2`.
 */
const pathsTouch = (readPath: TPath, writePath: TPath): boolean => {
    return readPath === writePath
        || readPath.startsWith(writePath + PATH_SEPARATOR)
        || writePath.startsWith(readPath + PATH_SEPARATOR);
};

export const pathsIntersect = (reads: TPathSet, writes: TPathSet): boolean => {
    if (reads.has(WILDCARD_PATH) || writes.has(WILDCARD_PATH)) {
        return true;
    }

    for (const writePath of writes) {
        for (const readPath of reads) {
            if (pathsTouch(readPath, writePath)) {
                return true;
            }
        }
    }

    return false;
};
