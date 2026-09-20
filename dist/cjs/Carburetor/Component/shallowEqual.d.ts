/**
 * Compares two prop or state objects one level deep. Values are compared with Object.is,
 * so a prop rebuilt on every parent render — an inline object or arrow function — counts
 * as changed, exactly as it does for React.memo.
 */
export declare const shallowEqual: (left: unknown, right: unknown) => boolean;
