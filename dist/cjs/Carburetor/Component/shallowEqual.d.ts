/**
 * Compares two prop or state objects one level deep. Values are compared with Object.is,
 * so a prop rebuilt on every parent render — an inline object or arrow function — counts
 * as changed, exactly as it does for React.memo.
 *
 * Two arrays take a dedicated length-and-index loop (R16-09): going through `Object.keys`,
 * which builds a string per index, then `every`, cost 0.11–0.18 ms on two 4000-element id
 * arrays against 0.01 ms for the loop — real cost for the documented `equals` of an id array.
 * A mismatched pair (one array, one not) falls through to the general branch below instead of
 * a hard `false`, so an array and a plain object that happen to share the same numeric keys
 * keep comparing exactly as they always have.
 *
 * @param left - the previous side; only its keys are visited, so a key `right` lacks ends the
 * comparison as unequal
 * @param right - the incoming side; every key of `left` must be present here with an
 * Object.is-equal value
 */
export declare const shallowEqual: (left: unknown, right: unknown) => boolean;
