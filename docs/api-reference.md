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

## Interop

| Symbol | Signature | Contract | Link |
|---|---|---|---|
| `useCarburetorValue<T extends object, R>` | `(carburetor: IReadableCarburetor<T>, select: TSelector<T, R>, isEqual?: TValueComparator<R>): TReadonly<R>` | Tracks selector reads and returns a detached readonly selection. | [`useCarburetorValue.ts`](../lib/src/Interop/useCarburetorValue.ts) |
| `useComputedValue<R>` | `(computed: IComputed<R>): R` | Returns the live computed value, not a detached result. Mutable results can retain identity; memoized children may not rerender, so pass scalar or detached projections. | [`useComputedValue.ts`](../lib/src/Interop/useComputedValue.ts) |
| `useResourceValue<T, TArgs, R>` | `(source: IResourceSource<T, TArgs>, args: TArgs, select: TSelector<IResourceView<T>, R & (Extract<R, PromiseLike<unknown>> extends never ? unknown : never)>, isEqual?: TValueComparator<R>): TReadonly<R>` | Required synchronous selector returns a detached readonly value; loading starts after commit. | [`useResourceValue.ts`](../lib/src/Interop/useResourceValue.ts) |

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
