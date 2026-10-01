import {TDisposer, TReadonly, TSubscriber, TUpdater} from "./Base";
import {IPatchObserver, TPathSet} from "./Paths";

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
 * Scheduler keys are opaque internal delivery identities, not public subscription ids;
 * they keep registrations independent when several stores share one policy.
 */
export interface IUpdateScheduler {
    schedule: (uid: string, updater: TUpdater) => void;
    cancel: (uid: string) => void;
}

export interface ISubscribeOptions {
    /**
     * A stable store-local id of your own. Subscribing again with the same id in that
     * store replaces the previous registration. Omit it to get a generated one.
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
     * afterward has no effect. A live subscription's read set is grown internally by the engine
     * as its reads accumulate; the caller only ever hands over a fresh set.
     *
     * A custom `ICarburetorSubscription` implementation should copy `reads` too if it keeps it
     * past the call: the engine only ever grows its own copy immediately before notifying the
     * subscriber, never the Set it was handed.
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
}

/**
 * Type-erased state access, for tooling that cannot know the data type:
 * devtools, persistence, server-side hydration.
 */
export interface IInspectable extends ICarburetorSubscription {
    toJSON: () => unknown;
    fromJSON: (value: unknown) => void;
    /** Detached copy for tooling that must not hold live state. */
    snapshot: () => unknown;
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
    /** Copies plain state; native Map/Set/Date and class instances remain shared by reference. */
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
}

/** A carburetor as seen by the batch coordinator. */
export interface INotifiable {
    notifyWrites: (writes: TPathSet) => void;
}

/**
 * A source of mutation-time patches and pre-subscriber publication boundaries. History needs
 * both: another subscriber may publish again before a later callback runs. Producers MUST honor
 * `publication` before ordinary subscribers, through the same scheduler (and its transaction/
 * throttle coalescing), and `restoreClaim` only when installing that exact restore argument.
 */
export interface IPatchSource {
    /**
     * Attaches an independent history observer; several may record the same source. An observer
     * with only `patch` replaces only a prior patch-only observer, never an active history. The
     * disposer detaches just its own registration and cancels its deferred publication.
     */
    attachPatchListener: (observer: IPatchObserver) => TDisposer;
    /**
     * Captures the authoritative complete state/wire graph for history. The producer invokes
     * `own` on its raw state before an ordinary snapshot can split plain/native aliases;
     * subclasses with additional wire metadata include it in the returned graph.
     * This is mandatory: history cannot infer native graph identity from snapshot().
     *
     * @param own - detaches one authoritative raw graph, rejecting unsupported mutable values
     */
    captureHistory: (own: <V>(value: V) => V) => unknown;
}
