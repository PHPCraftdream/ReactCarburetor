import { ICarburetor } from "../Carburetor/index.js";
import { TSelector, TValueComparator } from "./Models.js";
/**
 * Subscribes to exactly the paths the selector reads, the same precision the class API
 * gets. The selector result is cached per store version, so useSyncExternalStore sees a
 * stable snapshot even when the selector builds a new object.
 */
export declare const useCarburetorValue: <T extends object, R>(carburetor: ICarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>) => R;
