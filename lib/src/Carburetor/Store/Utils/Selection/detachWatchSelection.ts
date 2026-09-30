import {detachOpaque} from "./detachOpaque";

/** Detaches a watch selection while rejecting live class instances.
 *
 * @param value - the selected value to retain for comparison or deliver
 */
export const detachWatchSelection = <R>(value: R): R => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    return detachOpaque(value, (instance: object): void => {
        throw new Error(
            'watch() cannot select a live ' +
            (Object.getPrototypeOf(instance)?.constructor?.name || 'class') +
            ' instance because in-place changes cannot produce a safe comparison. Select the ' +
            'fields the callback needs, or return a plain object of those fields.'
        );
    }) as R;
};
