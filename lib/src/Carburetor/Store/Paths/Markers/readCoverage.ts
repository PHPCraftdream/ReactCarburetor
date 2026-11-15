import {TPath, TPathSet} from '../../../Models/Paths';
import {TCompletedReads} from '../../Tracking/Observation/Models';
import {PATH_SEPARATOR} from '../PathSeparator';
import {branchPath} from './BranchMarker';

/** The presence marker's suffix, taken from the one place that names it. */
const PRESENCE_SUFFIX = branchPath('');

/** The branch a presence marker stands for. */
const branchOf = (marker: TPath): TPath => marker.slice(0, -PRESENCE_SUFFIX.length);

/** The prefix every path strictly below a presence marker's branch starts with. */
const belowPrefix = (marker: TPath): TPath => marker.slice(0, -PRESENCE_SUFFIX.length + PATH_SEPARATOR.length);

/** Strict branch coverage of a collection that is being completed. */
const prefixes = (reads: ReadonlySet<TPath>): Set<TPath> => {
    const branches = new Set<TPath>();
    for (const path of reads) {
        let cut = path.lastIndexOf(PATH_SEPARATOR);
        // Presence does not cover itself; keys do.
        if (path.endsWith(PRESENCE_SUFFIX)) cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
        while (cut > 0) {
            branches.add(path.slice(0, cut));
            cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
        }
    }
    return branches;
};

const cachedPrefixes = new WeakMap<ReadonlySet<TPath>, {size: number; branches: Set<TPath>}>();
/** Linear steps paid per completed set; covered markers exit early, so prefixes are built only once misses add up. */
const scanned = new WeakMap<ReadonlySet<TPath>, number>();
const SCAN_ROUNDS = 8;

/** Whether another read lies strictly below the marker's branch (R40-02). */
const impliedBy = (reads: TCompletedReads, marker: TPath): boolean => {
    const cached = cachedPrefixes.get(reads);
    if (cached?.size === reads.size) return cached.branches.has(branchOf(marker));
    const used = scanned.get(reads) ?? 0;
    if (used >= reads.size * SCAN_ROUNDS) {
        const branches = prefixes(reads);
        cachedPrefixes.set(reads, {size: reads.size, branches});
        return branches.has(branchOf(marker));
    }
    const below = belowPrefix(marker);
    let steps = 0;
    for (const other of reads) {
        steps++;
        if (other !== marker && other.startsWith(below)) {
            scanned.set(reads, used + steps);
            return true;
        }
    }
    scanned.set(reads, used + steps);
    return false;
};

/** Tests traversal coverage without mutating either read set. */
const covers = (reads: TCompletedReads, path: TPath): boolean =>
    reads.has(path) || (path.endsWith(PRESENCE_SUFFIX) && impliedBy(reads, path));

/** Whether every path is covered; walks the set as it is, without copying it. */
const coversAll = (reads: TCompletedReads, paths: ReadonlySet<TPath>): boolean => {
    for (const path of paths) if (!covers(reads, path)) return false;
    return true;
};

/** One owner slice per path: the branch a direct child read proves. */
const owners = (reads: ReadonlySet<TPath>): Set<TPath> => {
    const found = new Set<TPath>();
    for (const path of reads) {
        let cut = path.lastIndexOf(PATH_SEPARATOR);
        // Presence covers one level further up; other markers own their branch directly.
        if (cut > 0 && path.endsWith(PRESENCE_SUFFIX)) cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
        if (cut > 0) found.add(path.slice(0, cut));
    }
    return found;
};

/** Prunes only markers implied by this collection's own reads. */
const prune = (reads: TPathSet): void => {
    if (reads.size <= 8) {
        for (const path of reads) {
            if (!path.endsWith(PRESENCE_SUFFIX)) continue;
            const prefix = belowPrefix(path);
            for (const other of reads) {
                if (other !== path && other.startsWith(prefix)) {
                    reads.delete(path);
                    break;
                }
            }
        }
        return;
    }
    const markers = [];
    for (const path of reads) if (path.endsWith(PRESENCE_SUFFIX)) markers.push(path);
    if (markers.length === 0) return;
    const branchOwners = owners(reads);
    let budget = reads.size * SCAN_ROUNDS;
    let branches: Set<TPath> | undefined;
    for (const marker of markers) {
        const base = branchOf(marker);
        if (branchOwners.has(base)) {
            reads.delete(marker);
            continue;
        }
        // No direct-child evidence: the exact scan decides until the shared scan budget
        // runs out; from then on the once-built prefix set answers the remaining markers.
        if (branches !== undefined) {
            if (branches.has(base)) reads.delete(marker);
            continue;
        }
        const below = belowPrefix(marker);
        let steps = 0;
        let implied = false;
        for (const other of reads) {
            steps++;
            if (other !== marker && other.startsWith(below)) {
                implied = true;
                break;
            }
        }
        budget -= steps;
        if (implied) {
            reads.delete(marker);
        } else if (budget < 0) {
            branches = prefixes(reads);
            cachedPrefixes.set(reads, {size: reads.size, branches});
            if (branches.has(base)) reads.delete(marker);
        }
    }
};

/** Closes patch scratch and extends retained reads without pruning index-owned paths. */
const extend = (filed: TCompletedReads, scratch: TPathSet): TCompletedReads => {
    prune(scratch);
    let grown: Set<TPath> | undefined;
    for (const path of scratch) {
        if (covers(filed, path)) continue;
        grown ??= new Set<TPath>(filed);
        grown.add(path);
    }
    return grown === undefined ? filed : grown as unknown as TCompletedReads;
};

/** Shared presence-prefix semantics for completion and retained selection coverage. */
export const readCoverage = {covers, coversAll, prune, extend};
