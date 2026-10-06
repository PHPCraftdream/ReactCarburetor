import {viewKeys} from "@/Carburetor/Store/Tracking/Models";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";

/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;

/** Optional stricter array policy used by class connection selections. */
type TArraySubclassGuard = (instance: object) => never;

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
 * One recursive step against a caller-owned cycle ledger.
 *
 * Every copied container is registered in `seen` before its members are walked, so a source value
 * reached along two paths — including through its own cycle — reuses the copy already under
 * construction instead of recursing forever.
 *
 * @param value - the value to detach
 * @param seen - the external cycle ledger, shared across the whole walk
 * @param onLiveInstance - live-instance report
 * @param onArraySubclass - array-subclass guard
 * @param onSharing - fired when a raw value is reached a second time (sharing or cycle)
 */
const detach = (
    value: unknown,
    seen: WeakMap<object, unknown>,
    onLiveInstance: TReportLiveInstance | undefined,
    onArraySubclass: TArraySubclassGuard | undefined,
    onSharing?: () => void
): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target = liveViews.readTarget(value);
    const native = target ?? value;
    const known = seen.get(value) ?? (target !== undefined ? seen.get(target) : undefined);

    if (known !== undefined) {
        // Reached twice: the detached graph is not a tree (R37-01).
        onSharing?.();
        if (target !== undefined && !seen.has(value)) {
            // The raw branch may have been copied first through an opaque container. Still
            // visit this recognized read proxy once: its field reads subscribe to the selected
            // paths, including descendants, without making a second detached copy.
            seen.set(value, known);

            if (!Array.isArray(value)) {
                const keys = viewKeys(value);

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
            copy.set(detach(key, seen, onLiveInstance, onArraySubclass, onSharing),
                detach(member, seen, onLiveInstance, onArraySubclass, onSharing));
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
            copy.add(detach(member, seen, onLiveInstance, onArraySubclass, onSharing));
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

        let densePrefix = 0;

        for (; densePrefix < length; densePrefix++) {
            if (!Object.prototype.hasOwnProperty.call(value, densePrefix)) {
                break;
            }

            copy[densePrefix] = detach(value[densePrefix], seen, onLiveInstance, onArraySubclass, onSharing);
        }

        if (densePrefix < length) {
            // ownKeys uses the live view's structural read trap, so adding or deleting a slot
            // wakes a sparse selection even when that slot previously held a hole.
            const ownKeys = Reflect.ownKeys(value);

            for (let index = 0; index < ownKeys.length; index++) {
                const key = ownKeys[index];

                if (typeof key !== 'string') {
                    continue;
                }

                const numericIndex = Number(key);

                if (!Number.isInteger(numericIndex) || numericIndex < densePrefix ||
                    numericIndex >= 0xFFFFFFFF || String(numericIndex) !== key) {
                    continue;
                }

                const descriptor = target === undefined ? undefined : Object.getOwnPropertyDescriptor(target, key);
                const cloned = detach(value[numericIndex], seen, onLiveInstance, onArraySubclass, onSharing);
                if (descriptor?.enumerable === false) {
                    Object.defineProperty(copy, key, {
                        value: cloned, writable: descriptor.writable, configurable: descriptor.configurable,
                        enumerable: false,
                    });
                } else {
                    copy[numericIndex] = cloned;
                }
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
    const keys = viewKeys(source);

    for (let index = 0; index < keys.length; index++) {
        const child: unknown = source[keys[index]];

        assign(result, keys[index], child !== null && typeof child === 'object'
            ? detach(child, seen, onLiveInstance, onArraySubclass, onSharing)
            : child);
    }

    return result;
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
    onArraySubclass: TArraySubclassGuard | undefined,
    onSharing?: () => void
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

            assign(copy, keys[index], detach(child, seen, onLiveInstance, onArraySubclass, onSharing));
        } else {
            assign(copy, keys[index], child);
        }
    }

    return copy;
};

/**
 * Recursively detaches a value into an externally owned cycle ledger (R34-02).
 *
 * Semantics match `detachOpaque`, but the ledger is supplied by the caller so a fused
 * reconcile can share one ledger across compare + detach. The primitive fast path still
 * applies, and its result is registered in the caller's ledger before returning.
 *
 * @param value - the value to detach
 * @param seen - the external cycle ledger, also filled by the fast path
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @param onArraySubclass - optional rejection policy for class selections
 * @param onSharing - fired when the detached graph turns out not to be a tree: a raw value reached
 * twice, through any container kind, including Map keys/members and Set members (R37-01)
 * @returns the detached copy
 */
export const detachOpaqueInto = (
    value: unknown,
    seen: WeakMap<object, unknown>,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard,
    onSharing?: () => void
): unknown => {
    if (value !== null && typeof value === 'object') {
        // One raw value, one copy: the shared ledger may already hold one from an earlier
        // branch of a fused reconcile walk. That second reach is sharing.
        const known = seen.get(value);

        if (known !== undefined) {
            onSharing?.();
            return known;
        }

        const fast = tryFastPrimitiveCopy(value, onLiveInstance, onArraySubclass, onSharing);

        if (fast !== undefined) {
            seen.set(value, fast);

            return fast;
        }
    }

    return detach(value, seen, onLiveInstance, onArraySubclass, onSharing);
};
