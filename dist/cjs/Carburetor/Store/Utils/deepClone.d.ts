/**
 * A detached copy of plain data.
 *
 * Only plain objects and arrays are copied — the same boundary the tracking proxies use.
 * Anything else (Map, Set, Date, class instances) is carried over by reference, because the
 * engine does not track it field by field either. State is own enumerable string-keyed data:
 * `Object.keys` is what the state model (R6-02/R6-03) says a container's fields are, so it is
 * also what this walks — no symbol keys, no non-enumerable properties to weigh each one against.
 * An own key literally named `__proto__` still needs `Object.defineProperty` to land as a data
 * property instead of reassigning the target's prototype.
 */
export declare const deepClone: <T>(value: T) => T;
