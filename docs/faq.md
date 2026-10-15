# FAQ

## Why classes instead of hooks?

The core API is hook-free: components extend `AntiHookComponent` (or `ScopedAntiHookComponent`) and read state inside `render()` via `this.useCarburetor`, which records a per-path subscription for exactly the fields the component read. If your codebase is hooks-first, an opt-in entry point, `react-carburetor/interop`, exposes hook readers with the same path precision: `useCarburetorValue`, `useComputedValue` and `useResourceValue`. See [hooks interop in the README](../README.md#hooks-interop).

## Does it work with React 18 and 19?

Yes — `react` (and the optional `@types/react`) are peer dependencies with the advertised range `^18.0.0 || ^19.0.0` in [package.json](../package.json). [react-compatibility.md](react-compatibility.md) covers how the library binds to your React, duplicate installs, RSC, and how compatibility is tested.

## How does it fit RSC / Next.js?

State lives outside the React tree, so the engine itself has no tree-shaped state to conflict with a server renderer. For per-request state, create a `CarburetorScope` per request, register stores with `carburetorToken`, and have components resolve them from `ScopedAntiHookComponent`; scope state can be dehydrated server-side and hydrated on the client. The `no-module-level-store` lint rule is off in the recommended preset (fine for client-only apps) and can be turned on for server-rendered codebases so module-level singletons are reported. See [promise-cache.md](promise-cache.md) for the server-rendering and hydration design notes, and [per-request stores in the README](../README.md#per-request-stores) for the scope/SSR plumbing.

## Why must a method be decorated with `@bind` to be passed as a callback?

Class methods live on the prototype and lose their `this` receiver when passed as a value. `@bind` binds the method to the instance once at construction, so the reference is stable for the component's lifetime. The lint rule `require-bind-for-passed-method` reports a method passed as a value without the decorator; see [rules.md](rules.md) and [hazards.md](hazards.md).

## My component didn't re-render — what are the likely causes?

Common causes: a write through `draft` without publishing (`update()` publishes; a raw write does not); the same plain object placed under two paths, so a write through one path does not match readers of the other; and a computed returning the same object identity after a change, so the unchanged-result check suppresses the update. Each of these has an entry in the [troubleshooting.md](troubleshooting.md) symptom table with diagnostics and fixes.

## How do I test stores?

Stores are plain classes: instantiate one, call its methods, and assert on its state — no renderer, no `act`, no mocked React. For writes that land asynchronously, `waitForUpdate` (exported from `react-carburetor`) resolves on the next notification, with a default timeout of 1000 ms. For component-level testing, see [testing your code in the README](../README.md#testing-your-code) and [testing-tiers.md](testing-tiers.md).

## Is state global?

Only if you make it so. A store is an ordinary object you create — `new CounterCarburetor({value: 0})` at module level is a singleton by your choice, not a requirement. A `CarburetorScope` creates and resolves store instances per context (for example, per server request), and the `no-module-level-store` rule reports module-level singletons where they are inappropriate. See [per-request stores in the README](../README.md#per-request-stores).

## How is it different from Redux?

There are no actions, reducers or middleware. State changes are made by calling methods on the store, which mutate a draft inside `update()` and publish the changed paths. Subscriptions are the paths a component actually read during render, recorded automatically. There is no dispatch layer and no middleware pipeline to configure.

## How is it different from Zustand?

In React Carburetor, a class component reads a store inside `render()` via `this.useCarburetor`, `connect`, or `connectSelection`, rather than through a hook. A hook reader, `useCarburetorValue(store, selector)`, exists in the opt-in `react-carburetor/interop` entry point for hooks-first code. Updates are draft-based: a store method mutates a draft inside `update()` rather than replacing state through a setter.

## How is it different from MobX?

Tracking in React Carburetor is path-based: reads made through the tracked data during render record paths into a plain state tree, and writes invalidate the intersecting paths. There is no observable class, no decorator-based observable graph, and components are class components by default. Effects are declared on the component: override `useEffects` and declare each effect with `this.useEffect(name, callback, deps)`, where `deps` is compared element by element with `Object.is` — see [effects without hooks in the README](../README.md#effects-without-hooks).

## Why don't the lint rules accept options?

The rules are native, and configuration accepts severity only — `error`, `warn` or `off`; a legacy `[severity, options]` payload may sit in host configuration but native rules do not consume options. Recognition is likewise fixed and syntactic: store bases named `Carburetor` and `ResourceCarburetor`, component bases named `AntiHookComponent` and `ScopedAntiHookComponent`, and a `render` method. See [rules.md](rules.md) and [npm/carburetor-lint/README.md](../npm/carburetor-lint/README.md).

## How big is it, and how fast?

This document makes no size or performance claims, and no published performance guarantees exist. Qualitative design boundaries — what the promise cache deliberately does and does not do — are in [promise-cache.md](promise-cache.md).

## How do I suppress a lint report?

Use `// carburetor-disable-next-line <rule>` for a single line or `// carburetor-disable <rule>` for a whole file. Either directive without a rule list silences all carburetor rules. See [rules.md](rules.md).

## A rule fired wrongly — where do I report it?

[hazards.md](hazards.md) documents, per hazard, where each rule can produce a false positive — check the relevant hazard first. If it is a genuine false positive or a case the catalogue does not cover, open an issue at https://github.com/PHPCraftdream/ReactCarburetor/issues.

## I build `IResourceData` / `IResourceEntry` objects myself — what do the status flags require?

Resource state carries four boolean flags derived from `status`: `isIdle`, `isPending`,
`isSuccess`, `isError`. If you build `IResourceData`, `IResourceEntry`, `IResourceView` or
`IResourceSnapshot` objects by hand — your own `IResourceSource`, test fixtures, seeded stores —
set all four: exactly one is `true`, the one matching `status`. Payloads you restore
(`restore()`, `fromJSON()`, cache hydration, `persist`) do not need them: the library recomputes
the flags from `status` and ignores stored values, so payloads saved before the flags existed
still load.
