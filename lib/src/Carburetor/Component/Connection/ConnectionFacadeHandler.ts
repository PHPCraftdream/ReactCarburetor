import {TReadonly} from "@/Carburetor/Models/Base";
import {IConnectionSource} from "@/Carburetor/Component/Models/Connection";
import {PROXY_CACHE} from "@/Carburetor/Store/Tracking/Models";

/**
 * Refuses a write. Shared by every write-forbidding trap of every connect()-family facade —
 * `set`, `defineProperty`, `deleteProperty`, `setPrototypeOf` and `preventExtensions` all throw
 * this same error, so one module-level function covers all five instead of a fresh closure per
 * declaration per trap.
 */
const forbidWrite = (): never => {
    throw new Error(
        'Carburetor: data read through connect() is read-only. ' +
        'Write through carburetor methods — they write via draft and know which paths changed.'
    );
};

/**
 * connect()-family facade trap handler: one instance per declaration, but one set of trap
 * functions for all of them — the same shape `createReadProxy`'s `ReadProxyHandler` uses
 * (R14-07). Its only per-instance state is the declaration's own `ConnectionSource`
 * (declareConnection.ts), which already carries the probe result, the view cache and the
 * recorder together, so this class adds no state of its own beyond holding that reference —
 * a connect()/connectSelection() declaration costs one handler instance plus one `Proxy`, not a
 * handler object with twelve trap closures.
 *
 * Every trap forwards to the current persistent view instead of the facade's own empty target,
 * which is what lets the same Proxy instance survive a rebuild underneath it — only the object
 * `resolveView` returns changes; the Proxy identity never does. Writing through any instance is
 * forbidden — `set`, `deleteProperty`, `defineProperty`, `setPrototypeOf` and
 * `preventExtensions` all throw — so introspection stays truthful about the live data: the
 * target stays extensible, which is what keeps every forwarding trap lawful.
 */
export class ConnectionFacadeHandler<T extends object> implements ProxyHandler<TReadonly<T>> {
    /**
     * Holds the one piece of per-declaration state every trap reads and writes.
     *
     * @param source - this declaration's state: connection, resolver, recorder and facade cache
     */
    constructor(private readonly source: IConnectionSource<T>) {}

    /**
     * Asserts that `data` still matches the facade's declared array/object kind.
     *
     * A new underlying data object must keep the declared kind: same kind — the rebuild is
     * transparent (setData, restore, a source() swap); the other kind — an explicit boundary
     * error, because forwarding it would serve a view that answers basic JavaScript questions
     * (`Array.isArray`, key enumeration) wrongly.
     *
     * @param data - the source's current root, checked against the facade's declared kind
     */
    private assertDeclaredKind(data: T): void {
        const {source} = this;

        if (Array.isArray(data) === source.arrayFacade) {
            return;
        }

        const mismatch = new Error(
            source.arrayFacade
                ? 'Carburetor: this connect() view was declared for an array root, but its source now ' +
                  'resolves to a root that is not an array. One persistent view cannot change its ' +
                  'object/array kind; declare a separate connection for the other store.'
                : source.probeError === undefined
                    ? 'Carburetor: this connect() view is fixed as an object view because its source was not ' +
                      'resolvable at declaration time (a scope-backed resolver resolves after construction), ' +
                      'but the resolved root is an array. Read an array-rooted scoped store through ' +
                      'useCarburetor in render instead.'
                    : 'Carburetor: this connect() view is fixed as an object view because reading its source ' +
                      'threw during declaration (see this error\'s "cause") — a scope-backed resolver not yet ' +
                      'ready throws the same way, but this may instead be a genuine resolver bug — and the ' +
                      'resolved root is now an array. Read an array-rooted scoped store through useCarburetor ' +
                      'in render instead.'
        );

        // Not a typed ErrorOptions constructor argument: that needs an ES2022 lib the project
        // does not target. Setting it directly is the same runtime shape, cause included.
        if (source.probeError !== undefined) {
            (mismatch as Error & {cause?: unknown}).cause = source.probeError;
        }

        throw mismatch;
    }

    /**
     * Resolves the current view, rebuilding it only when the wrapped data object itself changed.
     *
     * A normal field write mutates that object in place, so this stays untouched render after
     * render; only `setData`/`restore` (a whole new object) or a `source()` swap to a different
     * carburetor (whose data is necessarily a different object) trigger a rebuild.
     */
    private resolveView(): TReadonly<T> {
        const {source} = this;
        // The attempt's shared resolution, not a fresh one per property access: reading several
        // fields in one render resolves the source once. The root itself is still re-read per
        // access — a setData() replacement must rebuild the view immediately.
        const carburetor = source.resolveAttemptSource();
        const data = carburetor.getData();

        if (source.cachedTarget !== data) {
            this.assertDeclaredKind(data);
            source.cachedTarget = data;
            source.cachedView = carburetor.read(source.recorder);
        }

        return source.cachedView as TReadonly<T>;
    }

    /**
     * Answers the introspection hatch before resolving anything, or forwards to the current
     * view otherwise.
     *
     * @param _target - the facade's own empty target; unused, every answer forwards to the view
     * @param key - the property being read
     */
    get(_target: TReadonly<T>, key: string | symbol): unknown {
        if (key === PROXY_CACHE) {
            // A peek, not a read: asking for the hatch must not force resolveView() on a
            // connection that was declared but never actually read. Answered from whatever
            // resolveView() has already built, if anything; test introspection only.
            const {cachedView} = this.source;

            return cachedView === undefined ? undefined : Reflect.get(cachedView as object, PROXY_CACHE);
        }

        return Reflect.get(this.resolveView() as object, key);
    }

    /**
     * Forwards a presence check to the current view.
     *
     * @param _target - the facade's own empty target; unused
     * @param key - the property being probed
     */
    has(_target: TReadonly<T>, key: string | symbol): boolean {
        return Reflect.has(this.resolveView() as object, key);
    }

    /**
     * Forwards key enumeration to the current view.
     *
     * @param _target - the facade's own empty target; unused
     */
    ownKeys(_target: TReadonly<T>): ArrayLike<string | symbol> {
        return Reflect.ownKeys(this.resolveView() as object);
    }

    /**
     * Forwards a descriptor lookup, relaxing non-configurable keys absent from the target.
     *
     * An array target already owns a non-configurable `length`, but its writable bit must
     * remain true: reporting false would violate Proxy invariants and permanently locking the
     * shared target would break undo, root replacement and other facades. Raw descriptor flags
     * needed by detachment are read through liveViews instead of this facade's reflection.
     *
     * @param _target - the facade's own empty target, consulted for its own descriptors
     * @param key - the property whose descriptor is being read
     */
    getOwnPropertyDescriptor(_target: TReadonly<T>, key: string | symbol): PropertyDescriptor | undefined {
        const descriptor: PropertyDescriptor | undefined =
            Reflect.getOwnPropertyDescriptor(this.resolveView() as object, key);

        if (descriptor === undefined || descriptor.configurable) {
            return descriptor;
        }

        const targetDescriptor: PropertyDescriptor | undefined =
            Reflect.getOwnPropertyDescriptor(_target as object, key);

        if (targetDescriptor !== undefined && !targetDescriptor.configurable) {
            return targetDescriptor.writable === true && descriptor.writable === false
                ? {...descriptor, writable: true}
                : descriptor;
        }

        return {...descriptor, configurable: true};
    }

    /**
     * Forwards prototype introspection to the current view, so it stays truthful about the live
     * data.
     *
     * @param _target - the facade's own empty target; unused
     */
    getPrototypeOf(_target: TReadonly<T>): object | null {
        return Reflect.getPrototypeOf(this.resolveView() as object);
    }

    /** Refuses a prototype change: it would invalidate the facade's forwarding invariants. */
    setPrototypeOf(): never {
        return forbidWrite();
    }

    /** Refuses an extension change, exactly like `setPrototypeOf`. */
    preventExtensions(): never {
        return forbidWrite();
    }

    /** Refuses a direct write; carburetor methods are the only writable path into tracked data. */
    set(): never {
        return forbidWrite();
    }

    /** Refuses `Object.defineProperty`, which bypasses `set` entirely. */
    defineProperty(): never {
        return forbidWrite();
    }

    /** Refuses a delete; carburetor methods are the only writable path into tracked data. */
    deleteProperty(): never {
        return forbidWrite();
    }
}
