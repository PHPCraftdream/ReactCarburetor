import { TReadonly } from "../../Models/Base.mjs";
import { IConnectionSource } from "../Models/Connection.mjs";
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
export declare class ConnectionFacadeHandler<T extends object> implements ProxyHandler<TReadonly<T>> {
    private readonly source;
    /**
     * Holds the one piece of per-declaration state every trap reads and writes.
     *
     * @param source - this declaration's state: connection, resolver, recorder and facade cache
     */
    constructor(source: IConnectionSource<T>);
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
    private assertDeclaredKind;
    /**
     * Resolves the current view, rebuilding it only when the wrapped data object itself changed.
     *
     * A normal field write mutates that object in place, so this stays untouched render after
     * render; only `setData`/`restore` (a whole new object) or a `source()` swap to a different
     * carburetor (whose data is necessarily a different object) trigger a rebuild.
     */
    private resolveView;
    /**
     * Answers the introspection hatch before resolving anything, or forwards to the current
     * view otherwise.
     *
     * @param _target - the facade's own empty target; unused, every answer forwards to the view
     * @param key - the property being read
     */
    get(_target: TReadonly<T>, key: string | symbol): unknown;
    /**
     * Forwards a presence check to the current view.
     *
     * @param _target - the facade's own empty target; unused
     * @param key - the property being probed
     */
    has(_target: TReadonly<T>, key: string | symbol): boolean;
    /**
     * Forwards key enumeration to the current view.
     *
     * @param _target - the facade's own empty target; unused
     */
    ownKeys(_target: TReadonly<T>): ArrayLike<string | symbol>;
    /**
     * Forwards a descriptor lookup to the current view, relaxing a non-configurable result.
     *
     * Relaxed to configurable — the one lawful representation over the empty facade target,
     * which grants nothing because every mutation trap rejects it — unless the target itself
     * already holds that key non-configurable (an array target's `length`), where forwarding
     * unchanged stays compatible instead.
     *
     * @param _target - the facade's own empty target, consulted only for its own descriptors
     * @param key - the property whose descriptor is being read
     */
    getOwnPropertyDescriptor(_target: TReadonly<T>, key: string | symbol): PropertyDescriptor | undefined;
    /**
     * Forwards prototype introspection to the current view, so it stays truthful about the live
     * data.
     *
     * @param _target - the facade's own empty target; unused
     */
    getPrototypeOf(_target: TReadonly<T>): object | null;
    /** Refuses a prototype change: it would invalidate the facade's forwarding invariants. */
    setPrototypeOf(): never;
    /** Refuses an extension change, exactly like `setPrototypeOf`. */
    preventExtensions(): never;
    /** Refuses a direct write; carburetor methods are the only writable path into tracked data. */
    set(): never;
    /** Refuses `Object.defineProperty`, which bypasses `set` entirely. */
    defineProperty(): never;
    /** Refuses a delete; carburetor methods are the only writable path into tracked data. */
    deleteProperty(): never;
}
