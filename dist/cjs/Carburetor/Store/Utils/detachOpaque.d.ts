/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;
/**
 * Recursively detaches plain objects, arrays, Maps, Sets and Dates.
 * Own string and symbol data descriptors are preserved; accessors are rejected without invocation.
 *
 * A null-prototype dictionary stays null-prototype. An accessor cannot produce a detached
 * snapshot because its value may remain connected to mutable source state.
 *
 * That is the boundary `deepClone` deliberately does not provide: the store's own
 * snapshot/restore round trip carries opaque values by reference, while a React snapshot handed to
 * `useSyncExternalStore` must stay immutable under in-place mutation.
 *
 * A class instance — anything else with a prototype of its own — has no generic safe copy and
 * passes through live, at the root and nested alike; `onLiveInstance` lets the caller hear about
 * each one. A detached Map key is a new object, so a lookup into the copy with the original key
 * object misses: read through the copy's own keys.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @returns the detached copy
 */
export declare const detachOpaque: <T>(value: T, onLiveInstance?: TReportLiveInstance) => T;
export {};
