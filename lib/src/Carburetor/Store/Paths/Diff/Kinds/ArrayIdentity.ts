import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {probesSparse} from './probesSparse';

/** Differing positions up to which membership is answered by scanning, with no Set built. */
const SCAN_DIFFERENCES = 8;
/** Works for arrays with a null prototype or an overridden `indexOf`. */
const indexOf = (array: unknown[], value: object, from = 0): number => Array.prototype.indexOf.call(array, value, from);

/** R39-05: lazy raw-occupant membership, including displaced old occupants at a new insertion. */
export class ArrayIdentity {
    /** Old raw occupant membership. */
    private oldItems?: Set<object>;
    /** Assigned occupant membership. */
    private nextItems?: Set<object>;
    /** Differing positions while few; `null` once Sets answer cheaper; unset until asked. */
    private differing?: number[] | null;

    /** Retains the compared arrays.
     *
     * @param previous - old raw array.
     * @param next - assigned array, possibly holding views. */
    constructor(private readonly previous: unknown[], private readonly next: unknown[]) {}

    /** Unwraps one candidate.
     *
     * @param value - candidate occupant. */
    private raw(value: unknown): unknown {
        return value !== null && typeof value === 'object' ? liveViews.readTarget(value) ?? value : value;
    }

    /** Finds the few positions where the arrays differ, so a single replaced row builds no Set.
     *
     * @returns the positions, or `null` for many differences or a sparse array. */
    private differences(): number[] | null {
        if (this.differing !== undefined) return this.differing;
        const {previous, next} = this;
        const limit = Math.max(previous.length, next.length);
        if (limit > 4096 && (probesSparse(previous) || probesSparse(next))) return this.differing = null;
        const found: number[] = [];
        for (let index = 0; index < limit; index++) {
            if (previous[index] === next[index]) continue;
            if (found.length === SCAN_DIFFERENCES) return this.differing = null;
            found.push(index);
        }
        return this.differing = found;
    }

    /** Whether a raw old occupant is still in the assigned array; equal positions hold the same object.
     *
     * @param value - old raw occupant.
     * @param differing - positions where the arrays differ. */
    private keptInNext(value: object, differing: readonly number[]): boolean {
        for (const index of differing) if (this.raw(this.next[index]) === value) return true;
        for (let at = indexOf(this.previous, value); at !== -1; at = indexOf(this.previous, value, at + 1)) {
            if (!differing.includes(at)) return true;
        }
        return false;
    }

    /** Whether the old array holds the object.
     *
     * @param value - normalized assigned occupant.
     * @param differing - positions where the arrays differ, or `null` for the Set path. */
    private inPrevious(value: object, differing: readonly number[] | null): boolean {
        if (differing) return indexOf(this.previous, value) !== -1;
        return (this.oldItems ??= this.index(this.previous)).has(value);
    }

    /** Whether the assigned array still holds the old occupant.
     *
     * @param value - old raw occupant.
     * @param differing - positions where the arrays differ, or `null` for the Set path. */
    private inNext(value: object, differing: readonly number[] | null): boolean {
        if (differing) return this.keptInNext(value, differing);
        return (this.nextItems ??= this.index(this.next)).has(value);
    }

    /** Builds object membership.
     *
     * @param array - occupants to index, visiting own sparse keys only. */
    private index(array: unknown[]): Set<object> {
        const result = new Set<object>();
        const add = (value: unknown): void => {
            if (array !== this.previous) value = this.raw(value);
            if (value !== null && typeof value === 'object') result.add(value);
        };
        if (array.length > 4096 && probesSparse(array)) {
            for (const key of Object.keys(array)) {
                if (/^(0|[1-9]\d*)$/.test(key)) add((array as unknown as Record<string, unknown>)[key]);
            }
        } else {
            for (let index = 0; index < array.length; index++) add(array[index]);
        }
        return result;
    }

    /** Retains the compared arrays.
     *
     * @param previous - previous occupant.
     * @param next - normalized next occupant. */
    public moved(previous: unknown, next: unknown): boolean {
        if (Object.is(previous, next)) return false;
        const differing = this.differences();
        if (next !== null && typeof next === 'object' && this.inPrevious(next, differing)) return true;
        if (previous === null || typeof previous !== 'object' || next === undefined) return false;
        if (!this.inNext(previous, differing)) return false;
        liveViews.normalizeAssigned(next, previous);
        return true;
    }
}
