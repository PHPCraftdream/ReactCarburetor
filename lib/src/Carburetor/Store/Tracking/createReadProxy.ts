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
 * Refuses a write. Shared by every write-forbidding trap — `set`, `defineProperty`,
 * `deleteProperty`, `setPrototypeOf` and `preventExtensions` all throw this same error, so one
 * function covers all five instead of a fresh closure per proxy per trap.
 */
const forbidWrite = (): never => {
    throw new Error(
        'Carburetor: data read through useCarburetor is read-only. ' +
        'Write through carburetor methods — they write via draft and know which paths changed.'
    );
};

/** The error a locked (frozen or sealed) property refuses wrapping with, named by its path. */
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
 * looks the descriptor up on every branch read so the refusal always fires; production pays
 * for the lookup only on a non-extensible source, where locked properties are plausible.
 *
 * @param source - the object the property lives on.
 * @param key - the property to check.
 * @param own - the descriptor already in hand, when the caller has one — `getOwnPropertyDescriptor`
 * does, and passing it here skips a second lookup.
 */
const lockedAgainstWrapping = (
    source: object,
    key: string | symbol,
    own?: PropertyDescriptor
): boolean => {
    const descriptor: PropertyDescriptor | undefined =
        own ?? (IS_DEVELOPMENT || !Object.isExtensible(source)
            ? Reflect.getOwnPropertyDescriptor(source, key)
            : undefined);

    return descriptor !== undefined && !descriptor.configurable && descriptor.writable === false;
};

/**
 * Read-proxy trap handler: one instance per proxy, but one set of trap functions for all of
 * them. Every branch gets a fresh `ReadProxyHandler` carrying its own `basePath`/`record`/
 * `aliases`/`cache`, while `get`/`has`/`ownKeys`/etc. live once on the prototype — a proxy
 * costs one small instance plus the `Proxy` itself, not a handler object and eight closures.
 *
 * Writing through any instance is forbidden — `set`, `deleteProperty` and `defineProperty`
 * all throw — and `getOwnPropertyDescriptor` wraps object values like `get` does, so no trap
 * hands out raw state. Structural changes are refused the same way at every level of the read
 * tree: `setPrototypeOf` and `preventExtensions` both throw, so neither a root view nor any
 * nested branch behind it can reshape the backing object. Introspection stays truthful: there
 * is no getPrototypeOf or isExtensible trap to answer them, so a view keeps reporting exactly
 * what the raw data is.
 *
 * Plain objects and arrays only: a Map, Date, Set or class instance passes through unwrapped,
 * so a mutating method called on one of those sits outside this guard.
 *
 * Frozen data is refused, not wrapped, because the engine accepts no proxy answer but the raw
 * value from a non-configurable, non-writable property. Development throws with the path
 * named; production hands out the raw branch, still recorded as a branch read — the same
 * degrade-and-mark policy the write proxy applies to Maps.
 *
 * Two contracts the recording relies on. Accessors run against the receiving proxy: `get`
 * forwards the trap's own `receiver` argument to `Reflect.get`, so a getter sees the proxy as
 * `this` and its internal reads (`get doubled() { return this.n * 2 }`) land in the recording
 * instead of silently reading the raw target. And the data is a tree, one object at one path:
 * a second path to a live object is reported in development through the alias ledger, which
 * production compiles out.
 */
class ReadProxyHandler<T extends object> implements ProxyHandler<T> {
    /**
     * Stores the branch identity this instance's traps answer for.
     *
     * @param basePath - the dotted path this instance's proxy answers for; the default '' is
     * the store root, and its emptiness is what makes `ownKeys` record the wildcard.
     * @param record - where each touched path is reported; a branch read reports the branch
     * marker, not every path inside it.
     * @param aliases - development-only: notes each branch object under its path so a second
     * path to the same object is reported; production hands in undefined.
     * @param cache - the branch-wrapper cache this proxy's whole tree shares.
     */
    constructor(
        private readonly basePath: TPath,
        private readonly record: TPathRecorder,
        private readonly aliases: TAliasLedger | undefined,
        private readonly cache: IProxyCache,
    ) {}

    /**
     * Records the read and wraps a trackable value read-only, or answers the introspection
     * hatch before any of that runs. Reaching into a branch subscribes to the branch marker
     * and, in development, notes it in the alias ledger; a leaf read subscribes to its own path.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being read.
     * @param receiver - the actual proxy the caller touched, forwarded to `Reflect.get` so an
     * accessor's own reads run against it and land in the recording too.
     */
    get(source: T, key: string | symbol, receiver: unknown): unknown {
        if (key === PROXY_CACHE) {
            return this.cache;
        }

        const value: unknown = Reflect.get(source, key, receiver);

        if (!isRecordable(source, key)) {
            // Inherited: found on the prototype chain, not this object's own. Nothing is
            // recorded, and nothing is wrapped either — wrapping an inherited iterator would
            // break the very protocol it exists to answer.
            return value;
        }

        if (typeof key === 'symbol') {
            // A symbol has no place in a dotted path: an own (or absent) symbol read is
            // recorded as the wildcard, so any future write anywhere invalidates it.
            this.record(WILDCARD_PATH);

            if (!isTrackable(value)) {
                return value;
            }

            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) {
                    throw lockedError(String(key));
                }

                return value;
            }

            return this.cache(
                WILDCARD_PATH,
                value,
                () => createReadProxy(value, this.record, WILDCARD_PATH, this.aliases, this.cache)
            );
        }

        const path = joinPath(this.basePath, key);

        if (isTrackable(value)) {
            // Reaching into a branch is traversal, not a read: subscribing to `items` here
            // would make every row depend on the whole list. Subscribe to the branch marker
            // instead, so a check that reads the branch itself (`!!data.user`) hears about
            // the branch being replaced without subscribing to leaves deep inside it.
            this.aliases?.note(value, path);
            this.record(branchPath(path));

            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) {
                    throw lockedError(path);
                }

                return value;
            }

            return this.cache(path, value, () => createReadProxy(value, this.record, path, this.aliases, this.cache));
        }

        this.record(path);

        return value;
    }

    /**
     * Records presence at branch-marker precision instead of the whole element `get` would
     * record, so a bare presence check does not subscribe to data it never read.
     *
     * `Array.prototype.map`/`forEach`/`filter`/`some`/`every`/`reduce` call this once per index
     * before reading it, so a coarse record here would subscribe every row to the whole list.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being probed.
     */
    has(source: T, key: string | symbol): boolean {
        const present = Reflect.has(source, key);

        // An inherited key ('map' in items) names no data of this object's own and records
        // nothing; an absent key still records, so a later own-key add wakes the reader. The
        // descriptor, not a get: a presence check must not run an accessor.
        if (typeof key === 'string' && isRecordable(source, key)) {
            const path = joinPath(this.basePath, key);
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            const value: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;

            this.record(isTrackable(value) ? branchPath(path) : path);
        }

        return present;
    }

    /**
     * Records a structural read: enumerating keys reads the shape as a whole, not any value.
     *
     * @param source - the raw object this proxy fronts.
     */
    ownKeys(source: T): ArrayLike<string | symbol> {
        this.record(this.basePath || WILDCARD_PATH);

        return Reflect.ownKeys(source);
    }

    /**
     * Wraps a trackable descriptor value like `get` does, so `Object.getOwnPropertyDescriptor`
     * cannot hand out a raw nested object as a second way around every trap.
     *
     * Records nothing: `Object.keys`/`for...in` pass through here for the enumeration check
     * alone, and a structure-only read must not subscribe to the values it merely looked at.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property whose descriptor is being read.
     */
    getOwnPropertyDescriptor(source: T, key: string | symbol): PropertyDescriptor | undefined {
        const descriptor: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(source, key);

        if (descriptor === undefined) {
            return descriptor;
        }

        if (typeof key === 'symbol') {
            // Same wildcard treatment as `get`: the descriptor route is a second way to reach
            // a symbol-keyed branch and must not hand out a raw, untracked value.
            this.record(WILDCARD_PATH);

            const symbolValue: unknown = descriptor.value;

            if (isTrackable(symbolValue)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (IS_DEVELOPMENT) {
                        throw lockedError(String(key));
                    }

                    return descriptor;
                }

                descriptor.value = this.cache(
                    WILDCARD_PATH,
                    symbolValue,
                    () => createReadProxy(symbolValue, this.record, WILDCARD_PATH, this.aliases, this.cache)
                );
            }

            return descriptor;
        }

        const path = joinPath(this.basePath, key);
        const value: unknown = descriptor.value;

        if (isTrackable(value)) {
            if (lockedAgainstWrapping(source, key, descriptor)) {
                if (IS_DEVELOPMENT) {
                    throw lockedError(path);
                }

                return descriptor;
            }

            descriptor.value = this.cache(
                path,
                value,
                () => createReadProxy(value, this.record, path, this.aliases, this.cache)
            );
        }

        return descriptor;
    }

    /**
     * Refuses a prototype change: a proxy answer here would reshape the backing object through
     * the view, and introspection stays truthful by never answering `getPrototypeOf` either.
     */
    setPrototypeOf(): never {
        return forbidWrite();
    }

    /** Refuses an extension change, exactly like `setPrototypeOf`. */
    preventExtensions(): never {
        return forbidWrite();
    }

    /** Refuses a direct write; draft is the only writable path into tracked data. */
    set(): never {
        return forbidWrite();
    }

    /** Refuses `Object.defineProperty`, which bypasses `set` entirely. */
    defineProperty(): never {
        return forbidWrite();
    }

    /** Refuses a delete; draft is the only writable path into tracked data. */
    deleteProperty(): never {
        return forbidWrite();
    }
}

/**
 * Builds a read proxy over `target`: every field access is recorded as a path, and writing,
 * defining or restructuring through it is refused. The root call mints its own cache; every
 * nested branch call receives the same one back, so one proxy tree caches as one unit.
 *
 * @param target - the raw state this proxy fronts, held by reference: nothing copies it, so
 * every trap answers from the object as it is now.
 * @param record - where each touched path is reported, supplied by read(); a branch read
 * reports the branch marker, not every path inside it.
 * @param basePath - the dotted path this root answers for; the default '' is the store root,
 * and its emptiness is what makes ownKeys record the wildcard.
 * @param aliases - development-only: notes each branch object under its path so a second
 * path to the same object is reported; production hands in undefined.
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit.
 */
export const createReadProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache
): T => {
    const cached: IProxyCache = cache ?? createProxyCache();
    const proxy = new Proxy(target, new ReadProxyHandler<T>(basePath, record, aliases, cached)) as T;

    // This proxy is a live view the escape diagnostic below walks selections for; the only
    // reader of the registry is development-only, so populating it is too.
    if (IS_DEVELOPMENT) {
        liveViews.note(proxy);
    }

    return proxy;
};
