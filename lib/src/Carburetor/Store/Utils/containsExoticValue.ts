import {isExoticValue} from "./isExoticValue";

/**
 * Whether an exotic value — a Map, Set, Date or class instance — is present as a member at
 * any depth of plain objects and arrays, or is the value itself. Plain containers are walked
 * with a cycle guard; the contents of an exotic member are not looked into.
 *
 * A stable plain envelope hides a mutation from a reference check (R7-02): the outer object
 * keeps its identity across evaluations while an exotic member inside it mutates in place.
 * `Computed` consults this when its result reference is unchanged and its dependencies moved,
 * and treats the result as changed exactly like a directly exotic one.
 *
 * @param value - the value to inspect, e.g. a computed result about to be judged unchanged
 */
export const containsExoticValue = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const visited: WeakSet<object> = new WeakSet<object>();

    const walk = (candidate: unknown): boolean => {
        try {
            if (isExoticValue(candidate)) {
                return true;
            }

            if (candidate === null || typeof candidate !== 'object' || visited.has(candidate)) {
                return false;
            }

            visited.add(candidate);

            return Reflect.ownKeys(candidate).some((key: string | symbol): boolean => {
                const descriptor = Object.getOwnPropertyDescriptor(candidate, key);

                if (!descriptor?.enumerable) {
                    return false;
                }

                // Accessors are opaque: reading one would run caller code during settlement.
                // Treat it as exotic so dependency changes still notify conservatively.
                if (!("value" in descriptor)) {
                    return true;
                }

                return walk(descriptor.value);
            });
        } catch {
            // A proxy can reject reflection. Notifying is safer when its members are opaque.
            return true;
        }
    };

    return walk(value);
};
