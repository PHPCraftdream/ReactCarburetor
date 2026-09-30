// Re-exported rather than redefined: the store's own watch(select, onChange) (R16-10) and this
// hook read through the identical tracked-view mechanism, so one selector shape describes both.
export type {TSelector} from "@/Carburetor";

/** Compares two selected values; defaults to a structural comparison, see useCarburetorValue. */
export type TValueComparator<R> = (a: R, b: R) => boolean;
