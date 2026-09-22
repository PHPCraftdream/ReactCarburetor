import {TPath, TPathRecorder, TAliasLedger} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {branchPath} from "@/Carburetor/Store/Paths/BranchMarker";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {createProxyCache} from "./createProxyCache";
import {isTrackable} from "./isTrackable";

/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 *
 * Two contracts the recording relies on. Accessors run against the proxy — it is handed to
 * `Reflect.get` as the receiver — so the reads a getter makes internally are tracked like any
 * other; a getter that returns a branch is an alias by another name and is not supported. And
 * the data is a tree, one object at one path: a second path to a live object is reported in
 * development through the alias ledger, which production compiles out.
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
        set: forbidWrite,
        deleteProperty: forbidWrite,
    }) as T;

    return proxy;
};
