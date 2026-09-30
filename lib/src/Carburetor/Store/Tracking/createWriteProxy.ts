import {
    PATCH_ARRAY_LENGTH_LOCK, PATCH_OPAQUE, TPath, TPathRecorder, TAliasLedger, TPatchPort,
    TPatchRecorder,
} from "@/Carburetor/Models/Paths";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {deepClone} from "@/Carburetor/Store/Utils/deepClone";
import {createProxyCache} from "./createProxyCache";
import {IProxyCache, PROXY_CACHE} from "./Models";
import {isTrackable} from "./isTrackable";
import {nativeAliasIndex} from "./Aliases/NativeAliasIndex";
import {liveViews} from "./liveViews";

/** A plain value safe to hand a patch listener: cloned so a later in-place write cannot alias it. */
const patchValue = (value: unknown): unknown => (isTrackable(value) ? deepClone(value) : value);

/** Refuses a symbol-keyed write: state is string-keyed data only (R6-02/R6-03). */
const forbidSymbolKey = (path: TPath): never => {
    throw new Error(
        'Carburetor: "' + (path || 'the root') + '" cannot take a symbol-keyed write — state is ' +
        'string-keyed data only. Use a string key.'
    );
};

/** Check the flags the native definition would leave behind, including new-key defaults. */
const isOpaqueDescriptor = (descriptor: PropertyDescriptor, existing?: PropertyDescriptor): boolean =>
    'get' in descriptor || 'set' in descriptor
    || (descriptor.configurable ?? existing?.configurable) !== true
    || (descriptor.writable ?? existing?.writable) !== true
    || (descriptor.enumerable ?? existing?.enumerable) !== true;

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
     * root; an index or `length` write on an array is named like any other key.
     * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
     * `get` also reports unwrappable objects handed out raw, imprecise but never a lost update.
     * @param aliases - consulted on every write to complain when it lands in an object another
     * path was read from, and to validate the state model (R6-02/R6-03); undefined outside
     * development, so both are no-ops in production.
     * @param cache - the branch-wrapper cache this proxy's whole tree shares.
     * @param isArray - whether the target is an array, so index and `length` writes get their
     * array-specific attribution.
     * @param patchPort - where this proxy's whole tree finds the currently attached patch
     * listener, if any (R16-07); shared by every branch so attaching one needs no rebuild.
     * @param basePathSegments - `basePath`'s own keys, unescaped; built once per branch (on a
     * cache miss in `wrap`) and only read when a patch is actually being reported.
     */
    constructor(
        private readonly basePath: TPath,
        private readonly record: TPathRecorder,
        private readonly aliases: TAliasLedger | undefined,
        private readonly cache: IProxyCache,
        private readonly isArray: boolean,
        private readonly patchPort: TPatchPort | undefined,
        private readonly basePathSegments: readonly string[],
    ) {}

    /**
     * This instance's own memo of `key -> joinPath(basePath, key)`, built lazily on first use —
     * same rationale as the read proxy's memo of the same shape: a persistent draft-consuming
     * caller reads the same key through the same handler repeatedly.
     */
    private childPaths?: Map<string, TPath>;

    /** `keysPath(basePath)`, memoized: this instance's own key-set marker never changes. */
    private keysMarkerPath?: TPath;

    /**
     * This instance's own key-set marker (R16-01): a key appearing, disappearing, or an array
     * truncation removing indices wakes a reader that enumerated this container.
     *
     * A reader of some untouched leaf under it is not woken.
     */
    private keysMarker(): TPath {
        return this.keysMarkerPath ?? (this.keysMarkerPath = keysPath(this.basePath));
    }

    /**
     * `joinPath(basePath, key)`, memoized: every key is named exactly like any other, index and
     * `length` included; a repeat write to the same key does not concatenate the path again.
     *
     * @param key - the property being written.
     */
    private writtenPath(key: string): TPath {
        const memo = this.childPaths ?? (this.childPaths = new Map<string, TPath>());
        let path = memo.get(key);

        if (path === undefined) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);
        }

        return path;
    }

    /**
     * Builds and delivers one patch for `key`, deep-cloning `previous`/`next` first (R16-07).
     *
     * @param listener - the patch listener to deliver to; only read from `patchPort` once by
     * each caller, so this takes it directly instead of re-reading the port.
     * @param key - the property this patch describes; appended to `basePathSegments`.
     * @param previous - the actual value before the write.
     * @param next - the actual value after the write.
     * @param previousExists - whether the key was own before the write.
     * @param nextExists - whether the key is own after the write.
     */
    private reportPatch(
        listener: TPatchRecorder,
        key: string,
        previous: unknown,
        next: unknown,
        previousExists: boolean, nextExists: boolean
    ): void {
        if (this.patchPort?.opaque) {
            listener(PATCH_OPAQUE);

            return;
        }

        listener({
            segments: [...this.basePathSegments, key],
            previousExists, previous: patchValue(previous),
            nextExists, next: patchValue(next),
        });
    }

    /** The cached wrapper for (path, source), allocating child segments only on a miss.
     *
     * @param path - the full path the branch was read at.
     * @param key - the property `path` was reached through, appended to this branch's own
     * segments to build the child's.
     * @param source - the raw branch object to wrap.
     */
    private wrap(path: TPath, key: string, source: object): object {
        const cached = this.cache.get(path, source);

        if (cached !== undefined) {
            return cached;
        }

        const segments = [...this.basePathSegments, key];
        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache, this.patchPort, segments);

        this.cache.set(path, source, proxy);

        return proxy;
    }

    /** Applies native array-length semantics, then attributes only the changes that landed.
     *
     * @param source - raw array
     * @param value - requested length
     * @param descriptor - defineProperty descriptor, when present
     */
    private setArrayLength(source: T, value: unknown, descriptor?: PropertyDescriptor): boolean {
        const validNumber = typeof value === 'number' && Number.isInteger(value)
            && value >= 0 && value <= 0xFFFFFFFF;

        // [[Set]] rejects a non-writable own property before ArraySetLength sees the value.
        if (!descriptor && !validNumber && Object.getOwnPropertyDescriptor(source, 'length')?.writable === false) {
            return Reflect.set(source, 'length', value);
        }

        // ArraySetLength performs both conversions, in this order. The second can run user
        // code again; the normalized number avoids a third conversion in the raw write.
        const uint32 = validNumber ? value as number : (value as number) >>> 0;

        if (!validNumber && uint32 !== +(value as number)) {
            throw new RangeError('Invalid array length');
        }

        const array = source as unknown as unknown[];
        const previousLength = array.length;
        const previousWritable = Object.getOwnPropertyDescriptor(source, 'length')!.writable!;
        const listener = this.patchPort?.listener;
        const concrete = listener && !this.patchPort?.opaque ? listener : undefined;
        let removed: Array<number | string> | undefined;
        let removedValues: unknown[] | undefined;
        let removedAny = false;
        let denseStart: number | undefined;

        if (uint32 < previousLength) {
            const range = previousLength - uint32;

            if (!concrete && range >= 64 && range <= 4096) {
                const ownKeys = Object.keys(array);

                if (ownKeys.length === previousLength && ownKeys[previousLength - 1] === String(previousLength - 1)) {
                    denseStart = uint32;
                }
            }

            if (denseStart === undefined) {
                removed = [];
                if (concrete) {
                    removedValues = [];
                }

                if (range <= 4096) {
                    for (let index = uint32; index < previousLength; index++) {
                        if (Object.prototype.hasOwnProperty.call(array, index)) {
                            removed.push(index);
                            removedValues?.push(array[index]);
                        }
                    }
                } else {
                    for (const key of Object.keys(array)) {
                        const index = Number(key);

                        if (Number.isInteger(index) && index >= uint32 && index < previousLength
                            && String(index) === key) {
                            removed.push(key);
                            removedValues?.push(array[index]);
                        }
                    }
                }
            }
        }

        const wrote = descriptor
            ? Reflect.defineProperty(source, 'length', 'value' in descriptor
                ? {...descriptor, value: uint32} : descriptor)
            : Reflect.set(source, 'length', uint32);
        const nextLength = array.length;
        const writableChanged = Object.getOwnPropertyDescriptor(source, 'length')!.writable !== previousWritable;

        if (denseStart !== undefined) {
            for (let index = denseStart; index < previousLength; index++) {
                if (wrote || !Object.prototype.hasOwnProperty.call(array, index)) {
                    removedAny = true;
                    this.record(joinPath(this.basePath, String(index)));
                }
            }
        }

        if (removed) {
            for (let i = 0; i < removed.length; i++) {
                const entry = removed[i];

                if (!wrote && Object.prototype.hasOwnProperty.call(array, entry)) {
                    continue;
                }

                removedAny = true;
                const key = String(entry);
                this.record(joinPath(this.basePath, key));

                if (concrete) {
                    this.reportPatch(concrete, key, removedValues?.[i], undefined, true, false);
                }
            }
        }

        if (removedAny) {
            this.aliases?.checkWrite(source, this.basePath);
            this.record(this.keysMarker());
        }

        if (nextLength !== previousLength || writableChanged) {
            this.aliases?.checkWrite(source, this.basePath);
            this.record(this.writtenPath('length'));

            if (concrete && nextLength !== previousLength) {
                this.reportPatch(concrete, 'length', previousLength, nextLength, true, true);
            }
        }
        if (writableChanged) {
            listener?.(PATCH_ARRAY_LENGTH_LOCK);
        } else if (listener && !concrete && (removedAny || nextLength !== previousLength)) {
            listener(PATCH_OPAQUE);
        }
        return wrote;
    }

    /**
     * Answers the introspection hatch, hands back a function unwrapped, wraps a trackable
     * value writable, or — for an unwrappable object like a Map — records the path it came
     * from, since a mutation reached through it would otherwise land invisibly.
     *
     * A symbol key has no place in state (R6-02/R6-03): its value passes through raw, wrapped
     * or recorded by nothing, the same way a function does.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being read.
     */
    get(source: T, key: string | symbol): unknown {
        // One branch, not two: PROXY_CACHE is itself a symbol, so folding its check inside the
        // `typeof` branch costs the overwhelmingly common string-keyed read only one comparison
        // instead of two.
        if (typeof key === 'symbol') {
            return key === PROXY_CACHE ? this.cache : Reflect.get(source, key);
        }

        const value: unknown = Reflect.get(source, key);

        if (typeof value === 'function') {
            return value;
        }

        if (isTrackable(value)) {
            return this.wrap(this.writtenPath(key), key, value);
        }

        // Map/Set can adapt their native methods but cannot be tracked as plain branches;
        // Date and class instances still pass through raw. Access to any of them must
        // conservatively publish the owner path, since subsequent in-place mutation would
        // otherwise be invisible. Primitive reads build no path.
        if (value !== null && typeof value === 'object') {
            // Whatever changes inside it, if anything, cannot be described as a patch: a
            // history attached to this store falls back to a full snapshot for this change.
            this.patchPort?.listener?.(PATCH_OPAQUE);
            if (this.cache.nativeAliasRoot !== undefined) {
                nativeAliasIndex.invalidate(this.cache.nativeAliasRoot);
            }
            this.record(this.writtenPath(key));
            return liveViews.adaptNativeCollection(value, this.cache, source, key);
        }

        return value;
    }

    /**
     * Writes through to the raw object after the no-op and aliasing checks, attributing array
     * `length` shrinks and grows precisely.
     *
     * A symbol key is refused outright (R6-02/R6-03): state is string-keyed data only. In
     * development, the key and the assigned subtree are also checked against the state model
     * before anything is recorded or forgotten, so a rejected write leaves no partial trace.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being written.
     * @param value - the value being assigned, possibly a write proxy that needs unwrapping
     * first.
     */
    set(source: T, key: string | symbol, value: unknown): boolean {
        if (typeof key === 'symbol') {
            return forbidSymbolKey(this.basePath);
        }

        const previous: unknown = Reflect.get(source, key);
        const raw: unknown = value !== null && typeof value === 'object'
            ? (liveViews.readTarget(value) ?? value) : value;
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);

        if (this.isArray && key === 'length') {
            return this.setArrayLength(source, raw);
        }

        // A genuine no-op is an own key already holding the assigned value. The comparison is
        // SameValue (Object.is), not ===: +0 and -0 are distinct values, and NaN matches
        // itself. An absent key is never a no-op either — assigning even `undefined` must
        // create the own property, or `in`, enumeration and hasOwn would never see the write.
        if (wasOwn && Object.is(previous, raw)) {
            return true;
        }

        const path = this.writtenPath(key);

        this.aliases?.checkKey(source, key, path);
        this.aliases?.checkState(raw, path, wasOwn ? previous : undefined);
        this.aliases?.checkWrite(source, this.basePath);

        // Define the literal data key without invoking an inherited setter. A refused write
        // must not forget aliases, announce a path or put a phantom value into history.
        const protoWrite = key === '__proto__';
        const previousLength = this.isArray && key !== 'length'
            ? (source as unknown as {length: number}).length
            : undefined;
        const wrote = protoWrite
            ? Reflect.defineProperty(source, key, {
                value: raw, writable: true, enumerable: true, configurable: true,
            })
            : Reflect.set(source, key, raw);
        if (!wrote) {
            return false;
        }

        // A branch replaced or deleted takes its old object's recorded path with it, and a
        // write into an object last read under a different path is the aliasing the ledger
        // exists to report.
        this.aliases?.forget(previous);

        const listener = this.patchPort?.listener;

        // A key that did not already exist changes the key set itself (R16-01): an index write
        // past the array's own end is exactly such a case, alongside an ordinary new object key.
        if (!wasOwn) {
            this.record(this.keysMarker());
        }

        // Replacing a plain object/array with another of the same kind (R16-03): announce
        // only changed leaves. New keys, kind changes and primitives report the whole path.
        if (wasOwn && isTrackable(previous) && isTrackable(raw) && Array.isArray(previous) === Array.isArray(raw)) {
            const concrete = listener && !this.patchPort?.opaque ? listener : undefined;
            const segments = concrete ? [...this.basePathSegments, key] : [];
            const changed = diffPaths(previous, raw, path, segments, concrete);

            if (listener && !concrete && changed.size > 0) {
                listener(PATCH_OPAQUE);
            }
            changed.forEach((written: TPath) => this.record(written));
        } else {
            if (listener) {
                this.reportPatch(listener, key, wasOwn ? previous : undefined, raw, wasOwn, true);
            }

            this.record(path);
        }

        if (previousLength !== undefined && (source as unknown as {length: number}).length !== previousLength) {
            const newLength = (source as unknown as {length: number}).length;

            if (listener) {
                this.reportPatch(listener, 'length', previousLength, newLength, true, true);
            }

            this.record(this.writtenPath('length'));
        }

        return true;
    }

    /** Attributes effective data definitions, including implicit array growth.
     * Symbols and non-plain descriptors are refused before the native definition.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being defined.
     * @param descriptor - the descriptor to install.
     */
    defineProperty(source: T, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        if (typeof key === 'symbol') {
            return forbidSymbolKey(this.basePath);
        }

        if (this.isArray && key === 'length') {
            return 'value' in descriptor
                ? this.setArrayLength(source, descriptor.value, descriptor)
                : this.setArrayLength(
                    source, (source as unknown as unknown[]).length, descriptor
                );
        }

        // A fully-open definition needs no descriptor lookup; omitted flags inherit from the
        // existing property, or default to false when the key is new.
        const fullyOpen = descriptor.configurable === true
            && descriptor.writable === true && descriptor.enumerable === true;
        const existing = fullyOpen ? undefined : Object.getOwnPropertyDescriptor(source, key);
        const wasOwn = fullyOpen ? Object.prototype.hasOwnProperty.call(source, key) : existing !== undefined;

        if (isOpaqueDescriptor(descriptor, existing)) {
            throw new Error(
                'Carburetor: "' + joinPath(this.basePath, key) + '" cannot take a non-plain-data ' +
                'descriptor — state properties are writable, configurable, enumerable data, no ' +
                'accessors. Derive a computed value instead, e.g. with Computed.'
            );
        }

        const previous = Reflect.get(source, key);
        const raw = 'value' in descriptor && descriptor.value !== null
            && typeof descriptor.value === 'object'
            ? (liveViews.readTarget(descriptor.value) ?? descriptor.value)
            : 'value' in descriptor ? descriptor.value : wasOwn ? previous : undefined;
        const path = this.writtenPath(key);

        this.aliases?.checkKey(source, key, path);
        this.aliases?.checkState(raw, path, wasOwn ? previous : undefined);
        this.aliases?.checkWrite(source, this.basePath);

        const effective = 'value' in descriptor ? {...descriptor, value: raw} : descriptor;
        const previousLength = this.isArray ? (source as unknown as unknown[]).length : undefined;
        const wrote = Reflect.defineProperty(source, key, effective);
        if (!wrote) {
            return false;
        }

        if (wasOwn && Object.is(previous, raw)) {
            return true;
        }

        this.aliases?.forget(previous);

        if (!wasOwn) {
            this.record(this.keysMarker());
        }

        const listener = this.patchPort?.listener;

        if (listener) {
            this.reportPatch(listener, key, wasOwn ? previous : undefined, raw, wasOwn, true);
        }

        this.record(path);

        if (previousLength !== undefined && (source as unknown as unknown[]).length !== previousLength) {
            const nextLength = (source as unknown as unknown[]).length;
            if (listener) {
                this.reportPatch(listener, 'length', previousLength, nextLength, true, true);
            }
            this.record(this.writtenPath('length'));
        }

        return true;
    }

    /**
     * Deletes the key from the raw object after the aliasing checks, doing nothing when the
     * key was never there. Removing an own key wakes an enumerator of this container (R16-01),
     * same as it wakes a direct reader of the deleted path.
     *
     * A symbol key that is present is refused, same as `set`/`defineProperty` — an absent one is
     * already a no-op above, whatever its type.
     *
     * @param source - the raw object this proxy fronts.
     * @param key - the property being deleted.
     */
    deleteProperty(source: T, key: string | symbol): boolean {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            return true;
        }

        if (typeof key === 'symbol') {
            return forbidSymbolKey(this.basePath);
        }

        const previous = Reflect.get(source, key);

        this.aliases?.checkWrite(source, this.basePath);
        if (!Reflect.deleteProperty(source, key)) {
            return false;
        }

        this.aliases?.forget(previous);
        this.record(this.keysMarker());

        const path = this.writtenPath(key);
        const listener = this.patchPort?.listener;

        if (listener) {
            this.reportPatch(listener, key, previous, undefined, true, false);
        }

        this.record(path);

        return true;
    }
}

/**
 * Builds a path-recording write proxy with one shared branch cache.
 *
 * @param target - raw state, filed for unwrapping values read back through draft
 * @param record - write-path sink; unwrappable leaves invalidate their owner
 * @param basePath - escaped dotted path, empty at the root
 * @param aliases - development alias and state-model validation
 * @param cache - shared branch-wrapper cache, created by the root call
 * @param patchPort - shared current listener and opaque recording mode
 * @param basePathSegments - unescaped path keys, empty at the root
 */
export const createWriteProxy = <T extends object>(
    target: T,
    record: TPathRecorder,
    basePath: TPath = '',
    aliases?: TAliasLedger,
    cache?: IProxyCache,
    patchPort?: TPatchPort,
    basePathSegments: readonly string[] = [],
): T => {
    const cached: IProxyCache = cache ?? createProxyCache(target);
    const handler = new WriteProxyHandler<T>(
        basePath, record, aliases, cached, Array.isArray(target), patchPort, basePathSegments
    );
    const proxy = new Proxy(target, handler);

    liveViews.noteTarget(proxy, target);

    return proxy as T;
};
