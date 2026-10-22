import {isTrackable} from '../../../Tracking/isTrackable';
import {sameKind} from '../Kinds/sameKind';
import {ArrayIdentity} from '../Kinds/ArrayIdentity';
import {probesSparse} from '../Kinds/probesSparse';
import {countDiffLeaves} from './countDiffLeaves';

const hasOwn = Object.prototype.hasOwnProperty;
const isEnumerable = Object.prototype.propertyIsEnumerable;
const INDEX_KEY = /^(0|[1-9]\d*)$/;

/** Running sums of one measuring pass. */
interface ITally {
    /** Genuine differing leaves, as `countDiffLeaves.changed` counts them. */
    changed: number;
    /** Positional occupants: what `countDiffLeaves.changed(…, true)` adds on top. */
    moved: number;
}

/**
 * One array position; returns its `countDiffLeaves.total` share.
 *
 * @param previous - the old array.
 * @param next - the new array.
 * @param index - the position.
 * @param identity - occupant identity of the pair.
 * @param tally - running sums.
 */
const measureIndex = (
    previous: unknown[], next: unknown[], index: number, identity: ArrayIdentity, tally: ITally
): number => {
    const oldValue = previous[index];
    const newValue = next[index];
    // Equal occupants (own or hole) are one visited leaf and no difference.
    if (Object.is(oldValue, newValue)) return 1;
    if (identity.moved(oldValue, newValue)) {
        tally.moved++;
        return 1;
    }
    return measure(oldValue, newValue, tally, undefined);
};

/**
 * One same-kind array pair, dense or sparse like `countDiffLeaves`; returns its total share
 * before the one-leaf floor of an empty container.
 *
 * @param previous - the old array.
 * @param next - the new array.
 * @param tally - running sums.
 */
const measureArray = (previous: unknown[], next: unknown[], tally: ITally): number => {
    const identity = new ArrayIdentity(previous, next);
    const limit = Math.max(previous.length, next.length);
    let total = 0;
    if (limit > 4096 && (probesSparse(previous) || probesSparse(next))) {
        for (const key of Object.keys(next)) {
            if (INDEX_KEY.test(key)) total += measureIndex(previous, next, Number(key), identity, tally);
        }
        // Old-only indices are differences, but never part of the visited total.
        for (const key of Object.keys(previous)) {
            if (INDEX_KEY.test(key) && !isEnumerable.call(next, key)) {
                measureIndex(previous, next, Number(key), identity, tally);
            }
        }
    } else {
        for (let index = 0; index < limit; index++) total += measureIndex(previous, next, index, identity, tally);
    }
    return total;
};

/**
 * One pair; returns its `countDiffLeaves.total` share and adds its differences to `tally`.
 *
 * @param oldValue - the previous value.
 * @param newValue - the next value.
 * @param tally - running sums.
 * @param wake - receives differing keys of this object pair; only given at the top level.
 */
const measure = (oldValue: unknown, newValue: unknown, tally: ITally, wake: string[] | undefined): number => {
    if (Object.is(oldValue, newValue)) return 1;
    if (!isTrackable(oldValue) || !isTrackable(newValue) || !sameKind(oldValue, newValue)) {
        tally.changed++;
        return 1;
    }
    if (Array.isArray(newValue)) return measureArray(oldValue as unknown[], newValue, tally) || 1;
    const previous = oldValue as Record<string, unknown>;
    const next = newValue as Record<string, unknown>;
    const keys = new Set<string>(Object.keys(previous));
    for (const key of Object.keys(next)) keys.add(key);
    let total = 0;
    for (const key of keys) {
        if (hasOwn.call(previous, key) && hasOwn.call(next, key)) {
            const before = tally.changed + tally.moved;
            total += measure(previous[key], next[key], tally, undefined);
            if (wake && tally.changed + tally.moved > before) wake.push(key);
            continue;
        }
        tally.changed++;
        total += countDiffLeaves.total(previous[key], next[key]);
        if (wake && countDiffLeaves.changed(previous[key], next[key], true) > 0) wake.push(key);
    }
    return total || 1;
};

/**
 * `countDiffLeaves.changed` and `countDiffLeaves.total` of one pair, from a single pass.
 * Given `wake`, also collects the top-level object keys `countDiffLeaves.changed(…, true)` finds
 * differing, in `Object.keys` order (previous keys first).
 *
 * @param oldValue - the previous value, read but never mutated.
 * @param newValue - the next value, already normalized.
 * @param wake - receives the differing top-level keys of an object pair; ignored for arrays.
 */
export const measureDiff = (
    oldValue: unknown, newValue: unknown, wake?: string[]
): {changed: number; total: number} => {
    const tally: ITally = {changed: 0, moved: 0};
    const total = measure(oldValue, newValue, tally, wake);
    return {changed: tally.changed, total};
};
