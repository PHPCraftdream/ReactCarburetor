# Examples

This catalog contains runnable, self-contained examples covering the whole public API of the library. Each example is a standalone TypeScript snippet that can be read on its own, without reading the surrounding documentation first. Every TypeScript block marked `<!-- example:compile -->` is typechecked by `npm run check:examples`.

## Examples

- [stores.md](stores.md) — creating stores, draft/update writes, transactions, history/undo, persist.
- [derived.md](derived.md) — computed values and factories.
- [components.md](components.md) — AntiHookComponent/ScopedAntiHookComponent, connect/connectSelection, effects, bind.
- [resources.md](resources.md) — ResourceCarburetor and ResourceCache (TTL, limits, hydration).
- [hooks.md](hooks.md) — the hooks interop layer from 'react-carburetor/interop' (useCarburetorValue, useComputedValue, useResourceValue).
- [tooling.md](tooling.md) — devtools, waitForUpdate, scope/SSR plumbing.
- [lint.md](lint.md) — oxlint/ESLint/standalone CLI setup for the lint rules.

## Choosing an API

| Task | API | Example |
| --- | --- | --- |
| Read store state in a class component | `this.useCarburetor(store)` inside AntiHookComponent | [components.md](components.md) |
| Read store state in an existing hook-based component | `useCarburetorValue(store, selector)` from 'react-carburetor/interop' | [hooks.md](hooks.md) |
| Subscribe to a derived value | `Computed` / `this.useComputed(computed)`; hook: `useComputedValue` | [derived.md](derived.md) / [hooks.md](hooks.md) |
| Precise selection with comparator | `this.connectSelection(...)` | [components.md](components.md) |
| Declare a one-off connection | `this.connect(...)` | [components.md](components.md) |
| Pass a store method as a callback | decorate it with `@bind` | [components.md](components.md) |
| Async data with TTL and eviction | `ResourceCache` | [resources.md](resources.md) |
| Single async resource | `ResourceCarburetor` | [resources.md](resources.md) |
| Isolate stores per request (SSR/testing) | `CarburetorScope` / `ScopedAntiHookComponent` | [tooling.md](tooling.md) |
| Undo/redo | `CarburetorHistory` | [stores.md](stores.md) |
| Durable state | `persist(carburetor, {key, storage})` | [stores.md](stores.md) |
| Catch state mistakes early | lint presets / `carburetor-lint` | [lint.md](lint.md) |

## Defaults

| Setting | Default | Where |
| --- | --- | --- |
| ResourceCache `ttl` | 30_000 ms | [resources.md](resources.md) |
| ResourceCache `maxEntries` | 100 entries | [resources.md](resources.md) |
| ResourceCache `keyCacheSize` | 4096 memo records | [resources.md](resources.md) |
| Component update throttle (`updateTimeout`) | 40 ms | [components.md](components.md) |
| CarburetorHistory `limit` | 50 entries | [stores.md](stores.md) |
| `persist` write coalescing | on (one stringify per microtask) | [stores.md](stores.md) |

`maxEntries` is an eviction target, not a hard cap (entries with in-flight requests or readers are skipped); freshness is lazy — no timer is installed.

Behavioral examples are verified by tests, not just typechecked.
