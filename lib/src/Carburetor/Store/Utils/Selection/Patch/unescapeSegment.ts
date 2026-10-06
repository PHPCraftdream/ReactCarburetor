import {PATH_SEPARATOR} from "@/Carburetor/Store/Paths/PathSeparator";

/**
 * The inverse of the escape `joinPath` applies to one key: `~1` back to the separator, then `~0`
 * back to `~`, in the order that undoes the escape.
 *
 * @param segment - one segment of a path, as `joinPath` wrote it.
 * @returns the original key.
 */
export const unescapeSegment = (segment: string): string =>
    segment.includes('~') ? segment.split('~1').join(PATH_SEPARATOR).split('~0').join('~') : segment;
