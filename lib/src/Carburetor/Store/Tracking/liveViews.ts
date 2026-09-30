import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";
import {IProxyCache} from "./Models";

/**
 * Engine-owned read views, draft views and persistent connection facades share one weak
 * registry across package copies and module formats. A tracked proxy maps to its raw
 * target; a persistent facade resolves its current native root when detached (it can retarget
 * after setData). A dropped view is never kept alive by the registry.
 *
 * All roles share process-wide identity: another package copy can detach a tracked selection
 * or normalize a raw Map key passed through a draft from this copy. The
 * versioned sharedSingleton key deliberately does not promise a cross-version ABI.
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
 * Map/Set own intrinsic slots cannot be called through a Proxy. Forward intrinsic reads to
 * the original collection and normalize only the identity-sensitive native arguments. The
 * collection stays the graph's original object: no member, key or root is copied or replaced.
 * Unsupported subclasses, own method overrides and other native/class objects remain raw.
 */
const adaptNativeCollection = (
    value: object, cache: IProxyCache, source: object, key: string
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
            // Native getters (notably size) require a receiver with the collection's slots.
            const member: unknown = Reflect.get(target, key, target);

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
                    return result === receiver && receiver !== this ? this : result;
                };
            } else if (key === 'get' || key === 'has' || key === 'delete'
                || (!map && key === 'add')) {
                method = function (this: unknown, entry: unknown): unknown {
                    const receiver = canonical(this);
                    const result = (member as (this: unknown, entry: unknown) => unknown)
                        .call(receiver, canonical(entry));
                    return result === receiver && receiver !== this ? this : result;
                };
            } else if (key === 'forEach') {
                method = function (this: unknown, callback: unknown, thisArg?: unknown): unknown {
                    const receiver = canonical(this);
                    const forEach = member as (this: unknown, callback: unknown, thisArg?: unknown) => unknown;
                    if (typeof callback !== 'function') {
                        return forEach.call(receiver, callback, thisArg);
                    }
                    return forEach.call(receiver, (value: unknown, entry: unknown, raw: unknown): void => {
                        Function.prototype.call.call(callback, thisArg, value, entry,
                            raw === receiver && receiver !== this ? this : raw);
                    }, thisArg);
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
    liveViews.noteTarget(facade, value);
    return facade;
};

export const liveViews = {
    /** Adapts native Map/Set methods using the same canonical target registry as detachment. */
    adaptNativeCollection,
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
     * @param view - candidate engine view
     */
    readTarget: (view: object): object | undefined => {
        const known = knownViews.get(view);

        return typeof known === 'function' ? known() : known;
    },

    /** Whether `value` is a registered engine view rather than detached plain data. */
    has: (value: unknown): boolean => {
        return typeof value === 'object' && value !== null && knownViews.has(value);
    },
};
