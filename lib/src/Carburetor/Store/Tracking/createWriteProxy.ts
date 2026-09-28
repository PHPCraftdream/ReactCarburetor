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

const unwrapWriteProxy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const target: object | undefined = proxyTargets.get(value);

    return target ?? value;
};

/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it. Reads made elsewhere are consulted through the alias
 * ledger, so writing into an object that another path was read from is reported in development.
 *
 * A replaced or deleted branch's old wrapper needs no release here: the branch cache below
 * keys entries by the raw object they wrap, so a branch no longer reachable from the data
 * takes its cache entry with it once nothing else references it.
 *
 * @param target - the raw object the proxy fronts; it is filed in proxyTargets so a value
 * read back through draft is unwrapped before the write compares it
 * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
 * the get trap also reports unwrappable objects handed out raw, imprecise but never a lost
 * update
 * @param basePath - the dotted path this root answers for, '' being the store root; a symbol
 * key, or a write already inside an opaque symbol-keyed branch, still collapses onto the
 * wildcard, but an index or `length` write on an array is named like any other key
 * @param aliases - consulted on every write to complain when it lands in an object another
 * path was read from; undefined outside development
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit
 */
export const createWriteProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache
): T => {
    const cached: IProxyCache = cache ?? createProxyCache();
    const isArray: boolean = Array.isArray(target);

    const writtenPath = (key: string | symbol): TPath => {
        // A symbol has no place in a dotted path, so a write through one cannot be
        // attributed. Everything is treated as changed rather than the write lost.
        // The same holds once already inside an opaque symbol-keyed branch (basePath
        // is itself the wildcard): nothing below it can be named more precisely either.
        if (typeof key === 'symbol' || basePath === WILDCARD_PATH) {
            return WILDCARD_PATH;
        }

        // An index or `length` write on an array is named exactly like an object's own key:
        // `items[5] = …` wakes `items.5`'s own readers, not every row under `items`, and
        // `push` wakes whoever reads `items.length` without waking any existing row.
        return joinPath(basePath, key);
    };

    const proxy = new Proxy(target, {
        get: (source: T, key: string | symbol): unknown => {
            // The introspection hatch is answered before anything else: asking for it must
            // not reach the data, record a path, or touch the cache.
            if (key === PROXY_CACHE) {
                return cached;
            }

            const value: unknown = Reflect.get(source, key);

            if (typeof value === 'function') {
                return value;
            }

            // A symbol key has no dotted path, and once already inside an opaque
            // symbol-keyed branch (basePath already the wildcard) nothing below it can
            // be named more precisely either: every path from here on is the wildcard,
            // so a nested write anywhere under it still records and publishes.
            const path = typeof key === 'symbol' || basePath === WILDCARD_PATH
                ? WILDCARD_PATH
                : joinPath(basePath, key);

            if (isTrackable(value)) {
                return cached(path, value, () => createWriteProxy(value, record, path, aliases, cached));
            }

            // A Map, Set, Date or class instance cannot be wrapped, so `draft.index.set(...)`
            // mutates the real object behind the engine's back: no path is recorded and
            // emitUpdate concludes nothing changed. Handing out that reference is therefore
            // counted as writing the path it came from — imprecise, but never a lost update.
            // Primitives are left alone: they are copied, not mutated.
            if (value !== null && typeof value === 'object') {
                record(path);
            }

            return value;
        },
        set: (source: T, key: string | symbol, value: unknown): boolean => {
            const previous: unknown = Reflect.get(source, key);
            const raw: unknown = unwrapWriteProxy(value);

            // A genuine no-op is an own key already holding the assigned value. The
            // comparison is SameValue (Object.is), not ===: +0 and -0 are distinct values,
            // and NaN matches itself. An absent key is never a no-op either — assigning
            // even `undefined` must create the own property, or `in`, enumeration and
            // hasOwn would never see the write.
            if (Object.prototype.hasOwnProperty.call(source, key) && Object.is(previous, raw)) {
                return true;
            }

            // A branch replaced or deleted takes its old object's recorded path with it, and a
            // write into an object last read under a different path is the aliasing the ledger
            // exists to report.
            aliases?.checkWrite(source, basePath);
            aliases?.forget(previous);

            // A direct `length` write that shrinks the array truncates every index above the
            // new length without a deleteProperty per index — the one array write `set` alone
            // cannot attribute precisely. Each removed index is recorded on its own, so the
            // row it held wakes and unmounts; pop/shift/splice already delete their removed
            // indices explicitly and only ever shrink `length` to match afterwards, so this
            // fires for them too, redundantly but harmlessly — the paths are recorded already.
            if (isArray && key === 'length' && typeof raw === 'number' && typeof previous === 'number'
                && raw < previous) {
                for (let removed = raw; removed < previous; removed++) {
                    record(joinPath(basePath, String(removed)));
                }
            }

            // An index write past the current end grows `length` as an intrinsic side effect
            // of the underlying array, before any explicit `Set(length, …)` call a method like
            // `push` makes afterwards — which then finds the value already there and is
            // skipped above as a no-op, recording nothing. Reading the length now, before this
            // write lands, and comparing it after is what still wakes a reader of `length`.
            const previousLength = isArray && typeof key === 'string' && key !== 'length'
                ? (source as unknown as {length: number}).length
                : undefined;

            const path = writtenPath(key);

            record(path);

            const wrote = Reflect.set(source, key, raw);

            if (previousLength !== undefined && (source as unknown as {length: number}).length !== previousLength) {
                record(writtenPath('length'));
            }

            return wrote;
        },
        // Object.defineProperty never reaches the set trap, so without this the write
        // would land in the data and wake nobody.
        defineProperty: (source: T, key: string | symbol, descriptor: PropertyDescriptor): boolean => {
            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));

            const path = writtenPath(key);

            record(path);

            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source: T, key: string | symbol): boolean => {
            if (!Reflect.has(source, key)) {
                return true;
            }

            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));

            const path = writtenPath(key);

            record(path);

            return Reflect.deleteProperty(source, key);
        },
    });

    proxyTargets.set(proxy, target);

    return proxy as T;
};
