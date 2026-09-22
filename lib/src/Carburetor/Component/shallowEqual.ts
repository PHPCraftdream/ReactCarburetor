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
export const shallowEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) {
        return true;
    }

    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
        return false;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);

    if (leftKeys.length !== Object.keys(rightRecord).length) {
        return false;
    }

    return leftKeys.every((key: string) => {
        return key in rightRecord && Object.is(leftRecord[key], rightRecord[key]);
    });
};
