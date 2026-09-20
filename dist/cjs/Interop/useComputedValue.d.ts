import { IComputed } from "../Carburetor/index.js";
/** Reads a memoized derived value from a hooks-based component. */
export declare const useComputedValue: <R>(computed: IComputed<R>) => R;
