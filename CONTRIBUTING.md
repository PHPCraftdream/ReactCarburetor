# Contributing

Thanks for taking the time. This project has a narrow design thesis, so the most useful
contributions are the ones that sharpen it rather than widen it.

## Design rules

- **No hooks in the public API.** State lives outside the tree; components are classes.
  A change that requires consumers to write hooks is out of scope.
- **Never create an unnecessary re-render.** Precision beats smoothing. If something
  re-renders too often, fix the invalidation, don't add a delay.
- **Render stays pure.** Subscriptions are established in the commit phase, never during render.
- **Never miss an update.** When the changed paths cannot be known, fall back to invalidating
  everything rather than guessing.

## Project layout

Two structural rules keep the tree navigable:

- **One export per file.** A file carries a single class, function, constant or enum, and is
  named after it. The exceptions are `Models.ts` files (and the `Models/` folder), which group
  related types and interfaces, and `index.ts` barrels, which only re-export. Type-only files
  are always named `Models.ts` so the rule can be checked mechanically.
- **Enums instead of string unions.** A closed set of values is an enum in `Models/Enums/`
  (`EResourceStatus`, `EDevToolsAction`), not a union of string literals, and never a bare
  string literal in a comparison — a typo should be a compile error, not a branch that never
  runs.
- **At most seven entries per directory.** When a folder outgrows that, its contents are
  regrouped into subfolders by meaning rather than left as a flat list.

Singletons live next to their class in a file suffixed with `Instance`
(`SyncUpdateScheduler.ts` and `SyncUpdateSchedulerInstance.ts`) — two files differing only
in the first letter's case would collide on case-insensitive filesystems.

The engine is grouped as `Models/` (types), `Store/` (the carburetor and its machinery:
paths, tracking proxies, transactions, schedulers), `Derived/` (computed values),
`Resource/` (async state), `Component/` (React integration) and `Tooling/` (devtools,
persistence, history, test helpers). The optional hooks bridge lives in `lib/src/Interop`.

## Getting started

```bash
npm install
npm run build       # Rslib: bundleless CJS + declarations via tsgo
npm run typecheck   # TypeScript 7
npm run lint        # oxlint, including type-aware rules
npm test            # Rstest + @testing-library/react
```

The demo app has its own package:

```bash
cd lib && npm install && npm start
```

Note that the repository does not commit lockfiles, so use `npm install` rather than `npm ci`.

## Pull requests

- Keep the four commands above green. A failing or flaky test is fixed in the same change,
  not deferred.
- Add a regression test for every bug fix. Several of the subtle bugs in this codebase were
  only visible through tests that render real DOM, so prefer a test that exercises the
  component path over a unit test of an internal helper.
- Comments and identifiers are in English, and comments explain *why*, not *what*.
- Don't bump the package version or dependency versions as part of a feature change.

## Licensing of contributions

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as MIT OR Apache-2.0, without any additional terms or conditions.
