import {IDict} from '../../Models/Base';
import {IComputedOptions} from '../../Models/Derived';
import {C} from '../Models';
import {ILeafVersion} from './Models';
import {driftedSince} from './driftedSince';
import {containsExoticValue} from "../../Store/Utils/Graph/containsExoticValue";
import {liveViews} from "../../Store/Tracking/Proxy/liveViews";
/** Only engine-created facades can contribute a canonical underlying result identity. */
const canonicalResult = (value: unknown): unknown =>
    value !== null && typeof value === 'object' ? (liveViews.readTarget(value) ?? value) : value;

/**
 * Decides whether a freshly settled result should stay unannounced, the way `Computed.settle`
 * judges it: by reference first, with an exotic-mutation carve-out and an opt-in content check.
 *
 * A stable reference is unchanged unless it hides an in-place exotic mutation (R6-02/R7-02): a
 * `Map`/`Set`, or a plain envelope wrapping one, can keep its identity across evaluations while
 * the wrapped value mutates, so a moved dependency together with an exotic result still counts
 * as a change. `equals` is never consulted there — `previous` and `next` would alias the very
 * same mutated object, so it could only ever say "equal" and hide a change mutation tracking
 * already earned. A changed reference, by contrast, is exactly what `equals` exists to second
 * -guess: it runs only when there is a successful baseline to compare against and the caller
 * supplied one, and its verdict overrides the reference change when it says the content is the
 * same.
 *
 * @param baseline - the successful cached or announced value, including undefined
 * @param hasBaseline - whether that value exists; a cold result is never suppressed
 * @param next - the value this recompute just produced
 * @param dependenciesMoved - whether a dependency drifted since the announced baseline
 * @param equals - the caller's content comparator, if any
 */
const unchanged = <R>(
    baseline: R | undefined,
    hasBaseline: boolean,
    next: R,
    dependenciesMoved: boolean,
    equals: ((previous: R, next: R) => boolean) | undefined
): boolean => {
    if (!hasBaseline) return false;
    const sameReference = Object.is(baseline, next);
    const sameRawReference = sameReference || Object.is(canonicalResult(baseline), canonicalResult(next));
    // A persistent read tree keeps an engine view's identity stable across recomputes while the
    // store may have moved under it (in-place writes included): a moved dependency together with
    // a live result counts as a change, like the exotic-mutation carve-out below.
    const liveChanged = sameRawReference && dependenciesMoved
        && next !== null && typeof next === 'object' && liveViews.readTarget(next) !== undefined;
    const opaqueChanged = sameRawReference && dependenciesMoved && !liveChanged && containsExoticValue(next);
    const contentSame = !sameReference && !opaqueChanged && !liveChanged
        && equals !== undefined && equals(baseline as R, next);

    return (sameReference && !liveChanged && !opaqueChanged) || contentSame;
};

/** Evaluation state participating in unobserved acceptance, independent of observer delivery. */
interface IAcceptanceState<R> {
    [C.value]: R | undefined;
    [C.snapshotRevision]: number;
    [C.versions]: IDict<ILeafVersion>;
    [C.allNativeSources]: boolean;
    [C.validatedEpoch]: number;
    [C.valid]: boolean;
    [C.options]: IComputedOptions<R>;
}

/** The accepted value/token and its freshness checkpoint before an evaluation starts. */
interface IAcceptanceBaseline<R> {
    value: R | undefined;
    revision: number;
    versions: IDict<ILeafVersion>;
    allNative: boolean;
    epoch: number;
}

/** Captures the baseline before body evaluation or reentrant comparator reads can replace it.
 *
 * @param state - The evaluation cache.
 */
const capture = <R>(state: IAcceptanceState<R>): IAcceptanceBaseline<R> => ({
    value: state[C.value], revision: state[C.snapshotRevision], versions: state[C.versions],
    allNative: state[C.allNativeSources], epoch: state[C.validatedEpoch],
});

/** Commits one acceptance verdict, restoring the original baseline on comparator failure.
 *
 * @param state - The evaluation cache, whose dependency attachment has already completed.
 * @param baseline - The accepted checkpoint, absent when no unobserved comparison is needed.
 * @param value - The candidate produced by that body.
 */
const accept = <R>(
    state: IAcceptanceState<R>, baseline: IAcceptanceBaseline<R> | undefined, value: R
): void => {
    if (!baseline || !driftedSince(baseline.versions, state[C.versions])) {
        state[C.value] = value;
        state[C.valid] = true;
        return;
    }
    const candidate = capture(state);
    let changed: boolean;
    try {
        changed = !unchanged(baseline.value, true, value, true, state[C.options].equals);
        if (!changed) value = baseline.value as R;
    } catch (error: unknown) {
        state[C.value] = baseline.value;
        state[C.snapshotRevision] = baseline.revision;
        state[C.versions] = baseline.versions;
        state[C.allNativeSources] = baseline.allNative;
        state[C.validatedEpoch] = baseline.epoch;
        state[C.valid] = false;
        throw error;
    }
    state[C.value] = value;
    state[C.snapshotRevision] = baseline.revision + (changed ? 1 : 0);
    state[C.versions] = candidate.versions;
    state[C.allNativeSources] = candidate.allNative;
    state[C.validatedEpoch] = candidate.epoch;
    state[C.valid] = true;
};

/** Internal equality decisions and atomic unobserved evaluation acceptance. */
export const announceIsUnchanged = {unchanged, capture, accept};
