import { TReadonly } from "../Carburetor/index.mjs";
/** Picks the part of the data a hooks-based component cares about. */
export type TSelector<T, R> = (data: TReadonly<T>) => R;
/** Compares two selected values; defaults to Object.is. */
export type TValueComparator<R> = (a: R, b: R) => boolean;
