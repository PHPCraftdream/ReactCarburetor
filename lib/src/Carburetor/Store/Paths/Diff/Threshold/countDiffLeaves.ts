import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {sameKind} from '@/Carburetor/Store/Paths/Diff/Kinds/sameKind';
import {ArrayIdentity} from '@/Carburetor/Store/Paths/Diff/Kinds/ArrayIdentity';
import {probesSparse} from '@/Carburetor/Store/Paths/Diff/Kinds/probesSparse';

const countLeaves = (oldValue: unknown, newValue: unknown): number => {
    if (!isTrackable(newValue)) return 1;
    if (Object.is(oldValue, newValue)) return 1;
    if (!isTrackable(oldValue) || !isTrackable(newValue) || !sameKind(oldValue, newValue)) return 1;
    let count = 0;
    if (Array.isArray(newValue)) {
        const previous = oldValue as unknown[];
        const identity = new ArrayIdentity(previous, newValue);
        if (Math.max(previous.length, newValue.length) > 4096
            && (probesSparse(previous) || probesSparse(newValue))) {
            const keys = Object.keys(newValue);
            for (const key of keys) {
                if (/^(0|[1-9]\d*)$/.test(key)) {
                    const index = Number(key);
                    count += identity.moved(previous[index], newValue[index])
                        ? 1 : countLeaves(previous[index], newValue[index]);
                }
            }
        } else {
            for (let index = 0; index < Math.max(previous.length, newValue.length); index++) {
                count += identity.moved(previous[index], newValue[index])
                    ? 1 : countLeaves(previous[index], newValue[index]);
            }
        }
    } else {
        const previous = oldValue as Record<string, unknown>;
        const next = newValue as Record<string, unknown>;
        for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            count += countLeaves(previous[key], next[key]);
        }
    }
    return count || 1;
};

const countVisitedLeaves = (oldValue: unknown, newValue: unknown, positional = false): number => {
    if (Object.is(oldValue, newValue)) return 0;
    if (!isTrackable(oldValue) || !isTrackable(newValue) || !sameKind(oldValue, newValue)) return 1;
    let count = 0;
    if (Array.isArray(newValue)) {
        const previous = oldValue as unknown[];
        const identity = new ArrayIdentity(previous, newValue);
        const limit = Math.max(previous.length, newValue.length);
        if (limit > 4096 && (probesSparse(previous) || probesSparse(newValue))) {
            const keys = new Set([...Object.keys(previous), ...Object.keys(newValue)]);
            for (const key of keys) {
                if (!/^(0|[1-9]\d*)$/.test(key)) continue;
                const index = Number(key);
                if (
                    Object.is(previous[index], newValue[index])
                    && Object.prototype.hasOwnProperty.call(previous, key)
                        === Object.prototype.hasOwnProperty.call(newValue, key)
                ) continue;
                count += identity.moved(previous[index], newValue[index]) ? Number(positional)
                    : countVisitedLeaves(previous[index], newValue[index], positional);
            }
        } else {
            for (let index = 0; index < limit; index++) {
                const oldOwn = Object.prototype.hasOwnProperty.call(previous, index);
                const newOwn = Object.prototype.hasOwnProperty.call(newValue, index);
                if (oldOwn === newOwn && Object.is(previous[index], newValue[index])) continue;
                count += identity.moved(previous[index], newValue[index]) ? Number(positional)
                    : countVisitedLeaves(previous[index], newValue[index], positional);
            }
        }
    } else {
        const previous = oldValue as Record<string, unknown>;
        const next = newValue as Record<string, unknown>;
        for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            const inOld = Object.prototype.hasOwnProperty.call(previous, key);
            const inNew = Object.prototype.hasOwnProperty.call(next, key);
            if (inOld && inNew && Object.is(previous[key], next[key])) continue;
            count += inOld && inNew ? countVisitedLeaves(previous[key], next[key], positional) : 1;
        }
    }
    return count;
};

/** Counts genuine leaf differences separately from positional occupants. */
export const countDiffLeaves = {total: countLeaves, changed: countVisitedLeaves};
