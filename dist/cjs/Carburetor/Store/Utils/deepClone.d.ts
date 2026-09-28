/**
 * A detached copy of plain data.
 *
 * Only plain objects and arrays are copied — the same boundary the tracking proxies use.
 * Anything else (Map, Set, Date, class instances) is carried over by reference, because the
 * engine does not track it field by field either. Keys are copied by plain assignment, except
 * an own key literally named `__proto__`, which needs `Object.defineProperty` to land as a
 * data property instead of reassigning the target's prototype.
 */
export declare const deepClone: <T>(value: T) => T;
