import { ICarburetor, IComputed, TReadonly } from "../Carburetor/index.js";
/**
 * Optional bridge for embedding a carburetor into a hooks-based subtree — a router shell,
 * a third-party UI kit, an existing hooks codebase. The engine itself needs no hooks;
 * this entry point exists only for the boundary with code that does.
 */
export type TSelector<T, R> = (data: TReadonly<T>) => R;
/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 */
export declare const useCarburetorValue: <T extends {}, R>(carburetor: ICarburetor<T>, select: TSelector<T, R>, isEqual?: (a: R, b: R) => boolean) => R;
/** Reads a memoized derived value from a hooks-based component. */
export declare const useComputedValue: <R>(computed: IComputed<R>) => R;
