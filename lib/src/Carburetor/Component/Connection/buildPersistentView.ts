import {TReadonly} from "@/Carburetor/Models/Base";
import {IConnectionSource} from "@/Carburetor/Component/Models/Connection";
import {ConnectionFacadeHandler} from "@/Carburetor/Component/Connection/ConnectionFacadeHandler";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {liveViews} from "@/Carburetor/Store/Tracking/liveViews";

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
    // view instead. Which of the two it is fixes the facade's kind.
    const facade = new Proxy(
        (source.arrayFacade ? [] : {}) as unknown as TReadonly<T>,
        new ConnectionFacadeHandler<T>(source)
    ) as TReadonly<T>;

    // Noted so the escape diagnostic recognizes this view as live; its only reader is
    // development-only, so populating the registry is too.
    if (IS_DEVELOPMENT) {
        liveViews.note(facade);
    }

    return facade;
};
