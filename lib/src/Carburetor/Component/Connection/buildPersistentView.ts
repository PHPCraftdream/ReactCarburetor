import {TReadonly} from "@/Carburetor/Models/Base";
import {IConnectionSource} from "@/Carburetor/Component/Models/Connection";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";

/**
 * Builds the persistent view one connect()-family declaration reads through: the once-only
 * shape probe, the declared-kind assertion, the forwarding facade.
 *
 * Serves both `connect` and `connectSelection`, which declare one connection, record through
 * one recorder, and hand out one facade whose object/array kind is fixed at declaration
 * time — the JS-03 contract, see `connect`'s docstring.
 */
export const buildPersistentView = <T extends object>(source: IConnectionSource<T>): TReadonly<T> => {
    const {getCarburetor, recorder, resolveAttemptSource} = source;

    let cachedTarget: T | undefined;
    let cachedView: TReadonly<T> | undefined;

    // Root-shape contract: the facade's object/array kind is fixed once, here, from the
    // source's current root — an array root declares an array-shaped facade (`[]` target:
    // `Array.isArray` true, `JSON.stringify` emits an array), anything else an
    // object-shaped one. A Proxy target cannot change after creation, so the kind cannot
    // either: a source that is not resolvable yet (a scope-backed resolver resolves only
    // after construction, once React fills context) declares an object-shaped facade, and
    // a later root of the other kind fails loudly in resolveView instead of serving a
    // silently wrong view.
    let arrayFacade = false;

    try {
        // A shape probe, not a read: no render attempt is open, so nothing records, and
        // nothing here subscribes — the declaration stays subscription-free until commit.
        arrayFacade = Array.isArray(getCarburetor().getData());
    } catch {
        // The source is not resolvable yet; the real resolution error, if any, surfaces
        // unguarded at the first real read below.
    }

    // A new underlying data object must keep the declared kind: same kind — the rebuild is
    // transparent (setData, restore, a source() swap); the other kind — an explicit
    // boundary error, because forwarding it would serve a view that answers basic
    // JavaScript questions (`Array.isArray`, key enumeration) wrongly.
    const assertDeclaredKind = (data: T): void => {
        if (Array.isArray(data) === arrayFacade) {
            return;
        }

        throw new Error(
            arrayFacade
                ? 'Carburetor: this connect() view was declared for an array root, but its source now ' +
                  'resolves to a root that is not an array. One persistent view cannot change its ' +
                  'object/array kind; declare a separate connection for the other store.'
                : 'Carburetor: this connect() view is fixed as an object view because its source was not ' +
                  'resolvable at declaration time (a scope-backed resolver resolves after construction), ' +
                  'but the resolved root is an array. Read an array-rooted scoped store through ' +
                  'useCarburetor in render instead.'
        );
    };

    // Rebuilds only when the wrapped data object itself changed — a normal field write
    // mutates that object in place, so this stays untouched render after render; only
    // setData()/restore() (a whole new object) or a source() swap to a different carburetor
    // (whose data is necessarily a different object) trigger a rebuild.
    const resolveView = (): TReadonly<T> => {
        // The attempt's shared resolution, not a fresh one per property access: reading
        // several fields in one render resolves the source once. The root itself is still
        // re-read per access — a setData() replacement must rebuild the view immediately.
        const carburetor = resolveAttemptSource();
        const data = carburetor.getData();

        if (cachedTarget !== data) {
            assertDeclaredKind(data);
            cachedTarget = data;
            cachedView = carburetor.read(recorder);
        }

        return cachedView as TReadonly<T>;
    };

    const forbidWrite = (): never => {
        throw new Error(
            'Carburetor: data read through connect() is read-only. ' +
            'Write through carburetor methods — they write via draft and know which paths changed.'
        );
    };

    // An empty object/array stands in for the real target: every trap below resolves and
    // forwards to the current view instead, which is what lets the same Proxy instance
    // survive a rebuild underneath it. Which of the two it is fixes the facade's kind.
    const facade = new Proxy((arrayFacade ? [] : {}) as unknown as TReadonly<T>, {
        get: (_target: TReadonly<T>, key: string | symbol): unknown => Reflect.get(resolveView() as object, key),
        has: (_target: TReadonly<T>, key: string | symbol): boolean => Reflect.has(resolveView() as object, key),
        ownKeys: (_target: TReadonly<T>): ArrayLike<string | symbol> => Reflect.ownKeys(resolveView() as object),
        getOwnPropertyDescriptor: (_target: TReadonly<T>, key: string | symbol): PropertyDescriptor | undefined => {
            const descriptor: PropertyDescriptor | undefined =
                Reflect.getOwnPropertyDescriptor(resolveView() as object, key);

            if (descriptor === undefined || descriptor.configurable) {
                return descriptor;
            }

            // A non-configurable view descriptor can often not be reported as-is: over the
            // empty facade target the engine answers with a bare proxy-invariant TypeError
            // and no explanation — the enumeration/serialization failure this facade
            // existed to fix. The one lawful representation there is the descriptor
            // relaxed to configurable, which grants nothing: set, deleteProperty,
            // defineProperty, setPrototypeOf and preventExtensions are all rejected below,
            // so the relaxed flag can never be acted on. A key the target itself holds as
            // a non-configurable own property (an array target's "length") must instead
            // be forwarded unchanged: relaxing it would contradict the target's existing
            // property, which the engine rejects, while forwarding stays compatible
            // because the target's own "length" remains writable.
            const targetDescriptor: PropertyDescriptor | undefined =
                Reflect.getOwnPropertyDescriptor(_target as object, key);

            if (targetDescriptor !== undefined && !targetDescriptor.configurable) {
                return descriptor;
            }

            return {...descriptor, configurable: true};
        },
        // Introspection stays truthful about the live data; the target stays extensible,
        // which is what keeps every forwarding trap lawful.
        getPrototypeOf: (_target: TReadonly<T>): object | null => Reflect.getPrototypeOf(resolveView() as object),
        // A prototype change or an extension change would invalidate the facade's
        // forwarding invariants (a non-extensible target must mirror the view's keys), so
        // both are rejected the same way as writes.
        setPrototypeOf: forbidWrite,
        preventExtensions: forbidWrite,
        set: forbidWrite,
        deleteProperty: forbidWrite,
        defineProperty: forbidWrite,
    }) as TReadonly<T>;

    // Noted so the child-prop snapshot boundary recognizes this view as live.
    liveViews.note(facade);

    return facade;
};
