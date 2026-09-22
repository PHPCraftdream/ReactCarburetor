import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {isTrackable} from "./isTrackable";

/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it. Reads made elsewhere are consulted through the alias
 * ledger, so writing into an object that another path was read from is reported in development.
 */
export const createWriteProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger
): T => {
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
                return cached(path, value, () => createWriteProxy(value, record, path, aliases));
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

            // Writing the same value changes nothing and must wake nobody.
            if (previous === value) {
                return true;
            }

            // A branch replaced or deleted takes its old object's recorded path with it, and a
            // write into an object last read under a different path is the aliasing the ledger
            // exists to report.
            aliases?.checkWrite(source, basePath);
            aliases?.forget(previous);

            record(writtenPath(key));

            return Reflect.set(source, key, value);
        },
        // Object.defineProperty never reaches the set trap, so without this the write
        // would land in the data and wake nobody.
        defineProperty: (source: T, key: string | symbol, descriptor: PropertyDescriptor): boolean => {
            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));

            record(writtenPath(key));

            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source: T, key: string | symbol): boolean => {
            if (!Reflect.has(source, key)) {
                return true;
            }

            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));

            record(writtenPath(key));

            return Reflect.deleteProperty(source, key);
        },
    }) as T;
};
