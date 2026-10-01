import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";

/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;

/** Optional stricter array policy used by class connection selections. */
type TArraySubclassGuard = (instance: object) => never;

/**
 * One recursive step, split from the export only so the entry point can hand a fresh cycle guard.
 *
 * Every copied container is registered in `seen` before its members are walked, so a source value
 * reached along two paths — including through its own cycle — reuses the copy already under
 * construction instead of recursing forever.
 */
const detach = (
    value: unknown,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined
): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target = liveViews.readTarget(value);
    const native = target ?? value;
    const known = seen.get(value) ?? (target !== undefined ? seen.get(target) : undefined);

    if (known !== undefined) {
        if (target !== undefined && !seen.has(value)) {
            // The raw branch may have been copied first through an opaque container. Still
            // visit this recognized read proxy once: its field reads subscribe to the selected
            // paths, including descendants, without making a second detached copy.
            seen.set(value, known);

            if (!Array.isArray(value)) {
                const keys = Object.keys(value);

                const branch = value as Record<string, unknown>;

                for (let index = 0; index < keys.length; index++) {
                    void branch[keys[index]];
                }
            }
        }

        return known;
    }

    // A persistent facade can front a native root, but native methods require their real
    // internal-slot receiver. Its registered resolver already recorded the root wildcard.
    if (native instanceof Date && Object.getPrototypeOf(native) === Date.prototype) {
        const copy = new Date(Date.prototype.getTime.call(native));

        seen.set(value, copy);

        if (target !== undefined) {
            seen.set(target, copy);
        }

        return copy;
    }

    if (native instanceof Map && Object.getPrototypeOf(native) === Map.prototype) {
        const copy = new Map<unknown, unknown>();

        seen.set(value, copy);

        if (target !== undefined) {
            seen.set(target, copy);
        }

        Map.prototype.forEach.call(native, (member: unknown, key: unknown): void => {
            copy.set(detach(key, seen, onLiveInstance, onArraySubclass),
                detach(member, seen, onLiveInstance, onArraySubclass));
        });

        return copy;
    }

    if (native instanceof Set && Object.getPrototypeOf(native) === Set.prototype) {
        const copy = new Set<unknown>();

        seen.set(value, copy);

        if (target !== undefined) {
            seen.set(target, copy);
        }

        Set.prototype.forEach.call(native, (member: unknown): void => {
            copy.add(detach(member, seen, onLiveInstance, onArraySubclass));
        });

        return copy;
    }

    if (Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Array.prototype && prototype !== Object.prototype && prototype !== null) {
            // A subclass cannot be forged into a plain array for a class connection.
            // Other consumers keep unsupported array instances live, as before.
            if (onArraySubclass !== undefined) {
                onArraySubclass(value);
            }

            onLiveInstance?.(value);

            return value;
        }

        // Holes stay holes; a null-prototype array keeps its prototype.
        const copy: unknown[] = [];
        const length = value.length;

        copy.length = length;

        if (prototype !== Array.prototype) {
            Object.setPrototypeOf(copy, prototype);
        }

        seen.set(value, copy);

        if (target !== undefined) {
            seen.set(target, copy);
        }

        for (let index = 0; index < length; index++) {
            if (Object.prototype.hasOwnProperty.call(value, index)) {
                copy[index] = detach(value[index], seen, onLiveInstance, onArraySubclass);
            }
        }

        return copy;
    }

    if (!isTrackable(value)) {
        // A class instance has no generic safe copy: fields can be private, the prototype carries
        // behavior, and a structural copy would break every identity its methods rely on. It is
        // handed over live, and the caller can ask to hear about it.
        onLiveInstance?.(value);

        return value;
    }

    const source = value as Record<string, unknown>;
    // The literal is the fast path for the common prototype; Object.create keeps a
    // null-prototype dictionary null-prototype instead of always landing on Object.prototype.
    const prototype = Object.getPrototypeOf(native);
    const result: Record<string, unknown> = prototype === Object.prototype
        ? {}
        : Object.create(prototype);

    seen.set(value, result);

    if (target !== undefined) {
        seen.set(target, result);
    }

    // Own enumerable string keys only — the state model (R6-02). Reads go through the value
    // itself so a live view records every selected path.
    const keys = Object.keys(source);

    for (let index = 0; index < keys.length; index++) {
        const child: unknown = source[keys[index]];

        assign(result, keys[index], child !== null && typeof child === 'object'
            ? detach(child, seen, onLiveInstance, onArraySubclass)
            : child);
    }

    return result;
};

/**
 * Stores one copied field; an own key literally named `__proto__` needs defineProperty to
 * avoid reassigning the copy's prototype.
 *
 * @param result - the copy under construction
 * @param key - the field name
 * @param cloned - the detached value
 */
const assign = (result: Record<string, unknown>, key: string, cloned: unknown): void => {
    if (key === '__proto__') {
        Object.defineProperty(result, key, {value: cloned, writable: true, enumerable: true, configurable: true});
    } else {
        result[key] = cloned;
    }
};

/**
 * Copies a plain Object.prototype object. Primitive fields go straight into a literal with
 * no cycle ledger; on the first container field the ledger is created and the rest is walked
 * by `detach`, reusing the value already read — a getter never runs twice.
 * `undefined` means "not applicable, take the full path" (nothing has been read).
 *
 * @param value - the candidate
 * @param onLiveInstance - live-instance report
 * @param onArraySubclass - array-subclass guard
 */
const tryFastPrimitiveCopy = (
    value: object,
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined
): Record<string, unknown> | undefined => {
    if (Array.isArray(value) ||
        liveViews.readTarget(value) !== undefined ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        return undefined;
    }

    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    const copy: Record<string, unknown> = {};
    let seen: WeakMap<object, unknown> | undefined;

    for (let index = 0; index < keys.length; index++) {
        const child: unknown = source[keys[index]];

        if (child !== null && typeof child === 'object') {
            if (seen === undefined) {
                seen = new WeakMap<object, unknown>();
                seen.set(value, copy);
            }

            assign(copy, keys[index], detach(child, seen, onLiveInstance, onArraySubclass));
        } else {
            assign(copy, keys[index], child);
        }
    }

    return copy;
};

/**
 * Recursively detaches a selection the way the state model defines one (R30-04).
 *
 * Plain objects by own enumerable string keys, arrays by elements and `length` (holes kept),
 * detached copies of plain Date/Map/Set, and everything else — class instances, Array and
 * native subclasses — by reference. Symbol keys, non-enumerable keys and descriptor flags
 * are not part of a selection and are not copied. An accessor's getter runs once, like any
 * plain read, and its value is what the copy keeps.
 *
 * A null-prototype dictionary stays null-prototype. Shared references and cycles survive
 * through the cycle ledger: one source value, one detached copy.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @param onArraySubclass - optional rejection policy for class selections
 * @returns the detached copy
 */
export const detachOpaque = <T>(
    value: T,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard
): T => {
    if (value !== null && typeof value === 'object') {
        const fast = tryFastPrimitiveCopy(value, onLiveInstance, onArraySubclass);

        if (fast !== undefined) {
            return fast as unknown as T;
        }
    }

    return detach(value, new WeakMap<object, unknown>(), onLiveInstance, onArraySubclass) as T;
};
