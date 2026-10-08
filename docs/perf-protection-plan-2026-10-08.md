# Performance protection plan — 2026-10-08

Status: planned, not started. Tasks #331–#339 in the session TaskList mirror the steps below.

Source: `docs/perf-coverage-audit-2026-10-08.md` (97 claims: A 54, B 19, C 15, D 9). Every item
the audit classified B, C or D (Gaps #1–#28 with sub-items) is assigned to exactly one step here;
the audit's numbering is kept so each line can be traced back to its evidence.

Goal: every claimed optimization is guarded by a permanent `perf/` gate that fails on the build
before its fix, by the mechanism the fix removed, and passes on the current build six runs in a
row. Unit tests stay; they are not counted as protection.

Non-goals: no changes to `lib/` behaviour (instrumentation helpers only where §2.3 allows), no
new optimizations, no CI wiring (task #288 stays separate), no version bump.

## 1. Order and dependencies

```
#331 PG-DOC ─────────────────────────────┐
#332 PG-BASE ─┬─ #333 PG-C1  (O(N²))      │
              ├─ #334 PG-C2  (renders)    │
              ├─ #335 PG-B1  (time→count) ├─ #339 PG-FIN
              ├─ #336 PG-D1  (uncovered)  │
              ├─ #337 PG-HEAP-CTRL ◄──────┤ (also needs #331)
              └─ #338 PG-HARNESS          │
```

#331 and #332 can run in parallel. After #332, steps #333–#338 touch disjoint gate files and
scenario directories and can run in parallel worktrees (see §5). #339 runs alone at the end.

## 2. Rules that apply to every new gate

### 2.1 Gate shape

- One scenario per mechanism under `perf/scenarios/<area>/<name>.mjs`, one `emit({...})`, a
  correctness tail emitted as a metric (`done`, `text`, state equality). At most 7 files per
  scenario directory, 600 lines per file (`node scripts/checkLayout.mjs` checks `perf/` too).
- Entries go into `perf/gates/<area>.mjs` with `improvement: '<finding>'`; an entry that passes on
  its baseline by design is `improvement: 'control'`.
- Gates on exact counters (`equals`, `max`, `min`), same-run ratios (`over`) and size scale
  (`scale: {from: '<id>'}`). Every counter has a positive control in the same scenario: a metric
  proving the probe sees the mechanism (a cold path, a dense input, a deliberately unoptimized
  call).
- Wall-clock values are emitted as diagnostics only. An absolute ceiling is allowed only with at
  least 10× margin to the current median and 10× to the pre-fix median, and it must survive six
  runs; otherwise drop it. The R39 lesson: `diff39` ratio and scale timing gates flaked at 20× and
  2.0 limits and were removed.
- Heap metrics need a deterministic companion counter (§4, step #337). Allocation bytes are
  measured as in `write/one-row` and `writelog39/write-bytes`: a child process with
  `--min-semi-space-size` / `--max-semi-space-size` large enough that no scavenge happens inside
  the window, plus a `monotone` metric proving it.

### 2.2 Labels

Findings of the js-review rounds get a `JS-` prefix (`JS-R16-04`), api-engine rounds keep `R<n>-`.
`--lint-gates` must reject an unprefixed label that collides with a js-review number (step #331).

### 2.3 Counting internal work

Scenarios load the built distribution (`load()` / `loadPath()` from `perf/harness/lib.mjs`).
ESM exports are immutable and inlined calls cannot be intercepted, so a counter must use one of:

1. Globals: wrap `Map`, `Set`, `WeakMap` constructors or their prototype methods, `Object.keys`,
   `Reflect.ownKeys`, `Object.defineProperty`, `Object.getOwnPropertySymbols` for the measured
   window only, and restore them in `finally`. Isolate the window so fixture setup and unrelated
   store bookkeeping are not counted; prove isolation with a control window that does no
   measured work.
2. Prototype methods of exported or `loadPath`-reachable classes (`Computed.prototype.markStale`,
   `EvictionLedger`, `SubscriberIndex`), wrapped on the prototype before the store is created.
3. Public observables: renders, selector or body runs, loader calls, `subscribe` calls on the
   store instance, recorded paths, history entry kinds.
4. Internal fields reached through the instance (`store.writeLog.targets.count`): allowed for
   diagnostics, never as the only gate metric, because a baseline may lack the field
   (`raw-retention` emits -1 on `e8c3b34`).

If none works (string-path memo, #27b), the item stays B and the audit says so; no function is
monkeypatched in a way the baseline build cannot reproduce identically.

A module path used with `loadPath` must exist in the baseline build too. Check it before writing
the scenario; when the module moved, probe through a public class or a global instead.

### 2.4 Validation per gate

1. `node perf/run.mjs --only <area> --runs 3` on the current build: green.
2. Six consecutive runs of that command: green. A failure is fixed in place (metric, window,
   iteration count), never by loosening the mechanism bound.
3. `node perf/run.mjs --only <area> --runs 3 --dist worktrees/bench-dist/<sha>/esm-prod` on the
   pre-fix build: the improvement entries fail on their counter, controls pass. A failure caused by
   a missing API or a thrown exception does not count; restructure the probe until the verdict is
   a mechanism verdict (R34-05 is the known case).
4. `node perf/run.mjs --lint-gates`, `node scripts/checkLayout.mjs`,
   `node node_modules/oxlint/bin/oxlint --type-aware perf` (no ` error` lines).

## 3. Step details

### #331 PG-DOC — documentation and label anomalies (audit §5, Gap #10)

- R19 contradiction: R35 "Open" says R19-01 has no gate failing on its parent build; `perf/README`
  lists `ce08c7f2041a` as "before R19-01" and `perf/gates/aliases.mjs` claims every gate fails on
  its parent. Run `--only aliases` on `ce08c7f2041a` and on the parent of the scalar-alias-index fix
  (audit: `470a912^`, verify with `git log` first), record which entries fail, then correct whichever
  document is wrong.
- `aliases/selection-visits@128`: `firstRootVisits ≤ 300` passes the pre-fix 256; tighten to the
  measured current value with margin (audit target ≤ 8, INFERRED; measure first).
- Labels: rename js-review labels to the `JS-` form (`R13-06`, `R13-10`, `R16-02`, …), split the
  ambiguous `R19-02` into `R19-ENGINE-02` / `R19-API-02`, make scenario comments use the same ids,
  and add the collision rule to the gate lint in `perf/run.mjs`.
- Absolute timing ceilings next to counters (`aliases/read-cache` `cachedReadMs ≤ 0.02`, `derived/*`
  `getMs ≤ 0.05`, `computed/pulls@128` `pullsMs ≤ 10`, `cache/forget-all` `removeMs`, `hooks/*`
  `renderBeforeMs`/`stableWriteMs`, `history/r33-patches` `dep10kMs ≤ 8`): check each against §2.1;
  keep it only if both 10× margins hold, otherwise turn it into a diagnostic.
- Files: `perf/gates/*.mjs`, `perf/run.mjs` (lint only), `perf/README.md`, the R35/R36 reports
  (append a note, do not rewrite original lines).

### #332 PG-BASE — missing pre-fix builds

`node perf/harness/baseline.mjs <ref>` builds into `worktrees/bench-dist/<sha12>/` (one build at a
time, reuses `node_modules`, caches). The audit names the commits as "exact parent to add …";
they are not verified. For each, run `git show --stat <sha>` and confirm the commit is the fix
named in the round's Resolution before building its parent.

| Gap | Finding | Build |
|---|---|---|
| 1 | JS-R16-04 EvictionLedger | `3394b26^` |
| 2 | JS-R16-06 markStale | `9e4ef94^` |
| 3 | JS-R14-01 computed extend | `ec98a4b^` |
| 5 | JS-R16-05 commit drift | `dc7eb03^` |
| 6, 20, 20b | JS-R13-02/03/05 | `a5cf42c^` (README `a5cf42ca06e0` is this parent: check) |
| 7 | JS-R16-01 key-set marker | `e52def0^` |
| 8 | JS-R14-02/03/04 | `89a5af7^` |
| 9 | JS-R16-07 | `2aa36c7^` |
| 10 | scalar alias index | `470a912^` |
| 12 | JS-R13-04 | `9386cd9^` |
| 15 | R36-07 | `27dce28^` (or `bf6af47`, cited in the R36 report) |
| 16 | R17-ENGINE-04 | `15748fc^` |
| 17, 21c | JS-R15-04/05 | `d006c59^` |
| 18 | JS-R14-07, JS-R15-06 | `57277e2^`, `650ae81^` |
| 19 | JS-R13-07 | `f19f6f0^` (R6-02 uses existing `171c1fa781f3`) |
| 22b | R9-04 | `687c7aa^` (README `687c7aa405e6` already contains the fix) |
| 22c | R10-06 | `52a4a61^` |
| 24 | JS-R14-05 | `c793167^` |
| 25 | R16-PERF-01 | `984ad79^` |
| 26c, 26d, 26e | JS-R13-08, JS-R15-01, JS-R15-03 | `759c94d^`, `2768ed6^`, `868617c^` |
| 27a, 27b | JS-R13-09, JS-R15-08 | `a819e9f^`, `2768ed6^` |
| 28 | R19-ENGINE-02 | `ce08c7f^` |
| — | R38 | `c703dbd` (cited in the R38 report) |

Existing builds reused: `d300b9a44c84` (#4, #14), `1c100299e00c` (#11), `523d6a04a5f5` (#13, #21a,
#21b), `8b27dc42ac2f` (#22a), `c15fb04c0472` (#23), `1a02d29eec30` (#26a), `829c3ea9c8bf` (#26b).
About 25 builds; each takes minutes, so run them sequentially in the background and never in
parallel with timing measurements. Add every built row to the "Baseline builds" table in
`perf/README.md`. Disk use is bounded (`dist/esm-prod` ≈ 0.3 MB each).

### #333 PG-C1 — removed O(N²) costs from the js-review rounds

| Gap | Entry | Measured | Before → after |
|---|---|---|---|
| 1 | `cache/eviction-scaling@{1k,4k}` | load N keys with the default `maxEntries`, settle all; `Object.keys` calls on the entries dictionary and ledger walks per load; `equals` 0 on hits; `scale` 4k/1k ≤ 4.4 | ~N per load → O(1) amortized |
| 2 | `computed/diamond-ladder@26` | one write through a 26-node diamond ladder; wrap `Computed.prototype.markStale`; marks `max` 120, body runs `equals` 26 | 1 149 795 → 99 |
| 3 | `computed/live-list@{1k,4k}` | hook list rendered from a computed's live result, one title edit; `subscribe` calls on the store instance per edit `equals` 1, `extend` calls ≤ rows | 2002 / 8002 → 1 |
| 17 | `subscribe/refile-delta@{1k,4k}` | re-subscribe the same id with one added path, fixed depth, no removals; count exact-path and ancestor filing separately (wrap `SubscriberIndex` prototype methods); unchanged paths untouched; `scale` 4k/1k ≤ 1.1 | O(paths × depth) → O(depth) |

Positive controls: a cold load (#1), a ladder with `markStale` forced to keep walking is not
possible on the current build, so use the body-run count and a second write that does change the
result (#2), a fresh mount that must subscribe (#3), a re-subscribe with a removed path (#17).
Files: `perf/gates/cache.mjs`, `computed.mjs`, `subscribe.mjs` (append entries),
`perf/scenarios/{cache,computed,subscribe}/` (new files; check the 7-entry limit, add a
subdirectory if needed).

### #334 PG-C2 — render precision

| Gap | Entry | Measured | Before → after |
|---|---|---|---|
| 5 | `components/mount-sibling-writer@4k` | 4000 rows mounted next to a sibling writing an unrelated path on mount; row renders | 8000 → 4000 |
| 7 | `components/keys-parent@4k` | parent renders `Object.keys(items)`, one row title edit; parent renders `equals` 0, row renders `equals` 1 | 1 → 0 |
| 8 | `components/list-precision@1k` | nested edit under `items.map` (parent 1 → 0); `push` and `items[5] = …` and `splice` (row renders 1001/1000 → 1/1); unrelated write after `for…of` (1 → 0) | as listed |
| 11 | `write/object-replace-filter@4k` | `draft.items[i] = {...items[i], title}` under an observed computed reading only `done`; recomputes `equals` 0, recorded paths `equals` 1 | 1–2 → 0 |
| 26a | `hooks/lazy-watch@100` | initializer calls per stable re-render, subscription replacements per unchanged notification | 100/1 → 0/0 |
| 26b | `hooks/equals-reference@100` | memo child renders after an equal computed publication | 100 → 0 |
| 26c | `hooks/default-equal@100` | extra renders on a structurally equal replacement | 100 → 0 |
| 26d | `components/symbol-reads@1` | renders after an unrelated write following `concat`/`toString`/`String` | 1 → 0 |
| 26e | `computed/equals-list@20` | list renders after an equal result | 20 → 0 |

Use the React setup of `perf/harness/lib.mjs` (`setupReact`) and `flushSync`, as
`perf/scenarios/resource39/*.mjs` do. Count renders with a counter in `render()`; every entry has
a positive control (a relevant write that must render exactly once). Several fixtures are INFERRED
by the audit: write the scenario, run it on both builds, and set the gate values from the
measurement, keeping the direction of the claim.

### #335 PG-B1 — replace time-only guards with counters

| Gap | Where | New counter | Before → after |
|---|---|---|---|
| 4 | `history/undo-one-field@{10k,50k}` | `Reflect.ownKeys`/`Object.keys` on raw rows during `undo()`/`redo()` `equals` 0; control: an undo of a snapshot entry ≥ rows | ≥ 10 000 → 0 |
| 9 | `history39/scale@10k` | plain `ownedClones`/`clonedNodes` `equals` 0 via `history39/owned-counter.mjs`; construction and snapshot controls nonzero | snapshot → patches, 0 clones |
| 12 | `computed/hook-publication` | `Object.keys` calls inside `get()` across 5 waves `equals` 0 | S per get → 0 |
| 13 | `derived/r32-fan-in` | `Set` constructions and `add` calls per write at K = 1600, `scale` vs K = 100 ≤ 20 | ~K² → ~K |
| 14 | `store/dehydrate@10k` | snapshot/clone calls during `JSON.stringify(scope)` `equals` 0; control `dehydrate()` ≥ 1. The pre-R34 build has no `scope.toJSON`: add a candidate-side negative control (a scope whose `toJSON` delegates to `dehydrate`) so the counter is proven to separate | ≥ 1 → 0 |
| 19 | `store/r32-deep-clone@10k` | R6-02: `Reflect.ownKeys` calls attributable to `deepClone` (>0 → 0, baseline `171c1fa781f3`); JS-R13-07: `Object.defineProperty` per ordinary key → 0, an own `__proto__` key as nonzero control (`f19f6f0^`) | as listed |
| 20 | `components/ssr@{1k,4k}` | `Map`/`WeakMap` method calls per rendered row, `scale` 4k/1k ≤ 1.2 | ~N per row → constant |
| 20b | `components/ssr@4k` | `liveViews.note` calls in production while creating and reading 4000 row proxies (reach `liveViews` through `loadPath` on both builds; development mode as positive control) | ≥ 4000 → 0 |

Keep the existing time metrics as diagnostics; remove a timing gate only when the new counter
fails on the baseline.

### #336 PG-D1 — uncovered claims

| Gap | Entry | Measured | Before → after |
|---|---|---|---|
| 6 | `reads/live-readers@{0,1000}` | hold N read views (or mounted rows), 2000 primitive writes; `Map`/`WeakMap`/`Set` method calls during the write loop; `scale` 1000/0 ≤ 1.1 | ~N per write → constant |
| 15 | `components/props-gate@10k` | 10 000 three-key `shallowEqual` comparisons through the class props gate; allocated KB in a no-scavenge window (technique of `write/one-row`) ≤ 16; control: a comparator that copies keys | ~3 objects × 10 000 → 0 |
| 16 | `history/mixed-capture@128` | `{rows[128], last: Map}` plus history construction; `Reflect.ownKeys` per original row `equals` 1 | 2 → 1 |
| 18 | `reads/proxy-alloc@4k` | allocated bytes per fresh read proxy; retained bytes per `connect()` row against a plain `React.Component` row, `over` ≤ 1.9 | ~9 objects → 1; 9608 → 6904 B |
| 25 | `state/resource-history@plain-10k` | plain-node ownership copies per capture, native snapshot control (needs #16's probe) | 2 → 1 |

#18 is heap-based: give it a deterministic companion (object constructions per proxy counted
through the handler prototype) in the same entry.

### #337 PG-HEAP-CTRL — heap companions and hidden counters

- Heap companions (Gaps #21a–d), each next to the existing heap ceiling:
  - #21a `array/memo-window@200k-*`: live memo entries after 200k transient keys ≤ a bound read
    from the implementation (audit INFERRED ≤ 2048), baseline `523d6a04a5f5`.
  - #21b `readenum/fresh@10000`: wrapper constructions for own-key enumeration `equals` 0.
  - #21c `subscribe/three-path-buckets@4k`: bucket objects and ancestor-cache records per
    three-path subscriber (≥ 3 / ≥ 1 → 0 / 0), `d006c59^`.
  - #21d `subscribe/reads-copy@4k`: Set copies attributable to subscription; internal reads 0,
    public reads a nonzero control. The parent already adopted internal sets, so this is a
    no-regression guard: validate it with a deliberate internal-copy negative control on the
    candidate, label `control`.
- Hidden counters (Gaps #22a–c): move R8-03 (`persistForgetWrites`), R9-04 (`versionDeltaAbort`,
  `storageWritesAbort`) and R10-06 (view identity) out of the `control` entries
  `cache/forget-all@32-fallbacks` and `views/set-data-identity@100` into entries labelled with the
  finding at 4000 entries: `cache/forget-all@4000-persist` (4000 → 1), `cache/abort-all@4000`
  (4000 → 1), `views/set-data-identity@4000` (4000 → 0).
- #23 `state/restore-array-length@sparse`: index visits during snapshot, validation and truncation
  of a length-10⁶ array with 3 own indices ≤ 10, dense control; existing baseline `c15fb04c0472`.
- #28 `state/resource-history`: `Object.keys` on root, dictionary and entries during an ordinary
  unlocked cache replacement capture (2/2/8 → 0/0/0), baseline `ce08c7f^`, label `R19-ENGINE-02`.

Depends on #331 because of the label renames in the same files.

### #338 PG-HARNESS — node flags and the remaining items

- `perf/harness/measure.mjs` spawns scenarios with `--expose-gc` only. Add an optional
  `nodeArgs` field on a gate entry (validated by `--lint-gates`, allow-list:
  `--allow-natives-syntax`, semi-space flags) that the runner appends to the child's arguments.
  Entries sharing a scenario and args already share samples (`perf/run.mjs`); include `nodeArgs` in
  that key.
- #24 `components/fast-properties@2`: `%HasFastProperties` of the second `AntiHookComponent`
  instance `equals` true, `c793167^` false.
- #27b `reads/repeat-child@4k`: needs equal instrumentation of `joinPath` and `branchPath` in both
  builds. If the only way is a source patch of the baseline, do not do it: record #27b as
  "time/model only" in the audit Resolution.
- #27a `resource/serialization@100`: key serialization calls per hook render and new absent views
  per stable render (≥ 2 / 1 → 1 / 0), `a819e9f^`. Low priority; do it if the counters reach the
  serializer through a public or prototype path.

### #339 PG-FIN — final validation

1. Every new entry: six consecutive green runs on the current build and a mechanism failure on its
   baseline (§2.4); write the measured values into the entry comment.
2. `npm run build`, `npm run bench -- --lint-gates`, `node scripts/checkLayout.mjs`, oxlint on
   `perf`, full `npm run bench -- --runs 3` in the background (≈ 25 min, more with the new entries):
   0 failed.
3. Append a Resolution section to `docs/perf-coverage-audit-2026-10-08.md` (original lines
   unchanged): new class counts, items that stayed B or D and why, the baseline builds added.
4. `perf/README.md`: a section per new area or a table of the added entries; `CHANGELOG.md`
   Unreleased: one bullet for the coverage work.
5. Report to the user; commit and push only on an explicit request.

## 4. Risks

- Unverified SHAs: the audit marks several parents as "to add". Building the wrong parent gives a
  gate that "fails on baseline" for an unrelated reason. Verify each commit before building.
- Baselines without the module or API the scenario uses: the entry then fails by exception, which
  is not proof (§2.4). Probe through globals, prototypes or public behaviour.
- Global wrapping that counts fixture work: always measure a control window with no work and
  assert it is 0.
- React scenarios are slower and noisier than store-only ones: counts only, no timing gates.
- Suite runtime grows. Keep sizes as small as separates the mechanism (1k/4k, not 50k) and share
  samples between entries with the same scenario and args.
- Heap-based gates depend on the Node/V8 version; each must carry a deterministic companion.

## 5. Execution

- Parallel worktrees under `worktrees/` (rush agents, `/wrush` rules): after #332, one agent per
  step #333–#338, each owning only its gate files and scenario directories listed above. #331 and
  #337 touch the same gate files (labels), so #337 starts after #331 is merged.
- Agents may not run the full suite or `npm run bench` without `--only`; heavy commands one at a
  time; no private machine paths in repository files.
- The orchestrator verifies each diff, reruns the agent's gates on both builds, merges, removes
  the worktree (unlink junctions first), then runs #339.
