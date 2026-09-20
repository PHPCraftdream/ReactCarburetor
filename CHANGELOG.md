# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Removed

- The global `componentUpdateThrottle` singleton, superseded by per-carburetor schedulers.
- A dead hand-written `Partial<T>` that duplicated the built-in TypeScript utility type.
