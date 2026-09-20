import {TPath, TPathSet} from "../../Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";
import {WILDCARD_PATH} from "./WildcardPath";

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
