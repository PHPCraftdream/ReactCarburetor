# API reference

Compact reference for public exports. Core symbols come from `react-carburetor`; React hooks
come from `react-carburetor/interop`. Source links are repository-relative.

## Resources

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `ResourceCarburetor<T, TArgs = void>` | `(loader: TResourceLoader<T, TArgs>, scheduler?: IUpdateScheduler)` | Single async slot; different arguments supersede the active request. | [`ResourceCarburetor.ts`](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `load` | `(args: TArgs): Promise<void>` | Starts or joins a request for these arguments. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `reload` | `(): Promise<void>` | Repeats the last load; resolves immediately if none exists. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `abort` | `(): void` | Aborts the active resource-wide request; no-op when none is active. Late results are ignored. | [same](../lib/src/Carburetor/Resource/ResourceCarburetor.ts) |
| `ResourceCache<T, TArgs = void>` | `(loader: TResourceLoader<T, TArgs>, options?: IResourceCacheOptions)` | Multi-entry cache keyed by loader arguments. | [`ResourceCache.ts`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `resolve` | `(args: TArgs): IResourceResolution<T>` | Resolves key, subscription path and current view together. | [same](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |
| `getFailure` | `(args: TArgs): unknown` | Raw rejection (including `undefined`), not serialized; check failure presence separately. | [same](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts) |

## History and tooling

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `canUndo` / `canRedo` | `(): boolean` | Whether the corresponding history endpoint is available. | [`CarburetorHistory.ts`](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `undo` / `redo` | `(): boolean` | Moves to the prior / next recorded state; returns whether it moved. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `clear` | `(): void` | Drops past, future and pending changes, captures current baseline, and continues observing. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `disconnect` | `(): void` | Detaches history observation; does not clear stored steps. | [same](../lib/src/Carburetor/Tooling/CarburetorHistory.ts) |
| `persist<T extends object>` | `(carburetor: ICarburetor<T>, options: IPersistOptions): TDisposer` | Restores storage once, then coalesces writes per microtask by default; disposer unsubscribes and flushes a pending write. | [`persist.ts`](../lib/src/Carburetor/Tooling/persist.ts) |
| `connectDevTools` | `(carburetors: IDict<IInspectable>, options?: IDevToolsOptions): TDisposer` | No-op without the extension; disposes store and extension subscriptions when present, without closing the connection. | [`connectDevTools.ts`](../lib/src/Carburetor/Tooling/connectDevTools.ts) |
| `watch<R>` | `(select: TSelector<T, R>, onChange: (next: TReadonly<R>, previous: TReadonly<R>) => void): TDisposer` | Watches changed detached selections; no initial callback. The disposer stops watching. | [`Carburetor.ts`](../lib/src/Carburetor/Store/Carburetor.ts) |
| `waitForUpdate` | `(source: ICarburetorSubscription, timeout?: number): Promise<void>` | Resolves on the next notification. Timeout defaults to `1000` ms; on timeout rejects with `Error("waitForUpdate: no update within " + timeout + "ms")`; unsubscribes on either path. | [`waitForUpdate.ts`](../lib/src/Carburetor/Tooling/waitForUpdate.ts) |

## Interop

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `useCarburetorValue<T extends object, R>` | `(carburetor: IReadableCarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>): TReadonly<R>` | Tracks selector reads and returns a detached readonly selection. | [`useCarburetorValue.ts`](../lib/src/Interop/useCarburetorValue.ts) |
| `useComputedValue<R>` | `(computed: IComputed<R>): R` | Returns the live computed value, not a detached result. Mutable results can retain identity; memoized children may not rerender, so pass scalar or detached projections. | [`useComputedValue.ts`](../lib/src/Interop/useComputedValue.ts) |
| `useResourceValue<T, TArgs, R>` | `(source: IResourceSource<T, TArgs>, args: TArgs, select: TSelector<IResourceView<T>, R & (Extract<R, PromiseLike<unknown>> extends never ? unknown : never)>, isEqual?: TValueComparator<R>): TReadonly<R>` | Required synchronous selector returns a detached readonly value; loading starts after commit. | [`useResourceValue.ts`](../lib/src/Interop/useResourceValue.ts) |

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
| `IResourceData<T>` | `{status: EResourceStatus; data: T \| undefined; error: string \| undefined; updatedAt: number \| undefined}` | Serializable resource state; error is message only. | [`Resource.ts`](../lib/src/Carburetor/Models/Resource.ts) |
| `TResourceLoader<T, TArgs>` | `(args: TArgs, signal: AbortSignal) => Promise<T>` | Async resource loader. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceSnapshot<T>` | Extends `IResourceData<T>`; `key?: string \| undefined` | Snapshot carries key of settled answer; absent when no settled answer. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceEntry<T>` | Extends `IResourceData<T>`; `refreshing: boolean; invalidated: boolean; failed: boolean` | Cache entry with refresh, invalidation and retry bookkeeping state. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceCacheData<T>` | `{entries: IDict<IResourceEntry<T>>}` | Cache entries by encoded key. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceView<T>` | Extends `IResourceEntry<T>`; `stale: boolean` | Entry plus freshness verdict. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceResolution<T>` | `{key: string; path: string; view: IResourceView<T>; present?: boolean; fieldView?: (resolution: IResourceResolution<T>, record: (path: string) => void) => IResourceView<T>}` | Key, subscription path and current view resolved together. | [same](../lib/src/Carburetor/Models/Resource.ts) |
| `IResourceSource<T, TArgs>` | Extends subscription; `resolve(args: TArgs): IResourceResolution<T>; load(args: TArgs): Promise<void>` | Minimal resource source for readers. | [same](../lib/src/Carburetor/Models/Resource.ts) |
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
| `IPersistOptions` | `{key: string; storage: IStorageLike; onError?: (error: unknown) => void; coalesce?: boolean}` | Persistence key, storage adapter and optional write coalescing. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `IUpdateScheduler` | `{schedule(uid: string, updater: TUpdater): void; cancel(uid: string): void}` | Update delivery policy. | [`Store.ts`](../lib/src/Carburetor/Models/Store.ts) |
| `IStorageLike` | `{getItem(key: string): string \| null; setItem(key: string, value: string): void; removeItem(key: string): void}` | Persistence storage adapter. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsExtension` | `{connect(options: {name?: string}): IDevToolsConnection}` | Extension adapter. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.init` | `(state: unknown): void` | Sends the initial state. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.send` | `(action: string, state: unknown): void` | Publishes an action and its state. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsConnection.subscribe` | `(listener: (message: IDevToolsMessage) => void) => TDisposer \| void` | Registers a message listener; may return its disposer. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IDevToolsMessage` | `{type: string; payload?: {type?: string; actionId?: number}; state?: string}` | Message shape consumed by the adapter. | [same](../lib/src/Carburetor/Models/Tooling.ts) |
| `IResourceCacheOptions` | `{ttl?: number; maxEntries?: number; keyCacheSize?: number; scheduler?: IUpdateScheduler}` | Cache TTL, entry bound, key memo and scheduler options. | [`Resource.ts`](../lib/src/Carburetor/Models/Resource.ts) |
| `IDevToolsOptions` | `{name?: string; extension?: IDevToolsExtension}` | Devtools integration options. | [`Tooling.ts`](../lib/src/Carburetor/Models/Tooling.ts) |
| `EResourceStatus` | Enum | Resource status. | [`EResourceStatus.ts`](../lib/src/Carburetor/Models/Enums/EResourceStatus.ts) |
