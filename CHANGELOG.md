# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `computed(body)`: a memoized derived value that tracks the paths its body reads, recomputes
  only when one of them is written, and wakes subscribers only when the result changed.
  `AntiHookComponent.useComputed` subscribes a component to the value rather than its inputs.
- `transaction(body)`: writes made inside it are delivered as one update per carburetor,
  however many stores were touched.
- `snapshot()` / `restore()` and a type-erased `toJSON()` / `fromJSON()` bridge, plus
  `watch(paths, callback)` for subscribing outside React.
- `ResourceCarburetor`: async state with an explicit status, request deduplication, abort via
  `AbortSignal`, a serializable error message and `suspend()` for Suspense — class components
  do suspend on a thrown promise, which the test suite pins down.
- Per-request stores: `CarburetorScope`, `carburetorToken`, `CarburetorProvider` and
  `ScopedAntiHookComponent`, which resolves its carburetors through `contextType`, so server
  rendering no longer has to rely on module singletons.
- Tooling: `connectDevTools` (Redux DevTools protocol with time travel, injectable connector),
  `persist` (injectable storage), `CarburetorHistory` (undo/redo over snapshots) and
  `waitForUpdate` for tests.
- Optional `react-carburetor/interop` entry point with `useCarburetorValue` and
  `useComputedValue`, for embedding a carburetor into a hooks-based subtree. Built on
  `useSyncExternalStore`, and it derives the subscription from the selector's read paths.
- ESM output alongside CommonJS, with an `exports` map carrying per-condition types.

- Path-level tracking: `useCarburetor` returns tracked data, and a component subscribes to
  exactly the fields it read. `emitUpdate` wakes only the subscribers whose read paths
  intersect the written ones.
- `draft` write proxy on `Carburetor`, which records changed paths. Writes of an unchanged
  value record nothing and wake nobody.
- `IUpdateScheduler` with two policies: `SyncUpdateScheduler` (default, immediate delivery)
  and `ComponentUpdateThrottle(ms)` for streaming sources. The scheduler is chosen per
  carburetor instead of being global.
- `Carburetor.getVersion()`, used by components to detect a write that landed between render
  and commit.
- Dual licensing under MIT OR Apache-2.0.

### Changed

- Sources are laid out one export per file, with related types grouped in `Models/` and at
  most seven entries per directory. The engine now reads as `Models/`, `Store/`, `Derived/`,
  `Resource/`, `Component/` and `Tooling/`. The published entry points are unchanged.
- `ResourceCarburetor.load(args)` no longer takes the internal notification flag, and its
  argument type defaults to `void`, so a resource without arguments is loaded as `load()`.
- Data read through a carburetor is typed deeply read-only, so the compiler rejects a write
  instead of leaving it to the runtime guard.
- `peerDependencies` widened to React 18 or 19.
- Updates are delivered immediately by default. Previously every update was delayed by a
  global 40 ms throttle window.
- `useCarburetor` returns tracked data instead of the carburetor instance. Data read this way
  is read-only; mutating it throws.
- `AntiHookComponent` owns the React lifecycle instead of monkey-patching the subclass's
  methods in the constructor. Subscriptions are established in the commit phase, so render is
  pure and an abandoned concurrent render leaves nothing behind.
- `preEmmit` / `emmitByKey` renamed to `preEmit` / `emitByKey`.
- Tooling moved to Rslib, Rsbuild, Rstest, oxlint and TypeScript 7; the demo app moved from
  Create React App and Bootstrap to Rsbuild and Tailwind CSS; React upgraded to 19.

### Fixed

- Subscriptions were never released on unmount, so a carburetor kept the component instance
  alive forever and the leak grew with every mount/unmount cycle.
- Updates queued while the throttle was flushing (for example from an effect writing to a
  carburetor) were silently dropped.
- Declaring `componentDidMount` or `render` as a class property in a subclass silently
  disabled all effects, because the field initializer overwrote the constructor's patch.
- Effects ran twice per carburetor-driven update: `forceUpdate` already triggers
  `componentDidUpdate`, which re-ran them.
- A cached nested write proxy kept pointing at a replaced branch, so writes after a nested
  array or object was replaced went to the stale object.
- Notification loops crashed when a subscriber unsubscribed another one while the batch was
  being delivered.

### Removed

- The global `componentUpdateThrottle` singleton, superseded by per-carburetor schedulers.
- A dead hand-written `Partial<T>` that duplicated the built-in TypeScript utility type.
