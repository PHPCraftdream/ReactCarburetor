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
export const shallowEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) {
        return true;
    }

    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
        return false;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return false;
        }

        for (let i = 0; i < left.length; i++) {
            if (!Object.is(left[i], right[i])) {
                return false;
            }
        }

        return true;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    let leftKeyCount = 0;
    let rightKeyCount = 0;

    for (const key in leftRecord) {
        if (Object.prototype.hasOwnProperty.call(leftRecord, key)) {
            leftKeyCount++;
            if (!(key in rightRecord) || !Object.is(leftRecord[key], rightRecord[key])) {
                return false;
            }
        }
    }

    for (const key in rightRecord) {
        if (Object.prototype.hasOwnProperty.call(rightRecord, key)) {
            rightKeyCount++;
        }
    }

    return leftKeyCount === rightKeyCount;
};
