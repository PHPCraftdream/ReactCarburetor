/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;
/**
 * A fully detached copy of a value: plain objects, arrays, Maps, Sets and Dates are all rebuilt at
 * any depth — inside a plain container, a Map or Set, or a Map key — own enumerable string and
 * symbol keys included, a null-prototype dictionary staying null-prototype.
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
