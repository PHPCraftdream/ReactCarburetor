import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {branchPath} from "@/Carburetor/Store/Paths/Markers/BranchMarker";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {createProxyCache} from "./Proxy/createProxyCache";
import {IProxyCache, KEYS_HATCH, PROXY_CACHE, RAW_TARGET, VIEW_PATH} from "./Models";
import {liveViews} from "./Proxy/liveViews";
import {isTrackable} from "./isTrackable";
import {recordNativeAliasReads} from "./Aliases/NativeAliasReads";
import {HandlerMemos} from './Proxy/Positional/HandlerMemos';
import {ArrayCallbackMethods} from './Proxy/Positional/ArrayCallbackMethods';

/**
 * Inherited values are never state branches: in particular `__proto__` must not wrap or
 * traverse Object.prototype. An array's inherited methods cannot be its own state indices,
 * but an ordinary object's inherited names can become own data, so reads of those names
 * record their precise path before returning the inherited value unchanged.
 *
 * @param source - the object the read proxy fronts.
 * @param key - the string key being read or probed.
 */
const isInherited = (source: object, key: string): boolean =>
    !Object.prototype.hasOwnProperty.call(source, key) && key in source;

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
    key: string,
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
 * Plain objects and arrays are wrapped read-only. Ordinary Map/Set instances use native
 * receiver facades; their raw members remain raw, while any member also reachable through a
 * plain own path subscribes to that path. Other native/class instances pass through raw.
 *
 * Frozen data is refused, not wrapped, because the engine accepts no proxy answer but the raw
 * value from a non-configurable, non-writable property. Development throws with the path
 * named; production hands out the raw branch, still recorded as a branch read — the same
 * degrade-and-mark policy the write proxy applies to Maps.
 *
 * The development ledger reports plain aliases; native-member alias dependencies are
 * independently recorded here in both development and production.
 */
class ReadProxyHandler<T extends object> implements ProxyHandler<T> {
    /**
     * Stores the branch identity this instance's traps answer for.
     *
     * @param path - the dotted path this instance's proxy answers for; the default '' is
     * the store root, where `ownKeys` records the bare key-set marker instead of one qualified
     * by a path.
     * @param record - where each touched path is reported; a branch read reports the branch
     * marker, not every path inside it.
     * @param aliases - development-only: notes each branch object under its path so a second
     * path to the same object is reported; production hands in undefined.
     * @param cache - the branch-wrapper cache this proxy's whole tree shares.
     * @param root - current plain store root, used to find ordinary paths to native raw members.
     */
    constructor(
        public readonly path: TPath,
        private readonly record: TPathRecorder,
        private readonly aliases: TAliasLedger | undefined,
        private readonly cache: IProxyCache,
        private readonly root: object,
    ) {}

    /** The wrapper this handler fronts; `createReadProxy` sets it once the `Proxy` exists. */
    public proxy: object | undefined = undefined;

    /** The branch's path memos; absent until this branch resolves its first path. */
    private memos: HandlerMemos | undefined = undefined;

    /** The memo size at which the memos are next audited against the source's live key count. */
    private memoLimit = 128;

    /** Lazily cached callback methods for this array view. */
    private arrayMethods: ArrayCallbackMethods | undefined = undefined;

    /**
     * Drops the memos once more than half of what they hold is no longer the source's own
     * keys (dead entries a rolling key window left behind); a pure string cache, so
     * clearing changes no answer.
     *
     * Checked only when a memo map crosses the doubling threshold, so the audit stays
     * amortized O(1) per memoized key.
     *
     * @param source - the raw object this proxy fronts.
     */
    private auditMemos(source: object): void {
        const memo = this.memos;

        if (memo === undefined) return;

        const childPaths = memo.childPaths;
        const size = (childPaths?.size ?? 0) + (memo.branchMarkers?.size ?? 0);

        if (size < this.memoLimit) return;

        // Deterministic insertion-order sample, capped at 128 keys: the first entries are the
        // oldest, exactly the ones a rolling key window kills first, so the sampled liveness
        // prices the whole memo without a full scan per audit.
        let live = 0;

        if (childPaths !== undefined && childPaths.size > 0) {
            const keys = childPaths.keys();
            const checked = Math.min(childPaths.size, 128);

            for (let index = 0; index < checked; index++) {
                const key: string = keys.next().value as string;

                if (Object.prototype.hasOwnProperty.call(source, key)) live++;
            }

            live = Math.max(1, Math.round((live / checked) * childPaths.size));
        }

        if (size > 2 * live) {
            memo.firstKey = undefined;
            memo.firstPath = '';
            memo.childPaths = undefined;
            memo.firstBranch = undefined;
            memo.firstMarker = '';
            memo.branchMarkers = undefined;
            this.memoLimit = 128;

            return;
        }

        this.memoLimit *= 2;
    }

    /**
     * `joinPath(path, key)`, memoized: a persistent view reads the same keys every render,
     * and a fresh string is re-hashed by every `Set`/index lookup downstream.
     *
     * One slot covers a branch read through a single key — a row's own tree mostly — without
     * allocating a Map; a Map appears only for a branch read through several keys.
     *
     * @param key - the own or absent string key being read.
     * @param source - the raw object this proxy fronts, for the memo bound.
     */
    private childPath(key: string, source: object): TPath {
        const memo = this.memos ?? (this.memos = new HandlerMemos());

        if (key === memo.firstKey) {
            return memo.firstPath;
        }

        if (memo.firstKey === undefined) {
            memo.firstKey = key;

            return (memo.firstPath = joinPath(this.path, key));
        }

        const childPaths = memo.childPaths ?? (memo.childPaths = new Map<string, TPath>());
        let path = childPaths.get(key);

        if (path === undefined) {
            path = joinPath(this.path, key);
            childPaths.set(key, path);

            if (childPaths.size >= this.memoLimit) this.auditMemos(source);
        }

        return path;
    }

    /**
     * `branchPath(path)`, memoized the same way as `childPath`.
     *
     * @param path - the branch's own path, already resolved through `childPath`.
     */
    private branchMarker(path: TPath): TPath {
        const memo = this.memos ?? (this.memos = new HandlerMemos());

        if (path === memo.firstBranch) {
            return memo.firstMarker;
        }

        if (memo.firstBranch === undefined) {
            memo.firstBranch = path;

            return (memo.firstMarker = branchPath(path));
        }

        const markers = memo.branchMarkers ?? (memo.branchMarkers = new Map<TPath, TPath>());
        let marker = markers.get(path);

        if (marker === undefined) {
            marker = branchPath(path);
            markers.set(path, marker);
        }

        return marker;
    }

    /**
     * `keysPath(path)`, memoized like `childPath`/`branchMarker`: `ownKeys` reads no other
     * path, so one computation per instance covers every call.
     */
    private keysMarker(): TPath {
        const memo = this.memos ?? (this.memos = new HandlerMemos());

        return memo.keysMarkerPath ?? (memo.keysMarkerPath = keysPath(this.path));
    }

    /**
     * The wrapper for (path, source): the cache's own entry on a hit, a fresh one filed on a
     * miss. Split from a single call taking a `create` thunk so a hit allocates no closure —
     * `createReadProxy` and its arguments are only built once `cache.get` has already missed.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw branch object to wrap.
     */
    private wrap(path: TPath, source: object): object {
        const cached = this.cache.get(path, source);

        // A miss self-registers: `createReadProxy` files this handler (which carries its own
        // path and wrapper) as the cache entry, saving the wrapper object per branch.
        return cached !== undefined
            ? cached
            : createReadProxy(source, this.record, path, this.aliases, this.cache, this.root);
    }

    /**
     * Records the read and wraps a trackable value read-only, or answers the introspection
     * hatch before any of that runs. Reaching into a branch subscribes to the branch marker
     * and, in development, notes it in the alias ledger; a leaf read subscribes to its own path.
     *
     * A symbol key has no place in plain state (R6-02/R6-03): nothing is recorded for reading
     * one there. Native Map/Set fields and methods keep their original raw members and receiver
     * semantics, but exposed plain aliases also subscribe to their ordinary writable paths.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being read.
     * @param receiver - the actual proxy the caller touched, forwarded to `Reflect.get` so an
     * accessor's own reads run against it and land in the recording too.
     */
    get(source: T, key: string | symbol, receiver: unknown): unknown {
        // One branch, not two: both hatches are symbols, so folding their checks inside the
        // `typeof` branch costs the overwhelmingly common string-keyed read only one comparison
        // instead of two.
        if (typeof key === 'symbol') {
            if (key === RAW_TARGET) {
                return source;
            }

            // The engine's internal keys hatch: the key-set read `Object.keys` would make,
            // without the descriptor trap per key whose wrapped branch is discarded.
            if (key === KEYS_HATCH) {
                this.record(this.keysMarker());

                return Object.keys(source);
            }

            if (key === VIEW_PATH) return this.path;
            return key === PROXY_CACHE ? this.cache : Reflect.get(source, key, receiver);
        }

        const value: unknown = Reflect.get(source, key, receiver);

        if (isInherited(source, key)) {
            // Only own state values may be wrapped. A plain-object inherited name can be
            // shadowed by an own data key, whereas array prototype methods stay untracked.
            if (!Array.isArray(source)) {
                this.record(this.childPath(key, source));
            } else if (ArrayCallbackMethods.supports(source, key, value)) {
                return (this.arrayMethods ?? (this.arrayMethods = new ArrayCallbackMethods()))
                    .get(source, key, this);
            }

            return value;
        }

        const path = this.childPath(key, source);

        if (isTrackable(value)) {
            // Reaching into a branch is traversal, not a read: subscribing to `items` here
            // would make every row depend on the whole list. Subscribe to the branch marker
            // instead, so a check that reads the branch itself (`!!data.user`) hears about
            // the branch being replaced without subscribing to leaves deep inside it.
            this.aliases?.note(value, path);
            this.record(this.branchMarker(path));

            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) {
                    throw lockedError(path);
                }

                return value;
            }

            return this.wrap(path, value);
        }

        this.record(path);
        if (value === null || typeof value !== 'object') return value;

        const prototype = Object.getPrototypeOf(value);
        if (prototype === Map.prototype || prototype === Set.prototype) {
            return liveViews.adaptReadNativeCollection(
                value, this.cache, source, key, this.root, this.record
            );
        }

        recordNativeAliasReads(this.root, value, this.record);
        return value;
    }

    /**
     * Records presence at branch-marker precision instead of the whole element `get` would
     * record, so a bare presence check does not subscribe to data it never read.
     *
     * `Array.prototype.map`/`forEach`/`filter`/`some`/`every`/`reduce` call this once per index
     * before reading it, so a coarse record here would subscribe every row to the whole list.
     *
     * Reads the value directly rather than through a descriptor: state has no accessors
     * (R6-02/R6-03) left to protect this from running.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being probed.
     */
    has(source: T, key: string | symbol): boolean {
        const present = Reflect.has(source, key);

        // An inherited plain-object name can become an own key. Record its precise path,
        // but never inspect/wrap its inherited value (notably Object.prototype via __proto__).
        // Inherited array methods still name no tracked array data.
        if (typeof key === 'string') {
            if (present && !Object.prototype.hasOwnProperty.call(source, key)) {
                if (!Array.isArray(source)) {
                    this.record(this.childPath(key, source));
                }

                return present;
            }

            const path = this.childPath(key, source);
            const value: unknown = Reflect.get(source, key);

            this.record(isTrackable(value) ? this.branchMarker(path) : path);
        }

        return present;
    }

    /**
     * Records a structural read: enumerating keys reads the key set, not any value under it.
     *
     * Subscribes to the key-set marker (R16-01), not the branch's own path — a value write below
     * an existing key must not wake an enumerator, only a key appearing, disappearing or the
     * branch itself being replaced (caught through the marker's ancestor, the branch path).
     *
     * @param source - the raw object this proxy fronts.
     */
    ownKeys(source: T): ArrayLike<string | symbol> {
        this.record(this.keysMarker());

        return Reflect.ownKeys(source);
    }

    /**
     * Wraps a trackable descriptor value like `get` does, so `Object.getOwnPropertyDescriptor`
     * cannot hand out a raw nested object as a second way around every trap.
     *
     * Records nothing: `Object.keys`/`for...in` pass through here for the enumeration check
     * alone, and a structure-only read must not subscribe to the values it merely looked at.
     *
     * A symbol key answers with its raw descriptor, untouched — same as `get` (R6-02/R6-03).
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property whose descriptor is being read.
     */
    getOwnPropertyDescriptor(source: T, key: string | symbol): PropertyDescriptor | undefined {
        const descriptor: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(source, key);

        if (descriptor === undefined || typeof key === 'symbol') {
            return descriptor;
        }

        // The path is not memoized here: `Object.keys`/`for...in` pass through for the
        // enumeration check and drop the wrapped value, so memoizing a key they touched is
        // pure retention — the next true read of the key recomputes the same string.
        const path = joinPath(this.path, key);
        const value: unknown = descriptor.value;

        if (isTrackable(value)) {
            if (lockedAgainstWrapping(source, key, descriptor)) {
                if (IS_DEVELOPMENT) {
                    throw lockedError(path);
                }

                return descriptor;
            }

            descriptor.value = this.wrap(path, value);
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
 * where `ownKeys` records the bare key-set marker instead of one qualified by a path.
 * @param aliases - development-only: notes each branch object under its path so a second
 * path to the same object is reported; production hands in undefined.
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit.
 * @param root - the original read tree root, passed unchanged to nested branches
 */
export const createReadProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache,
    root: object = target
): T => {
    const proxyCache: IProxyCache = cache ?? createProxyCache();
    const handler = new ReadProxyHandler<T>(basePath, record, aliases, proxyCache, root);
    const proxy = new Proxy(target, handler) as T;

    handler.proxy = proxy;

    // The handler doubles as its own cache entry — it carries `path` and `proxy` — so a
    // wrapped branch costs no separate `{path, proxy}` record. A cache without the internal
    // handle (a test double) is fed through its public `set`.
    const filer = (proxyCache as IProxyCache & {
        fileHandler?: (handler: ReadProxyHandler<T>, source: object) => void;
    }).fileHandler;

    if (filer !== undefined) {
        filer.call(proxyCache, handler, target);
    } else {
        proxyCache.set(basePath, target, proxy);
    }

    return proxy;
};
