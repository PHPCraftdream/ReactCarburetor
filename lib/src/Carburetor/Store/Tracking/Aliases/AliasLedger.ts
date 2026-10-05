import {TPath, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";

// Declared locally rather than through @types/node, as in Carburetor.ts: bundlers substitute
// this exact member expression at build time, which is what lets the strings below be dropped
// from a production bundle — an imported IS_DEVELOPMENT constant cannot be folded across
// modules, and the messages would ship dead.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/** A string array index (not `length`), the only own keys an array's state has besides it. */
const isArrayIndexKey = (key: string): boolean =>
    key === '0' || (/^[1-9]\d*$/.test(key) && Number(key) <= 0xFFFFFFFE);

/** Throws naming the array's one own key that is not an index or `length`. */
const throwNonIndexKey = (value: unknown[], path: TPath): never => {
    for (const name of Object.getOwnPropertyNames(value)) {
        if (name !== 'length' && !isArrayIndexKey(name)) {
            throw new Error(
                'Carburetor: array at "' + (path || 'the root') + '" has a non-index own key "' + name +
                '" — an array\'s state is its elements and length only.'
            );
        }
    }

    // Reachable only if the mismatch below was a false positive (it is not, by construction);
    // still needed so TypeScript sees every path through `checkArray` either recurse or throw.
    throw new Error('Carburetor: array at "' + (path || 'the root') + '" has an unexpected own key.');
};

/**
 * Throws for a descriptor the state model rejects: an accessor, or a non-enumerable property.
 * `path` is a thunk, not a value: building it costs a string concatenation (`joinPath`), wasted
 * work on every valid key on the hot common case — only the rare throw needs it.
 */
const checkDescriptor = (descriptor: PropertyDescriptor, childPath: () => TPath): void => {
    if ('get' in descriptor || 'set' in descriptor) {
        throw new Error(
            'Carburetor: "' + childPath() + '" is an accessor property (getter/setter) — state is ' +
            'plain data only. Derive it instead, e.g. with Computed.'
        );
    }

    if (!descriptor.enumerable) {
        throw new Error(
            'Carburetor: "' + childPath() + '" is a non-enumerable own property — state must be ' +
            'enumerable: Object.keys() is what diffing, cloning and restoring see.'
        );
    }
};

/**
 * `checkContainer`'s array branch: every own key but `length` must be an index, in state form.
 *
 * Short arrays keep the numeric loop; long arrays walk own names so sparse tails cost only
 * their stored elements. The `length` descriptor is intrinsic; every other name must be an
 * index, including non-enumerable keys rejected below.
 *
 * Reads each descriptor with its own `Reflect.getOwnPropertyDescriptor` call — measured faster
 * than `Object.getOwnPropertyDescriptor` (no `ToObject` coercion on the receiver) — rather than
 * batching through `Object.getOwnPropertyDescriptors`: measured on a wide (thousands of keys)
 * container, the batch form is markedly slower still — it builds a whole descriptor object per
 * key up front instead of the one this walk actually needs before moving on, and a container
 * this wide is exactly the shape `setData`/`restore`/construction validate on a real app's row
 * collection.
 *
 * `joinPath(path, name)` is built only where a value actually needs it (an error, or recursing
 * into a nested container) — an index holding a primitive, the common case for a row of scalar
 * fields, moves on without ever concatenating a path for it.
 */
const checkArray = (value: unknown[], path: TPath, previous: unknown, stack: Set<object>): void => {
    const priorArray = Array.isArray(previous) ? previous : undefined;

    if (value.length <= 4096) {
        let ownIndexCount = 0;

        for (let index = 0; index < value.length; index++) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                continue;
            }

            ownIndexCount++;
            const name = String(index);
            const descriptor = Reflect.getOwnPropertyDescriptor(value, name) as PropertyDescriptor;
            checkDescriptor(descriptor, () => joinPath(path, name));
            const previousElement = priorArray ? priorArray[index] : undefined;

            if (!Object.is(descriptor.value, previousElement) && isTrackable(descriptor.value)) {
                checkContainer(descriptor.value, joinPath(path, name), previousElement, stack);
            }
        }

        if (Object.getOwnPropertyNames(value).length !== ownIndexCount + 1) {
            throwNonIndexKey(value, path);
        }

        return;
    }

    for (const name of Object.getOwnPropertyNames(value)) {
        if (name === 'length') {
            continue;
        }

        if (!isArrayIndexKey(name)) {
            throwNonIndexKey(value, path);
        }

        const descriptor = Reflect.getOwnPropertyDescriptor(value, name) as PropertyDescriptor;

        checkDescriptor(descriptor, () => joinPath(path, name));

        const previousElement = priorArray ? priorArray[Number(name)] : undefined;

        if (!Object.is(descriptor.value, previousElement) && isTrackable(descriptor.value)) {
            checkContainer(descriptor.value, joinPath(path, name), previousElement, stack);
        }
    }
};

/** `checkContainer`'s plain-object branch: every own key is a data property, string-keyed. */
const checkObject = (value: object, path: TPath, previous: unknown, stack: Set<object>): void => {
    const priorObject = isTrackable(previous) && !Array.isArray(previous)
        ? previous as Record<string, unknown>
        : undefined;

    for (const name of Object.getOwnPropertyNames(value)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, name) as PropertyDescriptor;

        checkDescriptor(descriptor, () => joinPath(path, name));

        const previousField = priorObject ? priorObject[name] : undefined;

        if (!Object.is(descriptor.value, previousField) && isTrackable(descriptor.value)) {
            checkContainer(descriptor.value, joinPath(path, name), previousField, stack);
        }
    }
};

/** A container's own checks: no cycle, no symbol keys, then its array/object-shaped own keys. */
const checkContainer = (value: object, path: TPath, previous: unknown, stack: Set<object>): void => {
    if (liveViews.has(value)) {
        throw new Error(
            'Carburetor: state at "' + (path || 'the root') + '" contains an engine view — store the ' +
            'raw value instead; a tracked view must never become state.'
        );
    }

    if (stack.has(value)) {
        throw new Error(
            'Carburetor: state at "' + (path || 'the root') + '" is cyclic — a container cannot ' +
            'contain itself.'
        );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error(
            'Carburetor: state at "' + (path || 'the root') + '" has an own symbol key, which is not ' +
            'part of the state model — use a string key instead.'
        );
    }

    stack.add(value);

    try {
        if (Array.isArray(value)) {
            checkArray(value, path, previous, stack);
        } else {
            checkObject(value, path, previous, stack);
        }
    } finally {
        stack.delete(value);
    }
};

/**
 * One value's own check: a sub-branch already known equal to `previous` (by `Object.is`) is
 * skipped, unchecked — the same short-circuit `diffPaths`/`applyDiff` use, so `setData`'s check
 * costs nothing for the untouched majority of a large tree. A primitive write — the common case
 * on the hot path, every leaf assignment through draft — returns here too, before `stack` is
 * ever allocated: `checkState` below hands this `undefined` on every call, and only a value
 * that actually needs walking into pays for a `Set`.
 */
const checkStateWalk = (value: unknown, path: TPath, previous: unknown, stack: Set<object> | undefined): void => {
    if (Object.is(value, previous)) {
        return;
    }

    if (!isTrackable(value)) {
        return;
    }

    checkContainer(value, path, previous, stack ?? new Set<object>());
};

/**
 * The development ledger behind the aliasing contract: the read proxy notes where each branch
 * object was read, and draft complains when it writes into an object that was read somewhere
 * else, since only the written path's subscribers are woken.
 *
 * It reports only — matching never consults it. Production gets `undefined`, which folds the
 * call sites and their message strings out of the bundle.
 *
 * `checkState`/`checkKey` are the state-model boundary (R6-02/R6-03): thrown, not reported,
 * since invalid state corrupts tracking rather than merely surprising it.
 */
export const createAliasLedger = (): TAliasLedger => {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
        return undefined;
    }

    const seen = new WeakMap<object, TPath>();

    return {
        note: (value: object, path: TPath): void => {
            const found = seen.get(value);

            if (found !== undefined && found !== path) {
                diagnostics.report(
                    'the same object was reached at two paths, ' + found + ' and ' + path + ': ' +
                    'reads are tracked by path, so a write through one will not wake a component ' +
                    'reading the other. Keep the data a tree — one object, one path.'
                );
            }

            seen.set(value, path);
        },
        checkWrite: (source: object, path: TPath): void => {
            const found = seen.get(source);

            if (found !== undefined && found !== path) {
                diagnostics.report(
                    'a write landed in an object that was also read at ' + found + ', while the ' +
                    'write sits at ' + (path || 'the root') + ': only the written path is woken, ' +
                    'the other never hears about it. Keep the data a tree — one object, one path.'
                );
            }
        },
        forget: (value: unknown): void => {
            if (value !== null && typeof value === 'object') {
                seen.delete(value);
            }
        },
        checkState: (value: unknown, path: TPath, previous?: unknown): void => {
            checkStateWalk(value, path, previous, undefined);
        },
        checkKey: (container: object, key: string, path: TPath): void => {
            if (Array.isArray(container) && key !== 'length' && !isArrayIndexKey(key)) {
                throw new Error(
                    'Carburetor: "' + path + '" is not an index or "length" — an array\'s state is ' +
                    'its elements and length only.'
                );
            }
        },
    };
};
