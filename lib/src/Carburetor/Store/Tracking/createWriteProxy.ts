import {
    PATCH_KEY_ORDER_CHANGE, PATCH_OPAQUE, RAW_EXPOSURE, TPath, TAliasLedger, TPatchRecorder,
    TPatchPort, TWriteRecorder,
} from "@/Carburetor/Models/Paths";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {keyDeletionRequiresReplay} from "@/Carburetor/Store/Paths/Diff/Order/keyDeletionRequiresReplay";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {branchPath} from "@/Carburetor/Store/Paths/Markers/BranchMarker";
import {clonePatchValue} from "./Proxy/clonePatchValue";
import {createProxyCache} from "./Proxy/createProxyCache";
import {IProxyCache, PROXY_CACHE, RAW_TARGET} from "./Models";
import {isTrackable} from "./isTrackable";
import {isOpaqueDescriptor} from "./Proxy/isOpaqueDescriptor";
import {forbidSymbolKey} from "./Proxy/forbidSymbolKey";
import {nativeAliasIndex} from "./Aliases/NativeAliasIndex";
import {liveViews} from "./Proxy/liveViews";
import {runPositional} from "./Proxy/Positional/positionalArrayMethods";
import {writeArrayLength} from "./Proxy/Positional/writeArrayLength";
import {deliverPatches} from "./Proxy/deliverPatches";

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
/**
 * The reordering/positional array methods the write proxy intercepts on draft arrays: run
 * natively on the raw array, then attributed as index-level writes, so one `splice` records
 * one path per changed index instead of a field diff per shifted element.
 */
const POSITIONAL_METHODS = new Set<string>([
    'sort', 'reverse', 'splice', 'shift', 'unshift', 'copyWithin', 'fill',
]);

class WriteProxyHandler<T extends object> implements ProxyHandler<T> {
    /**
     * Stores the branch identity this instance's traps answer for.
     *
     * @param basePath - the dotted path this instance's proxy answers for, '' being the store
     * root; an index or `length` write on an array is named like any other key.
     * @param record - the store's write sink, feeding the paths the next emitUpdate announces
     * together with the raw object each mutation landed on; `get` also reports unwrappable
     * objects handed out raw, imprecise but never a lost update.
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
        private readonly record: TWriteRecorder,
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

    /** The memo size at which the memos are next audited against the source's live key count. */
    private memoLimit = 128;

    /** One intercepted positional-method dispatcher per method name, built on first read. */
    private positionalMethods?: Map<string, (...args: unknown[]) => unknown>;

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
     * Drops the key-path memo once more than half of it names keys the source no longer owns
     * (a rolling key window's dead entries); a pure string cache, so clearing changes no
     * answer. Checked only when the memo crosses the doubling threshold, amortized O(1).
     *
     * @param source - the raw object this proxy fronts.
     */
    private auditMemos(source: object): void {
        const memo = this.childPaths;

        if (memo === undefined || memo.size === 0) return;

        const keys = memo.keys();
        const checked = Math.min(memo.size, 128);
        let live = 0;

        for (let index = 0; index < checked; index++) {
            const key: string = keys.next().value as string;

            if (Object.prototype.hasOwnProperty.call(source, key)) live++;
        }

        if (memo.size > 2 * Math.max(1, Math.round((live / checked) * memo.size))) {
            memo.clear();
            this.memoLimit = 128;

            return;
        }

        this.memoLimit *= 2;
    }

    /**
     * `joinPath(basePath, key)`, memoized: every key is named exactly like any other, index and
     * `length` included; a repeat write to the same key does not concatenate the path again.
     *
     * @param key - the property being written.
     * @param source - the raw object this proxy fronts, for the memo bound.
     */
    private writtenPath(key: string, source?: object): TPath {
        const memo = this.childPaths ?? (this.childPaths = new Map<string, TPath>());
        let path = memo.get(key);

        if (path === undefined) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);

            if (source !== undefined && memo.size >= this.memoLimit) this.auditMemos(source);
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
            previousExists, previous: clonePatchValue(previous),
            nextExists, next: clonePatchValue(next),
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

    /** Performs a native array-length write, recording any effective partial truncation.
     *
     * @param source - the raw array.
     * @param value - requested length.
     * @param descriptor - optional native definition.
     */
    private setArrayLength(source: T, value: unknown, descriptor?: PropertyDescriptor): boolean {
        return writeArrayLength(
            source as unknown as unknown[], value, descriptor, this.basePath,
            this.basePathSegments, this.record, this.aliases, this.patchPort
        );
    }

    /** Builds or returns the memoized dispatcher for one intercepted positional method.
     *
     * @param key - the intercepted method name.
     * @param source - the raw array the method runs on.
     */
    private positional(key: string, source: object): (...args: unknown[]) => unknown {
        let fn = this.positionalMethods?.get(key);

        if (fn === undefined) {
            const host = this as unknown as Parameters<typeof runPositional>[0];

            fn = function (this: unknown, ...args: unknown[]): unknown {
                return runPositional(host, key, this, source as unknown[], args);
            };
            (this.positionalMethods ?? (this.positionalMethods = new Map())).set(key, fn);
        }

        return fn;
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
        // One branch, not two: both hatches are symbols, so folding their checks inside the
        // `typeof` branch costs the overwhelmingly common string-keyed read only one comparison
        // instead of two.
        if (typeof key === 'symbol') {
            if (key === RAW_TARGET) {
                return source;
            }

            return key === PROXY_CACHE ? this.cache : Reflect.get(source, key);
        }

        const value: unknown = Reflect.get(source, key);

        if (typeof value === 'function') {
            // Native positional methods run on the raw array and are attributed at index
            // level, instead of field-diffing every shifted element through the set trap.
            // Own overrides and subclass methods keep running through the proxy, unchanged.
            if (this.isArray && POSITIONAL_METHODS.has(key as string)
                && (value as unknown)
                    === (Array.prototype as unknown as Record<string, unknown>)[key as string]) {
                return this.positional(key as string, source);
            }

            return value;
        }

        if (isTrackable(value)) {
            return this.wrap(this.writtenPath(key, source), key, value);
        }

        // Map/Set can adapt their native methods but cannot be tracked as plain branches;
        // Date and class instances still pass through raw. Access to any of them must
        // conservatively publish the owner path, since subsequent in-place mutation would
        // otherwise be invisible. Primitive reads build no path.
        if (value !== null && typeof value === 'object') {
            // Whatever changes inside it, if anything, cannot be described as a patch: a
            // history attached to this store falls back to a full snapshot for this change.
            this.patchPort?.listener?.(PATCH_OPAQUE);
            // Any handout of an opaque/native draft field marks its effects unknown: methods,
            // returns, locked values and unseen descendants cannot be attributed exactly.
            if (this.cache.nativeAliasRoot !== undefined) nativeAliasIndex.invalidate(this.cache.nativeAliasRoot);
            const path = this.writtenPath(key, source);
            this.record(path, value);
            this.record(branchPath(path), RAW_EXPOSURE);
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

        const path = this.writtenPath(key, source);

        // Views inside a caller-built container never become state (R32-01): a same-kind
        // replacement normalizes inside the diff walk below, every other shape — here.
        const diffBranch = wasOwn && isTrackable(previous) && isTrackable(raw)
            && Array.isArray(previous) === Array.isArray(raw);
        if (!diffBranch || this.aliases !== undefined) {
            liveViews.normalizeAssigned(raw, diffBranch ? previous : undefined);
        }

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
        // Topology refresh: only a container added, replaced or removed shifts raw ownership.
        if ((isTrackable(previous) || isTrackable(raw)) && previous !== raw
            && this.cache.nativeAliasRoot !== undefined) nativeAliasIndex.invalidate(this.cache.nativeAliasRoot);

        // A branch replaced or deleted takes its old object's recorded path with it, and a
        // write into an object last read under a different path is the aliasing the ledger
        // exists to report.
        this.aliases?.forget(previous);

        const listener = this.patchPort?.listener;

        // A key that did not already exist changes the key set itself (R16-01): an index write
        // past the array's own end is exactly such a case, alongside an ordinary new object key.
        if (!wasOwn) {
            this.record(this.keysMarker(), source);
        }

        // A replaced branch's diff is walked once. Its bounded patches are collected during
        // that walk, while every affected path (including implicit array growth) is recorded
        // before the first fallible observer call.
        const nextLength = previousLength !== undefined
            ? (source as unknown as {length: number}).length : undefined;
        const grew = nextLength !== undefined && nextLength !== previousLength;
        if (diffBranch) {
            const concrete = listener && !this.patchPort?.opaque ? listener : undefined;
            const patches: Parameters<TPatchRecorder>[0][] | undefined = concrete ? [] : undefined;
            const segments = concrete ? [...this.basePathSegments, key] : [];
            const changed = diffPaths(previous, raw, path, segments, patches);
            changed.forEach((written: TPath) => this.record(written, raw));
            if (grew) this.record(this.writtenPath('length', source), source);
            if (concrete && patches) {
                if (grew) this.reportPatch(patch => { patches.push(patch); },
                    'length', previousLength, nextLength, true, true);
                deliverPatches(concrete, patches);
            } else if (listener && changed.size > 0 && grew) {
                const patches: Parameters<TPatchRecorder>[0][] = [PATCH_OPAQUE];
                this.reportPatch(patch => { patches.push(patch); },
                    'length', previousLength, nextLength, true, true);
                deliverPatches(listener, patches);
            } else if (listener && changed.size > 0) {
                listener(PATCH_OPAQUE);
            } else if (listener && grew) {
                this.reportPatch(listener, 'length', previousLength, nextLength, true, true);
            }
        } else {
            this.record(path, source);
            if (grew) this.record(this.writtenPath('length', source), source);
            if (listener && grew) {
                const patches: Parameters<TPatchRecorder>[0][] = [];
                const queue: TPatchRecorder = patch => { patches.push(patch); };
                this.reportPatch(queue, key, wasOwn ? previous : undefined, raw, wasOwn, true);
                this.reportPatch(queue, 'length', previousLength, nextLength, true, true);
                deliverPatches(listener, patches);
            } else if (listener) {
                this.reportPatch(listener, key, wasOwn ? previous : undefined, raw, wasOwn, true);
            }
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

        // A fully-open definition needs no descriptor lookup unless history must also
        // distinguish an accepted readonly property's transition from a writable patch.
        const fullyOpen = descriptor.configurable === true
            && descriptor.writable === true && descriptor.enumerable === true;
        const existing = fullyOpen && !this.patchPort?.listener
            ? undefined : Object.getOwnPropertyDescriptor(source, key);
        const wasOwn = fullyOpen && !this.patchPort?.listener
            ? Object.prototype.hasOwnProperty.call(source, key) : existing !== undefined;

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
        if (isTrackable(raw) && !Object.is(raw, previous)) {
            liveViews.normalizeAssigned(raw, previous);
        }
        const path = this.writtenPath(key, source);

        this.aliases?.checkKey(source, key, path);
        this.aliases?.checkState(raw, path, wasOwn ? previous : undefined);
        this.aliases?.checkWrite(source, this.basePath);

        const effective = 'value' in descriptor ? {...descriptor, value: raw} : descriptor;
        const previousLength = this.isArray ? (source as unknown as unknown[]).length : undefined;
        const wrote = Reflect.defineProperty(source, key, effective);
        if (!wrote) {
            return false;
        }
        if ((isTrackable(previous) || isTrackable(raw)) && previous !== raw
            && this.cache.nativeAliasRoot !== undefined) nativeAliasIndex.invalidate(this.cache.nativeAliasRoot);

        if (wasOwn && Object.is(previous, raw)) {
            return true;
        }

        this.aliases?.forget(previous);

        if (!wasOwn) {
            this.record(this.keysMarker(), source);
        }

        const listener = this.patchPort?.listener;
        const nextLength = previousLength !== undefined
            ? (source as unknown as unknown[]).length : undefined;
        const grew = nextLength !== undefined && nextLength !== previousLength;
        this.record(path, source);
        if (grew) this.record(this.writtenPath('length', source), source);
        if (listener) {
            if (grew) {
                const patches: Parameters<TPatchRecorder>[0][] = [];
                const queue: TPatchRecorder = patch => { patches.push(patch); };
                // A scalar patch cannot install a new value into the readonly owned baseline.
                if (existing?.writable === false) queue(PATCH_OPAQUE);
                else this.reportPatch(queue, key, wasOwn ? previous : undefined, raw, wasOwn, true);
                this.reportPatch(queue, 'length', previousLength, nextLength, true, true);
                deliverPatches(listener, patches);
            } else if (existing?.writable === false) listener(PATCH_OPAQUE);
            else this.reportPatch(listener, key, wasOwn ? previous : undefined, raw, wasOwn, true);
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
        const listener = this.patchPort?.listener;
        const changesOrderOnInverse = listener && !this.isArray
            && keyDeletionRequiresReplay(source, key);

        this.aliases?.checkWrite(source, this.basePath);
        if (!Reflect.deleteProperty(source, key)) {
            return false;
        }

        this.aliases?.forget(previous);
        if (isTrackable(previous) && this.cache.nativeAliasRoot !== undefined) {
            nativeAliasIndex.invalidate(this.cache.nativeAliasRoot);
        }
        this.record(this.keysMarker(), source);
        const path = this.writtenPath(key, source);
        // The key is gone: its memo entry names a path to nothing and a rolling key window
        // would otherwise keep every key ever written memoized.
        this.childPaths?.delete(key);
        this.record(path, source);
        if (listener) {
            if (changesOrderOnInverse) {
                const patches: Parameters<TPatchRecorder>[0][] = [];
                patches.push(PATCH_KEY_ORDER_CHANGE);
                this.reportPatch(patch => { patches.push(patch); },
                    key, previous, undefined, true, false);
                deliverPatches(listener, patches);
            } else {
                this.reportPatch(listener, key, previous, undefined, true, false);
            }
        }

        return true;
    }
}

/**
 * Builds a path-recording write proxy with one shared branch cache.
 *
 * @param target - raw state, answered raw through the RAW_TARGET hatch for unwrapping
 * @param record - write-path sink carrying the raw mutation target; unwrappable leaves invalidate their owner
 * @param basePath - escaped dotted path, empty at the root
 * @param aliases - development alias and state-model validation
 * @param cache - shared branch-wrapper cache, created by the root call
 * @param patchPort - shared current listener and opaque recording mode
 * @param basePathSegments - unescaped path keys, empty at the root
 */
export const createWriteProxy = <T extends object>(
    target: T,
    record: TWriteRecorder,
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

    return new Proxy(target, handler) as T;
};
