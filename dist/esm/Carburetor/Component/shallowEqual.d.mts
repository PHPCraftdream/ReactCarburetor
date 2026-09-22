/**
 * Compares two prop or state objects one level deep. Values are compared with Object.is,
 * so a prop rebuilt on every parent render — an inline object or arrow function — counts
 * as changed, exactly as it does for React.memo.
 *
 * @param left - the previous side; only its keys are visited, so a key `right` lacks ends the
 * comparison as unequal
 * @param right - the incoming side; every key of `left` must be present here with an
 * Object.is-equal value
 */
export declare const shallowEqual: (left: unknown, right: unknown) => boolean;
