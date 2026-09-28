# React compatibility

`react-carburetor` never bundles React: every class extends the `React.Component` your app
installs, and the interop hooks call straight into your app's own React runtime. This page
covers the supported versions, how that binding works, the one hazard specific to this library
(several copies sharing one process) and the generic one that isn't (a duplicate React install),
and how both are tested.

## Supported versions

| Entry | Peer `react` range | Notes |
|---|---|---|
| `.` (core) | `^18.0.0 \|\| ^19.0.0` | React 19.3 and 18.3.1 both run the full test suite in CI. |
| `./interop` | same range, but needs `>=18.0.0` exactly | Uses `useSyncExternalStore`, added in React 18.0; there is no React 17 shim. |

`@types/react` is an **optional** peer, `^18.0.0 || ^19.0.0`: both major versions type-check the
same consumer code cleanly (checked against `@types/react` 18.3.x and 19.3.x). A plain-JS
consumer with no `@types/react` installed gets no peer warning; a TypeScript consumer outside the
range does.

`react-dom` is not a peer dependency at all — nothing under `dist/` imports it. Rendering is
entirely the consumer's job.

## How the library binds to your React

- Every build variant (`esm`, `cjs`, `esm-prod`, `cjs-prod`) imports React as an **external**
  module — `import * as React from "react"` / `require("react")` — never bundled.
- JSX compiles to classic `React.createElement` calls, not the automatic `react/jsx-runtime`
  transform, so there is no dependency on which `jsx-runtime` module a bundler resolves.
- Because `React.Component` is read live from your own `react` install, `class Foo extends
  AntiHookComponent` really does extend *your* `React.Component`, not a vendored one.
- `react-carburetor/lint` has no runtime dependency on React at all.

## Sharing state across copies of the library

Two copies of the library sharing one process — a duplicated install, a monorepo that failed to
dedupe, or the same install loaded through both its CJS and ESM builds — used to each build their
own `CarburetorContext`, update batch, update wave and `getUid()` counter. A
`ScopedAntiHookComponent` bound to one copy's context read `null` under a `<CarburetorProvider>`
built by another, a `transaction()` or `Computed` spanning two copies could batch a write
incorrectly, and two copies minting the same uid could drop one another's settlement or steal
one another's subscription.

These values are now looked up through a shared registry keyed by
`globalThis[Symbol.for('react-carburetor/v1/<name>')]`: the first copy to ask creates the value,
every later copy or module format gets the same one back.

| Shared | Why |
|---|---|
| `CarburetorContext` | `contextType` reads the right scope regardless of which copy rendered the provider. |
| Update batch | `transaction()` batches writes to stores built by any copy, not just the caller's own. |
| Update wave | A `Computed` that defers its settlement is drained regardless of which copy created it. |
| Invalidation edges | Closes a narrow gap: a computed depending on a computed from another copy still gets notified when the inner one fails. |
| `getUid()` counter | Ids from different copies never collide. A collision is not cosmetic: `UpdateWave.defer(uid, settle)` and `Carburetor.subscribe(cb, {id})` both key a registration by uid, so two copies minting the same id would drop one copy's settlement or steal its subscription. |
| `carburetorToken` claimed names | The duplicate-name check sees a name claimed by any copy, not just its own. |

Not shared, by design: the `diagnostics.setEnabled` flag (cosmetic), and the internal per-object
tracking `WeakMap`s, which are always reached through the one copy that owns the data object.

The registry key is versioned (`v1`) on purpose: a future breaking change to what's shared ships
under a new version, so an old and a new copy simply fail to find each other's entry and fall
back to today's per-copy behavior instead of crashing on a shape mismatch.

**Development diagnostic.** When a later call disagrees with the entry already registered — a
different copy, or (for `CarburetorContext` specifically) a different React identity — one
warning fires per value, once:

> two copies of react-carburetor share this process for "\<name>" — a duplicated install, or the
> package loaded through two different module formats at once. Dedupe the install, or make sure
> only one module format is loaded.

If the two copies are also bound to different React installs, a second sentence is appended:

> The copies also imported different React modules — align them to one React install.

This diagnostic, like the rest of the library's development-only checks, is stripped from
production builds.

## Duplicate React installs

The shared registry above only compares copies of *this* library — it has nothing to compare
against when there is exactly one copy of `react-carburetor` in the process, even if that one
copy's own `react` resolution differs from your app's (for example a nested `react` under
`node_modules/react-carburetor/node_modules/react`). That shape is the generic, well-known
"two React copies" hazard, and it can't be detected from inside a single call site — symptoms are
the usual ones for that hazard: a hook throwing "Invalid hook call", a `<Context>` not
propagating, or an `instanceof` check failing silently.

**Diagnosing:**

- npm — `npm ls react` (add `--all` in a large tree) shows every resolved path and version.
- pnpm — `pnpm why react` shows the same, across the workspace.

**Fixing:**

| Tool | Fix |
|---|---|
| npm | `npm dedupe` collapses compatible duplicates; a flat, hoisted `node_modules/react` is the goal. |
| pnpm | A top-level `pnpm.overrides` pinning `react`/`react-dom` to one version forces every dependency to resolve the same copy; run `pnpm dedupe` after changing it. |
| Vite | `resolve.dedupe: ['react', 'react-dom']` in `vite.config`. |
| webpack | A `resolve.alias` pointing `react`/`react-dom` at one physical path pins every import regardless of how many `node_modules` trees resolve them. |
| Monorepo | Keep one `react` version range across every workspace package — hoisting failures are the most common real-world source of this hazard. |

**`npm link` caveat.** A linked package resolves bare imports through its own real path first, so
a linked `react-carburetor` can pick up its own `devDependency` react instead of your app's.
Prefer `npm install <path>` or a `file:` dependency over `npm link` for local testing; if you do
link, link `react` from your app into the library too.

## React Server Components

The modules that touch React's client API carry `"use client"` in every build: the
`AntiHookComponent` class chain, `ScopedAntiHookComponent`, `CarburetorContext`,
`CarburetorProvider`, and the two interop hooks. Everything else — `Carburetor`, `Computed`,
`ResourceCache`, `CarburetorScope`, `carburetorToken`, `transaction`, the tooling — has no
directive and stays importable from a Server Component. The barrels have none either: an RSC
bundler follows their re-exports to the marked files, and a client boundary cannot `export *`.

What this gives a Server Component:

- it can import from `react-carburetor` — a store or cache used on the server — without
  evaluating `createContext` or `React.Component` against the `react-server` build, which does
  not have them;
- a client export it references arrives as a client reference, so a mistake surfaces as React's
  own boundary error instead of `createContext is not a function`.

What stays yours:

- a component extending `AntiHookComponent` or `ScopedAntiHookComponent` lives in your own
  `"use client"` file — the base class is a client reference on the server and cannot be extended
  there;
- `CarburetorProvider` takes a `CarburetorScope`, a class instance, which cannot cross from a
  Server Component as a prop; create the scope inside a client component:

```tsx
'use client';

export function Stores({children}: {children: React.ReactNode}) {
    const [scope] = React.useState(() => new CarburetorScope());

    return <CarburetorProvider scope={scope}>{children}</CarburetorProvider>;
}
```

A store created in a Server Component and a store created in a client module are two separate
instances in two module graphs; server data reaches the client through `scope.dehydrate()` /
`hydrate()`, not by sharing the object.

## Known limitations

**HMR, in this repository's own dev loop only.** Hot-reloading the library's own source
re-evaluates the shared-registry module and mints a new per-module identity, so the next reload
after a source edit logs one harmless "two copies… a duplicated install" message even though
there is exactly one real copy — the shared objects built before the reload stay the ones handed
out. This is specific to hot-reloading `react-carburetor`'s own sources; a consumer's app
hot-reloading its own components never re-evaluates `react-carburetor`'s modules.

## How compatibility is tested

- CI's **Library on React 18** job swaps `react`/`react-dom` to 18.3.1 in the root and demo trees
  and reruns the full internal test suite. The few assertions that observe React's own
  uncaught-error logging and error-replay render counts branch on the installed major at
  runtime, so nothing is skipped.
- `npm run test:consumers` (CI's **Consumer matrix** job) tests the *published tarball*, not repo
  source: it packs the library with `npm pack`, then for each of React 18.3.1 and 19.3.0 crossed
  with npm and pnpm, installs it into a fresh consumer project — 4 installs, each reused for both
  an ESM and a CJS cell, 8 cells total. Each cell:
  - typechecks a fixture consumer — class components, `connect`/`connectSelection`/
    `useComputed`/`useResource`, `CarburetorProvider`, both interop hooks — against that cell's
    own installed `react`/`@types/react`;
  - compiles and renders it through `react-dom/server`, asserting the output and that a
    captured instance is `instanceof` that cell's own `React.Component`.

  One further check reuses an installed cell to `require()` its CJS build and `import()` its ESM
  build in the same process, and asserts the development diagnostic above fires with the
  expected wording.

  The last cells build a Next.js App Router app (Next pinned, React 19) on the same tarball, once
  with Turbopack and once with webpack: a server page imports the package barrel next to two
  `"use client"` subtrees — a connected component, and a provider with a scoped component and both
  interop hooks — and the prerendered page must contain every subtree's output.
- A unit test (`__tests__/Engine/ClientDirective.test.ts`) derives the client set from the sources
  — modules with a value import from `react`, plus everything importing one, barrels excluded —
  and checks that exactly those modules start with the directive, in the sources and in all four
  builds; the production minifier drops it unless configured not to.
