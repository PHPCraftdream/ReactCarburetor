import {isPlainObject} from "./isPlainObject";

/**
 * The detached form of a selection's value — the form safe to hand a child.
 *
 * Plain objects and arrays are shallow-copied, so a child receives plain data that outlives
 * the render instead of a branch of the live view; a branch read inside the child's own render
 * would record nothing and sit under no subscription. Primitives are detached by being values.
 * Exotic objects (Map, Date, class instances) would lose their prototype to a copy, so they
 * pass as is. The copy is also what the comparison reads: the copied key set and the compared
 * key set agree by construction, which is what makes a stable snapshot mean a stable view.
 */
export const detachSelection = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return Array.from(value);
    }

    if (isPlainObject(value)) {
        return {...value};
    }

    return value;
};
