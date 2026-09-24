import { ICarburetor } from "../Carburetor/index.mjs";
import { TSelector, TValueComparator } from "./Models.mjs";
/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 *
 * A selected class instance cannot be detached safely and throws; select its rendered
 * fields as plain values instead.
 *
 * @param carburetor - the store read and subscribed to; swapping it unsubscribes the previous
 * one and reconciles against the new read set
 * @param select - run on a tracked read of the store, so the paths it touches become exactly
 * what the subscription watches
 * @param isEqual - decides whether a recomputed result counts as changed; true keeps the old
 * reference, so React never sees a re-render
 */
export declare const useCarburetorValue: <T extends object, R>(carburetor: ICarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>) => R;
