import { IComputed } from "../Carburetor/index.mjs";
/** Reads a memoized derived value from a hooks-based component. */
export declare const useComputedValue: <R>(computed: IComputed<R>) => R;
