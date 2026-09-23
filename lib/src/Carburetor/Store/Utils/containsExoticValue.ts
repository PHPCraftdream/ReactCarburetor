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
        if (isExoticValue(candidate)) {
            return true;
        }

        if (candidate === null || typeof candidate !== 'object' || visited.has(candidate)) {
            return false;
        }

        visited.add(candidate);

        return Object.values(candidate).some((member: unknown): boolean => walk(member));
    };

    return walk(value);
};
