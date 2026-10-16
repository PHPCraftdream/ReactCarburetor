import {TResourceArgs} from "@/Carburetor/Models/Resource";

/**
 * Loader tuples must be fixed-length without optional members: the runtime appends the signal,
 * so an optional loader argument would swallow it when `load()` is called without arguments.
 */
type TFixedTArgs<TArgs extends TResourceArgs> = [TArgs] extends [Required<TArgs>]
    ? [number] extends [TArgs['length']] ? never : TArgs
    : never;

/** The loader a constructor accepts: `TArgs` fixed-length, then the signal. Never for bad tuples. */
export type TSignalLoader<T, TArgs extends TResourceArgs> = TFixedTArgs<TArgs> extends never
    ? never
    : (...args: [...TFixedTArgs<TArgs>, AbortSignal]) => Promise<T>;
