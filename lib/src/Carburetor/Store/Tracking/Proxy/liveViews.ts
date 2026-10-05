import {TPathRecorder} from "@/Carburetor/Models/Paths";
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";
import {IProxyCache, RAW_TARGET} from "@/Carburetor/Store/Tracking/Models";
import {recordNativeAliasReads} from "@/Carburetor/Store/Tracking/Aliases/NativeAliasReads";
import {nativeAliasIndex} from "@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex";
import {isTrackable} from "@/Carburetor/Store/Tracking/isTrackable";

/**
 * Read proxies, draft proxies and native collection facades answer RAW_TARGET with their raw
 * target, so a tracked view maps back to its original without a registry insert. The weak
 * registry stays only for persistent connection facades, which need a dynamic resolver (it
 * can retarget after setData). A dropped view is never kept alive by either structure.
 *
 * Both structures share process-wide identity: another package copy can detach a tracked
 * selection or normalize a raw Map key passed through a draft from this copy — the hatch via
 * `Symbol.for`, the registry via sharedSingleton. The versioned sharedSingleton key
 * deliberately does not promise a cross-version ABI.
 */
type TDynamicReadTarget = () => object | undefined;

const knownViews: WeakMap<object, object | TDynamicReadTarget | undefined> = sharedSingleton(
    'liveViews', () => new WeakMap<object, object | TDynamicReadTarget | undefined>()
);

/** Only a view minted by the engine can be exchanged for its original graph member. */
const canonical = (value: unknown): unknown =>
    value !== null && typeof value === 'object' ? (liveViews.readTarget(value) ?? value) : value;

/** A collection is adapted once per tracking tree, including when reached by another alias. */
const facades = new WeakMap<IProxyCache, WeakMap<object, object>>();

/**
 * Reads a view's RAW_TARGET hatch: answered by a get trap, so probing a foreign Proxy runs
 * that proxy's own get trap, and a throw reads as "not an engine view".
 *
 * @param value - candidate engine view or raw object
 */
const readHatch = (value: object): object | undefined => {
    try {
        const hatch: unknown = Reflect.get(value, RAW_TARGET);

        return typeof hatch === 'object' && hatch !== null ? hatch : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Map/Set own intrinsic slots cannot be called through a Proxy. Forward intrinsic reads to
 * the original collection and normalize only the identity-sensitive native arguments. The
 * collection stays the graph's original object: no member, key or root is copied or replaced.
 * Unsupported subclasses, own method overrides and other native/class objects remain raw.
 */
const adaptNativeCollection = (
    value: object, cache: IProxyCache, source: object, key: string,
    root: object | undefined, record: TPathRecorder | undefined
): object => {
    const prototype = Object.getPrototypeOf(value);
    const map = prototype === Map.prototype;

    if (!map && prototype !== Set.prototype) {
        return value;
    }

    // A Proxy must report an own, non-configurable, non-writable data value unchanged.
    // Native own descriptors can be intentionally locked even when the parent is extensible.
    const own = Object.getOwnPropertyDescriptor(source, key);
    if (own !== undefined && !own.configurable && own.writable === false) {
        if (root !== undefined && record !== undefined) recordNativeAliasReads(root, value, record);
        return value;
    }

    let tree = facades.get(cache);

    if (tree === undefined) {
        tree = new WeakMap<object, object>();
        facades.set(cache, tree);
    }

    const existing = tree.get(value);

    if (existing !== undefined) {
        return existing;
    }

    const methods = new Map<PropertyKey, unknown>();
    const facade = new Proxy(value, {
        get(target, key): unknown {
            if (key === RAW_TARGET) {
                return target;
            }

            // Native getters (notably size) require a receiver with the collection's slots.
            const member: unknown = Reflect.get(target, key, target);
            if (root !== undefined && record !== undefined
                && member !== null && typeof member === 'object') {
                recordNativeAliasReads(root, member, record);
            }

            if (typeof member !== 'function' || key === 'constructor'
                || Object.prototype.hasOwnProperty.call(target, key)) {
                return member;
            }

            const saved = methods.get(key);

            if (saved !== undefined) {
                return saved;
            }

            let method: unknown;
            if (map && key === 'set') {
                method = function (this: unknown, entryKey: unknown, entryValue: unknown): unknown {
                    const receiver = canonical(this);
                    const result = (member as (this: unknown, key: unknown, value: unknown) => unknown)
                        .call(receiver, canonical(entryKey), canonical(entryValue));
                    if (cache.nativeAliasRoot !== undefined) {
                        nativeAliasIndex.invalidate(cache.nativeAliasRoot);
                    }
                    return result === receiver && receiver !== this ? this : result;
                };
            } else if (map && key === 'get') {
                method = function (this: unknown, entry: unknown): unknown {
                    const result = (member as (this: unknown, entry: unknown) => unknown)
                        .call(canonical(this), canonical(entry));
                    if (root !== undefined && record !== undefined) {
                        recordNativeAliasReads(root, result, record);
                    }
                    return result;
                };
            } else if (key === 'has' || key === 'delete'
                || (!map && key === 'add')) {
                method = function (this: unknown, entry: unknown): unknown {
                    const receiver = canonical(this);
                    const result = (member as (this: unknown, entry: unknown) => unknown)
                        .call(receiver, canonical(entry));
                    if (cache.nativeAliasRoot !== undefined && key !== 'has') {
                        nativeAliasIndex.invalidate(cache.nativeAliasRoot);
                    }
                    return result === receiver && receiver !== this ? this : result;
                };
            } else if (key === 'forEach') {
                method = function (this: unknown, callback: unknown, thisArg?: unknown): unknown {
                    const receiver = canonical(this);
                    if (root !== undefined && record !== undefined) {
                        recordNativeAliasReads(root, receiver, record);
                    }
                    const forEach = member as (this: unknown, callback: unknown, thisArg?: unknown) => unknown;
                    if (typeof callback !== 'function') {
                        return forEach.call(receiver, callback, thisArg);
                    }
                    return forEach.call(receiver, (value: unknown, entry: unknown, raw: unknown): void => {
                        Function.prototype.call.call(callback, thisArg, value, entry,
                            raw === receiver && receiver !== this ? this : raw);
                    }, thisArg);
                };
            } else if (key === 'keys' || key === 'values' || key === 'entries'
                || key === Symbol.iterator) {
                method = function (this: unknown, ...args: unknown[]): unknown {
                    const receiver = canonical(this);
                    const result = Reflect.apply(member, receiver, args);
                    if (root !== undefined && record !== undefined) {
                        recordNativeAliasReads(root, receiver, record);
                    }
                    return result;
                };
            } else if (key === 'clear') {
                method = function (this: unknown): unknown {
                    const result = Reflect.apply(member, canonical(this), []);
                    if (cache.nativeAliasRoot !== undefined) {
                        nativeAliasIndex.invalidate(cache.nativeAliasRoot);
                    }
                    return result;
                };
            } else {
                method = function (this: unknown, ...args: unknown[]): unknown {
                    const receiver = canonical(this);
                    const result = Reflect.apply(member, receiver, args);
                    return result === receiver && receiver !== this ? this : result;
                };
            }

            methods.set(key, method);
            return method;
        },
    });

    tree.set(value, facade);
    return facade;
};

const sameKind = (a: object, b: object): boolean =>
    Array.isArray(a) === Array.isArray(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b);

const normalizeInto = (value: object, previous: unknown, stack: Set<object>): void => {
    if (stack.has(value)) {
        return;
    }

    stack.add(value);

    const record = value as Record<string, unknown>;
    const prior = isTrackable(previous) && sameKind(value, previous)
        ? previous as Record<string, unknown>
        : undefined;

    if (Array.isArray(value)) {
        const priorArray = prior ? (previous as unknown as unknown[]) : undefined;

        for (let index = 0; index < value.length; index++) {
            const child: unknown = value[index];

            if (child === null || typeof child !== 'object') {
                continue;
            }

            const previousChild = priorArray && index < priorArray.length ? priorArray[index] : undefined;

            if (Object.is(child, previousChild)) {
                continue;
            }

            const target = liveViews.readTarget(child);

            if (target !== undefined) {
                value[index] = target;
                continue;
            }

            if (isTrackable(child)) {
                normalizeInto(child, previousChild, stack);
            }
        }
    } else {
        for (const key of Object.keys(record)) {
            const child: unknown = record[key];

            if (child === null || typeof child !== 'object') {
                continue;
            }

            const previousChild = prior ? prior[key] : undefined;

            if (Object.is(child, previousChild)) {
                continue;
            }

            const target = liveViews.readTarget(child);

            if (target !== undefined) {
                record[key] = target;
                continue;
            }

            if (isTrackable(child)) {
                normalizeInto(child, previousChild, stack);
            }
        }
    }

    stack.delete(value);
};

export const liveViews = {
    /** Adapts a draft Map/Set without recording read dependencies. */
    adaptNativeCollection: (value: object, cache: IProxyCache, source: object, key: string): object =>
        adaptNativeCollection(value, cache, source, key, undefined, undefined),
    /** Adapts a read Map/Set, recording only the raw members its caller exposes. */
    adaptReadNativeCollection: (
        value: object, cache: IProxyCache, source: object, key: string,
        root: object, record: TPathRecorder
    ): object => adaptNativeCollection(value, cache, source, key, root, record),
    /** Notes a diagnostic-only facade without erasing an existing target or resolver. */
    note: (view: object): void => {
        if (!knownViews.has(view)) {
            knownViews.set(view, undefined);
        }
    },

    /**
     * Associates a tracked read, draft or native collection facade with its raw graph member.
     *
     * @param view - engine-created view
     * @param target - its raw member
     */
    noteTarget: (view: object, target: object): void => {
        knownViews.set(view, target);
    },

    /**
     * Registers a persistent facade's current-target resolver, not a stale snapshot of
     * its original root. Only engine-created facades receive one.
     *
     * @param view - persistent connection facade
     * @param resolve - reads the current supported native root and records its wildcard
     */
    noteDynamicReadTarget: (view: object, resolve: TDynamicReadTarget): void => {
        knownViews.set(view, resolve);
    },

    /**
     * The raw branch of a registered engine view, including a draft or native facade.
     *
     * Tracked views answer through their RAW_TARGET get trap, which runs in O(1) with no
     * registry write at creation. The probe reads the symbol through `get`, so a foreign
     * Proxy's own get trap may run first; an exception it throws is treated as "not an engine
     * view", falling back to the registry. The registry then only serves persistent
     * connect() facades (`noteDynamicReadTarget`, `note`), which need a dynamic resolver.
     *
     * @param view - candidate engine view
     */
    readTarget: (view: object): object | undefined => {
        const direct = readHatch(view);

        if (direct !== undefined) {
            return direct;
        }

        const known = knownViews.get(view);

        return typeof known === 'function' ? known() : known;
    },

    /** Whether `value` is an engine view rather than detached plain data. Same probe
     * trade-off and fallback as `readTarget`.
     *
     * @param value - candidate engine view or raw value
     */
    has: (value: unknown): boolean => {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        return readHatch(value) !== undefined || knownViews.has(value);
    },

    /**
     * Replaces every engine view inside a freshly assigned value with its raw target, mutating
     * the caller's container in place so no tracked view ever becomes state (R32-01).
     *
     * A view is exchanged for the graph member it fronts and not walked into — state-owned raw
     * data is never modified. Subtrees already reference-equal to their `previous` counterpart
     * are skipped entirely, so an unrelated engine proxy kept by the caller is never walked.
     *
     * @param value - the value about to be stored into state.
     * @param previous - the value it replaces, for the reference-equal skip; undefined when the
     * shape changed or there is nothing to compare against.
     */
    normalizeAssigned: (value: unknown, previous?: unknown): void => {
        if (!isTrackable(value) || liveViews.has(value)) {
            return;
        }

        normalizeInto(value, previous, new Set<object>());
    },
};
