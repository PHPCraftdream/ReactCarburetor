export type { TSelector } from "../Carburetor/index.mjs";
/** Compares two selected values; defaults to a structural comparison, see useCarburetorValue. */
export type TValueComparator<R> = (a: R, b: R) => boolean;
