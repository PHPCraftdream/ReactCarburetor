import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";
import {isPlainObject} from "./isPlainObject";

/** Renders one path segment for the report: a symbol reads as `[Symbol(...)]`, a string as-is. */
const describeSegment = (segment: string | symbol): string =>
    typeof segment === 'symbol' ? '[' + segment.toString() + ']' : segment;

/**
 * Depth-first search for the first live view reachable from `value`, through plain objects and
 * arrays at any depth and through own string and symbol data properties alike. Accessors are
 * skipped here and rejected by detachment, so inspecting the result never invokes a getter.
 *
 * A plain container already on the current path is skipped instead of walked again: the only
 * way this could fail to terminate is a cycle the selection's own data introduced, not the
 * traversal, and a container the selection already passed through cannot be hiding a live view
 * this search has not already seen by the time it is revisited.
 *
 * @param value - the candidate to inspect
 * @param visited - plain containers already on the current path
 * @param path - the property path from the selection's root to `value`, returned as the report
 * location when `value` itself is a live view
 */
const findLiveView = (
    value: unknown,
    visited: Set<object>,
    path: Array<string | symbol>
): Array<string | symbol> | undefined => {
    if (liveViews.has(value)) {
        return path;
    }

    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    if (!Array.isArray(value) && !isPlainObject(value)) {
        return undefined;
    }

    if (visited.has(value)) {
        return undefined;
    }

    visited.add(value);

    // Binding narrowed ahead of the callback: a `for...of` body over a computed key list runs
    // outside the guards' narrowing reach.
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);

        if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            continue;
        }

        // Reading the data property through the view preserves its dependency tracking.
        const found = findLiveView(Reflect.get(value, key), visited, [...path, key]);

        if (found !== undefined) {
            return found;
        }
    }

    return undefined;
};

/**
 * The development diagnostic for a selection that hands a live view to a child, at any depth.
 *
 * Reported once per selection, not per render — the mistake is the declaration's, and one
 * complaint names it. Returns whether a report was made, so the caller latches only on a real
 * escape and a selection that only later starts handing out a live view is still caught;
 * production compiles the call site out, leaving behavior unchanged.
 *
 * @param next - the fresh selection to inspect, walked at every depth reachable through plain
 * objects and arrays
 */
export const reportLiveViewEscape = (next: unknown): boolean => {
    const location = findLiveView(next, new Set<object>(), []);

    if (location === undefined) {
        return false;
    }

    const where = location.length === 0
        ? 'as its whole value'
        : 'at "' + location.map(describeSegment).join('.') + '"';

    diagnostics.report(
        'a connectSelection() snapshot handed a child a live store view ' + where + '. A child reading it in ' +
        'its own render records nothing, so no subscription covers what it sees and it never hears about ' +
        'changes. Select plain values — primitives, or plain objects and arrays built from them.'
    );

    return true;
};
