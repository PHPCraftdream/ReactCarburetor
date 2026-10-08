/** Compares existing open scalar chains; arrays are admitted only for native baselines.
 *
 * @param beforeRoot - owned baseline.
 * @param afterRoot - live endpoint.
 * @param segments - recorded own path.
 * @param arrays - permits ordinary open arrays.
 */
export const sameExistingScalarPath = (
    beforeRoot: unknown, afterRoot: unknown, segments: readonly string[], arrays: boolean
): boolean | undefined => {
    let before = beforeRoot;
    let after = afterRoot;
    for (let index = 0; index < segments.length; index++) {
        if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
            return undefined;
        }
        const beforePrototype = Object.getPrototypeOf(before);
        const afterPrototype = Object.getPrototypeOf(after);
        if (beforePrototype !== afterPrototype) return undefined;
        if (Array.isArray(before) || Array.isArray(after)) {
            if (!arrays || !Array.isArray(before) || !Array.isArray(after) ||
                beforePrototype !== Array.prototype ||
                Object.getOwnPropertyDescriptor(before, 'length')?.writable !== true ||
                Object.getOwnPropertyDescriptor(after, 'length')?.writable !== true) return undefined;
        } else if (beforePrototype !== Object.prototype && beforePrototype !== null) return undefined;
        const beforeField = Object.getOwnPropertyDescriptor(before, segments[index]);
        const afterField = Object.getOwnPropertyDescriptor(after, segments[index]);
        if (!beforeField || !afterField || !('value' in beforeField) || !('value' in afterField) ||
            !beforeField.enumerable || !afterField.enumerable || !beforeField.writable ||
            !afterField.writable || !beforeField.configurable || !afterField.configurable) return undefined;
        before = beforeField.value;
        after = afterField.value;
        if (index === segments.length - 1) {
            return (before === null || (typeof before !== 'object' && typeof before !== 'function')) &&
                (after === null || (typeof after !== 'object' && typeof after !== 'function'))
                ? Object.is(before, after) : undefined;
        }
    }
    return undefined;
};
