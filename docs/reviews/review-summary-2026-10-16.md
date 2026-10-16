# Review summary — 2026-10-16

Five parallel read-only reviews of `master` at `f124880` (before the function-component lint rules
landed in `007c7fe`). Every review was static: code, docs and git history were read, nothing was
built, tested or benchmarked. Magnitudes below are inferred from code unless a report says
otherwise; each finding carries OBSERVED (traced in code) or INFERRED in its source report.

| Report | Topic | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|---|
| [performance-review-2026-10-16.md](performance-review-2026-10-16.md) | Hot-path allocations, redundant work | 0 | 2 | 6 | 10 | 18 |
| [algorithmic-review-2026-10-16.md](algorithmic-review-2026-10-16.md) | Big-O, structural speedups | 0 | 3 | 5 | 6 | 14 |
| [bugs-review-2026-10-16.md](bugs-review-2026-10-16.md) | Correctness defects | 0 | 0 | 8 | 9 | 17 |
| [api-usability-review-2026-10-16.md](api-usability-review-2026-10-16.md) | Public API simplicity | 0 | 2 | 13 | 11 | 26 |
| [test-coverage-review-2026-10-16.md](test-coverage-review-2026-10-16.md) | Tests, perf gates, CI tiers | 0 | 2 | 7 | 12 | 21 |
| **Total** | | **0** | **9** | **39** | **48** | **96** |

No P0. The store core, write proxy, subscription/commit lifecycle (Strict Mode replay, Suspense
hide/reveal, abandoned attempts), history and the interop hooks held up under the bug review's
traces. Defects cluster in the resource-handles change (`b841490`…`f124880`) and in lint tooling.

## 1. Cross-cutting themes

### 1.1 Resource handles need a second pass (bugs, API, tests agree)

The same problems surfaced independently in three reports:

| Problem | Findings | Technical detail |
|---|---|---|
| Unbounded slot answer memory | BUG-01, API-06, TEST-09 | Without `ttl`/`maxEntries`, `ResourceCarburetor`'s runtime `Map<key, {data, updatedAt}>` (`Resource/Slot/answerMemory.ts`) keeps every success forever; expired entries are only skipped on read, never purged. No liveness/bound test. Fix: default bound (and/or purge on `remember`), plus a heap/size test. |
| `clear(id)` wipes everything | API-02, BUG-17 | `ResourceCache.clear(...args: unknown[])` accepts a key and ignores it; `clear()` also leaves aborted-but-running loader promises orphaned. Fix: type `clear` as `() => void` (still assignable to `onClick`); settle orphans. |
| Settle semantics of handles | BUG-02, BUG-03, API-07 | `load(A)` superseded by `refresh(A)` resolves while still Pending; superseded-before-start rejects with `AbortError`; `ResourceCache.refresh` joins an in-flight request although documented as "always requests". Fix: one rule — a handle's promise settles with the request that finally owns the key; `refresh` restarts. |
| Default key collisions | BUG-04 | `JSON.stringify` collapses `Map`/`Set` to `{}`, `NaN` to `null`, and throws synchronously on cycles/BigInt; with answer memory a collision serves another key's data. Fix: reject non-JSON-safe args in development, require `key` for them. |
| Event detection | API-11, BUG-12 | `dropEventArgs` recognises DOM `Event` and objects with `nativeEvent instanceof Event`; React Native synthetic events have no DOM `Event`, so the event reaches the loader. |
| Own-property handles | BUG-16 | Bound handles are instance fields, so a subclass overriding `load`/`refresh` on the prototype is shadowed. |
| Signal position | API-10 | Trailing `AbortSignal` forces two constructor overloads, the `unknown`/`any` first-parameter edge and the unenforceable optional-parameter rule. Breaking to change; cheapest before the first npm publish. |

### 1.2 History is the main quadratic cliff in the engine

- **PERF-01 / ALGO-05** — `foldDependentPatch` scans every earlier owned patch for each new one,
  allocating a closure per step: O(P²·D) per publication; a head `splice` on N rows with history
  attached ≈ N²/2 iterations (~5·10⁷ at 10k). Fix: index pending owned targets (trie by path) →
  O(P·D). No gate covers the owned-target axis (`history43/*` does not).
- **ALGO-03** — with `CarburetorHistory` attached, deleting any dictionary key but the last costs
  O(K) (`Object.keys` per delete) and degrades the entry to a full snapshot, O(N_state). Bulk
  deletes (`ResourceCache.clear`, eviction under history) become quadratic. Fix: position-carrying
  delete records. No gate.
- **PERF-04** — object patch endpoints are cloned twice (×4 per positional row), plus a `WeakMap`
  per `own()` call.

### 1.3 Render/commit read-set bookkeeping

- **PERF-02** — each render attempt builds a fresh read `Set`; commit `prune` builds a `Set` of all
  ancestors of all paths, then `sameReads` compares in O(N). Paid by every component on every
  commit; `readset40/prune-work` tolerates one Set. Fix: owner-only prune first, then
  copy-on-divergence recording.
- **PERF-07 / PERF-08** — class `useResource` allocates a spread, Proxy, handler, closure and
  field path strings per render; `connectSelection` wakes skip the flat fast path (4 weak
  collections per woken component). No gates for either path.

### 1.4 Aliases and Map/Set/Date in drafts

- **PERF-03 / ALGO-12** — a Map/Set facade mutation deletes the whole ownership index although the
  index never covers Map/Set members; the next native read rebuilds it over all plain state.
  Fix: generation-only bump; scope invalidation to the changed subtree.
- **PERF-05** — reading a Date through `draft` publishes a write, refuses selection reuse and forces
  an O(state) snapshot entry.

### 1.5 Native linter cost

Reviewed at `f124880`; `007c7fe` already moved part of this:

- **ALGO-01** — with the default config a file costs ~31 full passes: 4 semantic builds, 16
  `walk_rule` walks, 10 `visit_program` visits; `--fix` repeats up to 11 times. Target: one
  semantic + one multiplexed walk, estimated 3–6×. *Status:* `007c7fe` shares one semantic build
  between H21/H29/H30/H31/H33/H34 and makes H33 single-pass; the multiplexed walk is not done.
- **ALGO-02** — capture analysis re-walks the subtree per nested function, O(N·D_f), and member
  analysis runs twice (H29 and H30). *Status:* `007c7fe` replaced the per-candidate full-file scan in
  H21/H31 with a per-file index (measured once: 2000 handlers, ~822 ms → ~71 ms debug); the
  bottom-up single pass for H29/H30 is not done.
- **ALGO-08 / ALGO-11** — no marker-text prefilter per rule group; `locate` is O(diagnostics ×
  source) without a line table.
- **TEST-19** — no throughput or scaling gate for the lint binary at all.

### 1.6 Lint coverage and configuration gaps

- **BUG-07 / API-14** — `no-module-level-store` and the store rules recognise `Carburetor` and
  `ResourceCarburetor` bases only; `ResourceCache` (and its subclasses) is unlinted.
- **BUG-08** — `no-store-write-in-render` reports `getFailure`/`resolve` (reads) as writes.
- **BUG-06** (INFERRED) — the JS bridge runs the binary on the file on disk and maps the
  diagnostics onto the editor's in-memory text, so unsaved edits get shifted locations.
- **API-03** — the oxlint preset lacks `no-closure-in-update`; the comment in `recommended.mts`
  cites a pinning test that does not exist. Generate the JSON preset from `RECOMMENDED`.
- **API-01** — `update(mutate)` takes no arguments, so the documented `this.update(draft => …)` form
  is flagged by our own H32/H30 and users fall back to `draft` + `emitUpdate()` + `try/finally`
  (33 `emitUpdate()` vs 14 `update` calls in examples and the demo). Proposal:
  `update(mutate, ...args)` so updaters can be module functions.
- **TEST-08** — `no-computed-get-in-render` (error) has no unit tests; **TEST-17** — the native
  "conformance" test compares the binary with itself and hardcodes 26 rules (registry has 29).

### 1.7 Perf-gate integrity and CI tiers

- **TEST-01** — the gate freeze (hash + amendments) is enforced only by the manual
  `performance.yml`. `cache.mjs`, `cache40.mjs` and `subclass40.mjs` were changed without an
  amendment during the resource-handles work; the `cache40` settle trap budget rose 9 → 12 (+33%)
  unnoticed — either a regression to revert or a change needing a recorded justification. The six
  `*44` gate files are not frozen at all. Performance validation is expected to fail its first
  phase (not run).
- **TEST-05 / TEST-11** — gates that cannot fail: `*Ms min: 0`, scenario-constant checks,
  `trackedPairs ?? -1` with only a `max` (passes when the probe disappears).
- **TEST-03 / TEST-10** — the fast tier under-selects: a helper change (`setupTests.ts`,
  `support.tsx`, ~31 importers) runs only the helper; the resource rule misses ~12 dependents
  including `ResourceAbortFallback.test.ts`; `native/**` changes skip `__tests__/Native`; perf areas
  miss `views/*`, `selection*`, `readset40`, `iterate40`, `subclass40`.
- **TEST-04 / TEST-13** — React 18, the consumer matrix and the peer-dependency floor run only in
  the full tier; nightly perf gates run before typecheck/lint/test, so a perf flake hides test
  results.
- **TEST-02** — the R33-08 public-surface type contract is committed without an extension and
  `tsconfig.types.json` points at a non-existent path, so it has never compiled;
  `subclass40/Contract.types.ts` is orphaned too.

### 1.8 API shape before the first publish

Breaking but free while unpublished: **API-10** (signal position), **API-15** (hook-style names on
a hook-free API: `use*`, `AntiHookComponent`). Cheap consistency: **API-04** (three contradictory
"default" answers for `connect()` vs `useCarburetor`), **API-17** (README leads with engine
internals instead of the contract), **API-21** (setup docs disagree on parser, suppression comments,
`unbound-method`), **API-25/26** (inconsistent error prefixes; review ids in shipped TSDoc).

## 2. Duplicates across reports

| Same issue | Findings |
|---|---|
| Slot memory unbounded | BUG-01 = API-06 = TEST-09 |
| Handle promise settle semantics | BUG-02 ≈ API-07; BUG-03 (cache `refresh` joins) |
| React Native events | API-11 = BUG-12 |
| History fold quadratic | PERF-01 = ALGO-05 |
| Map/Set alias invalidation | PERF-03 ≈ ALGO-12 |
| `ResourceCache` unlinted | BUG-07 ≈ API-14 |
| Linter passes | ALGO-01 ≈ TEST-19 (no gate) |

After de-duplication: 96 findings → ~89 distinct.

## 3. Recommended order

1. **Resource handles fix-up** (§1.1): API-02, BUG-01/API-06/TEST-09, BUG-02/BUG-03/API-07,
   BUG-04, BUG-12, BUG-16, BUG-17 — one change, the code is fresh and unpublished.
2. **Perf-gate integrity** (TEST-01): explain or revert the `cache40` budget, record amendments
   for `cache.mjs`/`cache40.mjs`/`subclass40.mjs`, freeze `*44`, enforce the freeze in `ci-fast`.
   Then TEST-02, TEST-05, TEST-11.
3. **History cliffs**: PERF-01/ALGO-05, then ALGO-03, each with a mechanism-counter gate that fails
   on the pre-change build (`perf/README.md`).
4. **API-01** (`update(mutate, ...args)`) and **API-03** (generated oxlint preset).
5. **Render path**: PERF-03 (one-line intent), PERF-02, then PERF-07/PERF-08.
6. **Linter**: ALGO-01 multiplexed walk + ALGO-02 bottom-up captures, with a throughput gate
   (TEST-19); BUG-07/BUG-08; TEST-08/TEST-17.
7. **Fast-tier selection** (TEST-03/TEST-10) and CI ordering (TEST-04/TEST-13).
8. **Pre-publish API decisions**: API-10, API-15 — owner's call.
9. P3 batches per report.
