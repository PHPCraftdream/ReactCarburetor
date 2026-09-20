import {TPath, TPathRecorder} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {isTrackable} from "./isTrackable";

/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 */
export const createReadProxy = <T extends object>(target: T, record: TPathRecorder, basePath: TPath = ''): T => {
    const cached = createProxyCache();

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
                return cached(path, value, () => createReadProxy(value, record, path));
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
