import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {IProxyCache, PROXY_CACHE} from "./Models";
import {isTrackable} from "./isTrackable";

/**
 * Write proxies by the raw object each wraps. A value read back through draft arrives
 * wrapped — array.sort writes the elements it read, and those read as proxies — so the
 * set trap unwraps it first: otherwise the wrap itself would count as a change, and a
 * proxy would end up living inside the plain data.
 */
const proxyTargets: WeakMap<object, object> = new WeakMap();

/** Unwraps a value written back through draft to the raw object a write proxy fronts. */
const unwrapWriteProxy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target: object | undefined = proxyTargets.get(value);

    return target ?? value;
};

/**
 * Write-proxy trap handler: one instance per proxy, but one set of trap functions for all of
 * them. Every branch gets a fresh `WriteProxyHandler` carrying its own `basePath`/`record`/
 * `aliases`/`cache`/`isArray`, while `get`/`set`/etc. live once on the prototype — a proxy
 * costs one small instance plus the `Proxy` itself, not a handler object and its own closures.
 *
 * Every changed branch is recorded as a path, so the carburetor only wakes the subscribers
 * that read it. Reads made elsewhere are consulted through the alias ledger, so writing into
 * an object that another path was read from is reported in development.
 *
 * A replaced or deleted branch's old wrapper needs no release here: the branch cache below
 * keys entries by the raw object they wrap, so a branch no longer reachable from the data
 * takes its cache entry with it once nothing else references it.
 *
 */
class WriteProxyHandler<T extends object> implements ProxyHandler<T> {
    /**
     * Stores the branch identity this instance's traps answer for.
     *
     * @param basePath - the dotted path this instance's proxy answers for, '' being the store
     * root. A symbol key, or a write already inside an opaque symbol-keyed branch, still
     * collapses onto the wildcard, but an index or `length` write on an array is named like any
     * other key.
     * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
     * `get` also reports unwrappable objects handed out raw, imprecise but never a lost update.
     * @param aliases - consulted on every write to complain when it lands in an object another
     * path was read from; undefined outside development.
     * @param cache - the branch-wrapper cache this proxy's whole tree shares.
     * @param isArray - whether the target is an array, so index and `length` writes get their
     * array-specific attribution.
     */
    constructor(
        private readonly basePath: TPath,
        private readonly record: TPathRecorder,
        private readonly aliases: TAliasLedger | undefined,
        private readonly cache: IProxyCache,
        private readonly isArray: boolean,
    ) {}

    /**
     * This instance's own memo of `key -> joinPath(basePath, key)`, built lazily on first use —
     * same rationale as the read proxy's memo of the same shape: a persistent draft-consuming
     * caller reads the same key through the same handler repeatedly.
     */
    private childPaths?: Map<string, TPath>;

    /**
     * The path a write to `key` is attributed to.
     *
     * A symbol has no place in a dotted path, so a write through one — or one already inside an
     * opaque symbol-keyed branch — collapses onto the wildcard; everything else is named like
     * an object's own key, index and `length` included, and memoized per key so a repeat write
     * to the same key does not concatenate the path again.
     *
     * @param key - the property being written.
     */
    private writtenPath(key: string | symbol): TPath {
        if (typeof key === 'symbol' || this.basePath === WILDCARD_PATH) {
            return WILDCARD_PATH;
        }

        const memo = this.childPaths ?? (this.childPaths = new Map<string, TPath>());
        let path = memo.get(key);

        if (path === undefined) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);
        }

        return path;
    }

    /**
     * The wrapper for (path, source): the cache's own entry on a hit, a fresh one filed on a
     * miss. Split from a single call taking a `create` thunk so a hit allocates no closure.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw branch object to wrap.
     */
    private wrap(path: TPath, source: object): object {
        const cached = this.cache.get(path, source);

        if (cached !== undefined) {
            return cached;
        }

        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache);

        this.cache.set(path, source, proxy);

        return proxy;
    }

    /**
     * Answers the introspection hatch, hands back a function unwrapped, wraps a trackable
     * value writable, or — for an unwrappable object like a Map — records the path it came
     * from, since a mutation reached through it would otherwise land invisibly.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being read.
     */
    get(source: T, key: string | symbol): unknown {
        if (key === PROXY_CACHE) {
            return this.cache;
        }

        const value: unknown = Reflect.get(source, key);

        if (typeof value === 'function') {
            return value;
        }

        if (isTrackable(value)) {
            return this.wrap(this.writtenPath(key), value);
        }

        // A Map, Set, Date or class instance cannot be wrapped, so `draft.index.set(...)`
        // mutates the real object behind the engine's back: no path is recorded here and
        // emitUpdate would conclude nothing changed unless this does it. Primitives are left
        // alone: they are copied, not mutated, and the path is never built for them at all —
        // a primitive read through draft records nothing, so building one would be pure waste.
        if (value !== null && typeof value === 'object') {
            this.record(this.writtenPath(key));
        }

        return value;
    }

    /**
     * Writes through to the raw object after the no-op and aliasing checks, attributing array
     * `length` shrinks and grows precisely.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being written.
     * @param value - the value being assigned, possibly a write proxy that needs unwrapping
     * first.
     */
    set(source: T, key: string | symbol, value: unknown): boolean {
        const previous: unknown = Reflect.get(source, key);
        const raw: unknown = unwrapWriteProxy(value);

        // A genuine no-op is an own key already holding the assigned value. The comparison is
        // SameValue (Object.is), not ===: +0 and -0 are distinct values, and NaN matches
        // itself. An absent key is never a no-op either — assigning even `undefined` must
        // create the own property, or `in`, enumeration and hasOwn would never see the write.
        if (Object.prototype.hasOwnProperty.call(source, key) && Object.is(previous, raw)) {
            return true;
        }

        // A branch replaced or deleted takes its old object's recorded path with it, and a
        // write into an object last read under a different path is the aliasing the ledger
        // exists to report.
        this.aliases?.checkWrite(source, this.basePath);
        this.aliases?.forget(previous);

        // A direct `length` write that shrinks the array truncates every index above the new
        // length without a deleteProperty per index — the one array write `set` alone cannot
        // attribute precisely. Each removed index is recorded on its own, so the row it held
        // wakes and unmounts; pop/shift/splice already delete their removed indices explicitly
        // and only ever shrink `length` to match afterwards, so this fires for them too,
        // redundantly but harmlessly — the paths are recorded already.
        if (this.isArray && key === 'length' && typeof raw === 'number' && typeof previous === 'number'
            && raw < previous) {
            for (let removed = raw; removed < previous; removed++) {
                this.record(joinPath(this.basePath, String(removed)));
            }
        }

        // An index write past the current end grows `length` as an intrinsic side effect of
        // the underlying array, before any explicit `Set(length, …)` call a method like `push`
        // makes afterwards — which then finds the value already there and is skipped above as
        // a no-op, recording nothing. Reading the length now, before this write lands, and
        // comparing it after is what still wakes a reader of `length`.
        const previousLength = this.isArray && typeof key === 'string' && key !== 'length'
            ? (source as unknown as {length: number}).length
            : undefined;

        const path = this.writtenPath(key);

        this.record(path);

        const wrote = Reflect.set(source, key, raw);

        if (previousLength !== undefined && (source as unknown as {length: number}).length !== previousLength) {
            this.record(this.writtenPath('length'));
        }

        return wrote;
    }

    /**
     * `Object.defineProperty` never reaches `set`, so without this trap the write would land
     * in the data and wake nobody.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being defined.
     * @param descriptor - the descriptor to install.
     */
    defineProperty(source: T, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        this.aliases?.checkWrite(source, this.basePath);
        this.aliases?.forget(Reflect.get(source, key));

        const path = this.writtenPath(key);

        this.record(path);

        return Reflect.defineProperty(source, key, descriptor);
    }

    /**
     * Deletes the key from the raw object after the aliasing checks, doing nothing when the
     * key was never there.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being deleted.
     */
    deleteProperty(source: T, key: string | symbol): boolean {
        if (!Reflect.has(source, key)) {
            return true;
        }

        this.aliases?.checkWrite(source, this.basePath);
        this.aliases?.forget(Reflect.get(source, key));

        const path = this.writtenPath(key);

        this.record(path);

        return Reflect.deleteProperty(source, key);
    }
}

/**
 * Builds a write proxy over `target`: every changed branch is recorded as a path. The root
 * call mints its own cache; every nested branch call receives the same one back, so one
 * proxy tree caches as one unit.
 *
 * @param target - the raw object the proxy fronts; it is filed in proxyTargets so a value
 * read back through draft is unwrapped before the write compares it.
 * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
 * the get trap also reports unwrappable objects handed out raw, imprecise but never a lost
 * update.
 * @param basePath - the dotted path this root answers for, '' being the store root; a symbol
 * key, or a write already inside an opaque symbol-keyed branch, still collapses onto the
 * wildcard, but an index or `length` write on an array is named like any other key.
 * @param aliases - consulted on every write to complain when it lands in an object another
 * path was read from; undefined outside development.
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit.
 */
export const createWriteProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache
): T => {
    const cached: IProxyCache = cache ?? createProxyCache();
    const handler = new WriteProxyHandler<T>(basePath, record, aliases, cached, Array.isArray(target));
    const proxy = new Proxy(target, handler);

    proxyTargets.set(proxy, target);

    return proxy as T;
};
