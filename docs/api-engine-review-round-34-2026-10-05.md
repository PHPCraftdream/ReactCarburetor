# API and engine review — round 34 — 2026-10-05

## Verdict

Base: `e3256d4` (round 33 integrated, CI green), measured through its own production ESM build
(`dist/esm-prod`, built from that commit). Six findings: three P1, three P3. Findings and recorded
known limits of rounds 30–33 are not re-reported.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R34-01 | P1 | Derived / hooks / O | The O(1) drift answer of R33-03 keys on the identity of the read set filed in the subscriber index, and the consumers lose that identity: after one recompute that keeps its read set, `computed.get()` after an unrelated write costs 8.4 ms instead of 0.001 ms at 10k rows; a computed reading a store directly and through an inner computed never gets the O(1) answer (5.3–5.8 ms); a `useCarburetorValue` list re-render costs 27–38 ms after one related edit, and 4–7 ms before it (the commit compares the read set with itself) |
| R34-02 | P1 | Hooks / selections / renders | A changed selection is detached from scratch: every row object gets a new identity, so one edited row re-renders all 1 000 / 10 000 `React.memo` rows instead of one, and every change costs a compare walk plus a full detach walk |
| R34-03 | P1 | History / O | Undo and redo of a one-field entry copy the whole baseline, diff the whole state through the draft and copy the live state again: 122–137 ms at 10k rows and 0.78–0.81 s at 50k rows, against a 0.15–0.22 ms write |
| R34-04 | P3 | Store / O | `restore()` descends through draft wrappers into branches that turn out unchanged: a one-leaf restore costs about 8× a full `snapshot()` (46 ms at 10k rows); a raw pre-check nearly halves it |
| R34-05 | P3 | API / SSR | `CarburetorScope.dehydrate()` deep-copies every store before the caller serializes it: `JSON.stringify(scope.dehydrate())` costs 2.4–2.6× stringifying the wire forms, for an identical payload, on every request |
| R34-06 | P3 | API docs | Three doc comments contradict the code: `persist` "synchronous by default", `CarburetorHistory` "O(changed values), not O(state)", `useCarburetorValue` "cached per store version" |

Fix R34-01 first: three small changes restore the round-33 mechanism where users actually meet
it — after the first edit. R34-03 is the largest single-action latency (Ctrl+Z on a 10k-row list).
R34-02 is the largest render count a hooks user meets.

## Method and evidence boundaries

- Read at `e3256d4`: store notification and drift protocol, write log, subscriber index, computed
  recompute/attach/freshness, both hooks, the class commit path, `watch`, selection compare and
  detach, history record/apply, `restore`/`applyDiff`, `persist`, `CarburetorScope`, the demo's
  derived views and the API docs.
- Every finding was reproduced through the built package's public API (subclassing `Carburetor`
  for the protected `update`; hooks rendered with React 19.3.0 `createRoot` and `flushSync` in
  JSDOM 30.0.1). Node v24.12.0, `NODE_ENV=production`.
- Runs went through an A/B runner: one child process per sample, builds interleaved and the start
  rotated; 3–5 samples per build, each the median of 9–200 repetitions (the R34-05 probe ran in one
  process, 15 repetitions). Counters (write-log consultations, renders, wakes, rendered text, final
  state) are exact and agreed across samples. Timings are given as median [min–max]; separate
  processes on this shared machine disagreed by up to 4× (one 10k-row outlier by 12×), so only
  differences of about 2× and more are reported.
- Projections patched throwaway copies of the unminified `dist/esm` build and were compared with an
  unpatched copy of the same build. They show the size of the available win, not a finished
  implementation; each was checked for identical counters and rendered output on its probe.
- CPU profiles (`--cpu-prof`) are cited where they locate the cost.
- No product source, tests, dependencies or tracked generated files were changed. Probes lived in
  the ignored `worktrees/r34-probes/` directory; see "Measurement tooling" for what is worth keeping.

## Findings

### R34-01 — P1 — the O(1) drift answer is lost after the first content-equal re-subscription

**Mechanism.** R33-03 answers "did a write since version `v` concern these reads?" in O(1) only
when the caller passes the very `Set` the store filed for an active subscription:
`subscriptionByReads.get(reads)` and `record.reads === reads` (`Store/Carburetor.ts:159-169`).
Otherwise it falls back to `WriteLog.matches`, O(read set × depth). Three consumers hand the store a
content-equal but different `Set`:

1. **Computed, retained recompute.** `recompute` collects reads into a fresh `Set` per source.
   When the read set did not change, `attachDependencies` keeps the store subscription (rightly —
   no re-filing) but publishes the fresh dependency and records its fresh `Set` as the leaf
   version's `reads` (`Derived/Computed.ts:321`, `:336`). From the first recompute on, every
   `get()` after an unrelated write reaches `leafVersionsDrifted` → `CARBURETOR_HAS_DRIFT` with a
   `Set` the store never filed (`Derived/Freshness/leafVersionsDrifted.ts:22-28`).
2. **Computed, fan-in.** When a computed reads one store both directly and through an inner
   computed, `captureLeafVersions` merges the two read sets into a new `Set`
   (`Derived/Freshness/captureLeafVersions.ts:25`) — filed by nobody, so the fast path never applies,
   before or after any recompute.
3. **Hook.** After a related write `getSnapshot` builds a new read `Set` (`Interop/useCarburetorValue.ts:240`,
   `:280-284`). The commit's `install` sees equal content and keeps the old subscription
   (`:164`) — rightly — but the cache entry keeps the new `Set`, and every later drift probe
   (`:215-217`) misses. The same `install` runs `sameReads` on every commit without an identity
   check (`:42-54`), so even while both sides are the same object, each commit iterates the whole
   read set (≈ 50 000 paths for a 10k-row list).

The class commit path has the same shape (`Component/AntiHookComponent/Subscriptions.tsx:271-287`),
but consults the drift answer only when a write lands between render and commit. `sameReads`
exists in three copies (hook, class commit, `watchSelection.ts:15`).

**Probe 1 — computed.** 10 000 items; `open = computed(count of !done)` with one subscriber; 200 ×
(`d.draft = …`, then time `open.get()`), before and after one relevant write that recomputes it.

| Phase | Current | Projection | Write-log consultations (current / projection) |
|---|---:|---:|---:|
| before any recompute | 0.0013 ms | 0.0011 ms | 0 / 0 |
| after one retained recompute | 8.36 [8.21–9.01] ms | 0.0012 ms | 200 / 0 |

Fan-in shape — `share = computed(read => read(open) / read(s).items.length)`, observed, no
recompute at all: 5.29 [4.79–5.59] ms per `get()`, 200 consultations; with the projection below,
0.0013 ms and 0. All variants return the same value (6665, 0.6666).

**Probe 2 — hook.** 10 000 rows `{id, title, done}`; `List` selects `d => d.rows` (stable or inline
selector) and re-renders through its own state after `d.draft = …`; 15 renders before and after
one related edit (`d.rows[5].title = …`); a tail of two more related writes, a push and a render.

| Selector | Phase | Current | Projection |
|---|---|---:|---:|
| stable | before the related edit | 6.90 [4.68–18.51] ms | 0.24 ms |
| stable | after the related edit | 38.24 [22.98–87.51] ms | 0.076 ms |
| inline | before the related edit | 3.94 [2.59–4.71] ms | 0.21 ms |
| inline | after the related edit | 26.54 [16.49–34.15] ms | 0.075 ms |

Write-log consultations after the edit: 15 → 0. Renders (35) and rendered text
(`edited|again|10001`) identical. At 1 000 rows: 0.49 → 0.15 ms before, 1.82 → 0.048 ms after.

The projection (a) kept the filed `Set` for a retained dependency
(`collected[cuid].reads = this.dependencies[cuid].reads` before `recordVersions`), (b) kept the
constituent `{version, reads}` pairs of a merged leaf and asked the store for each, (c) let
`install` adopt the subscribed `Set` into the cache entry when the content is equal, and (d) added
`a === b` to `sameReads`.

**Recommendation.**

1. A retained dependency keeps publishing the `Set` its subscription filed (equal content is
   already proven by the overlap count).
2. A merged leaf keeps its constituent filed sets; drift is "any constituent drifted", O(k) store
   answers instead of one O(read set) log walk.
3. A hook entry whose read content equals the installed subscription adopts that `Set`;
   `sameReads` starts with an identity check. One shared helper instead of three copies.

**Acceptance.** On both probes: zero write-log consultations after a retained recompute, for the
fan-in shape and after a related hook edit; `get()` ≤ 0.01 ms; the hook re-render ≤ 0.5 ms at 10k
rows in both phases; identical render counts and text; the freshness suites (transaction, throttle,
reentrant read) green; counter tests for the three shapes added next to `DriftShortcut.test.ts`.

### R34-02 — P1 — a changed selection is detached from scratch: no structural sharing

**Mechanism.** When a hook selection changes, `getSnapshot` first walks the live result against the
cached snapshot (`sameSelection`, `Interop/useCarburetorValue.ts:273`) and then detaches it again
from scratch (`:275`). `detachOpaque` always builds fresh containers
(`Store/Utils/Selection/detachOpaque.ts:116`, `:180-182`), so every row object of the new snapshot
is new — including the 9 999 rows that did not change. A list rendered as
`rows.map(row => <Row row={row}/>)` with a `React.memo` row re-renders every row on any edit; the
immutable-update libraries a hooks user compares against keep unchanged rows' identity. The class
`connectSelection` (`Component/AntiHookComponent/Reads.tsx:178`) and `watch`
(`Store/Tracking/Observation/watchSelection.ts:66`) detach the same way.

**Probe.** `useCarburetorValue(s, d => d.rows)` rendered as memo rows; 9 edits of `rows[5].title`,
then an edit of `rows[9]` and a push as a correctness tail.

| Rows | Memo row renders per edit (current / projection) | Per edit, current | Per edit, projection |
|---:|---:|---:|---:|
| 1 000 | 1 000 / 1 | 19.68 [16.13–35.86] ms | 18.08 [13.86–28.73] ms |
| 10 000 | 10 000 / 1 | 439.85 [298.11–679.30] ms | 223.65 [184.30–277.61] ms |

Rendered text identical (`edit 8|nine|pushed|10001`). The projection replaced compare-then-detach
with one walk that returns the previous detached subtree wherever the live content is unchanged
(by position) and copies only the changed spine. Profile of the projection at 10k rows: the walk is
33% of the samples, React 17%; the projection's own `Object.keys` on views (7%) would be the keys
hatch in a real implementation. An earlier projection that kept the extra walk rendered one row but
was slower than today at 10k rows — the gain needs the fused walk.

**Recommendation.** One reconcile walk shared by the hook, `connectSelection` and `watch`: compare
and copy together, return the previous copy for every unchanged subtree, copy only what changed.
Match moved members by raw identity through the previous snapshot's raw→copy ledger, and register
reused subtrees in the walk's ledger so R5-01's topology rule (one raw object, one copy; shared
references stay shared) still holds. Every leaf is still read, so the read set stays complete.

**Acceptance.** One memo row re-render per one-row edit at 1k and 10k rows; an edit costs no more
than today; detached-topology, cycle, Date/Map/Set and class-instance suites (selection, interop,
watch) green; a moved unchanged row keeps its identity.

### R34-03 — P1 — undo and redo of a one-field entry are O(state)

**Mechanism.** Recording is O(changed values), as the class comment promises. Replaying is not:
`apply` (`Tooling/CarburetorHistory.ts:536-565`) builds the target with `reconstruct`, which copies
the whole owned baseline (`cloneOwnedGraph`, `:574`); `restore` then diffs the whole state through
the draft (`Store/Carburetor.ts:257` → `applyDiff`), wrapping every branch in a write proxy; and the
history's own publication reconciles the baseline by copying the live state again
(`reconcileBaseline` → `capture`, `:296-303`). `installPatch` already supports the draft as a target
(`Store/Paths/Diff/installPatch.ts:9-11`), but `apply` routes every entry through `restore` so that
a store overriding `restore` (resource stores abort in-flight requests on time travel) sees undo the
same way.

**Probe.** History attached; 9 × (`d.rows[5].done = !…`, `undo()`, `redo()`); one subscriber on
`rows.5.done`.

| Rows | Write | Undo | Redo |
|---:|---:|---:|---:|
| 1 000 | 0.15 ms | 10.04 [9.49–11.07] ms | 9.49 [9.28–10.48] ms |
| 10 000 | 0.18 ms | 127.22 [111.48–132.97] ms | 121.82 [116.41–132.59] ms |
| 50 000 | 0.18 ms | 777.61 [670.74–853.83] ms | 812.43 [729.36–899.67] ms |

Profile at 10k rows: `cloneOwnedGraph` 42% (reconstruct 21%, capture 21%), `applyDiff` 37% (its
order pre-check 9%), GC 9%. Notifications are precise (28 wakes for 28 publications); only the cost
is wrong.

Projection: a patches entry replayed inside one `update` through `installPatch(draft, …)`, the same
patches installed into the baseline, the history's own publication ignored: at 10k rows undo
137.81 → 0.036 ms and redo 130.46 → 0.027 ms, wakes (28) and final state identical. It relied on the
synchronous scheduler; a real implementation needs the restore path's owner token so a throttled
publication is still recognized as the history's own.

**Recommendation.** Replay a patches entry through the draft when the store's `restore` is the base
implementation (or give stores a protected `replayPatches(patches, inverse)` whose default does
this), advance the baseline by installing the same patches, and mark the publication with the
existing replay-owner mechanism. Keep the reconstruct-and-restore path for snapshot entries and for
stores that override `restore`.

**Acceptance.** Undo/redo of a one-field entry at 10k rows ≤ 1 ms with identical wakes and state;
resource-store time travel unchanged; history suites (coalesced, throttled, branching, readonly and
native graphs) green.

### R34-04 — P3 — `restore()` descends through draft wrappers into unchanged branches

**Mechanism.** `applyKey` recurses into a same-kind branch through `target[key]`
(`Store/Paths/Diff/applyDiff.ts:52-60`) — the draft's `get` trap, which wraps the branch in a write
proxy — before knowing whether anything below differs; `canApplyOrder` (`:94-151`) is a separate
full pre-pass. A one-leaf restore therefore wraps every row.

**Probe.** 10 000 rows; `snap = s.snapshot()`, flip `snap.rows[5].done`, time `s.restore(snap)`:
46.06 [42.99–82.51] ms, while the `snapshot()` itself costs 5.97 [5.24–7.65] ms. At 1 000 rows:
5.64 against 0.66 ms. Projection — a raw content check before descending: 25.18 [24.57–28.19] ms
(1.8×), same wakes (9) and state.

**Recommendation.** Compare raw values first and take the draft wrapper only on the path to an
actual difference; fold the order/lock pre-check into the same raw pass. `restore` serves `persist`
loads, hydration, DevTools jumps and snapshot history entries.

**Acceptance.** A one-leaf restore ≤ 2× `snapshot()` at 10k rows; restore and history suites green.

### R34-05 — P3 — `dehydrate()` copies every store before the caller serializes it

**Mechanism.** `CarburetorScope.dehydrate()` returns `instance.snapshot()` per store
(`Component/Scope/CarburetorScope.ts:56-69`) — a deep copy, so the payload survives later writes.
The documented server use serializes it immediately, so each request walks the state twice and
allocates a full copy.

**Probe.** One store with 10 000 rows: `JSON.stringify(scope.dehydrate())` 11.57 ms against
`JSON.stringify({[token.id]: store})` 4.83 ms (wire form via `toJSON()`); at 50 000 rows 60.97
against 23.62 ms; identical strings.

**Recommendation.** Give the scope a `toJSON()` returning the stores' wire forms, so
`JSON.stringify(scope)` is one walk with no copy, and document it next to `dehydrate()` (which stays
the detached form).

**Acceptance.** `JSON.stringify(scope)` equals `JSON.stringify(scope.dehydrate())` and costs ≤ 0.5×.

### R34-06 — P3 — doc comments contradict the code

- `Tooling/persist.ts:9-12`: "Persistence is synchronous by default … `options.coalesce` trades that"
  — since R33-07 the default coalesces and `coalesce: false` is the synchronous mode
  (`Models/Tooling.ts` and the README already say so).
- `Tooling/CarburetorHistory.ts:41`: "Cost: O(changed values) per describable change, not O(state)" —
  true for recording, not for undo/redo (R34-03).
- `Interop/useCarburetorValue.ts:108`: "The selector result is cached per store version" — since
  R33-02 it is reused across versions while no write concerns what it read.

**Acceptance.** The comments describe the behaviour; no code change.

## Not findings

- Class commits compare each render's fresh read `Set` with the installed one (O(read set) per
  commit): that comparison replaces re-filing, which costs more; the identity fix of R34-01 does not
  apply because the class path builds a new set per render by design.
- `watch` compares its read set on every wake for the same reason.
- `SubscriberIndex.match` and `WriteLog.record` slice ancestor strings per write; `UpdateWave` and
  `UpdateBatch` copy their pending maps per drain; `PersistentViews.view` allocates a route closure
  per recompute — none visible next to the walks above.
- `ComponentUpdateThrottle`, `useComputedValue` and the resource key memo — nothing measurable.

## Known limits not re-reported

R33-06: the subtree write with history attached stays at 0.67× against the 0.6× gate (patch value
copies in `createWriteProxy`/`clonePatchValue`). R5-07: `connectSelection` runs its selector and
comparison on every call. R30: the alias answer cache with two roots; the R30-02 read-tree gates.
R31: mixed active readonly `forgetAll`; cyclic key working sets above the memo budget. R32: a fresh
large container assigned to a new key is walked once; the read-view rolling-window gate.

## Recommended order

1. R34-01 — three local changes and one shared `sameReads`; restores R33-02/R33-03 where they matter.
2. R34-03 — draft replay for patches entries.
3. R34-02 — the fused reconcile walk, shared by hook, `connectSelection` and `watch`.
4. R34-04, R34-05, R34-06.

## Measurement tooling

The probes of this round are reusable. Round 33 shipped two benchmarks whose baseline and fix
measured the same, because they never reached the cost they were meant to show; a reproducible
baseline build plus exact counters makes that visible on the first run. What was built, in the
ignored `worktrees/r34-probes/bench/`:

- `lib.mjs` — loads the build under test from `DIST_ROOT` (any directory holding `Carburetor/` and
  `Interop/`: `dist/esm-prod`, `dist/esm`, a patched copy, a baseline build), median, the
  `@@ {json}` metrics line, JSDOM + React setup, and a counter of the store's write-log fallbacks.
- `ab.mjs` — the A/B runner used for every table above: one child process per sample, builds
  interleaved and rotated, exact counters printed as-is, timings as median [min–max].
- `baseline.mjs <ref>` — builds a commit's distribution into `worktrees/bench-dist/<sha>` through a
  temporary worktree under the repository, so the build resolves the repository's own
  `node_modules` and nothing is installed; cached per commit, the worktree removed afterwards.
- Seven scenarios, each ending with a correctness tail (rendered text or final state) so a fix or
  projection that breaks behaviour cannot look fast: `derived-drift-after-recompute`,
  `derived-drift-fan-in`, `hook-drift-after-related`, `hook-memo-rows`, `history-undo-one-field`,
  `store-restore-one-leaf`, plus the dehydrate probe.

Proposal for keeping them (every directory within the seven-entry layout rule):

```
benchmarks/
  harness/   ab.mjs, lib.mjs, baseline.mjs
  derived/   drift-after-recompute.mjs, drift-fan-in.mjs
  hooks/     drift-after-related.mjs, memo-rows.mjs
  history/   undo-one-field.mjs
  store/     restore-one-leaf.mjs, dehydrate.mjs
  legacy/    today's top-level benchmarks and benchmarks/state/, moved unchanged
```

- Scenarios are grouped by subsystem, not by review round: a round's report links scenario names,
  and the next round reruns them against `baseline.mjs <previous commit>`.
- No machine-specific paths and no installs; builds are arguments, defaults are repository-relative.
  `benchmarks/state/tracking/consumers/r33/hooks-snapshot.mjs` currently defaults its baseline to an
  absolute path of the author's machine, and its two neighbours (`derived-liveBranch`,
  `drift-getAfterWrite`) do not reproduce their cost; they should be replaced by scenarios on this
  harness.
- Counters become tests: each R34 fix lands an rstest check of its counter (zero write-log
  consultations; one memo row render; no whole-state copy on undo), so CI guards the mechanism while
  timings stay manual.

## Reproduction recipes

Each recipe runs against `dist/esm-prod` with `NODE_ENV=production`;
`class S extends Carburetor { run(fn) { this.update(fn); } }`.

- R34-01 computed: 10 000 items `{id, done}`; `open = computed(read => count of !done)`;
  `open.subscribe(() => {})`; time `open.get()` after each `s.run(d => { d.draft = 'x' + i; })`, then
  once `s.run(d => { d.items[4].done = !d.items[4].done; })` and time again; count
  `s.writeLog.matches` calls. Fan-in: `share = computed(read => read(open) / read(s).items.length)`.
- R34-01 hook: JSDOM and `createRoot`; `List` calls `useCarburetorValue(s, d => d.rows)` and
  re-renders through `useState`; time `flushSync(() => bump())` after `s.run(d => { d.draft = … })`,
  before and after one `flushSync(() => s.run(d => { d.rows[5].title = 'edited'; }))`.
- R34-02: as above, rendering `React.memo` rows; count row renders for one `d.rows[5].title` edit.
- R34-03: `new CarburetorHistory(s)`; `s.run(d => { d.rows[5].done = !d.rows[5].done; })`; time
  `history.undo()` and `history.redo()` at 1 000 / 10 000 / 50 000 rows.
- R34-04: `snap = s.snapshot(); snap.rows[5].done = !snap.rows[5].done;` time `s.restore(snap)`.
- R34-05: `scope.get(token)` for a 10 000-row store; time `JSON.stringify(scope.dehydrate())` against
  `JSON.stringify({[token.id]: scope.get(token)})`.

## Resolution

Implemented one commit per group: `d807126` (R34-05, R34-06 persist), `7dc8d83` (R34-03, R34-06 history),
`caec36d` (R34-01, R34-06 hook), `52bc7d4` (R34-04), `95932b7` (R34-02). The measurement tooling landed first as
`d300b9a` (first under `benchmarks/state/tracking/consumers/r34/`, since moved to `perf/`: `harness/`, `scenarios/`, `gates/`), together with removal of a
machine-specific path from the r33 hooks benchmark.

Numbers below are my own re-measurement of the integrated tree against a build of `d300b9a` (the pre-fix source),
through the committed A/B runner, 5 samples per build, median [min–max]; agent-reported figures agreed within noise
except where stated.

| ID | Status | Before → after (own run) | Gate |
|---|---|---|---|
| R34-01 | fixed | computed `get()` after a retained recompute (10k): 8.4 → 0.0012 ms, write-log consultations 200 → 0; fan-in 5.9 → 0.0015 ms, 200 → 0; hook re-render after a related edit (10k, stable / inline): 26.0 / 18.0 → 0.067 / 0.072 ms, 15 → 0; before it: 3.6 / 3.8 → 0.17 / 0.21 ms; renders (35) and text identical | passed (≤0.01 ms, 0, ≤0.5 ms) |
| R34-02 | fixed | memo row renders per one-row edit 1 000 / 10 000 → 1 / 1; edit 13.1 → 10.8 ms (1k), 238 → 163 ms (10k, 0.69×); text identical | passed (1 render; ≤ today) |
| R34-03 | fixed | one-field undo / redo at 10k: 89 / 91 → 0.024 / 0.020 ms; at 50k: 636 / 624 → 0.030 / 0.033 ms; wakes (28) and final state identical | passed (≤1 ms, ≤5 ms) |
| R34-04 | partly | one-leaf restore at 10k: 34.9 → 9.2 ms (3.8×), snapshot 4.9 ms; at 1k: 3.8 → 1.2 ms | **not strictly met**: restore / snapshot is 1.9× at 10k in my run but 2.04–2.06× in the agent's runs, and 2.1× at 1k — within noise of the 2× gate, so recorded as borderline, not passed |
| R34-05 | fixed | `JSON.stringify(scope)` 3.2 ms against `dehydrate()` 6.3 ms (10k): 0.50×; identical payload | at the limit of ≤0.5× |
| R34-06 | fixed | three doc comments corrected (persist, `CarburetorHistory`, `useCarburetorValue`) | — |

What review of the agents' work changed:

- R34-04: the first version kept equal branches in a `Set` keyed by the previous-side object, so a raw object shared by
  two paths and equal at one of them hid a real difference at the other. Replaced by a pair map (previous → next); a test
  for the shared reference was added and fails on the `Set` version. A replacement of an object by `undefined` was
  skipped by the naive pair check and is guarded.
- R34-02: a differential fuzz test (random plain/null-prototype objects, sparse arrays, Date, Map, Set, random
  mutations, compared with `sameSelection(prev, view) ? prev : detachOpaque(view)`) found that deleting every key of a
  plain object turned the selection into `undefined` — silent data loss the agent's own tests and gates did not reach.
  The fuzz also exposed holes materialized as own `undefined` and a wrong key order after a key-set change; all three
  fixed, and the fuzz (5 400 steps plus direct topology tests) is kept as a permanent test.
- R34-01: the first retained-recompute test was vacuous (a same-value write invalidates nothing); rewritten, it fails
  without the fix. A third fan-in dependency dropped earlier constituents; fixed and tested.

Decisions and limits:

- R34-03: `replayPatchesOnDraft.ts` installs the protocol member on `Carburetor.prototype` when the history module
  loads, because `Carburetor.ts` is at the 600-line limit; a store from another package copy, a subclass overriding
  `restore()` and snapshot entries fall back to the previous path.
- R34-02 deliberately keeps one consequence of the state model: a class instance in a selection makes its container
  count as changed; unchanged siblings keep their references. Members are matched by position, so a reordered list
  copies the rows that moved.
- The two round 33 benchmarks that did not reproduce their cost (`derived-liveBranch`, `drift-getAfterWrite`) are
  still in the repository; the r34 scenarios cover the same paths and should replace them.
- Full suite on the integrated tree: 173 files, 1719 tests, 0 failures; typecheck, layout and lint clean. Not run locally: the React 18 projection and the consumer matrix (they install packages); CI runs both.
