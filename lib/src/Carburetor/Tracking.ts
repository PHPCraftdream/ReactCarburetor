import {TPath, TPathRecorder} from "./Models";
import {joinPath, WILDCARD_PATH} from "./Paths";

/** Only plain objects and arrays are worth wrapping — everything else is passed through. */
export const isTrackable = (value: unknown): value is object => {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === Array.prototype || prototype === null;
};

interface IProxyCacheEntry {
    source: object;
    proxy: object;
}

/**
 * Cache of proxies for nested branches. It also stores the source object: if the value
 * behind a path has been replaced, the proxy over the old object is no longer valid
 * and gets recreated.
 */
const cachedProxy = (
    cache: Map<TPath, IProxyCacheEntry>,
    path: TPath,
    source: object,
    create: () => object
): object => {
    const entry = cache.get(path);

    if (entry && entry.source === source) {
        return entry.proxy;
    }

    const proxy = create();
    cache.set(path, {source, proxy});

    return proxy;
};

/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 */
export const createReadProxy = <T extends object>(target: T, record: TPathRecorder, basePath: TPath = ''): T => {
    const cache: Map<TPath, IProxyCacheEntry> = new Map<TPath, IProxyCacheEntry>();

    const forbidWrite = (): never => {
        throw new Error(
            'Carburetor: data read through useCarburetor is read-only. ' +
            'Write through carburetor methods — they write via draft and know which paths changed.'
        );
    };

    return new Proxy(target, {
        get: (source: T, key: string | symbol): unknown => {
            const value: unknown = Reflect.get(source, key);

            if (typeof key === 'symbol') {
                return value;
            }

            const path = joinPath(basePath, key);

            if (isTrackable(value)) {
                // Reaching into a branch is traversal, not a read: subscribing to `items` here
                // would make every row depend on the whole list. We subscribe to the leaves
                // that were actually read, and to structure enumeration.
                return cachedProxy(cache, path, value, () => createReadProxy(value, record, path));
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
        set: forbidWrite,
        deleteProperty: forbidWrite,
    }) as T;
};

/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it.
 */
export const createWriteProxy = <T extends object>(target: T, record: TPathRecorder, basePath: TPath = ''): T => {
    const cache: Map<TPath, IProxyCacheEntry> = new Map<TPath, IProxyCacheEntry>();
    const isArray: boolean = Array.isArray(target);

    // Writing an index or `length` changes the array as a whole, not one separate path.
    const writtenPath = (key: string): TPath => {
        return isArray ? (basePath || WILDCARD_PATH) : joinPath(basePath, key);
    };

    return new Proxy(target, {
        get: (source: T, key: string | symbol): unknown => {
            const value: unknown = Reflect.get(source, key);

            if (typeof key === 'symbol' || typeof value === 'function' || !isTrackable(value)) {
                return value;
            }

            const path = joinPath(basePath, key);

            return cachedProxy(cache, path, value, () => createWriteProxy(value, record, path));
        },
        set: (source: T, key: string | symbol, value: unknown): boolean => {
            if (typeof key === 'string') {
                // Writing the same value changes nothing and must wake nobody.
                if (Reflect.get(source, key) === value) {
                    return true;
                }

                record(writtenPath(key));
            }

            return Reflect.set(source, key, value);
        },
        deleteProperty: (source: T, key: string | symbol): boolean => {
            if (typeof key === 'string') {
                if (!Reflect.has(source, key)) {
                    return true;
                }

                record(writtenPath(key));
            }

            return Reflect.deleteProperty(source, key);
        },
    }) as T;
};
