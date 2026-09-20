import {TPath, TPathRecorder} from "../../Models/Paths";
import {joinPath} from "../Paths/joinPath";
import {WILDCARD_PATH} from "../Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {isTrackable} from "./isTrackable";

/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it.
 */
export const createWriteProxy = <T extends object>(target: T, record: TPathRecorder, basePath: TPath = ''): T => {
    const cached = createProxyCache();
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

            return cached(path, value, () => createWriteProxy(value, record, path));
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
