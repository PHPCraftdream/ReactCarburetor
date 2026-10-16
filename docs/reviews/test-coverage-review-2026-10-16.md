# Test coverage and performance-gate review — 2026-10-16

## Scope

Branch `master`, HEAD `f124880`. Topic: how well the automated checks protect the public behaviour
and the documented guarantees, and how well the performance gates protect earlier optimizations.

Covered:

- rstest suites under `__tests__/` (Engine, Plugin, Native, Tooling, Demo), together with
  `rstest.config.ts`, `tsconfig.types.json` and `__tests__/setupTests.ts`;
- Rust unit tests in `native/src/**` and the integration tests in `native/tests/`;
- `scripts/consumerMatrix.mjs` and `scripts/consumer-matrix/**`;
- `perf/run.mjs`, `perf/harness/*`, `perf/gates/*.mjs`, `perf/scenarios/**`, `perf/ci/**`
  (the gate contract, the A/B comparison and the smoke runs), and `benchmarks/`;
- `.github/workflows/ci-fast.yml`, `ci.yml`, `performance.yml`, `timing-diagnostics.yml`, plus
  `release.yml` where it depends on the full tier;
- `scripts/affected.mjs` and `scripts/affected.map.json`, which select the fast tier;
- the guarantees stated in `README.md`, `docs/testing-tiers.md`, `docs/react-compatibility.md`,
  `docs/promise-cache.md`, `docs/rules.md` and `perf/README.md`.

Not covered: whether the library code is correct, except where a missing test lets a concrete
regression through.

## Method

The review was static and read-only. I read code and used read-only git (`log`, `show`, `diff`,
`ls-tree`, `grep`). I ran no tests, benchmarks, builds or coverage tools, so no runtime result is
claimed.

Each finding is labelled with one of two tags:

- **OBSERVED**: read directly from code, config or git history.
- **INFERRED**: a consequence reasoned from the observed facts, not reproduced.

Priorities:

- **P1**: a protection that the project believes it has, but that is dead or already bypassed.
- **P2**: a realistic regression class that would pass every tier today, or would be caught only by
  the nightly run.
- **P3**: hardening, flake risk, or wording.

## Overall assessment

The engine suite is unusually deep: 326 test files, about 2,500 tests by the last acceptance count,
and 471 gate entries. Several practices are strong and worth keeping:

- `__tests__/setupTests.ts` fails any test that writes to `console.error` or `console.warn`. React's
  own warnings (a getSnapshot result that is not cached, act warnings, key warnings) therefore fail
  tests instead of scrolling past.
- Positive controls are the norm. For example, the `completeReads` work test counts calls on
  `String.prototype` and asserts both `>= 10000` and `<= 100000`.
- `perf/README.md` requires every gate to be checked in both directions against a pre-fix baseline.
  The runner fails on a missing metric and on any metric that is not a number.
- There is a React 18 leg, a packed-tarball consumer matrix (npm and pnpm × React 18 and 19 × ESM and
  CJS, plus Next.js), and a real Chrome smoke test.

The weak points are mostly in the plumbing around the tests, not in the tests themselves:

- the gate-freeze contract is enforced only in a manual workflow, and has already drifted;
- one compile-time contract test has never been compiled;
- the fast tier can select far less than a change affects;
- some timing "gates" cannot fail;
- development-build performance is not measured at all.

## Coverage map

In the fast-tier column, "full" means the change escalates to the full suite, and "sel" lists the
selective rstest paths and `--only` perf areas that `scripts/affected.map.json` chooses.

| Area (`lib/src/...`) | rstest suites (approx. files) | Perf gate families | Fast tier for a change here | Gaps (finding) |
|---|---|---|---|---|
| Store core: `Store/Paths` (WriteLog, Diff, Markers), `Store/Transaction` | `Engine/Store/**` (~113), `Engine/Tooling/history/**` | `writelog39`, `diff39`, `write`, `replace36`, `subscribe`, `subscribe42`, `subscribers`, `readset40`, `delivery`, `store`, `state`, `drift36`, `trackrelease39` | full | Dev-build cost ungated (TEST-07); `trackedPairs` sentinel (TEST-11) |
| Store tracking: `Store/Tracking` (Proxy, Positional, Aliases, Observation) | `Engine/Store/Tracking/**` (~35) | `reads`, `readenum`, `aliases`, `alias39`, `aliases43`, `iterate40`, `array`, `descriptors` | full | Tests pinned to internals (TEST-21) |
| Selection and patches: `Store/Utils/Selection/**` | `Engine/Store/Carburetor/Selections/**`, `Engine/Component/AntiHookComponent/selection/**` | `selection`, `selection31`–`selection44` | full | — |
| Scheduling: `ComponentUpdateThrottle`, `UpdateWave` | `Engine/Store/Scheduling/**`, plus 27 files that use a throttle with real timers | `delivery/throttle-cancel` | full | Window semantics untested (TEST-06) |
| Derived: `Derived/**`, `Freshness` | `Engine/Derived/**` (~31) | `computed`, `computed41`–`computed44`, `derived`, `liveresult`, `readable` | full | Timing lanes with `min: 0` (TEST-05) |
| Resources: `Resource/Cache`, `Slot`, `Keys`, `Status` | `Engine/Resource/**` (~80), plus about 12 files elsewhere | `resource`, `resource39`–`resource44`, `resource-retention41`, `cache`, `cache40`, `views` | sel: `Engine/Resource` + 2 lifecycle files; perf `resource`, `cache` | Dependent tests outside `Engine/Resource` not selected (TEST-03); `views` area not selected (TEST-10); `answerMemory` retention (TEST-09) |
| Components: `Component/AntiHookComponent`, `Connection`, `Scope` | `Engine/Component/**` (~41), `Engine/Derived`, parts of `Engine/Resource` | `components`, `components42`–`components44`, `hooks` | sel; perf `hooks`, `components` | `selection*`, `readset40`, `iterate40`, `subclass40/component-delivery` not selected (TEST-10) |
| Interop hooks: `lib/src/Interop` | `Engine/Tooling/Interop*`, `Engine/Derived/Readable/Interop`, `Engine/Tooling/core/**` | `hooks`, `hooks43` (SSR on React 18 and 19, requires a matrix cell), `hooks44`, `resource40`, `resource41` | sel; perf `hooks`, `components`, `resource` | React 18 checked nightly only (TEST-04); streaming SSR (TEST-18) |
| Tooling: history, persist, devtools, scope dehydrate | `Engine/Tooling/**` (~33), `Engine/Component/Scope.test.tsx` | `history*`, `store/r33-persist`, `store/dehydrate`, `contracts/devtools` | full | `store/dehydrate` is gated by timing only (TEST-12) |
| Public typed surface | `tsconfig.types.json` (10 includes), `Tooling/examples/exportCoverage` | — | typecheck always runs | Dead R33-08 contract and an orphan `Contract.types.ts` (TEST-02) |
| Native lint rules (`native/src/rules`) | about 470 cargo unit tests, 35 CLI integration tests, `__tests__/Native` (4 files), `__tests__/Plugin` | none | `cargo test` + clippy; `test:rules`; `__tests__/Native` **not** run | `no-computed-get-in-render` has 0 unit tests (TEST-08); conformance compares the binary with itself (TEST-17); no throughput gate (TEST-19) |
| Packaging and consumers | consumer matrix (8 cells + Next.js), packed-lint smoke, browser smoke | `hooks43` (`--require-all`) | nightly only | pnpm skips pass silently (TEST-15); React 18.0–18.2 and the Node engine floor never run (TEST-04, TEST-20) |
| Gate manifests (`perf/gates`) | `Tooling/gateContract` (tests only the classifier function) | gate contract in `perf/ci` | area only; contract check **not** run | Freeze bypassed (TEST-01) |
| Tier selector | `Tooling/affected`, `Tooling/checkTask` | — | self-test | The `__tests__/**` "self" rule (TEST-03) |

## Findings

### TEST-01 (P1, OBSERVED): the gate freeze is not enforced where merges happen, and has already drifted

**Location:** `perf/ci/run.mjs:53-60`, `perf/ci/compare.mjs:23-29`,
`perf/ci/contract/gate-amendments.json`, `.github/workflows/performance.yml`, `ci-fast.yml`, `ci.yml`.

**What is weak.** The "frozen gate contract" works like this: each `perf/gates/*.mjs` file is hashed
and compared with the same file at baseline `acfd3e2` (2026-10-12), unless a registered amendment
covers it. That check runs only in `npm run bench:ci`, which only `performance.yml` calls, and that
workflow runs only on `ci/**` pushes or manual dispatch.

- `ci-fast.yml` and `ci.yml` run `node perf/run.mjs`, which reads whatever thresholds are currently
  in the files.
- `__tests__/Tooling/gateContract` tests only the three-way classifier `gateContractStatus()`. It
  never hashes the real files.

**Current state:**

- `git diff acfd3e2 HEAD -- perf/gates` changes five frozen files. Only `hooks43.mjs` and
  `writelog39.mjs` have amendments.
- `cache.mjs` changed (a comment only, in `b841490`).
- `cache40.mjs` (in `484561a`): the budget of write-proxy traps per settle rose from 9/6 to 12/9.
  `sets` rose from 7/4 to 9/6, and `gets` from 2 to 3. That is 33% more work on every settle,
  accepted by editing the gate in the same feature commit.
- `subclass40.mjs` changed (`slotCorrect` 5→7, `controls` 12→14).
- Every phase of `performance.yml` runs the hash loop before it branches. The next validation run
  will therefore throw `Gate contract changed without amendment: cache.mjs` (INFERRED from the code;
  not run).
- The six files added after the baseline (`components44`, `computed44`, `history44`, `hooks44`,
  `resource44`, `selection44`) are not frozen at all.

**Regression that passes today.** A PR doubles a counter bound (for example
`cache/eviction-scaling coldWorkPerLoad <= 3` becomes `<= 6`) in the same commit that makes the code
slower. `ci-fast` runs `--only cache` against the loosened file and goes green; so does the nightly
`ci.yml`. Nobody notices until someone dispatches Performance validation, and by then it is
indistinguishable from the cache40 drift above.

**Proposed fix:**

- Add a `Gate contract` step to the `plan` (or `checks`) job of `ci-fast.yml`, and to `ci.yml`. It is
  a pure Node script with no build or install, and should run whenever `perf/gates/**` or
  `gate-amendments.json` is in the diff. It should fail on `changed without amendment`.
- Hash a normalized manifest, `JSON.stringify` of `{id, scenario, args, nodeArgs, gates}` per entry,
  instead of the file text. Comment edits such as the `cache.mjs` one then stop tripping the
  contract, and real contract edits still do.
- Add a ratchet rule: for `equals` and `max` on counters, a new value that is looser than the
  baseline needs an amendment carrying a `reason`; a tighter value passes freely.
- Re-baseline, or explicitly freeze, the six `*44` files. Register amendments for `cache40.mjs` and
  `subclass40.mjs` (or revert them), and record the reason for the trap increase.
- Turn `__tests__/Tooling/gateContract` into a test of the real files: it should load the baseline
  hashes and assert that every gate file is either unchanged or amended.

### TEST-02 (P1, OBSERVED): the R33-08 public-surface type contract has never been compiled; a second types file is orphaned

**Location:** `__tests__/Engine/Store/PublicApi` (no file extension), `tsconfig.types.json`,
`__tests__/Engine/Store/Scheduling/subclass40/Contract.types.ts` and its `tsconfig.json`.

**What is dead.**

- Commit `4da99c4` (2026-10-05) added the R33-08 visibility contract as a file literally named
  `PublicApi`, with no extension.
- `tsconfig.types.json` includes `__tests__/Engine/Store/PublicApi/R3308Visibility.types.test.ts`,
  a path that does not exist (`git ls-files` confirms). `include` is a glob list, so tsc silently
  ignores a pattern that matches nothing.
- rstest's `include: ['__tests__/**/*.test.{ts,tsx}']` does not match the file either.
- Its own header claims "Checked by `tsc --noEmit -p tsconfig.types.json`". In fact nothing has ever
  checked its `@ts-expect-error` lines. The file was even edited in `b841490` without anyone
  noticing.
- Similarly, `subclass40/Contract.types.ts` is referenced only by `subclass40/tsconfig.json`, which
  no script or test invokes. Its intent is partly duplicated by `built/consumer.ts`, which
  `Declarations.test.ts` does run.

**Regression that passes today.** Someone makes `ResourceCache#getEntryByKey` or
`Computed#getSnapshotVersion` public again under a string name. The R33-08 directives would stop
being satisfied (TS2578), but they never run.

**Proposed fix:**

- Rename the file to `__tests__/Engine/Store/PublicApi/R3308Visibility.types.test.ts`.
- Switch `tsconfig.types.json` from `include` to `files`. tsc reports TS6053 for a missing `files`
  entry, so a path typo becomes a hard error.
- Add `__tests__/Tooling/typesCoverage.test.ts`. It should assert two things: every entry in
  `tsconfig.types.json` exists; and every `*.types.ts`, `*.types.test.ts(x)` or `*.typing.ts` under
  `__tests__` is either listed there or imported by a listed file. Today
  `subclass40/Contract.types.ts` would fail that check.
- Either add `Contract.types.ts` to the types config or delete it as superseded.

### TEST-03 (P2, OBSERVED map / INFERRED runner behaviour): the selective tier misses dependents of helpers, of resources and of the native crate

**Location:** `scripts/affected.map.json` and `scripts/affected.mjs`, in `select()` (the `self`
rule and the per-directory rstest lists).

**Problem (a): changed test helpers select only the helper itself.** A changed file under
`__tests__/**` maps to itself (`"self": true`), even when it is a helper. Examples:

- `__tests__/setupTests.ts`, the global console guard used by every test;
- `__tests__/Engine/Component/AntiHookComponent/support.tsx`, about 31 importers;
- `__tests__/Engine/Resource/ResourceCache/Helpers/TestCache.ts`, about 26 importers;
- `__tests__/Engine/Store/Carburetor/fixtures.ts`.

The plan then becomes `rstest run <helper path>`, which matches no test file. Depending on how rstest
treats "no tests found", this either goes green having run nothing, or fails with a confusing
message. Either way the 26–31 dependent suites do not run. `__tests__/Tooling/affected` has no case
for this rule.

**Problem (b): the resource rule omits resource tests that live elsewhere.** It selects
`__tests__/Engine/Resource` plus two lifecycle files. It omits:

- `__tests__/Engine/ResourceAbortFallback.test.ts`: the AbortController fallback test for
  `Resource/Slot/createAbortHandle.ts`, which is the very file `docs/testing-tiers.md` uses as its
  worked example;
- `lifecycle/custom-resource-source`, `lifecycle/render-attempts`;
- `receiver/SsrHydration/READMERecipe` (it spies on `ResourceCacheLifecycle.prototype.runLoad`);
- `receiver/rel4/suspense-refresh`, `connect/connect-subscriptions`;
- `Component/Scope.test.tsx` (ResourceCarburetor `toJSON`);
- `Tooling/core/persist/PersistenceResource`, `Tooling/history/HistoryNativeOwnership`;
- `Store/Scheduling/subclass40/Resources`, `Tooling/examples/behavior`.

**Problem (c): native changes do not run the `__tests__/Native` suites.** `native/**` maps to
`native: true, rstest: []`. The `checks` job builds the binary and runs `test:rules`
(`__tests__/Plugin`), but not `__tests__/Native`. That leaves out:

- `examples.test.ts`, whose "proper examples are clean under native defaults" check is the main
  false-positive corpus for the rules;
- `severities.test.ts` (native default severities against the JS preset);
- `conformance.test.ts`.

**Regressions that pass the fast tier:**

- A change to `createAbortHandle.ts` that breaks the fallback when `AbortController` is missing.
- An edit to `support.tsx` that breaks 31 component suites.
- A `config.rs` severity change that diverges from `plugin/recommended.oxlintrc.json`.
- A rule change that starts flagging a clean example.

All of these turn red only nightly.

**Proposed fix:**

- For a non-`*.test.*` file under `__tests__/`, select the files that import it, reusing the
  import-graph walk that `reverseFamilies` already performs for perf scenarios. Map `setupTests.ts`
  and `reactActEnvironment.ts` to `full`.
- Add the listed files to the resource rule. A better long-term option is to derive dependents
  automatically: run `rstest` over every test file that imports from `lib/src/Carburetor/Resource`.
- Add `__tests__/Native` to the `native/**` rule. Add `select.test` cases for all three.

### TEST-04 (P2, INFERRED): React 18, packed-consumer and engine-floor regressions are found only nightly

**Location:** `ci-fast.yml` (no `react-18` or `consumer-matrix` job), `ci.yml:react-18`
(`npx rstest run __tests__/Engine __tests__/Demo`), `docs/react-compatibility.md:13`.

**What is weak:**

- The fast tier never runs the React 18 leg or the packed consumer matrix, even when the selector
  escalates to `full`: a lockfile bump, `@types/react`, `rslib.config.ts`, workflows.
- The React 18 leg excludes `__tests__/Tooling`, which holds the README example behaviour tests,
  including `readme/ResourcesSuspense` and `HistoryPersistence`.
- The peer range `^18.0.0` is exercised only at 18.3.1, and the docs admit this.
- The README's testing guidance specifically talks about the 18.0 floor (React's own `act` is
  missing there).

**Regressions that pass:**

- A dependency bump changes `@testing-library/react` or the act environment so that the tests
  behave differently on React 18.
- An Interop change uses a React 18.3-only behaviour of `useSyncExternalStore`.

PRs merge green; master turns red the next night. Release is still protected, because
`release.yml` requires a green `ci.yml` run for the exact SHA, but blame is spread across a day of
merges.

**Proposed fix:**

- In `ci-fast.yml`, run the existing `react-18` job when `full == 'true'`, or when `lib/src/Interop/**`
  or `lib/src/Carburetor/Component/**` is in the plan.
- Add `__tests__/Tooling/examples` to the `react-18` rstest paths.
- Add one consumer-matrix cell on `react@18.0.0` (or 18.2.0) with npm and ESM: typecheck, plus a
  `renderToString` of the fixture.

### TEST-05 (P2, OBSERVED): timing lanes are "gated" by checks that cannot fail

**Location:**

- `perf/gates/resource43.mjs:65-76` (`resource43/lookup-operations`, R43-R02);
- `resource44.mjs:55-66` (`completed-operations`);
- `hooks44.mjs:7-12` (`multi-consumer@{1,4,8}-{native,external}`, R44-A02);
- `components43.mjs:14` and `components44.mjs:13` (`renderCommitMs`);
- `history43.mjs:18` (`updatePublicationMs`);
- `computed43.mjs:44` (`childTimeoutMs equals 30000`, a constant the scenario sets itself).

**What is weak.** `{metric: 'xMs', min: 0}` holds for every completed run; it only proves the metric
exists. `childTimeoutMs equals 30000` asserts a constant in the scenario's own configuration. Six
`hooks44/multi-consumer` entries labelled R44-A02 gate only counts that the scenario fixes in its
arguments (`consumers`, `publications`, `checks = 1000`). These entries add to the 471-entry figure
quoted as protection, but none of them can detect a slowdown.

**Regression that passes.** Consumer fan-out becomes O(consumers²). For example, each publication
re-checks every consumer against every other one. `checks` stays at 1000 by construction, the
`*Ms` values grow eight-fold at `@8`, and every gate still passes.

**Proposed fix:**

- Use the machine-independent `scale` gate that the suite already uses elsewhere:
  `hooks44/multi-consumer@8-*`, `{metric: 'checksMs', scale: {from: 'hooks44/multi-consumer@1-*'}, max: 12}`.
  Linear growth gives about 8×; quadratic gives about 64×.
- Better still, emit a work counter per publication (snapshot comparisons, subscriber visits) and
  gate it exactly.
- For `lookup-operations`, gate a canonicalization counter: key-serialization calls per object-key
  hit should be 0.
- Have `--lint-gates` warn on `min: 0` for `*Ms` metrics, and stop counting such entries as
  protection in the README tallies.

### TEST-06 (P2, OBSERVED): the throttle window has no deterministic test

**Location:** `__tests__/Engine/Store/Scheduling/ComponentUpdateThrottle.test.ts` (real
`setTimeout` sleeps of 100 ms against the default 40 ms window, and 30 ms against 10 ms), and 27
test files that use a `ComponentUpdateThrottle`. Only two files in the whole suite use fake timers
(`ResourceCache.test.ts`, `Tooling/examples/behavior.test.tsx`).

**What is unprotected.** The scheduling contract in `ComponentUpdateThrottle.ts` is that "the armed
flush timer ... keeps setupTimeout() from sliding the window" (a throttle, not a debounce), and that
nothing flushes before `updateTimeout`. No test schedules continuously across several windows, and
no test asserts silence just before the window ends. Every test schedules, sleeps well past the
window, and then checks the result.

**Regression that passes.** `setupTimeout` re-arms on every `schedule` (a debounce). A presence
stream that pushes every 10 ms, the use case the class documents, then never flushes while the stream
continues. Every existing test still passes, because each one stops scheduling before it sleeps.
The reverse also passes: a window collapsed to `setTimeout(0)` is caught only by the synchronous
`expect(values).toEqual([])` checks.

**Proposed fix.** Add `ComponentUpdateThrottleWindow.test.ts` with fake timers:

- schedule uid `a` every 10 ms for 200 ms with a 40 ms window;
- assert flush times of exactly 40/80/120/160/200 ms (5 flushes);
- assert no flush at 39 ms;
- assert that the last value of each window is the one delivered.

Converting the existing sleeps to fake timers also removes a source of hosted-runner flakiness.

### TEST-07 (P2, INFERRED): development-build performance is not measured anywhere

**Location:** `perf/harness/measure.mjs:17-19` (always sets `NODE_ENV: 'production'`), `perf/run.mjs`
(default `dist/esm-prod`), `benchmarks/state/unpublishedDraftCheck.mjs` (not referenced by any
workflow or script), `perf/README.md` ("Outside the suite").

**What is unprotected.** Development builds run validation on every draft write, according to the
README: they throw on symbol keys and non-data properties at the constructor, `setData`, `restore`
and every `draft` write. They also run the alias diagnostic, the unpublished-draft check and the
duplicate-copy registry. Every consumer's dev server and test run uses that build. No gate, counter
or benchmark in CI touches it.

**Regression that passes.** The per-write validation starts walking the whole state instead of the
written path: O(state) per write. Tests use small states and stay fast. The production gates do not
include the code. Users' dev loops on 10k-row stores slow down a hundredfold.

**Proposed fix.** Add a `dev` perf area. Its scenarios run with `--dist dist/esm` and
`NODE_ENV=development`. Gate counters, not time:

- validation node visits for a single-leaf `draft` write on a 10k-row store, with an exact or small
  constant bound;
- a scale gate of 50k rows against 10k of `<= 1.2`;
- a positive control: a full `setData` visits about N nodes.

Fold `unpublishedDraftCheck` into it as a counter gate (callback identities per cycle).

### TEST-08 (P2, OBSERVED): `no-computed-get-in-render` (severity `error`) has no unit tests

**Location:** `native/src/rules/data/reads/no_computed_get_in_render.rs`: 52 lines and the only rule
file without a `#[cfg(test)]` module. Its only coverage is one positive occurrence in
`plugin/__fixtures__/data/reads.tsx:23`, counted by `__tests__/Plugin/host.test.ts` and by the
conformance corpus.

**What is unprotected.** The rule's only precision device is `call.arguments.is_empty()`, which
keeps `Map.get(key)`, `FormData.get(name)` and similar calls from being reported. The fixture
contains no call to a keyed `get`. The render-context exemption for nested handlers comes from the
shared walker, but is not pinned for this rule either. The rule is `error` in `recommended`, so a
false positive breaks consumers' lint runs.

**Regression that passes.** The argument guard is dropped or inverted during a refactor of
`member_call_name`. Every `cache.get(key)` or `params.get('q')` in render then becomes an error, and
all current tests still pass: the fixture has exactly one zero-argument `get()`, and the clean
examples happen not to call a keyed `get` in render.

**Proposed fix.** Add unit tests using `support::testing::diagnose`:

- `visibleCount.get()` in `render` → `[line]`;
- `map.get(key)` in `render` → `[]`;
- `onClick={() => visibleCount.get()}` in `render` → `[]`;
- `get()` in `componentDidMount` → `[]`;
- `get()` in `render` of a class that does not extend a component base → `[]`.

Add one keyed `get` in render to `reads.tsx` as a negative control.

### TEST-09 (P2, INFERRED): the new answer memory has no retention or bound protection

**Location:** `lib/src/Carburetor/Resource/Slot/answerMemory.ts` (new in `b841490`);
`__tests__/Engine/Resource/Handles/AnswerMemory.test.ts`, `MemoryOwnership.test.ts`; `README.md:659-660`.

**What is weak.** The memory is a runtime-only `Map` per `ResourceCarburetor`, and the behaviour tests
for it are good: LRU order, ttl expiry, ownership of late answers. What is missing:

- **No liveness check.** Unlike `resource41/retention-live-cache` and the cache retention tests,
  nothing checks that `clear()`, `forget` or eviction let the remembered payloads be garbage
  collected.
- **No bound check.** No test or gate covers memory size with many distinct keys.
- **Expired entries stay forever (from the code).** `fresh()` returns `undefined` for an expired
  entry but keeps it. Without `maxEntries` (the default), a slot driven by distinct arguments,
  such as search-as-you-type, keeps every answer for the life of the slot.
- **The docs disagree with the code.** `README.md:660` says `maxEntries` "bounds how many earlier
  answers are remembered per key", while the code and tests bound the total across keys.

**Regression that passes.** `forget(key)` stops deleting from the memory, or `clear()` reassigns a
new `Map` while a closure keeps the old one. Behaviour tests that only check `loader.calls` after a
`clear()` can still pass if the stale map is no longer consulted, while the payloads leak.

**Proposed fix:**

- A GC-enabled child test, in the style of the existing retention scenarios. Load 10k distinct keys
  with `maxEntries: 200`, then assert `memory.size <= 200` and payload survivors `<= 200 + slack`.
  After `clear()`, assert that `WeakRef`s to the payloads collect within the existing job-boundary
  GC budget.
- A gate entry `resource44/answer-memory-retention@10k` with the counters above.
- Decide on purge-on-expiry, then pin whichever behaviour is chosen. Fix the "per key" wording.

### TEST-10 (P3, OBSERVED): perf areas in the fast tier miss gate families that exercise the changed code

**Location:** `scripts/affected.map.json` `perfAreas`. These are substrings matched against entry ids
and file names.

**What is missing:**

- A Resource change runs `resource` and `cache`. Those match `resource*`, `cache*`,
  `delivery/cache-views` and `state/resource-history`, but not `views/*`: three entries, including
  R10-06 `views/set-data-identity@4000` (`newViews = 0`), the ResourceCache view-identity
  mechanism.
- A Component change runs `hooks` and `components`. Those miss `selection31`–`selection44`
  (class-selection precision through `connect`/`connectSelection`), `readset40` (class rows file 2
  paths), `iterate40/parent-render`, `subclass40/component-delivery` and `reads/live-readers`.

**Regression that passes the fast tier.** A Component change that makes class rows file extra paths
(`readset40/filed-paths`) or re-render on equal branch switches (`selection*`). It is caught nightly.

**Proposed fix.** Add `views` to the Resource rule. Add `selection`, `readset40`, `iterate40` and
`subclass40` to the Component rule; the extra time is small compared with the full sweep. Extend
`mapCoverage.test.ts` to check that every gate family whose scenarios import a module under a rule's
`match` is listed in that rule's `perfAreas`.

### TEST-11 (P3, OBSERVED): a sentinel `-1` makes a cap gate pass without measuring anything

**Location:** `perf/scenarios/writelog39/raw-retention.mjs:50`
(`engine(store, 'writeLog')?.targets?.count ?? -1`), `perf/gates/writelog39.mjs:38`
(`trackedPairs max 2048`). `perf/README.md:251` already notes that this gate "holds trivially" on an
older build.

**Regression that passes.** `writeLog.targets` is renamed or restructured. `trackedPairs` becomes
`-1 <= 2048` and the retained-pairs cap is no longer measured. `survivors` still guards
reachability, but the bookkeeping cap the entry claims to guard is gone.

**Proposed fix.** Emit `null` when the probe is missing (the evaluator already fails a value that is
not a number), or add `{metric: 'trackedPairs', min: 1}` as the positive control. Add a
`--lint-gates` rule: a `max` gate on a counter needs a `min` or `equals` companion on the same probe.

### TEST-12 (P3, INFERRED): timing ratios below 1 run on hosted runners in every tier

**Location:**

- `perf/gates/readset40.mjs:26` (`completedMs over fullMs max 0.85`);
- `store.mjs:27` (`scopeStringifyMs over dehydrateStringifyMs max 0.8`);
- `aliases.mjs:10` (`viewIterateMs over rawIterateMs max 1.5`).

All of them run in `ci-fast` and `ci.yml` with three samples.

**What is weak:**

- `perf/README.md` records a byte-identical A/A median ratio of 1.85× on the hosted runner. It also
  records that the timing ratios on `diff39` flaked and were removed.
- The `readset40` timing ratio adds nothing: the same entry already gates the work exactly
  (`completedIndexWork` = 30000, `fullIndexWork` = 80000).
- `store/dehydrate` is timing-only by its own comment ("No comparable >=1 -> 0 mechanism"), with an
  expected ratio of about 0.5 against a bound of 0.8.

**Proposed fix:**

- Drop the `readset40` timing ratio.
- For `store/dehydrate`, add a counter, such as objects cloned while running
  `JSON.stringify(scope)` (0 on the `toJSON` path, about N on the dehydrate path). Move the ratio to
  the informational A/B of `performance.yml`.
- Run any remaining ratio gate with `--runs 5`.

### TEST-13 (P3, OBSERVED): in the nightly Library job, perf gates run before typecheck, lint and tests

**Location:** `ci.yml`, job `library`. The order is `Performance gates` → `Typecheck` → `Lint` →
`Test`.

**Impact.** One flaky timing ceiling skips every later step, so that night produces no test result
at all. `release.yml` requires a green `ci.yml` run for the SHA, so a perf flake also blocks release
until the job is re-run.

**Proposed fix.** Move the perf gates into their own job that `needs` the build; the fast tier
already works this way. Alternatively, run them last.

### TEST-14 (P3, OBSERVED): native CI can skip tests after test-only or toolchain changes

**Location:** `ci.yml`, `native` job, "Verified marker" key:
`hashFiles('native/src/**', 'native/Cargo.toml', 'native/Cargo.lock', 'native/build.rs', 'rust-toolchain*')`.

**What is weak:**

- The key omits `native/tests/**`.
- The crate does not pin rustc ("the toolchain the image ships is enough").
- When the hosted image upgrades Rust, `clippy -D warnings` can start failing, but the nightly run
  skips straight through on the cached marker. The failure surfaces on the next unrelated native PR.
- An edit to `native/tests/cli.rs` alone is never re-verified nightly. It is verified once by the
  fast tier.

**Proposed fix.** Add `native/tests/**` and the output of `rustc -V` to the marker key, or add
`rust-toolchain.toml`.

### TEST-15 (P3, OBSERVED): consumer-matrix skips count as passes

**Location:** `scripts/consumerMatrix.mjs`, which ends with
`process.exit(failed.length > 0 ? 1 : 0)` where skips are excluded, and
`scripts/consumer-matrix/cell.mjs:38` (pnpm missing → `skip`).

**Impact.** If `corepack enable` silently stops providing pnpm, two install cells and four format
cells skip, and the job stays green. `hooks43 --require-all` requires only `react18-npm`.

**Proposed fix.** When `CI=true`, treat `skip` as a failure, or accept a `--require-all` flag that
mirrors the perf runner's.

### TEST-16 (P3, OBSERVED): the local task tier runs dist-reading tests against a stale build

**Location:** `scripts/affected.mjs`, in `buildCommands` and `runCommands`. These never build; the
perf commands are skipped with a hint when `dist/esm-prod` is missing.

**What is weak.** Eleven test files read `dist/`, including `ClientDirective.test.ts`,
`computed41/BuiltConsumers`, `sharedSingleton.dualFormat`, `subclass40/built/Declarations`,
`R32/write-viewLeaks.builds`, `WriteProxyArrayPrecision` and the `resource42` child scripts. In this
checkout the local `dist/` predates HEAD by three days. A selected suite that reads `dist` can
therefore go green or red locally for reasons unrelated to the change.

**Proposed fix.** Have `check:task` run `npm run build` first whenever a selected rstest path, or a
file it imports, references `dist/`. Alternatively, those tests could assert that the build is fresh
(a build stamp compared with a hash of the sources).

### TEST-17 (P3, OBSERVED): the "conformance" test compares the native binary with itself

**Location:** `__tests__/Native/conformance.test.ts`. Its doc comment says "Runs both implementations
of the 26 carburetor rules".

**What is weak:**

- Every JS rule is `nativeRule(...)`, which delegates to the same binary through
  `plugin/src/Utils/Native/nativeBridge.mts`.
- The test therefore checks the bridge's mapping of line and column offsets. That is useful, but it
  cannot catch a regression in rule logic: both sides change together.
- `expect(seen.size).toBe(26)` is a literal count. A 27th catalogue rule added without a fixture
  still sees 26, and passes.

**Proposed fix.** Rename the test to a bridge round-trip test and correct its comment. Derive the
expected rule set from the native registry (`native/src/config.rs` defaults, or a `--list-rules`
flag) instead of the literal 26.

### TEST-18 (P3, INFERRED): streaming and Suspense SSR are untested

**Location:** The tests use only `renderToString` with preloaded data (`Scope.test.tsx`,
`envelope-ownership.test.tsx`, `resource42/hydration-child.mjs`). No test uses
`renderToPipeableStream` or `renderToReadableStream`.

**What is unprotected.** `suspend()` and class `useResource` throw promises. Under a streaming server
renderer on React 18 or 19, those promises are awaited per request. The promise-cache docs promise
that "server selection performs no load, subscription or proof acquisition". No test confirms that
this holds under streaming, or that a scope per request stays isolated when two streams interleave.

**Proposed fix.** Add a node-environment test that streams two requests concurrently, each with its
own `CarburetorScope` and a `Suspense` boundary around a suspending reader. Assert:

- each output contains only its own request's data;
- loader calls equal 1 per request;
- zero subscriptions remain after both streams end (reuse the `hooks43` counters).

### TEST-19 (P3, INFERRED): the native linter has no throughput or scaling gate

**Location:** `native/` has neither benches nor a perf area. The closure analysis
(`rules/support/closures/*`, `require_module_function/*`) is the most complex code in the crate.

**Regression that passes.** A quadratic closure-capture scan. The fixtures are tiny and the repo's
own lint run has no time budget, so lint times on consumer monorepos grow unnoticed.

**Proposed fix.** Add an integration test that generates a file of N = 2k and 8k functions and lints
it with `--format=json`. Gate a work counter rather than time: AST nodes visited per rule, emitted
behind a debug flag, with 8k/2k `<= 4.5`.

### TEST-20 (P3, INFERRED): the declared Node engine floor is never exercised

**Location:** `package.json` `"engines": {"node": ">=14.6.0"}`, `docs/react-compatibility.md:26`.
Every workflow uses Node 24, and the A/B workflows use 24.12.0.

**What is weak.** `ResourceAbortFallback.test.ts` simulates a missing `AbortController` on Node 24.
That covers the fallback logic, but not loading `dist/cjs-prod` or `dist/esm-prod` on an old
runtime: syntax lowering, `WeakRef` and `queueMicrotask` availability.

**Proposed fix.** Add one consumer-matrix cell, or a small CI step, that runs
`node -e "require('react-carburetor')"` and the ESM import on the oldest Node that `setup-node` can
install in the declared range, plus Node 18. Otherwise, raise `engines` to what is actually tested.

### TEST-21 (P3, OBSERVED): many tests are pinned to internals

**Location:**

- 133 of 326 test files import modules below the barrels, such as `Store/Paths/WriteLog`,
  `Tracking/createReadProxy`, `Observation/completeReads`, `Selection/reconcileSelection` and
  `Graph/WriteTargetLedger`.
- About 38 use the symbol-internal protocol (`this[R.keyOf]`, `engineKey`).
- Several spy on built-ins (`String.prototype.endsWith`, `Set.prototype.add`,
  `Object.prototype.hasOwnProperty`).

**What is weak.** Most of these pins have positive controls, so a refactor makes them fail loudly
rather than pass vacuously. That is fine, but they are mixed in with the behavioural tests. A
refactor then breaks dozens of files, and it is hard to tell a mechanism pin ("must not regress
work") from a behavioural contract ("must not change").

**Proposed fix.** Tag or relocate mechanism pins, for example into `__tests__/Engine/**/mechanism/` or
with a `describe('mechanism: …')` prefix. A structural refactor can then re-baseline them
explicitly, while the behavioural suite stays an unchanged acceptance gate. Prefer public counters,
such as the existing diagnostics hooks, over prototype spies where one exists.

## Summary

| ID | Priority | Tag | Area | One-line issue |
|---|---|---|---|---|
| TEST-01 | P1 | OBSERVED | perf gates / CI | Gate freeze enforced only in manual Performance validation; `cache.mjs`, `cache40.mjs` and `subclass40.mjs` changed without amendment (cache40 trap budget +33%); `*44` files unfrozen |
| TEST-02 | P1 | OBSERVED | types | R33-08 contract committed without extension and absent from `tsconfig.types.json` (stale path), so never compiled; `Contract.types.ts` orphaned |
| TEST-03 | P2 | OBSERVED/INFERRED | tier selector | Helper changes select only the helper; resource rule misses ~12 dependents incl. AbortController fallback; native changes skip `__tests__/Native` |
| TEST-04 | P2 | INFERRED | CI tiers | React 18, consumer matrix and peer floor run only nightly; React 18 leg skips `__tests__/Tooling` |
| TEST-05 | P2 | OBSERVED | perf gates | `*Ms min: 0` and scenario-constant checks cannot fail (`hooks44/multi-consumer`, `resource43/lookup-operations`, …) |
| TEST-06 | P2 | OBSERVED | scheduling | Throttle window (non-sliding, not before window) untested; all tests use real sleeps |
| TEST-07 | P2 | INFERRED | perf coverage | Development-build costs (validation, diagnostics) ungated; `benchmarks/` never runs |
| TEST-08 | P2 | OBSERVED | native rules | `no-computed-get-in-render` (error) has zero unit tests; arg guard against `Map.get(key)` false positives unpinned |
| TEST-09 | P2 | INFERRED | resources | New answer memory: no GC liveness or bound test; expired entries never purged; docs say "per key" |
| TEST-10 | P3 | OBSERVED | tier selector | Fast-tier perf areas miss `views/*` for Resource, and `selection*`/`readset40`/`iterate40`/`subclass40` for Component |
| TEST-11 | P3 | OBSERVED | perf gates | `trackedPairs ?? -1` with only `max` passes when the probe disappears |
| TEST-12 | P3 | INFERRED | perf gates | Timing ratios below 1 on hosted runners; `readset40` redundant, `store/dehydrate` timing-only |
| TEST-13 | P3 | OBSERVED | CI | Nightly perf gates run before typecheck, lint and test; a flake hides test results and blocks release |
| TEST-14 | P3 | OBSERVED | CI / native | Native marker key omits `native/tests/**` and rustc version |
| TEST-15 | P3 | OBSERVED | consumers | Consumer-matrix skips count as passes |
| TEST-16 | P3 | OBSERVED | local tier | `check:task` runs 11 dist-reading test files against a possibly stale build |
| TEST-17 | P3 | OBSERVED | native | "Conformance" compares the binary with itself; rule count hardcoded to 26 |
| TEST-18 | P3 | INFERRED | SSR | No streaming or Suspense SSR test (React 18/19), no isolation check across interleaved requests |
| TEST-19 | P3 | INFERRED | native perf | No throughput or scaling gate for the lint binary |
| TEST-20 | P3 | INFERRED | runtime | Node `>=14.6.0` engine floor never exercised; CI is Node 24 only |
| TEST-21 | P3 | OBSERVED | maintainability | 133/326 test files pinned to internals; mechanism pins mixed with behavioural contracts |

**Totals:** P1: 2, P2: 7, P3: 12 (21 findings).
