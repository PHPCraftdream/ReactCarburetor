import {TPath, TPathRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {isTrackable} from "./isTrackable";

/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it.
 */
export const createWriteProxy = <T extends object>(target: T, record: TPathRecorder, basePath: TPath = ''): T => {
    const cached = createProxyCache();
    const isArray: boolean = Array.isArray(target);

    const writtenPath = (key: string | symbol): TPath => {
        // A symbol has no place in a dotted path, so a write through one cannot be
        // attributed. Everything is treated as changed rather than the write lost.
        if (typeof key === 'symbol') {
            return WILDCARD_PATH;
        }

        // Writing an index or `length` changes the array as a whole, not one separate path.
        return isArray ? (basePath || WILDCARD_PATH) : joinPath(basePath, key);
    };

    return new Proxy(target, {
        get: (source: T, key: string | symbol): unknown => {
            const value: unknown = Reflect.get(source, key);

            if (typeof key === 'symbol' || typeof value === 'function') {
                return value;
            }

            const path = joinPath(basePath, key);

            if (isTrackable(value)) {
                return cached(path, value, () => createWriteProxy(value, record, path));
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
            // Writing the same value changes nothing and must wake nobody.
            if (Reflect.get(source, key) === value) {
                return true;
            }

            record(writtenPath(key));

            return Reflect.set(source, key, value);
        },
        // Object.defineProperty never reaches the set trap, so without this the write
        // would land in the data and wake nobody.
        defineProperty: (source: T, key: string | symbol, descriptor: PropertyDescriptor): boolean => {
            record(writtenPath(key));

            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source: T, key: string | symbol): boolean => {
            if (!Reflect.has(source, key)) {
                return true;
            }

            record(writtenPath(key));

            return Reflect.deleteProperty(source, key);
        },
    }) as T;
};
