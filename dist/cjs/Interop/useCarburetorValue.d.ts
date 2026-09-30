import { ICarburetor } from "../Carburetor/index.js";
import { TSelector, TValueComparator } from "./Models.js";
/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 *
 * A selected class instance cannot be detached safely and throws; select its rendered
 * fields as plain values instead.
 * Read primitive values with ordinary property access or `Reflect.get` inside `select`.
 * `Object.getOwnPropertyDescriptor(view, key)?.value` and `hasOwnProperty` inspect structure
 * without registering that value as a leaf dependency.
 *
 * @param carburetor - the store read and subscribed to; swapping it unsubscribes the previous
 * one and reconciles against the new read set
 * @param select - run on a tracked read of the store, so the paths it touches become exactly
 * what the subscription watches
 * @param isEqual - decides whether a recomputed result counts as changed; true keeps the old
 * reference, so React never sees a re-render. Defaults to the same structural comparison
 * `connectSelection` uses: own data properties and `Object.is` values, recursively through
 * plain objects and arrays. detachOpaque() rebuilds every plain container fresh, so `Object.is`
 * itself could never call two detached objects equal — pass it explicitly to restore that
 * stricter, reference-only behavior. A `Map`, `Set`, `Date` or class instance always compares
 * as changed: its content can mutate in place, so no comparison of it can be trusted.
 */
export declare const useCarburetorValue: <T extends object, R>(carburetor: ICarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>) => R;
