# Testing tiers

Testing is split into three tiers so that day-to-day work runs only what a change
can actually affect, while full coverage still comes from CI. The mapping from
changed files to checks lives in `scripts/affected.map.json` and is shared by the
local runner and the CI fast tier.

## Tier 1 — task tier (local, per change)

```bash
npm run check:task    # alias of: node scripts/affected.mjs --task
```

The script prints the selected plan first, then runs the checks one at a time,
stopping at the first failure:

```text
files: lib/src/Carburetor/Resource/createAbortHandle.ts
plan: selective
rstest: __tests__/Engine/Resource
       + the cross-subsystem resource suites (ResourceAbortFallback,
         AntiHookComponent lifecycle/receiver/connect, Scope.test.tsx,
         persist/history, subclass40 Resources, Tooling examples behavior)
perf areas: resource, cache, views
- resource subsystem
node scripts/checkLayout.mjs
node node_modules/@rstest/core/bin/rstest.js run \
  __tests__/Engine/Resource \
  __tests__/Engine/Component/Scope.test.tsx \
  ... (and the other cross-subsystem resource suites)
node perf/run.mjs --only resource --runs 3
node perf/run.mjs --only cache --runs 3
node perf/run.mjs --only views --runs 3
check:task OK (6 commands)
```

Typical change → what runs:

| Changed file | What `check:task` runs |
|---|---|
| `lib/src/Carburetor/Resource/x.ts` | layout + rstest `__tests__/Engine/Resource` and the other cross-subsystem resource suites (ResourceAbortFallback, AntiHookComponent lifecycle/receiver/connect resource tests, `Scope.test.tsx`, persist/history, subclass40 Resources, Tooling examples behavior) + perf areas `resource`, `cache`, `views` |
| `lib/src/Carburetor/Component/y.tsx` | layout + rstest `__tests__/Engine/Component`, `__tests__/Engine/Resource/ResourceCache/Views`, `__tests__/Engine/Resource/ResourceCache/Regressions`, `__tests__/Engine/Derived` + perf areas `hooks`, `components`, `selection`, `readset40`, `iterate40`, `subclass40` |
| `lib/src/Interop/x.ts` | layout + rstest `__tests__/Engine/Derived/Readable/Interop`, `__tests__/Engine/Tooling`, `__tests__/Engine/Component`, `__tests__/Engine/Resource` + perf areas `hooks`, `components`, `resource` |
| `perf/scenarios/resource42/*` | its own `resource42` area + transitive importing family `components42` |
| `perf/scenarios/computed42/*` | its own `computed42` area + transitive importing family `computed43` |
| `lib/src/Carburetor/Store/z.ts` | **full tier required** — exit code 2, nothing heavy runs locally |
| `native/src/...` | `cargo test` + the `__tests__/Native` suites (cargo with the explicit `--native` flag; otherwise the command is printed as a hint) |
| changed test helper (e.g. `__tests__/Engine/Resource/ResourceCache/Helpers/TestCache.ts`) | layout + the dependent suites that import it (transitively) |
| `__tests__/setupTests.ts` | full tier — the global test setup affects every suite |
| `docs/*.md` | docsOnly — nothing runs |
| any unmapped file | full tier (fails safe) |

Perf areas need a production build: without `dist/esm-prod` the gate is skipped
with a hint instead of failing. Selected suites that read the build output
require a fresh `dist/` — `check:task` verifies the build stamp (against
`lib/src/**` and `rslib.config.ts`) and fails with a build hint when stale.
`--typecheck` adds `tsc --noEmit`, `--dry`
prints the plan and the commands without running anything.

Documentation examples in README and docs Markdown (excluding `docs/reviews/**` and `docs/checkpoints/**`) are generated from `examples/` and verified by `npm run docs:check`; changes to the public API source trigger the same check in CI independently of `docsOnly`.

## Tier 2 — push/PR tier (CI)

`ci-fast.yml` runs the fast tier over the affected areas on CI hardware: the same
checks tier 1 selects, plus lint and typecheck, combined into one unified
fast-gate check on every push and pull request. Plans are written to the runner's
external temporary directory; first pushes use the merge-base with `origin/master` (or
fall back to the parent SHA). A base commit that is missing after a force-push makes the plan a
full run. The `Checks` job also runs the pure-Node gate-contract freeze check
(`node perf/ci/contract/check.mjs`) before anything heavy.
A `react-18` leg runs when the plan is
full or when Interop/Component files changed (`react18` output).

## Tier 3 — sprint end (full)

`ci.yml` runs the complete suite on schedule, manually via
`gh workflow run ci.yml --ref master`, or on a `sprint-*` tag. Before a release a
green full tier for the exact SHA is mandatory — `release.yml` enforces it, and starts the full tier
itself when the commit has none.

Performance validation and timing attribution are a separate track: dedicated
`ci/**` branches, up to 240 minutes, run manually (see `perf/README.md`).

## How to extend the map

Add a rule to `scripts/affected.map.json`: a `match` (exact path, `dir/**`
prefix or `*.ext` suffix, most specific wins), the `rstest` paths it selects,
its `perfAreas`, and a flag (`full`, `native` or `docsOnly`). An unmapped file
deliberately maps to full, so forgetting a rule fails safe instead of
under-testing. The selector's behavior — including that completeness property —
is pinned by the affected self-test in `__tests__/Tooling/affected`: rules are
prefix-match by specificity, and anything uncovered is deliberately full.

## Known limitations

Tiers 1–2 do not replace the full tier. Cross-cutting effects — shared barrels,
configuration, scripts, the lockfile — all map to full precisely because a local
selective run cannot see them, which is why the full tier also runs on a
scheduled nightly basis.

## Reading the fast tier's result

The `Plan` job writes the selection to its job summary (`full`, `docsOnly`, `native`, the rstest paths
and perf areas, and the reasons). A green `Fast gate` means only that the selected checks passed, so
look at the summary: a docs-only change legitimately skips `Test` and the performance gates, while
a change to workflows, scripts or shared engine code must show `full: true` and run the whole suite.
