import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {branchPath} from "@/Carburetor/Store/Paths/BranchMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {createProxyCache} from "./createProxyCache";
import {liveViews} from "./liveViews";
import {isTrackable} from "./isTrackable";

/**
 * Read proxy: every field access is recorded as a path. Writing through it is forbidden —
 * `set`, `deleteProperty` and `defineProperty` all throw — and `getOwnPropertyDescriptor`
 * wraps object values like `get` does, so no trap hands out raw state.
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
 */
export const createReadProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger
): T => {
    const cached = createProxyCache();

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
            // The proxy itself is the receiver: a getter then sees the proxy as `this`, so its
            // internal reads (`get doubled() { return this.n * 2 }`) land in the recording
            // instead of silently reading the raw target.
            const value: unknown = Reflect.get(source, key, proxy);

            if (typeof key === 'symbol') {
                return value;
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

                return cached(path, value, () => createReadProxy(value, record, path, aliases));
            }

            record(path);

            return value;
        },
        has: (source: T, key: string | symbol): boolean => {
            if (typeof key === 'string') {
                record(joinPath(basePath, key));
            }

            return Reflect.has(source, key);
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

            if (descriptor === undefined || typeof key === 'symbol') {
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
                    () => createReadProxy(value, record, path, aliases)
                );
            }

            return descriptor;
        },
        set: forbidWrite,
        // Object.defineProperty never reaches the set trap: without this the write would land
        // in the data untracked and unannounced.
        defineProperty: forbidWrite,
        deleteProperty: forbidWrite,
    }) as T;

    // This proxy and every view reachable through it are live views: the child-prop snapshot
    // boundary checks this before handing data onward.
    liveViews.note(proxy);

    return proxy;
};
