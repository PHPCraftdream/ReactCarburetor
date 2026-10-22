import {TResourceArgs} from "../../Models/Resource";
import {IS_DEVELOPMENT} from "../../Store/Utils/DevelopmentFlag";

/** Rejects an argument the default key cannot encode without collisions (development only). */
const checkJsonSafe = (value: unknown, seen: WeakSet<object>, depth: number): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(
                'resource arguments must be JSON-safe; NaN and Infinity collapse to the same key. Pass a `key` option.',
            );
        }
        return;
    }
    if (value === undefined) return;
    if (depth === 0 || typeof value !== 'object') {
        // Function/symbol/bigint and depth-exceeded values cannot round-trip through JSON.
        throw new TypeError(
            'resource arguments must be JSON-safe (string, number, boolean, null, plain object, array); '
            + 'this value would collide or throw in the default key. Pass a `key` option.',
        );
    }
    if (seen.has(value as object)) {
        throw new TypeError(
            'resource arguments must be JSON-safe; a circular structure cannot form a key. Pass a `key` option.',
        );
    }
    seen.add(value as object);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) {
        throw new TypeError(
            `resource arguments must be JSON-safe plain objects or arrays; got `
            + `${(value as object).constructor?.name || 'a class instance'}. Pass a \`key\` option.`,
        );
    }
    for (const member of Object.values(value as Record<string, unknown>)) checkJsonSafe(member, seen, depth - 1);
    seen.delete(value as object);
};

/** The default key: single-argument resources keep today's key, longer lists JSON-encode. */
export const defaultResourceKey = (args: TResourceArgs): string => {
    // Trailing undefined arguments are optional parameters, not different answers.
    let end = args.length;
    while (end > 0 && args[end - 1] === undefined) end -= 1;
    // Development only: reject arguments that would collide or throw before they poison answer memory.
    if (IS_DEVELOPMENT) {
        if (end === 1) checkJsonSafe(args[0], new WeakSet(), 32);
        else if (end > 1) checkJsonSafe(args.slice(0, end), new WeakSet(), 32);
    }
    if (end === 0) return JSON.stringify(null);
    if (end === 1) return JSON.stringify(args[0] === undefined ? null : args[0]);
    return JSON.stringify(args.slice(0, end));
};
