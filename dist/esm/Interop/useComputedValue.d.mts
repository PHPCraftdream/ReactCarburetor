import { IComputed } from "../Carburetor/index.mjs";
/**
 * Reads a computed publication. The returned value stays live; the cached snapshot
 * record detects publications without cloning the value.
 *
 * @param computed - the source read and subscribed to
 */
export declare const useComputedValue: <R>(computed: IComputed<R>) => R;
