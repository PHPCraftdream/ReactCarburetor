import {TDisposer, TReadonly, TSubscriber, TUpdater} from "./Base";
import {TPathSet, TPatchRecorder} from "./Paths";

/**
 * Picks the part of a carburetor's data one subscription cares about, run against a tracked
 * read view — the same mechanism `read()` and the hooks bridge use. `watch()`'s reads and
 * `sameSelection` comparison both key off what this touches, so a conditional selector still
 * narrows or widens the subscription the way a direct read would.
 * Read selected values through ordinary property access (`data.key` or `Reflect.get`).
 * Descriptor and `hasOwnProperty` introspection do not register a value dependency; descriptor
 * lookups also occur inside key enumeration, which tracks the key set instead.
 */
export type TSelector<T, R> = (data: TReadonly<T>) => R;

/**
 * Delivery policy for updates.
 * A carburetor delivers updates immediately by default; throttling is a deliberate
 * choice for streaming sources (sockets, mousemove), not a global rule.
 */
export interface IUpdateScheduler {
    schedule: (uid: string, updater: TUpdater) => void;
    cancel: (uid: string) => void;
}

export interface ISubscribeOptions {
    /**
     * A stable id of your own. Subscribing again with the same id replaces the previous
     * registration instead of adding a second one — that is how a component keeps exactly
     * one subscription across renders. Omit it to get a generated one.
     */
    id?: string;
    /**
     * Paths the subscriber depends on. Omitted means every update reaches it.
     *
     * Read-only by contract: a path string's own grammar (the separator, the escapes, the
     * markers R16-01 added) is an engine internal, not a stable format callers should build or
     * parse — `subscribe(callback, {reads})` is documented only as an extension point that reads
     * a path set already produced by `read()`'s recorder. Copied into the store's own Set at
     * subscribe time: the Set passed in is never mutated or kept by reference, so changing it
     * afterward has no effect. `extend()` is the supported way to add one more path to a live
     * subscription — it grows the store's copy, not yours.
     *
     * A custom `ICarburetorSubscription` implementation should copy `reads` too if it keeps it
     * past the call: the engine only ever grows its own copy immediately before calling your
     * `extend(id, path)`, never the Set it was handed.
     */
    reads?: ReadonlySet<string>;
}

/**
 * The part of the carburetor API that does not depend on the data type.
 * A component only needs the subscription surface, never the data itself, so it keeps
 * carburetors in this shape — that is how differently typed carburetors share one dictionary
 * without `any`.
 */
export interface ICarburetorSubscription {
    getUID: () => string;
    /** Write counter: lets a component detect data changes between render and commit. */
    getVersion: () => number;
    subscribe: (callback: TSubscriber, options?: ISubscribeOptions) => string;
    unsubscribe: (id: string) => void;
    /**
     * The path-precise drift check (R16-05): whether a write since `baselineVersion` could
     * concern `reads`. Optional — a source with no write log of its own (a computed, which
     * invalidates at the granularity of its whole value) is left out, and a caller with no
     * finer answer available falls back to "the version moved at all".
     */
    hasDriftSince?: (baselineVersion: number, reads: ReadonlySet<string>) => boolean;
}

/**
 * Type-erased state access, for tooling that cannot know the data type:
 * devtools, persistence, server-side hydration.
 */
export interface IInspectable extends ICarburetorSubscription {
    toJSON: () => unknown;
    fromJSON: (value: unknown) => void;
}

export interface ICarburetor<T> extends IInspectable {
    /** Untracked data, for code outside render. */
    getData: () => T;
    /**
     * Tracked data: every field read is reported to `record`. Documented, alongside
     * `subscribe(callback, {reads})`, as the engine's extension contract — building or parsing
     * the path strings `record` receives is not: R16-01 changed their shape once already.
     */
    read: (record: (path: string) => void) => TReadonly<T>;
    setData: (data: T) => T;
    /** Detached deep copy of the data, safe to serialize or keep around. */
    snapshot: () => T;
    /** Replaces the data with a previously taken snapshot. */
    restore: (data: T) => void;
    /**
     * Subscribes outside React to a derived value: `select` runs against a tracked read view,
     * the same mechanism the hooks bridge uses, and its reads become this subscription's read
     * set. `onChange(next, previous)` fires only when the selection actually changed — never on
     * the initial call, and never for a write that moved the selector's reads without moving its
     * result — and the selector's read set is re-tracked after every fire, since a conditional
     * selector can read different paths next time. A throwing selector or callback is isolated
     * the same way any other subscriber's throw is: the write has already landed, the remaining
     * subscribers still hear it, and the failure is reported rather than re-thrown.
     * Select a value with `data.key` or `Reflect.get(data, 'key')`; a primitive obtained only
     * through `Object.getOwnPropertyDescriptor(data, 'key')?.value` is not tracked as a leaf.
     *
     * `select`/`onChange` never see raw path strings, which is the point: prefer this over
     * `subscribe(callback, {reads})` unless you are writing engine-level tooling that genuinely
     * needs "every write" (history, persistence, devtools) — for that, use `subscribe` with no
     * `reads` at all rather than reconstructing it here.
     *
     * @param select - reads the part of the data this subscription cares about
     * @param onChange - called with the fresh and previous selection when they differ
     */
    watch: <R>(select: TSelector<T, R>, onChange: (next: R, previous: R) => void) => TDisposer;
    /**
     * Adds one path to an already-registered subscription's read set; an unknown id is a no-op.
     *
     * Only a store source ever receives this call: a computed notifies at the granularity of
     * its whole value, so it has no finer path to extend a subscription with, and this member
     * lives here rather than on `ICarburetorSubscription` so a third-party subscription source
     * — a computed among them — does not have to carry a no-op just to satisfy the interface.
     */
    extend: (id: string, path: string) => void;
}

/** A carburetor as seen by the batch coordinator. */
export interface INotifiable {
    notifyWrites: (writes: TPathSet) => void;
}

/**
 * A store that can report the patches behind its own writes (R16-07) instead of only the paths
 * that changed. `CarburetorHistory` is the one caller today: it records the patches for a small,
 * invertible entry instead of a snapshot per change, falling back to a snapshot only for a
 * change a patch cannot describe. Undo and redo still install the result through `restore()` —
 * not a patch-specific apply — so a store that overrides `restore()` (a `ResourceCache` aborting
 * in-flight requests, for one) keeps seeing every time-travel write the same way it always has.
 */
export interface IPatchSource {
    /**
     * Attaches one patch listener, replacing whichever one was attached before — a store has at
     * most one at a time, the same way `draft` has one memoized proxy tree. The disposer detaches
     * it; detaching an already-replaced listener is a no-op.
     */
    attachPatchListener: (listener: TPatchRecorder) => TDisposer;
}
