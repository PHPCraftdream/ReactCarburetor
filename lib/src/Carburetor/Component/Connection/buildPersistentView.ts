import {TReadonly} from "@/Carburetor/Models/Base";
import {IConnectionSource} from "@/Carburetor/Component/Models/Connection";
import {ConnectionFacadeHandler} from "@/Carburetor/Component/Connection/ConnectionFacadeHandler";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

/**
 * The empty targets every connect()-family facade forwards through, shared by every
 * declaration of the same kind instead of one fresh `{}`/`[]` per declaration (R16-09).
 *
 * Safe because no trap writes the target: every access forwards to the resolved view, every
 * mutation trap throws, and descriptor reflection normalizes a locked array `length` against
 * the writable `length` of the shared empty array. In particular, no connection may lock the
 * target itself: undo or a new root can make the source writable again, independently for
 * each facade.
 */
const SHARED_OBJECT_TARGET: object = {};
const SHARED_ARRAY_TARGET: unknown[] = [];

/**
 * Builds the persistent view one connect()-family declaration reads through: the once-only
 * shape probe, then a facade whose traps (`ConnectionFacadeHandler`) forward every access to
 * the resolved view.
 *
 * Serves both `connect` and `connectSelection`, which declare one connection, record through
 * one recorder, and hand out one facade whose object/array kind is fixed at declaration
 * time — the JS-03 contract, see `connect`'s docstring.
 *
 * @param source - the declaration's state, built by declareConnection; this call fixes its
 * `arrayFacade`/`probeError` fields and hands the same object to the facade's trap handler
 */
export const buildPersistentView = <T extends object>(source: IConnectionSource<T>): TReadonly<T> => {
    // Root-shape contract: the facade's object/array kind is fixed once, here, from the
    // source's current root — an array root declares an array-shaped facade (`[]` target:
    // `Array.isArray` true, `JSON.stringify` emits an array), anything else an object-shaped
    // one. A Proxy target cannot change after creation, so the kind cannot either: a source
    // that is not resolvable yet (a scope-backed resolver resolves only after construction,
    // once React fills context) declares an object-shaped facade, and a later root of the other
    // kind fails loudly in the handler's `resolveView` instead of serving a silently wrong view.
    try {
        // A shape probe, not a read: no render attempt is open, so nothing records, and
        // nothing here subscribes — the declaration stays subscription-free until commit.
        source.arrayFacade = Array.isArray(source.getCarburetor().getData());
    } catch (error) {
        // Captured, not discarded (R3-11): a scope-backed resolver throws this same way before
        // its context is filled in — the expected "not ready yet" case, which must not fail
        // construction — but an arbitrary resolver bug throws identically, and nothing at this
        // call site can tell the two apart without cooperation from the resolver itself. The
        // probe stays permissive either way; what changes is that a swallowed error is kept, so
        // it can still be attached to a later kind mismatch this call may have caused by
        // locking in the wrong facade shape, instead of being lost the moment the mismatch's
        // own message is built.
        source.probeError = error;
    }

    // An empty object/array stands in for the real target: every trap forwards to the current
    // view instead. Which of the two it is fixes the facade's kind; the target itself is one of
    // the two shared, never-mutated instances above, not a fresh allocation per declaration.
    const facade = new Proxy(
        (source.arrayFacade ? SHARED_ARRAY_TARGET : SHARED_OBJECT_TARGET) as unknown as TReadonly<T>,
        new ConnectionFacadeHandler<T>(source)
    ) as TReadonly<T>;

    // This facade may outlive setData and source swaps: resolve its current raw root at
    // detachment, not its declaration-time target. Plain/array roots are still traversed
    // through the facade so their field reads stay path-precise; native roots cannot be
    // walked through a Proxy's missing internal slots, so record their wildcard first.
    // This registration also serves the development-only escape diagnostic.
    liveViews.noteDynamicReadTarget(facade, (): object | undefined => {
        const data = source.resolveAttemptSource().getData();
        const prototype = Object.getPrototypeOf(data);

        if (prototype === Array.prototype || prototype === Object.prototype || prototype === null) {
            return data;
        }

        if (
            (data instanceof Map && prototype === Map.prototype) ||
            (data instanceof Set && prototype === Set.prototype) ||
            (data instanceof Date && prototype === Date.prototype)
        ) {
            source.recorder(WILDCARD_PATH);
            return data;
        }

        return undefined;
    });

    return facade;
};
