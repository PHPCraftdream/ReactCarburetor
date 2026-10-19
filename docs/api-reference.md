# API reference

Compact reference for public exports. Core symbols come from `react-carburetor`; React hooks
come from `react-carburetor/interop`. Source links are repository-relative.

## Resources

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `ResourceCarburetor<T, TArgs = []>` | `(loader: TResourceLoader<T, TArgs>, options?: IResourceCarburetorOptions<TArgs>)` | Single async slot; different arguments supersede the active request. Options: `key`, `ttl`, `maxEntries`, `scheduler`. | [`ResourceCarburetor.ts`](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `load` | `(...args: TArgs): Promise<void>` | Starts or joins a request for these arguments; skipped when the stored answer for the key is fresh. Resolves on loader failure; rejects with `AbortError` when superseded before start. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `refresh` | `(...args: TArgs): Promise<void>` | Always requests, even when the key already has a value; replaces the stored answer on success. An in-flight request for the key is restarted; the earlier handle promise settles with the new request's outcome. Resolves on loader failure; rejects with `AbortError` when superseded before start. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `clear` | `(): void` | Cancels the request, drops the answer and the per-key answer memory; status back to `Idle`. Cancelling includes a request whose entry a public replacement removed. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `abort` | `(): void` | Aborts the active resource-wide request; no-op when none is active. Late results are ignored. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `ResourceCache<T, TArgs = []>` | `(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions<TArgs>)` | Multi-entry cache keyed by loader arguments; the `key` option derives entry identity. | [`ResourceCache.ts`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `load` / `refresh` / `clear` | `(...args: TArgs): Promise<void>` / `clear(): void` | `load` resolves from the cache when fresh and otherwise fetches, sharing one request among identical calls; `refresh` always fetches and keeps the previous entry on failure (an in-flight request for the key is restarted; the earlier handle promise settles with the new request's outcome); `clear` cancels every request and drops every entry, including a request whose entry a public replacement removed (it replaces `forgetAll`). Both handle promises resolve on loader failure; they reject with `AbortError` when superseded before start. See [promise cache](promise-cache.md). | [same](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `resolve` | `(...args: TArgs): IResourceResolution<T>` | Resolves key, subscription path and current view together. | [same](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `getFailure` | `(...args: TArgs): unknown` | Raw rejection (including `undefined`), not serialized; check failure presence separately. | [same](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `resourceState` | `(status: EResourceStatus, data?: unknown, error?: string)` | Derives the flag view from the raw state fields: the four status flags plus `isLoading` (no data yet while Idle/Pending) and `refreshFailed` (Success with an error). See [promise cache](promise-cache.md). | [`resourceState.ts`](../lib/src/Carburetor/Resource/Status/resourceState.ts) |

## History and tooling

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `canUndo` / `canRedo` | `(): boolean` | Whether the corresponding history endpoint is available. | [`CarburetorHistory.ts`](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `undo` / `redo` | `(): boolean` | Moves to the prior / next recorded state; returns whether it moved. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `clear` | `(): void` | Drops past, future and pending changes, captures current baseline, and continues observing. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `disconnect` | `(): void` | Detaches history observation; does not clear stored steps. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `persist<T extends object>` | `(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer` | Restores storage once, then coalesces writes per microtask by default (`throttleMs` bounds the write rate, `partitions` stores dirty top-level branches under their own keys); disposer unsubscribes and flushes a pending write. | [`persist.ts`](../lib/src/Carburetor/Tooling/persist.ts) |
| `connectDevTools` | `(carburetors: IDict<IInspectable>, options?: IDevToolsOptions): TDisposer` | One action per store update; never echoes a time-travel jump, even under a deferring scheduler; no-op without the extension; disposes store and extension subscriptions when present, without closing the connection. | [`connectDevTools.ts`](../lib/src/Carburetor/Tooling/connectDevTools.ts) |
| `watch<R>` | `(select: TSelector<T, R>, onChange: (next: TReadonly<R>, previous: TReadonly<R>) => void): TDisposer` | Watches changed detached selections; no initial callback. The disposer stops watching. | [`Carburetor.ts`](../lib/src/Carburetor/Store/Carburetor.ts) |
| `waitForUpdate` | `(source: ICarburetorSubscription, timeout?: number): Promise<void>` | Resolves on the next notification. Timeout defaults to `1000` ms; on timeout rejects with `Error("waitForUpdate: no update within " + timeout + "ms")`; unsubscribes on either path. | [`waitForUpdate.ts`](../lib/src/Carburetor/Tooling/waitForUpdate.ts) |

## Interop

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `useCarburetorValue<T extends object, R>` | `(carburetor: IReadableCarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>): TReadonly<R>` | Tracks selector reads and returns a detached readonly selection. | [`useCarburetorValue.ts`](../lib/src/Interop/useCarburetorValue.ts) |
| `useComputedValue<R>` | `(computed: IComputed<R>): R` | Returns the live computed value, not a detached result. Mutable results can retain identity; memoized children may not rerender, so pass scalar or detached projections. | [`useComputedValue.ts`](../lib/src/Interop/useComputedValue.ts) |
| `useResourceValue<T, TArgs, R>` | `(source, args: TArgs, select, isEqual?): TReadonly<R>` where `TArgs extends TResourceArgs` — the loader arguments are an explicit tuple (`[]` for a resource without arguments) and precede the required synchronous selector, which returns a detached readonly value; loading starts after commit. | [`useResourceValue.ts`](../lib/src/Interop/useResourceValue.ts) |

## Types index

The four lint types below come from `react-carburetor/lint`.

| Symbol | Shape | Contract | Link |
|---|---|---|---|
| `IDict<T>` | `{[id: string]: T}` | String-keyed dictionary. | [`Base.ts`](../lib/src/Carburetor/Models/Base.ts) |
| `TSubscriber`, `TUpdater` | `() => void` | Subscriber callback / scheduled component update. | [same](../lib/src/Carburetor/Models/Base.ts) |
| `TEffect`, `TEffectCleanup` | `() => TEffectCleanup \| void`; cleanup `() => void` | Effect may return cleanup; cleanup runs before rerun and on unmount. | [same](../lib/src/Carburetor/Models/Base.ts) |
| `TEffectDeps` | `ReadonlyArray<unknown>` | Compared elementwise with `Object.is`. | [same](../lib/src/Carburetor/Models/Base.ts) |
| `TTimerHandle` | `ReturnType<typeof setTimeout> \| undefined` | Platform-inferred timeout handle. | [same](../lib/src/Carburetor/Models/Base.ts) |
| `TReadonly<T>` | Recursive readonly mapped type | Functions remain unchanged; Maps/Sets and arrays/objects become readonly; Date setters are omitted. Compile-time only, not a runtime guard. | [same](../lib/src/Carburetor/Models/Base.ts) |
| `IComputed<R>` | Extends `ICarburetorSubscription`; `get(): R` | Memoized derived value with tracked dependencies. | [`Derived.ts`](../lib/src/Carburetor/Models/Derived.ts) |
| `TComputedReader` | Overloads: `<T extends object>(IReadableCarburetor<T>) => TReadonly<T>`; `<R>(IComputed<R>) => R` | Reader function; direct `computed.get()` does not register dependency. | [same](../lib/src/Carburetor/Models/Derived.ts) |
| `TComputeBody<R>` | `(read: TComputedReader) => R` | Computed body; reads through `read` are dependencies. | [same](../lib/src/Carburetor/Models/Derived.ts) |
| `IComputedOptions<R>` | `{equals?: (previous: R, next: R) => boolean}` | Optional result equality comparator. | [same](../lib/src/Carburetor/Models/Derived.ts) |
| `TSelector<T, R>` | `(data: TReadonly<T>) => R` | Selector evaluated against tracked readonly view. | [`Store.ts`](../lib/src/Carburetor/Models/Store.ts) |
| `ISubscribeOptions` | `{id?: string; reads?: ReadonlySet<string>}` | Optional store-local replacement id and read-path set. | [same](../lib/src/Carburetor/Models/Store.ts) |
| `ICarburetorSubscription` | `getUID(): string; getVersion(): number; subscribe(callback: TSubscriber, options?: ISubscribeOptions): string; unsubscribe(id: string): void` | Common subscription surface. | [same](../lib/src/Carburetor/Models/Store.ts) |
| `IInspectable` | Extends `ICarburetorSubscription`; `toJSON(): unknown; fromJSON(value: unknown): void; snapshot(): unknown` | Type-erased tooling access. | [same](../lib/src/Carburetor/Models/Store.ts) |
| `IReadableCarburetor<T>` | Extends subscription; `getData(): T; read(record: (path: string) => void): TReadonly<T>` | Raw untracked access and tracked readonly access. | [same](../lib/src/Carburetor/Models/Store.ts) |
| `ICarburetor<T>` | Extends `IReadableCarburetor<T>`, `IInspectable`; `setData(T): T; snapshot(): T; restore(T): void; watch<R>(select: TSelector<T,R>, onChange: (next: TReadonly<R>, previous: TReadonly<R>) => void): TDisposer` | Writable store; `watch` has no initial callback and fires on changed selections. | [same](../lib/src/Carburetor/Models/Store.ts) |
| `IResourceData<T>` | `{status: EResourceStatus; isIdle: boolean; isPending: boolean; isSuccess: boolean; isError: boolean; data: T \| undefined; error: string \| undefined; updatedAt: number \| undefined}` | Serializable resource state; error is message only. The four flags are derived from `status` (exactly one is true and matches it) and are always recomputed on restore — stored values are ignored; a restored `Pending` without a live request is normalized to `Idle`. Subscriptions are per-field: reading only `isError` does not re-render on `Pending` → `Success`. | [`Resource.ts`](../lib/src/Carburetor/Models/Resource.ts) |
| `TResourceLoader<T, TArgs extends TResourceArgs = []>` | `(...args: [...TArgs, AbortSignal]) => Promise<T>` — variadic loader arguments followed by the signal; a loader without a signal parameter is accepted by the second overload. `TArgs` is a tuple (`[id: string]`, default `[]`); a first `unknown`/`any` parameter is taken for the signal, which needs the explicit `TArgs`. | Async resource loader. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceSnapshot<T>` | Extends `IResourceData<T>`; `key?: string \| undefined` | Snapshot carries key of settled answer; absent when no settled answer. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceEntry<T>` | Extends `IResourceData<T>`; `refreshing: boolean; invalidated: boolean; failed: boolean` | Cache entry with refresh, invalidation and retry bookkeeping state. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceCacheData<T>` | `{entries: IDict<IResourceEntry<T>>}` | Cache entries by encoded key. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceView<T>` | Extends `IResourceEntry<T>`; `stale: boolean` | Entry plus freshness verdict. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceResolution<T>` | `{key: string; path: string; view: IResourceView<T>; present?: boolean; fieldView?: (resolution: IResourceResolution<T>, record: (path: string) => void) => IResourceView<T>}` | Key, subscription path and current view resolved together. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceSource<T, TArgs extends TResourceArgs = []>` | Extends subscription; `resolve(...args: TArgs): IResourceResolution<T>; load(...args: TArgs): Promise<void>` | Minimal resource source for readers. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `ICarburetorToken<T>` | `{id: string; create(): T}` | Stable scope identity and factory. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `TValueComparator<R>` | `(a: TReadonly<R>, b: TReadonly<R>) => boolean` | Interop comparator; imported from `react-carburetor/interop`, not the root entry. | [`Models.ts`](../lib/src/Interop/Models.ts) |
| `TSeverity` | `'error' \| 'warn' \| 'off'` | Lint-rule severity; from `react-carburetor/lint`. | [`lint.d.ts`](../plugin/lint.d.ts) |
| `ICarburetorRule` | `{meta?: {type?: string; docs?: {description: string; url?: string}; schema?: readonly unknown[]; fixable?: string}; create(context: unknown): Record<string, (node: never) => void>}` | Public lint rule shape. | [same](../plugin/lint.d.ts) |
| `ICarburetorFlatConfig` | `{plugins: {carburetor: ICarburetorPlugin}; rules: Readonly<Record<string, TSeverity>>}` | Flat config using the plugin and severity map. | [same](../plugin/lint.d.ts) |
| `ICarburetorPlugin` | `{meta: {name: string; version?: string}; rules: Record<string, ICarburetorRule>; configs: {recommended: ICarburetorFlatConfig; 'no-hooks': ICarburetorFlatConfig}}` | Packaged lint plugin. | [same](../plugin/lint.d.ts) |

## Utilities and enums

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `deepClone<T>` | `(value: T): T` | Recursively copies supported plain containers and their prototypes; natives/classes stay by reference. Plain objects copy enumerable string fields. Arrays preserve length/holes and copy own numeric slots: all slots at length <= 4096, only enumerable slots for longer arrays; non-index/symbol keys are omitted and flags normalized. Shared plain references are copied independently; cycles are unsupported. | [`deepClone.ts`](../lib/src/Carburetor/Store/Utils/deepClone.ts) |
| `EDevToolsAction` | `JumpToAction='JUMP_TO_ACTION'; JumpToState='JUMP_TO_STATE'; Rollback='ROLLBACK'` | Time-travel actions accepted from DevTools. | [`EDevToolsAction.ts`](../lib/src/Carburetor/Models/Enums/EDevToolsAction.ts) |
| `EDevToolsMessageType` | `Dispatch='DISPATCH'` | DevTools dispatch message type. | [`EDevToolsMessageType.ts`](../lib/src/Carburetor/Models/Enums/EDevToolsMessageType.ts) |

## Public extension types

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `TDisposer` | `() => void` | Disposes an observation or subscription. | [`Base.ts`](../lib/src/Carburetor/Models/Base.ts) |
| `IHistoryOptions` | `{limit?: number}` | Maximum history entries; positive safe integer, default `50`. | [`CarburetorHistory.ts`](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `IPersistOptions` | `{key: string; storage: IStorageLike; onError?: (error: unknown) => void; coalesce?: boolean; throttleMs?: number; partitions?: ReadonlyArray<string>}` | Persistence key, storage adapter, optional write coalescing, write-rate bound and partitioned storage. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `IUpdateScheduler` | `{schedule(uid: string, updater: TUpdater): void; cancel(uid: string): void}` | Update delivery policy. | [`Store.ts`](../lib/src/Carburetor/Models/Store.ts) |
| `IStorageLike` | `{getItem(key: string): string \| null; setItem(key: string, value: string): void; removeItem(key: string): void}` | Persistence storage adapter. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsExtension` | `{connect(options: {name?: string}): IDevToolsConnection}` | Extension adapter. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.init` | `(state: unknown): void` | Sends the initial state. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.send` | `(action: string, state: unknown): void` | Publishes an action and its state. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.subscribe` | `(listener: (message: IDevToolsMessage) => void) => TDisposer \| void` | Registers a message listener; may return its disposer. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsMessage` | `{type: string; payload?: {type?: string; actionId?: number}; state?: string}` | Message shape consumed by the adapter. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IResourceCacheOptions<TArgs extends TResourceArgs = []>` | `{ttl?: number; maxEntries?: number; keyCacheSize?: number; key?: TResourceKey<TArgs>; scheduler?: IUpdateScheduler}` | Cache TTL, entry bound, key memo, custom key derivation and scheduler options. | [`Resource.ts`](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceCarburetorOptions<TArgs extends TResourceArgs = []>` | `{key?: TResourceKey<TArgs>; ttl?: number; maxEntries?: number; scheduler?: IUpdateScheduler}` | Slot options: key derivation, staleness, answer-memory bound and scheduler. | [`ResourceOptions.ts`](../lib/src/Carburetor/Resource/ResourceOptions.ts) |
| `IDevToolsOptions` | `{name?: string; extension?: IDevToolsExtension}` | Devtools integration options. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `EResourceStatus` | Enum | Resource status. | [`EResourceStatus.ts`](../lib/src/Carburetor/Models/Enums/EResourceStatus.ts) |

## Selections, history and replay details

### connectSelection detachment

`connectSelection`'s selector runs on every render — that is what keeps the owner's subscription
fresh — while the snapshot object itself is reused until the selected content changes.

What the call returns is detached data in the state-model sense: plain objects include own
enumerable string keys; flags are normalized, symbols and non-enumerable fields are omitted, and
an own key literally named `__proto__` lands as data. Arrays retain their length, holes and all
own numeric indices (including non-enumerable ones); extra named and symbol keys are ignored.
Descriptor flags are not uniformly normalized: some flat or sparse selection paths can preserve
non-enumerable index flags, but descriptor-only changes are not a stable selection-equality
guarantee. Sparse selections enumerate present indices after the first hole; adding an own
`undefined` slot or deleting one still updates the consumer.

Ordinary Maps, Sets and Dates are detached (a Date is its time), comparing only their entries or
timestamp and ignoring extra own properties; repeated references and Map-key aliases stay shared
within the copy, including a key selected through a tracked view. Custom instances remain live.
An accessor's getter runs once, like any plain read, and its value is what the copy keeps. An
`Array` subclass is rejected — its copy would lack its private state — so select
`Array.from(value)` or the fields the child needs instead.

Map/Set insertion order participates; changing only that order updates the snapshot. Equal Invalid
Dates stay stable. Repeated native facades and plain/native value aliases retain their topology
without bypassing tracked plain reads. Object keys remain conservatively changed, as do class
instances — including Map, Set and Date subclasses.

A write to what the selector read runs the selector again at notification time, against the
committed props and state, and the owner re-renders only when the snapshot moved. An equal-valued
branch switch, such as selecting `left` instead of an equal `right`, re-files the moved read set at
notification time without a render; writes to the old branch stay quiet, and a value change on the
new branch wakes the owner.

When the snapshot does change, only the changed spine is copied: unchanged nested objects and
arrays keep the references they had. Members are matched by their own object where the owner keeps
the previous pass (`useCarburetorValue`, `watch`, `connectSelection`), so a row that moved keeps the
copy it had; elsewhere they are matched by position. A related edit inside a selected live list is
applied from the store's write log instead of re-walking the list, regardless of unrelated writes to
the same store in between; a write the log cannot attribute costs one full walk. An opaque live
facade that cannot be detached is reported once per selection in development; project its plain
fields instead of handing the facade to a gated child.

### Diff thresholds

A kind change (array ↔ object, plain ↔ `Map`/class instance), or a supported object/array prototype
change, records the replaced path itself. A replacement that changes more than 2000 leaves and more
than half of the leaves of the replaced branch collapses — the replaced path itself is recorded
instead. A partial change of a large branch stays leaf-precise at any size: only an almost-complete
replacement collapses. At the root the top-level keys that differ are recorded instead of the
wildcard, so unrelated subscribers stay asleep.

An array element that is the same raw object at a different index (moved, or shifted by `filter` or
a spread insert) records its index path instead of diffing two different rows, as `splice` does.
Snapshots and history preserve supported null-prototype containers.

### Positional array methods on the draft

`sort`, `reverse`, `splice`, `shift`, `unshift`, `copyWithin` and `fill` run the native method on
the raw array and record the changed indices. `sort`/`reverse`/`fill`/`copyWithin` return the live
view (the receiver); `splice`/`shift` return the removed elements raw — detached from the tracked
graph, like any value read out of the store. A `sort` comparator and a `fill` value therefore see
raw elements, not tracked views: read tracked paths through the view afterwards, not inside the
comparator.

### History and replay

History owns ordinary `Map`, `Set` and `Date` endpoints independently of `snapshot()`. Unsupported
mutable instances and accessor-bearing native values are rejected instead of promising a false
undo. Undo and redo first reconcile collected writes awaiting a coalesced publication, so time
travel reverses the latest coherent step and a later flush cannot manufacture a new branch.

`history.clear()` captures the current baseline and discards pre-clear deferred writes; later
coalesced writes remain undoable from that baseline, and other histories stay independent. Resource
replay normalizes Pending/refreshing fields on its fresh owned graph. The built-in stores publish
to history before ordinary subscribers, after transaction/throttle coalescing.

Ordinary plain-tree undo/redo records patches — O(changed values), not O(state). Ordinary Date
raw identity is preserved; reads subscribe coarsely to the raw leaf, without wrapping reads or writes.
Draft Date exposure lasts through the synchronous turn, checking its time value on each publication
until microtask cleanup. Net changes create opaque history snapshots; unchanged setters and mutations
reverted before the next publication create no Date write. Date subclasses and Dates with own properties use
conservative immediate exposure. `setData`, `restore` and `fromJSON` record their leaf patches too (up to
1000, then one opaque entry). Only
classes whose wire form differs from their live data override `captureHistory(own)`, passing their
authoritative raw graph to `own`; custom history sources are not supported.

### Hooks interop detachment

`useCarburetorValue` selections are plain data in the state-model sense: plain objects include own
enumerable string fields; arrays retain their length, holes and all own numeric indices, including
non-enumerable ones, while extra named and symbol keys are omitted. Plain-object descriptor flags
are normalized; array flags are not uniformly normalized, since flat and sparse tracked detachment
can preserve non-enumerable index flags. Ordinary Dates compare by timestamp, and Maps/Sets by
entries, ignoring extra own metadata. An accessor's getter runs once and its value is the snapshot.
Repeated references and cycles stay connected within one detached selection, including a Date used
both as a Map key and elsewhere in the selected graph.

The third argument defaults to a structural comparison: own enumerable string keys and `Object.is`
values, recursively through plain objects and arrays, a detached Date by its timestamp (Invalid
Dates compare equal), and detached Map/Set size, iteration order and entries (object keys count as
changed). A class instance still always compares as changed, since its fields can mutate in place.
Pass `Object.is` explicitly for the old, reference-only behavior.

`useResourceValue`'s optional fourth argument compares detached readonly values. Hoisted or
correctly memoized selectors reuse completed results and read sets on unchanged parent renders; a
fresh inline selector remains correct but executes again and pays selection/capture costs. The
server snapshot keeps the server's `updatedAt` and invalidated state; TTL is checked normally.
After commit, a mounted `useResource` or `useResourceValue` reader may refetch a stale or
invalidated entry.
