import {containsExoticValue} from "@/Carburetor/Store/Utils/Graph/containsExoticValue";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
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
export const announceIsUnchanged = <R>(
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
