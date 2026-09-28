import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {branchPath} from "@/Carburetor/Store/Paths/BranchMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {createProxyCache} from "./createProxyCache";
import {IProxyCache, PROXY_CACHE} from "./Models";
import {liveViews} from "./liveViews";
import {isTrackable} from "./isTrackable";

/**
 * Whether a key is worth recording at all: the object's own, or missing everywhere. A key
 * found only on the prototype chain — `items.map`, `items.constructor`, the inherited
 * `Symbol.iterator` every `for…of` and spread reads first — names no data of this object's
 * own, so recording it buys a subscription that no write ever satisfies. An absent key still
 * counts: nothing owns it yet, but a later own-key write must still wake a reader that probed
 * early.
 */
const isRecordable = (source: object, key: string | symbol): boolean =>
    Object.prototype.hasOwnProperty.call(source, key) || !(key in source);

/**
 * Read proxy: every field access is recorded as a path. Writing through it is forbidden —
 * `set`, `deleteProperty` and `defineProperty` all throw — and `getOwnPropertyDescriptor`
 * wraps object values like `get` does, so no trap hands out raw state.
 *
 * Structural changes are refused the same way, at every level of the read tree:
 * `setPrototypeOf` (prototype changes) and `preventExtensions` (extension changes) both
 * throw, so neither a root view nor any nested branch behind it can reshape the backing
 * object. Introspection stays truthful: no getPrototypeOf or isExtensible trap answers
 * them, so a view keeps reporting exactly what the raw data is.
 *
 * Plain objects and arrays only: a Map, Date, Set or class instance passes through unwrapped,
 * so a mutating method called on one of those sits outside this guard.
 *
 * Frozen data is refused, not wrapped. For a non-configurable, non-writable property the
 * engine accepts no proxy answer but the raw value — from `get` and `getOwnPropertyDescriptor`
 * alike — so nothing inside a frozen branch can be wrapped by spec, and handing out the raw
 * object would be the untracked, unguarded leak this view exists to prevent. Development
 * throws with the path named; production hands out the raw branch, still recorded as a branch
 * read, the same degrade-and-mark policy the write proxy applies to Maps.
 *
 * Two contracts the recording relies on. Accessors run against the proxy — it is handed to
 * `Reflect.get` as the receiver — so the reads a getter makes internally are tracked like any
 * other; a getter that returns a branch is an alias by another name and is not supported. And
 * the data is a tree, one object at one path: a second path to a live object is reported in
 * development through the alias ledger, which production compiles out.
 *
 * @param target - the raw state this proxy fronts, held by reference: nothing copies it, so
 * every trap answers from the object as it is now
 * @param record - where each touched path is reported, supplied by read(); a branch read
 * reports the branch marker, not every path inside it
 * @param basePath - the dotted path this root answers for; the default '' is the store root,
 * and its emptiness is what makes ownKeys record the wildcard
 * @param aliases - development-only: notes each branch object under its path so a second
 * path to the same object is reported; production hands in undefined
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit
 */
export const createReadProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache
): T => {
    const cached: IProxyCache = cache ?? createProxyCache();

    const forbidWrite = (): never => {
        throw new Error(
            'Carburetor: data read through useCarburetor is read-only. ' +
            'Write through carburetor methods — they write via draft and know which paths changed.'
        );
    };

    const lockedError = (path: TPath): Error =>
        new Error(
            'Carburetor: read-only tracking cannot wrap "' + path + '" — the property is ' +
            'non-configurable and non-writable (freeze or seal does this), and the engine ' +
            'accepts only the raw object there, which nothing would track or guard. ' +
            'Keep store data unfrozen; snapshot() is the detached form.'
        );

    /**
     * Whether the property leaves the proxy no legal answer but the raw value: for a
     * non-configurable, non-writable property the invariants reject a wrapped one. Development
     * looks the descriptor up on every branch read so the refusal always fires; production
     * pays for the lookup only on a non-extensible source, where locked properties are plausible.
     */
    const lockedAgainstWrapping = (
        source: T,
        key: string | symbol,
        own?: PropertyDescriptor
    ): boolean => {
        const descriptor: PropertyDescriptor | undefined =
            own ?? (IS_DEVELOPMENT || !Object.isExtensible(source)
                ? Reflect.getOwnPropertyDescriptor(source, key)
                : undefined);

        return descriptor !== undefined && !descriptor.configurable && descriptor.writable === false;
    };

    const proxy = new Proxy(target, {
        get: (source: T, key: string | symbol): unknown => {
            // The introspection hatch is answered before anything else: it must not count as
            // a read of the data, so nothing is recorded by asking for it.
            if (key === PROXY_CACHE) {
                return cached;
            }

            // The proxy itself is the receiver: a getter then sees the proxy as `this`, so its
            // internal reads (`get doubled() { return this.n * 2 }`) land in the recording
            // instead of silently reading the raw target.
            const value: unknown = Reflect.get(source, key, proxy);

            if (!isRecordable(source, key)) {
                // Inherited: found on the prototype chain, not this object's own. The value
                // is not this object's data — `Array.prototype.values` behind an inherited
                // `Symbol.iterator`, `map`/`constructor` behind a string key — so nothing is
                // recorded, and nothing is wrapped either: wrapping an inherited iterator
                // would break the very protocol it exists to answer.
                return value;
            }

            if (typeof key === 'symbol') {
                // A symbol has no place in a dotted path: an own (or absent) symbol read is
                // recorded as the wildcard, so any future write anywhere invalidates it, and
                // a trackable value is wrapped read-only just like a string-keyed branch is —
                // nothing hands out a raw, mutable object here either.
                record(WILDCARD_PATH);

                if (!isTrackable(value)) {
                    return value;
                }

                if (lockedAgainstWrapping(source, key)) {
                    if (IS_DEVELOPMENT) {
                        throw lockedError(String(key));
                    }

                    return value;
                }

                return cached(
                    WILDCARD_PATH,
                    value,
                    () => createReadProxy(value, record, WILDCARD_PATH, aliases, cached)
                );
            }

            const path = joinPath(basePath, key);

            if (isTrackable(value)) {
                // Reaching into a branch is traversal, not a read: subscribing to `items` here
                // would make every row depend on the whole list. We subscribe to the leaves
                // that were actually read and to structure enumeration — plus a branch marker,
                // so a check that reads the branch itself (`!!data.user`) hears about the
                // branch being replaced without subscribing to leaves deep inside it.
                aliases?.note(value, path);
                record(branchPath(path));

                if (lockedAgainstWrapping(source, key)) {
                    if (IS_DEVELOPMENT) {
                        throw lockedError(path);
                    }

                    return value;
                }

                return cached(path, value, () => createReadProxy(value, record, path, aliases, cached));
            }

            record(path);

            return value;
        },
        has: (source: T, key: string | symbol): boolean => {
            const present = Reflect.has(source, key);

            // `Array.prototype.map`/`forEach`/`filter`/`some`/`every`/`reduce` call this once
            // per index before reading it: presence already has a precise path, the branch
            // marker, so a trackable element records that, not the leaf `get` would record —
            // otherwise laying out rows would subscribe to every field of every row. An
            // inherited key (`'map' in items`) names no data of this object's own and records
            // nothing; an absent key still records, so a later own-key add wakes the reader.
            // The descriptor, not a get: a presence check must not run an accessor.
            if (typeof key === 'string' && isRecordable(source, key)) {
                const path = joinPath(basePath, key);
                const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
                const value: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;

                record(isTrackable(value) ? branchPath(path) : path);
            }

            return present;
        },
        ownKeys: (source: T): ArrayLike<string | symbol> => {
            // Enumerating keys reads the structure as a whole.
            record(basePath || WILDCARD_PATH);

            return Reflect.ownKeys(source);
        },
        // Object.getOwnPropertyDescriptor would otherwise hand out the raw nested object — a
        // second way around every trap. It wraps like `get` does but records nothing:
        // `Object.keys` and `for...in` pass through here for the enumeration check alone, and
        // a structure-only read must not subscribe to the values it merely looked at.
        getOwnPropertyDescriptor: (
            source: T,
            key: string | symbol
        ): PropertyDescriptor | undefined => {
            const descriptor: PropertyDescriptor | undefined =
                Reflect.getOwnPropertyDescriptor(source, key);

            if (descriptor === undefined) {
                return descriptor;
            }

            if (typeof key === 'symbol') {
                // Same wildcard treatment as `get`: the descriptor route is a second way
                // to reach a symbol-keyed branch and must not hand out a raw, untracked value.
                record(WILDCARD_PATH);

                const symbolValue: unknown = descriptor.value;

                if (isTrackable(symbolValue)) {
                    if (lockedAgainstWrapping(source, key, descriptor)) {
                        if (IS_DEVELOPMENT) {
                            throw lockedError(String(key));
                        }

                        return descriptor;
                    }

                    descriptor.value = cached(
                        WILDCARD_PATH,
                        symbolValue,
                        () => createReadProxy(symbolValue, record, WILDCARD_PATH, aliases, cached)
                    );
                }

                return descriptor;
            }

            const path = joinPath(basePath, key);
            const value: unknown = descriptor.value;

            if (isTrackable(value)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (IS_DEVELOPMENT) {
                        throw lockedError(path);
                    }

                    return descriptor;
                }

                descriptor.value = cached(
                    path,
                    value,
                    () => createReadProxy(value, record, path, aliases, cached)
                );
            }

            return descriptor;
        },
        // A prototype change or an extension change would reshape the backing object through
        // the view, so both are refused exactly like a write. Introspection stays truthful:
        // there is deliberately no getPrototypeOf or isExtensible trap to answer them.
        setPrototypeOf: forbidWrite,
        preventExtensions: forbidWrite,
        set: forbidWrite,
        // Object.defineProperty never reaches the set trap: without this the write would land
        // in the data untracked and unannounced.
        defineProperty: forbidWrite,
        deleteProperty: forbidWrite,
    }) as T;

    // This proxy is a live view the escape diagnostic below walks selections for; the only
    // reader of the registry is development-only, so populating it is too.
    if (IS_DEVELOPMENT) {
        liveViews.note(proxy);
    }

    return proxy;
};
