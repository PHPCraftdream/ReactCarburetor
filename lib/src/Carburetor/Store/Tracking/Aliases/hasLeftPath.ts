import {TPath} from "../../../Models/Paths";
import {PATH_SEPARATOR} from "../../Paths/PathSeparator";
import {isTrackable} from "../isTrackable";

/** The inverse of `joinPath`'s escape: `~1` back to the separator first, then `~0` to `~`. */
const unescapeKey = (segment: string): string =>
    segment.includes('~') ? segment.split('~1').join(PATH_SEPARATOR).split('~0').join('~') : segment;

/**
 * Whether `value` is provably no longer found at `path` under `root`.
 *
 * The alias ledger remembers where it last saw an object, but a write that replaces a branch
 * forgets only that branch's own object, not what lay inside it: those entries keep naming
 * paths the objects have since left. Before a remembered path is reported as a second one it is
 * resolved here, against the state as it is now, so only an object still sitting there counts.
 *
 * The walk follows own data keys through plain objects and arrays. It answers `true` when the
 * path is gone (a missing key, a primitive on the way) or ends on a different value, and `false`
 * when the object is still there — or when the walk cannot tell (no root, or a native collection
 * or class instance on the way), which keeps the report rather than silencing a real alias.
 *
 * @param root - the state root the path is relative to; absent when the caller has none.
 * @param path - the escaped dotted path the object was remembered at.
 * @param value - the remembered object.
 */
export const hasLeftPath = (root: object | undefined, path: TPath, value: object): boolean => {
    if (root === undefined) {
        return false;
    }

    let current: unknown = root;

    for (const segment of path === '' ? [] : path.split(PATH_SEPARATOR)) {
        if (current === null || typeof current !== 'object') {
            return true;
        }

        if (!isTrackable(current)) {
            return false;
        }

        const descriptor = Reflect.getOwnPropertyDescriptor(current, unescapeKey(segment));

        if (descriptor === undefined) {
            return true;
        }

        current = descriptor.value;
    }

    return !Object.is(current, value);
};
