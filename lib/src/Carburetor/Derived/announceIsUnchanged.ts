import {containsExoticValue} from "@/Carburetor/Store/Utils/containsExoticValue";

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
 * -guess: it runs only when there is an announced baseline to compare against and the caller
 * supplied one, and its verdict overrides the reference change when it says the content is the
 * same.
 *
 * @param announced - the value last announced to subscribers, if any; `equals` runs only when
 * this is set — an unannounced computed has nothing for it to compare against, so a first
 * successful value is never suppressed
 * @param previous - the cached value from before this recompute, the reference-check baseline
 * when nothing has been announced yet (mirrors `Computed.settle`'s own fallback)
 * @param next - the value this recompute just produced
 * @param dependenciesMoved - whether a dependency drifted since the announced baseline
 * @param equals - the caller's content comparator, if any
 */
export const announceIsUnchanged = <R>(
    announced: {value: R} | undefined,
    previous: R | undefined,
    next: R,
    dependenciesMoved: boolean,
    equals: ((previous: R, next: R) => boolean) | undefined
): boolean => {
    const baseline = announced !== undefined ? announced.value : previous;
    const sameReference = Object.is(baseline, next);
    const opaqueChanged = sameReference && dependenciesMoved && containsExoticValue(next);
    const contentSame = !sameReference && announced !== undefined
        && equals !== undefined && equals(announced.value, next);

    return (sameReference && !opaqueChanged) || contentSame;
};
