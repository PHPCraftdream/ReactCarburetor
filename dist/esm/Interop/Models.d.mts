import { TReadonly } from "../Carburetor/index.mjs";
/** Picks the part of the data a hooks-based component cares about. */
export type TSelector<T, R> = (data: TReadonly<T>) => R;
/** Compares two selected values; defaults to a structural comparison, see useCarburetorValue. */
export type TValueComparator<R> = (a: R, b: R) => boolean;
