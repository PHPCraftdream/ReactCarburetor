import {detachOpaqueInto} from "./detachCore";

/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;

/** Optional stricter array policy used by class connection selections. */
type TArraySubclassGuard = (instance: object) => never;

/**
 * Recursively detaches a selection the way the state model defines one (R30-04).
 *
 * Plain objects by own enumerable string keys, arrays by elements and `length` (holes kept),
 * detached copies of plain Date/Map/Set, and everything else — class instances, Array and
 * native subclasses — by reference. Symbol keys, non-enumerable keys and descriptor flags
 * are not part of a selection and are not copied. An accessor's getter runs once, like any
 * plain read, and its value is what the copy keeps.
 *
 * A null-prototype dictionary stays null-prototype. Shared references and cycles survive
 * through the cycle ledger: one source value, one detached copy.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @param onArraySubclass - optional rejection policy for class selections
 * @returns the detached copy
 */
export const detachOpaque = <T>(
    value: T,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard
): T => (value !== null && typeof value === 'object'
    ? detachOpaqueInto(value, new WeakMap<object, unknown>(), onLiveInstance, onArraySubclass) as T
    : value);
