# Performance gates

Every performance improvement this library ships is measured again on every run: a change that
quietly reintroduces a cost a review round removed fails the suite.

`npm run bench` measures each scenario behind `perf/gates/*.mjs` on the built distribution and
checks the recorded gates. The exit code is non-zero on any violation, so a change is guarded by
one command.

## Running

```bash
npm run build && npm run bench            # whole suite on the current build (dist/esm-prod)
npm run bench -- --only history           # entries whose id or area contains the substring
npm run bench -- --runs 5                 # samples per build (default 3)
npm run bench -- --dist <dir>             # another build, e.g. one under worktrees/bench-dist
npm run bench -- --against <git-ref>      # also build <ref> and compare every *Ms metric with it
npm run bench -- --verbose                # passing gates too, and full crash output
npm run bench -- --lint-gates             # static manifest checks, no scenario is run
npm run bench -- --list                   # print the entries without running anything
npm run bench -- --json report.json       # machine-readable results
```

A failing entry — a crash, a non-zero child, no `@@` metrics line, including a baseline build that
lacks an API the scenario needs — is reported as `FAIL <id>` with a short cause, counted as a
violation, and the run continues; the summary and exit code reflect every violation. Entries
sharing the same (scenario, args, nodeArgs) are measured once and share their samples. `--only` still
measures the `scale.from` source entries a selected entry needs, without printing them as selected.

Ad-hoc A/B of one scenario across builds, no gates: `node perf/harness/ab.mjs <scenario.mjs>
--roots base=<dir>,fix=<dir> [--runs n] [-- args]`. To profile a scenario, run it under
`node --cpu-prof` with `DIST_ROOT` set and summarize the profile with
`node perf/harness/profile-top.cjs <file.cpuprofile>`.

## Resource retention protection

`resource41/retention-live-cache` adds one isolated liveness gate: **253 entries = 241
existing + 12 R41 entries**. Its GC-enabled child checks collection in all 10
cases: forget, forgetAll, setData removal/replacement, restore, fromJSON, draft
removal/replacement, refresh, and eviction. Caches remain live; strong payload and
caller-captured resolution controls must survive, and the captured payload must collect
after its resolution is released. Unchanged warm resolves must retain identity. Each
collection phase uses 12 job-boundary GCs without allocation pressure. All ten cases and
controls passed the final three-run suite; no measured timing gain is claimed.

## Format

A scenario is `perf/scenarios/<area>/<name>.mjs`: it reads the build under test from `DIST_ROOT`
(set by the runner, never hardcoded), takes its arguments from `process.argv`, ends with exactly
one `emit({...})` of its metrics, and always ends with a correctness check emitted as a metric, so
a broken implementation cannot look fast. Timing metrics are named `*Ms` (the `--against`
comparison picks those up); counters, strings and booleans are compared exactly. Shared helpers are
in `perf/harness/lib.mjs` (`load`, `loadPath`, `emit`, `median`, `countWriteLogMatches`,
`setupReact`, `distRoot`).

A gate entry is one element of the array in `perf/gates/<area>.mjs`:

```js
{
    id: 'history/undo-one-field@50k', improvement: 'R34-03',
    scenario: 'history/undo-one-field', args: [50000, 9],
    gates: [
        {metric: 'undoMs', max: 5},
        {metric: 'undoMs', scale: {from: 'history/undo-one-field@10k'}, max: 6},
        {metric: 'wakes', equals: 28}, {metric: 'done', equals: true},
    ],
}
```

Optional `nodeArgs` is an array of Node flags, for example `nodeArgs: ['--allow-natives-syntax']`
or `nodeArgs: ['--min-semi-space-size=64', '--max-semi-space-size=64']`. The runner passes them
before the scenario path, alongside `--expose-gc`, without changing scenario `args`; omitted
`nodeArgs` defaults to `[]`. `--lint-gates` accepts only `--allow-natives-syntax` and
`--min-semi-space-size=N` / `--max-semi-space-size=N` with a positive integer `N`. Entries share
samples only when their scenario, `args` and `nodeArgs` match.

`improvement` names the review-round item the entry guards (`R34-03`); js-review rounds
13–16 use `JS-R<n>-<nn>`, while api-engine labels keep `R<n>-` (explicit scope for collisions,
for example `R16-PERF-01`; bare `R15` is api-engine attribution). `'control'` marks a
correctness control that is not claiming to guard a speedup.

## Which gate when

| Gate | Asserts | Use when |
|------|---------|----------|
| `equals` | every sample equals the value | counters, verdicts, rendered text |
| `max` / `min` | median within an absolute bound | deterministic counters; generous time ceilings |
| `over` | median(metric) / median(other metric of the same run) ≤ max | the cost of one path against another inside one run — machine independent |
| `scale` | median(metric) / median(same metric of another entry) ≤ max | cost at 4N rows against N rows — machine independent |

Rules, so a gate actually guards something:

- **Validate both ways.** A gate that also passes on the pre-improvement build guards nothing: run
  it there (`--dist` pointing at a baseline build) and watch it fail by mechanism — the counter,
  the ratio — not only by a timing ceiling.
- **Positive control for counters.** A counter that can silently stay 0 (a renamed internal
  method) needs a companion gate proving the instrumentation still sees the mechanism.
- **Ceilings are the last resort.** An absolute timing `max` needs at least 10x margin
  above both the current median and the pre-fix median; otherwise keep the emitted timing
  diagnostic only. The adjacent mechanism counter, not the timing cap, guards the old cost.
- Gates on counters, ratios and scale are deterministic and quiet-machine friendly; absolute
  timings are not.

`npm run bench -- --lint-gates` checks the manifest without running anything: unique ids, the
improvement label format and unprefixed js-review round collisions, an existing scenario file behind every entry, at least one gate per
entry, `scale.from` pointing at a real id, gate shape, and — where the `emit({...})` call is a
plain object literal — that gate metrics are metrics the scenario actually emits.

## Adding an entry for a new round

1. Write the scenario: `perf/scenarios/<area>/<name>.mjs`, `emit` its metrics, end with a
   correctness tail. Keep at most 7 files per directory and 600 lines per file
   (`npm run check:layout`).
2. Add the entry (one per size) to `perf/gates/<area>.mjs` with `improvement: 'R<round>-<nn>'`.
3. `npm run build && npm run bench -- --only <area> --runs 3` — everything passes.
4. Build the pre-improvement baseline (`node perf/harness/baseline.mjs <parent-commit>`) and run
   the same `--only` against it with `--dist`: the mechanism gates must fail there.
5. `node scripts/checkLayout.mjs`; `node node_modules/oxlint/bin/oxlint --type-aware perf`;
   `npm run bench -- --lint-gates`.

### Round 37

All six R37 entries are permanent parts of the unfiltered `npm run bench` suite; the runner
discovers every `perf/gates/*.mjs` file automatically. No separate registration or `--only` is needed.

| Entry | Guards |
|---|---|
| `selection37/alias-topology@2` | Native/plain alias identity and values after both edits |
| `history/r37-02-delivery@4-fields` | Complete patch delivery after an observer throws, including undo/redo |
| `selection37/bounded-reads@64` | Bounded read ownership across 16/64 schema cycles |
| `selection37/patch-budget@4k` | Sparse 64/65/128 leaf writes without the old whole-list cliff |
| `selection37/primitive-wake@1` | Zero graph collections on a warmed equivalent scalar wake |
| `components/branch-migration@1` | Equal-valued class branch migration without a render |

These are mechanism/correctness gates, not latency speedup claims. Sparse reads have bounded
counters; dense walks, growing shapes and object reconciliation provide positive controls.

The six R37 gates reject `ba80fcb70719` on their actual mechanism counters/verdicts: stale aliases,
truncated patch delivery, growing read sets, the 65/128-write cliff, scalar ledgers and an extra
class render. Each baseline check uses three samples, including the scenarios' positive controls.

The `store/restore-one-leaf` entries guard R34-04 with `restoreRowWraps === 1`, the read-proxy
positive control and the delivered update. The pre-R34 build wraps every row instead (1000 at 1k).
`restoreMs` and `snapshotMs` remain diagnostic/A-B metrics: restore also diffs and publishes, so
snapshot cloning is not an equivalent-work timing control. Their old ratio ceilings failed even
on the pre-R37 build and are not used as regression gates.

The alias read-cache timing probe warms both paths with the same batches, alternates their order,
checks every iteration's checksum and reports time per traversal. Batching avoids single-traversal
timer/JIT noise without changing the `viewIterateMs / rawIterateMs <= 1.5` gate; pre-R30 still fails.

Integration verification: the unfiltered suite passed all 103 entries with three samples per build
and no violations. Run `npm run build && npm run bench` to include R37 with every existing round.

### Round 38

Eight automatically discovered entries in `perf/gates/selection38.mjs` join the unfiltered
`npm run bench` suite. Four mechanism gates share one scenario/sample set; they do not repeat
its work. Focused command: `npm run bench -- --only selection38 --runs 3`.

| Entry | Guards |
|---|---|
| `selection38/cyclic-equality@production` | Two reads at 1k/4k/16k, no false callbacks, real edits/backlinks/held snapshots |
| `selection38/inactive-copy-release@10k` | Detached copies collectible before unsubscribe while raw rows remain alive |
| `selection38/flat-primitive@128` | Zero graph collections at 1/64/128 watchers; sparse holes, own-undefined and non-enumerable indices |
| `selection38/class-primitive-ledger@3` | Three real parent renders/selector calls with zero primitive copy ledgers; object positive control |
| `selection38/sparse-raw-cap@4k` | 1023/1025/1100 leaf changes cost 2047/2051/2201 reads, not a full-list cliff |
| `selection38/sparse-raw-cap@16k` | 2500 leaf changes cost 5001 reads; dense-walk positive control and exact complete values |
| `selection38/native-read-precision@1k` | No unrelated size/key renders; actual selected changes and whole-Map alias delivery |
| `selection38/footprint-lifecycle@5000` | Stable 2-read cost after 5000 publications, covered transactions, unknown/overflow safety and expired-owner GC |

R38-03 changes the compile-time borrowed-readonly contract, not runtime performance; its
negative/positive consumer assertions are included in `npm run typecheck`.

Three samples pass all eight entries. The frozen pre-R38 build rejects cyclic/ledger/flat
mechanisms; lifecycle reads are 2,925,000 instead of 10,000, with 5000 false callbacks.
The pre-R37 build `ba80fcb70719` rejects both enlarged sparse guards: 28,007/112,007 reads and
a sparse/dense ratio of 1, not at most 0.25. A preserved overbroad native-read build rejects the
precision control with extra renders; a preserved incomplete-attribution build rejects
`unknownPublicationCorrect`. Negative runs fail on mechanisms, not crashes.

Raw-target proofs have separate cardinality/version bounds; losing them never discards
complete ordinary path history. Missing current-publication targets cannot borrow old owners.
Opaque draft exposure writes a branch invalidation that survives object-to-primitive replacement.
Whole-graph alias reads occur during selection capture, not on ordinary `Map.size` or key access.
Counters are graph-collection constructors and recorded reads; GC checks are reachability,
not byte bounds. Timing reports remain diagnostic. See the R38 review report for final receipts.

### Round 39

Forty-two entries in six files (`writelog39`, `history39`, `alias39`, `diff39`, `resource39`, `trackrelease39`) join the
unfiltered `npm run bench` suite. Most are counter or correctness gates; the exceptions are the generous 6× time-scale checks
on `history39/scale@10k` and the absolute ceilings of the headline entries listed last in the table. Focused command:
`npm run bench -- --only <area> --runs 3`.

| Entry | Guards |
|---|---|
| `writelog39/interleaved-{watch,hook,class}@{1000,10000}` | R39-01: a related write after two or more unrelated publications reads at most 4 paths, size-independent; overflow and unattributed writes cost one full walk, then patching resumes |
| `writelog39/paths-since@{0,4000}` | R39-01: `pathsSince` visits at most 2 recent records however old the baseline; a control scan visits all of them. `@0` is a `control` (the scale source) |
| `writelog39/write-allocs@1000` | R39-04: at most 3 Maps and 2000 Sets per 1000 writes without a consumer; a consumer still gets proofs |
| `history39/native-scalar-{write,undo}@{1k,10k}`, `history39/scale@{1k,10k}` | R39-02: scalar writes next to a `Date`/`Map`/`Set` stay patches; undo/redo restore exactly |
| `alias39/instance-leaf@{1k,10k,50k}`, `alias39/date@10k`, `alias39/flat-instance@10k` | R39-03: one native leaf read costs 3 descriptor lookups after a topology write; controls keep Date and flat-instance behaviour |
| `diff39/filter-assign-{middle,first}@{1000,10000}` | R39-05: `rows = rows.filter(...)` records the same index paths as `splice` and wakes the same rows; the filter-only control records none |
| `diff39/map-replace-one@10k`, `diff39/genuine-leaves@5k` | control: one replaced member stays one leaf; genuinely new rows stay leaf-precise and collapse past round 36's threshold |
| `diff39/external-alias-history@2` | R39-05: one object under two branches (`{rows: [a, b], selected: a}`, outside the contract) swapped by index; `selected` keeps its value through undo and redo (identity is not gated) |
| `resource39/data-only-readers@50`, `resource39/status-replacements` | R39-07: data-only readers render 2 times on mount and on an equal refresh and still refetch; `status` readers keep every render (control) |
| `resource39/forget-reload` | R39-07: a data-only reader whose pending entry is removed (`forget`, `restore`, also inside a manual throttle window) reloads — exactly 2 loader calls, more renders; bare creation renders nothing (`controlExtraRenders` = 0) |
| `writelog39/bound-write-{watch,hook,class}@10000` | R39-01: median of 21 related writes after two unrelated publications, 10k rows, ≤ 10 ms |
| `writelog39/write-bytes@6000` | R39-04: heap bytes per write (`used_heap_size` delta) in a child with a 64 MB semi-space (`monotone` proves no scavenge), a fresh store per measurement; a store without a consumer allocates ≤ 900 B per write (pre-R39: 1082 B), turning the proofs on costs ≤ 60 B more, and the opt-in toggle must exist |
| `trackrelease39/release-{watch,hook,class}@1000` | R39-04: after the last consumer disposes (watch disposer, hook unmount, class unmount), 1000 writes construct ≤ 3 Maps and ≤ 2000 Sets (pre-R39: 1000 and 3000); while a consumer lives, and after it is created again, a related write reads ≤ 4 paths |
| `writelog39/raw-retention@10000` | control: 10 000 add/write/remove rows leave ≤ 2112 of their raw objects reachable (cap 2048 + slack) and `writeLog.targets.count` ≤ 2048; manually held store rows survive, unreferenced objects do not |
| `history39/date-heap@10k` | R39-02: retained heap per history entry with one `Date`, 10k rows, ≤ 50 KB; plain-state control, genuine-snapshot positive control ≥ 100 KB |
| `history39/date-timing@10k` | R39-02: median leaf write ≤ 2 ms, undo ≤ 3 ms with one `Date`, 10k rows |
| `alias39/instance-leaf-time@50k` | R39-03: median dayjs-like leaf read after a topology write ≤ 5 ms at 50k rows; shares the `instance-leaf@50k` samples |
| `alias39/truncate-invalidates@64` | R39-03: `rows.length = n` drops the owner path; the answer equals a freshly built store's, no stale wake |

Measured on the current build (medians of three processes, six repeated runs all green): related write 0.11–0.14 ms (`watch`),
0.23–0.34 ms (hook), 0.28–0.44 ms (class); `write-bytes` off 732 B per write, proofs-on minus proofs-off about 0 B;
`date-heap` 1.6 KB per entry; `date-timing` write 0.08 ms, undo 0.06 ms; `instance-leaf-time@50k` 0.02 ms;
`raw-retention` 1866 reachable raw rows, 1869 retained pairs.

Run against the pre-R39 build `e8c3b34337f8` (`--dist worktrees/bench-dist/e8c3b34337f8/esm-prod`), three samples:
12 of 14 `writelog39`, 8 of 8 `history39`, 7 of 7 `alias39`, 5 of 7 `diff39` and 2 of 3 `resource39` entries fail. Those
that pass there are controls: `writelog39/paths-since@0`, `writelog39/raw-retention@10000`, `diff39/map-replace-one@10k`,
`diff39/genuine-leaves@5k`, `resource39/status-replacements`. Failures by mechanism: path-read counters (interleaved), Map/Set
counts (`write-allocs`), the missing track toggle and 1082 B instead of 732 B per write (`write-bytes`), snapshot entries and clone
counters (`history39`), descriptor/Set counters (`alias39`), stale owner path `rows.63` after truncation, index-path counts
(`diff39`), `undoSelected` b instead of a, extra render counts (`resource39`); and the ceilings: related write 298–412 ms,
`date-timing` write 40.6 ms and undo 96.3 ms, `instance-leaf-time` 115 ms. On the pre-R39 build `forget-reload` fails only on
`controlExtraRenders` (1), its reload gates pass there, and `raw-retention` reports `trackedPairs` -1 (no such field), so
its `≤ 2048` gate holds trivially there. The round-39 report's Resolution section lists the before/after numbers.
Wall-clock fields the scenarios emit (for example `filterMs`) are diagnostics only: the timing ratios tried on `diff39` flaked
on a shared CPU and were removed. `write-bytes` spawns its own child with `--min-semi-space-size=64 --max-semi-space-size=64`;
`date-heap` and `raw-retention` rely on the runner's `--expose-gc`.

### Round 40

Twenty-one entries in five files (`subclass40`, `readset40`, `iterate40`, `cache40`, `resource40`) join the unfiltered
`npm run bench` suite. All gate counters or delivered values; wall-clock fields are diagnostics, and the only time gates are wide
ceilings (`readset40/index-entries` ≤ 0.85× of its control, `subclass40/write-cost` ≤ 30×). Focused command: `npm run bench -- --only <area> --runs 3`.

| Entry | Guards |
|---|---|
| `subclass40/store-identities` | R40-01: a store subclass declaring `version`/`uid` (a server document version, a domain id) still delivers `A,B,C,D`; two stores sharing a domain `uid` deliver one `me & friend2` |
| `subclass40/store-names`, `subclass40/resource-names` | R40-01: no engine name is an own property of a `Carburetor`, `ResourceCache` or `ResourceCarburetor` instance, and a subclass field named like a former engine member (28 store cases, 7 cache and 5 resource-slot cases) leaves delivery correct, each against a control |
| `subclass40/component-delivery` | R40-01: two components declaring `uid = this.props.userId` both re-render (`GraceGr`); no engine name is an own property of the instance |
| `subclass40/write-cost` | control: 1 000 writes with a consumer deliver 1 000 times, and the write time stays within 30× of a control loop |
| `readset40/filed-paths@1000` | R40-02: a hook row files 1 path, a class row 2, a `watch` 1, a computed 2, the README `activeCount` 1001 of 1000 items; single markers (`!!data.user`, `'a1' in items`, a returned branch) are kept; replacing a row, a parent or the list, and a delete, still wake exactly the readers they did |
| `readset40/index-entries@5000` | R40-02: 5 000 hook-row subscribers hold 5 000 `exact` entries (10 001 before) and the index is empty after release; Map operations of subscribe + release ≤ 0.5× of an unpruned control (80 000 → 30 000); time ratio ≤ 0.85 |
| `readset40/prune-work` | R40-02: completing a read set of up to 8 paths constructs no Set, the 2 002-path `activeCount` set constructs one and ends at 1 001 paths |
| `readset40/bound-class-work` | control: after two unrelated publications a related class write reads ≤ 4 paths, refiles nothing and checks ≤ 500 paths for coverage |
| `iterate40/traps-{map,filter,forEach}@5000` | R40-03: one handler `get` per element and no `has` for present indices (2 per element before), the same read set and result as the native method |
| `iterate40/parent-render@5000`, `iterate40/computed-filter@1000` | R40-03: parent render and computed filter record the same paths with no `has` calls; one append wakes the parent once |
| `iterate40/delivery-index-length`, `iterate40/own-reads` | controls: delivery on index/length writes is unchanged, and reading own keys pays no method-table lookup (0 of 1000 lookups) |
| `cache40/settle-{success,failure}` | R40-05: write-proxy traps per settle publication 9 / 6 (21 / 12 through repeated `draft.entries[key]`), at most 0.5× of a control that writes the same fields the old way |
| `resource40/hook-renders@50` | R40-04: `useResourceValue` renders 2 on mount and 2 for an equal refresh after `invalidateAll()`, as the class `useResource` does, and reloads after `invalidate` |
| `resource40/field-precision`, `resource40/no-load-in-render` | R40-04: an unread field re-renders 0 times, a read one once; a load starts after commit, never in render |

Run against the pre-R40 build `ef78d4186ba5` (`--dist worktrees/bench-dist/ef78d4186ba5/esm-prod`), three samples: 4 of 5
`subclass40`, 3 of 4 `readset40`, 5 of 7 `iterate40`, 2 of 2 `cache40` and 3 of 3 `resource40` entries fail; the passing
ones are controls. Failures by mechanism: delivered values and own-name counts (`subclass40`), filed paths, `exact` size and Map
operations (`readset40`), handler `has` counts (`iterate40`), trap counts (`cache40`), and `hookAvailable: false` (`resource40`,
which sentinel-fills instead of crashing). Scenarios that read engine internals (`subscriberIndex`, `writeLog`, `writes`, `eviction`, `keyOf`,
`getEntryByKey`, `recordWrite`) cannot use plain names any more: those members sit under symbol keys, so the scenarios reach
them through `engine`/`call`/`engineKey` in `perf/harness/lib.mjs`, which resolve the plain name on older builds and the
symbol on newer ones. Every older scenario that did so was moved to those helpers and runs on both builds.

### Round 41 — Computed

Five automatically discovered entries in `computed41` guard public values, reachability and
membership work; no timing thresholds are added or older thresholds widened.

| Entry | Required fixed result / expected frozen-build negative |
|---|---|
| `computed41/public-collision` | Built-declaration strict uid-only subclass compiles; values 3→4, one delivery. After that graph succeeds, `strictDomainConsumer=true` requires a second strict public-declaration consumer with broader domain fields and callbacks (`version`, `value`, `valid`, dependency/announcement fields and former engine methods). Frozen build: 3→3, zero deliveries; fail `final` and `deliveries`, not uid-only compilation. |
| `computed41/observer-lifetime` | Old projection, speculative source and captured view collect after failed first body and last-release cleanup, before a new scalar get; strongly held projection/source controls and live evaluation owners survive; scalar 0, next edit 1 with one delivery. Frozen build: obsolete announcement holds projection (`collected=false`). Source/view controls additionally guard strong read-slot filing. Six old cached views remain readable while their retired source WeakRefs collect through observed switches with both distinct and reused ids. `oldViewsPrecise=true` requires actual body runs and deliveries to stay unchanged, not merely equal scalar output: real retired-source right writes give `retiredRightRuns='0,0'`, and replacement-source unread right writes give `replacementRightRuns='0,0'`. The observed-left positive control writes 41, requiring `observedLeftRuns='1,1'`, `observedLeftDeliveries='1,1'` and `observedLeftValues='41,41'`; live owners retain 41. These new retention assertions are not claimed as frozen-build failures. |
| `computed41/dependencies-{500,1000,2000}` | Seven switches deliver D/2D correctly, retained tick churn is zero, eight diff passes visit `8*(D+1)` edges, fresh-membership comparisons zero. Frozen build: comparisons `7*D*(D+3)/2`, work exceeds the unchanged linear bound. |

Focused and full verification commands:

```text
npm run build
npm run typecheck
npm run lint
npm run check:layout
npm test -- __tests__/Engine/Derived
npm run test:consumers
npm run bench -- --only computed41 --runs 3 --verbose
npm run bench -- --only computed41 --runs 3 --verbose --dist D:/dev/ReactCarburetor/worktrees/bench-dist/fad07d684f4b/esm-prod
npm run bench -- --runs 3
```

The frozen distribution is read-only: never rebuild, patch or replace it. The orchestrator
observed the negative results above against frozen R40. The strict consumer uses the selected build's
public declarations. Mixed-format helper assertions are `collision sum` (4) and `collision
delivery` ([4]); the helper's first graph is also uid-only, so the frozen build reaches the
`collision sum` assertion before broader domain-shadow fixtures. Dependency instrumentation resolves `diffDependencies` through `engineKey`,
which supports old plain names and new symbols. Existing 241-entry gate rules remain untouched.
Negative checks never overwrite the current or frozen build. Run current-build focused gates and
the unfiltered suite against the default distribution afterward; no product revert is needed.

### Round 41 — Resource selector cutover

`useResourceValue(source, args, select, isEqual?)` requires a pure synchronous selector and returns
its detached readonly selection. Dependencies belong to that completed selection, not to later child
reads. The parent explicitly projects the child's fields; selecting `view.data` captures the whole
graph and cannot promise unread-leaf precision within it. Hoisted/memoized selectors enable the
cached-parent lane. Fresh inline selectors execute again even when structural equality keeps the
returned identity. Local display overrides are real caller-owned overlays, never hook-result writes.

Six `resource41` entries use genuine React renders, state writes, loader observations and DOM checks.
The final three-run suite passed these actual counters and behavior assertions; no timing/byte saving is claimed:

| Entry | Required result |
|---|---|
| `resource41/memo-data@1000` | Hoisted narrow projection: memo child stays at 1 through unrelated parents and 1,000 warm renders; observed leaf and whole refresh deliver once each, child count 3, DOM `Grace`. |
| `resource41/machinery@1000` | Warm window: accessor definitions, WeakMap constructions, selector calls and subscription adds/removes all 0; actual DOM checksum 1000. Subscriptions balance and proof owners are 0 after unmount. Observed reevaluation calls the stable selector once. |
| `resource41/dependency-precision` | Unread nested write: parent/child deltas 0/0. Observed in-place leaf write: parent/child deltas 1/1 and DOM `Leaf`. Completed reads survive child bailout. |
| `resource41/snapshot-lifecycle` | Retained detached result stays `Ada`; loads in render 0; caller-owned overlay displays `local` while cache remains `Grace`. |
| `resource41/class-positive-control@1000` | Raw class control covers only unrelated parents and whole refresh: child stays 1, then reaches 2 with `Grace`. Separately labelled class selection uses `connectSelection` plus `useResource` loading: unread deltas 0/0, observed in-place deltas 1/1, DOM `Leaf`, then `Grace`. Raw class data does not claim detached in-place delivery or narrow leaf precision. |
| `resource41/inline-cost@1000` | Fresh inline selector executes 1000 times; DOM checksum 1000, child stays 1 and accessor definitions 0. Inline WeakMap constructions are reported separately, not held to the stable-selector zero promise. |

The scenario reports `reevaluationWeakMaps` separately from warmed `readTreeWeakMaps` and
`inlineWeakMaps`. The WeakMap instrumentation counts actual constructors in its window, including
selection-copy machinery; it is not a byte counter or a promise of zero total React allocation.
The warm result/read-set/ledger cache introduces no selection or source-subscription churn.

The migrated R40 scenarios keep real operations and unchanged thresholds: 50 readers each render
2 times on mount and 2 on equal invalidation refresh, with 50 refetches and unchanged correct text;
hook name/error/other unread/read deltas remain 0/1; raw class other-unread remains 1. The ref-commit
loader guard remains exactly 0 in render, 0 before commit and 1 after commit. No extra selected flags
or fabricated counters stand in for lifecycle notifications.

Packed fixtures exercise required-selector inference and rejection, readonly plain/native mutation
failures, detached native values, retained snapshots, real overlays and both cross-format source/hook
directions. The resource helper runs development and production export conditions in each existing
React 18.3.1/19.3.0, npm/pnpm, CJS/ESM cell. SSR selection does not load, subscribe or acquire proofs;
client automatic loading waits for committed publication and attachment.

### Final independent acceptance

The orchestrator ran 2530 tests with zero failures/skips and the unfiltered three-run suite:
**253 entries, zero failures, zero violations**. A complete manifest comparison preserves every
old 241-entry ID/args/scenario/threshold; only source callers of the new selector API migrated.
Packed consumers passed 16/16 checks, and actual Chromium verified memo/precision/refresh behavior
with zero browser errors. The four original R41 findings, API tradeoff and measured public A/B are
recorded in [the R41 resolution](../docs/api-engine-review-round-41-2026-10-09.md#resolution--2026-10-10).

The raw supplemental receipt preserves nested allocation lanes that the common runner's display
format would stringify. Direct-flat object/array and constructed-flat equivalents each use one
Set and one tracking WeakMap per reevaluation, with zero Set-copy constructions; graph lanes keep
their required footprint/ledger. Frozen resource runs also fail on the removed internal reader API;
the separate public legacy/selector A/B, not that incompatibility, proves the allocation/render gain.


## Baseline builds

`node perf/harness/baseline.mjs <ref>` builds any commit's distribution into
`worktrees/bench-dist/<sha>` and caches it; nothing is installed — a temporary worktree under the
repository reuses its `node_modules`. One build at a time. Ready-made parents of the review-round
fixes:

| Build (sha) | Guards improvements of |
|---|---|
| `1a02d29eec30` | before R30 |
| `d77a11b03d4d` | before R31 |
| `523d6a04a5f5` | before R32 |
| `829c3ea9c8bf` | before R33 |
| `d300b9a44c84` | before R34 |
| `ce08c7f2041a` | R19-ENGINE-02 fix itself; verified parent of R19-ENGINE-01 fix `b33be10` |
| `e41828a41747` | verified parent of scalar-alias-index fix `470a912` |
| `b5d41aefbae1` | before R15 |
| `171c1fa781f3` | before R6-02/03 |
| `1c100299e00c` | before the precise setData/restore wake (`b443f8f`) |
| `ac9bc8907bb0` | parent of `5875878` |
| `a5cf42ca06e0` | before the per-instance proxy SSR (`ac9bc89`) |
| `c15fb04c0472` | parent of `c234c5c` |
| `20bbbacafeaf` | before R10-03 |
| `6fc13561e952` | before R10-01 |
| `8b27dc42ac2f` | before R8 |
| `687c7aa405e6` | before R9-02 |
| `ba80fcb70719` | before R37 |
| `e8c3b34337f8` | before R39 |
| `ef78d4186ba5` | before R40 |
| `9e4ef94c9188` | before JS-R16-04 (EvictionLedger, `3394b26`) |
| `ed6263a5aa6c` | before JS-R16-06 (markStale, `9e4ef94`) |
| `90f16f9f54fe` | before JS-R14-01 (computed extend, `ec98a4b`) |
| `e52def010a10` | before JS-R16-05 (commit drift, `dc7eb03`) |
| `759c94d8aa71` | before JS-R13-02/03/05 (proxy branch WeakMap, `a5cf42c`) |
| `25e3dcc45fca` | before JS-R16-01 (key-set marker, `e52def0`) |
| `c793167d0a48` | before JS-R14-02/03/04 (array writes, `89a5af7`) |
| `b443f8f35d2e` | before JS-R16-07 (history patches, `2aa36c7`) |
| `f19f6f074877` | before JS-R13-04 (computed subscribers Map, `9386cd9`) |
| `a5ca525ec156` | before R17-ENGINE-04 (`15748fc`) |
| `868a74f30925` | before JS-R15-04/05 (`d006c59`) |
| `9c81aeec7297` | before JS-R14-07 (handler classes, `57277e2`) |
| `a6be80b0d25e` | before JS-R15-06 (connect facade, `650ae81`) |
| `5fd73a1e30ae` | before JS-R13-07 (deepClone, `f19f6f0`) |
| `a67911e6c23b` | before R9-04 (`687c7aa`) |
| `e45f466ce88e` | before R10-06 (`52a4a61`) |
| `ec98a4bb7fd1` | before JS-R14-05 (fast properties, `c793167`) |
| `fabde0984e9c` | before R16-PERF-01 (`984ad79`) |
| `9386cd9a073c` | before JS-R13-08 (structural selection compare, `759c94d`) |
| `d006c59494d5` | before JS-R15-01 / JS-R15-08 (`2768ed6`) |
| `2768ed631237` | before JS-R15-03 (computed equals, `868617c`) |
| `587587820608` | before JS-R13-09 (`a819e9f`) |
| `728d5c8c5f3b` | before R19-ENGINE-02 (`ce08c7f`) |
| `c703dbd93be1` | before R38 |

## Ceiling audit (2026-10-08)

Retain an absolute timing cap only when cap/current >= 10 and cap/pre-fix <= 0.1,
with an adjacent mechanism counter; this audit uses three samples per build.
Removed timings remain emitted diagnostics; counters, ratios, scales and caps are not loosened.

| Entry | Absolute ceiling decision | Reason / pre-fix build |
|---|---|---|
| aliases/read-cache@10k | cachedReadMs remains diagnostic | Existing removal preserved; warmed iteration ratio remains; 1a02d29eec30 |
| derived/drift-after-recompute@10k | Remove getBeforeRecomputeMs 0.05; retain getAfterRecomputeMs 0.05 | Before: pre-fix 0.0012 ms, insufficient separation; after: 8.9999 vs current 0.0016 ms; d300b9a44c84 |
| derived/drift-fan-in@10k | Retain getMs 0.05 | Current 0.0022, pre-fix 8.7435 ms; d300b9a44c84 |
| derived/r33-live-branch@10k | Retain settleMs 6 | Current 0.4608, pre-fix 370.6227 ms; 829c3ea9c8bf |
| derived/r33-drift-get-after-write@10k | Retain getMs 0.5 | Current 0.0017, pre-fix 9.0821 ms; 829c3ea9c8bf |
| computed/pulls@128 | Retain pullsMs 10 | Current 0.2426, pre-fix 169.2049 ms; b5d41aefbae1; pulls@1 scale source also measured |
| cache/forget-all@128-settled | Remove removeMs 30 | Current 0.6887, pre-fix 78.7028 ms: insufficient separation; d77a11b03d4d |
| cache/forget-all@1000-settled | Retain removeMs 100 | Current 3.1022, pre-fix 6902.7995 ms; d77a11b03d4d |
| cache/forget-all@4000-settled | Retain removeMs 400 | Current 11.0209, pre-fix 147349.3129 ms; d77a11b03d4d |
| hooks/drift-after-related@10k-stable | Remove renderBeforeMs 6 / renderAfterMs 4 | Pre-fix 7.5352 / 33.7276 ms: insufficient separation; d300b9a44c84 |
| hooks/drift-after-related@10k-inline | Remove renderBeforeMs 6 / renderAfterMs 4 | Pre-fix 10.5441 / 33.3302 ms: insufficient separation; d300b9a44c84 |
| hooks/r33-snapshot@10k | Remove stableWriteMs 20; retain inlineRenderMs 20 | Pre-fix 193.3313 / 346.3084, current 0.7973 / 0.7607 ms; 829c3ea9c8bf |
| history/r33-patches@10k | Remove dep10kMs 8 | Current 0.2917, pre-fix 29.7790 ms: insufficient separation; 829c3ea9c8bf |

Git provenance: ce08c7f2041a contains R19-ENGINE-02 and is the direct parent of
b33be1037187 (R19-ENGINE-01); e41828a41747 is the direct parent of scalar-index fix 470a912b2f1a.
The alias selection root bound remains 160 (current 130; ce08c7f baseline 384);
scalar-write attribution remains 470a912. No API cancellation protection is claimed.

## Coverage of earlier optimizations

Protection-plan additions for rounds 6–38 are indexed below by step. Sizes are collapsed;
companion positive/idle/correctness controls remain in the manifests. Bounds are current
mechanism guards, not timing claims. Baseline sha12 values identify builds, not fresh reruns;
see [Baseline builds](#baseline-builds) and the [audit resolution](../docs/perf-coverage-audit-2026-10-08.md#resolution--protection-plan-2026-10-08).

| Entry | Finding | Mechanism metric | Baseline build |
|---|---|---|---|
| **PG-C1** | | | |
| `cache/eviction-scaling@{1k,4k}` | JS-R16-04 | `coldDictionaryCalls = 0`; `coldWorkPerLoad ≤ 3`; hit dictionary calls/visits, ledger visits/work = 0; cold-work scale ≤ 4.4 | `9e4ef94c9188` |
| `computed/diamond-ladder@26` | JS-R16-06 | `marks ≤ 120`; `bodyRuns = 26` | `ed6263a5aa6c` |
| `computed/live-list@{1k,4k}` | JS-R14-01 | `subscribeCalls = 1`; `1 ≤ extendCalls ≤ rows` | `90f16f9f54fe` |
| `subscribe/refile-delta@{1k,4k}` | JS-R15-04 only | `exactFiles = 1`; `ancestorFiles = 2`; unfiles/unchanged touches = 0; `filingWork = 3`; all filing scales ≤ 1.1 | `868a74f30925` |
| **PG-C2** | | | |
| `components/mount-sibling-writer@4k` | JS-R16-05 | `mountRowRenders = 4000`; relevant row renders/writes = 1 | `e52def010a10` |
| `components/keys-parent@4k` | JS-R16-01 | `editParentRenders = 0`; edit row/relevant parent/new row renders = 1 | `25e3dcc45fca` |
| `components/list-precision@1k` | JS-R14-02/03/04 | map/replace/splice parent renders = 0; their row renders = 1; push parent/row = 1; for-of parent/row = 0; relevant renders = 1 | `c793167d0a48` |
| `write/object-replace-filter@4k` | JS-R16-03 | `recordedPaths = 1`; `titlePathOnly = true`; replacement bodies/renders = 0; changed bodies/renders = 1 | `1c100299e00c` |
| `hooks/lazy-watch@100` | R30-10 | `warmInitializers = 0`; `unchangedSubscriptions = 0`; cold/switched subscriptions = 1; changed renders = 100 | `1a02d29eec30` |
| `hooks/equals-reference@100` | R33-05 | equal announcements/renders = 0; equal bodies/comparisons = 1; changed renders = 100 | `829c3ea9c8bf` |
| `hooks/default-equal@100` | JS-R13-08 | `equalRenders = 0`; equal/changed calls = 100; changed renders = 100 | `9386cd9a073c` |
| `components/symbol-reads@1` | JS-R15-01 | concat/toString/string unrelated renders = 0; relevant renders = 1 | `d006c59494d5` |
| `computed/equals-list@20` | JS-R15-03 | `equalsEqualRenders = 0`; equal bodies = 1; changed and no-equals equal renders = 20 | `2768ed631237` |
| **PG-B1** | | | |
| `history/undo-one-field@{10k,50k}` | R34-03 | undo/redo/empty row walks = 0; snapshot undo row walks ≥ rows | `d300b9a44c84` |
| `history39/scale@10k-plain` | JS-R16-07 | plain owned clones/cloned nodes = 0; construction/snapshot clones ≥ 1, nodes ≥ 10000 | `b443f8f35d2e` |
| `computed/hook-publication-keys@1000` | JS-R13-04 | `pullKeys = 0`; `pullValue = 5` | `f19f6f074877` |
| `derived/r32-fan-in@1600` | R32-02 | `setWork1600 / setWork100 ≤ 20` | `523d6a04a5f5` |
| `store/r32-deep-clone@10k-ownkeys` | R6-02 | `cloneOwnKeys = 0`; `cloneCopied = true` | `171c1fa781f3` |
| `store/r32-deep-clone@10k-define` | JS-R13-07 | `cloneDefineProperties = 0`; `cloneCopied = true` | `5fd73a1e30ae` |
| `components/ssr-count@4k` (companion `@1k`) | JS-R13-02 | `mapWeakCallsPerRow` scale ≤ 1.2; empty calls = 0; positive calls/size reads = 4/1 | `759c94d8aa71` |
| `store/dehydrate@10k`, `store/dehydrate@10k-controls` | R34-05 / #14 remains B | `scopeSnapshots = 0` on both builds; dehydrate/synthetic-negative snapshots ≥ 1, empty = 0, equal counter payloads; not historical separation | `d300b9a44c84` |
| **PG-D1** | | | |
| `reads/live-readers@1000` (companion `@0`) | JS-R13-02/03; #6 guards JS-R13-03 | `methodCalls` scale ≤ 1.1; idle calls = 0; control calls = 6 | `759c94d8aa71` |
| `components/props-gate@10k` | R36-07 | `keyCopies = 0`; `allocatedKB ≤ 16`; `monotone = true` | `bf6af47e7990` |
| `history/mixed-capture@128` | R17-ENGINE-04 | `rowVisits = rowCopies = 128`; `intermediateCopies = 0` | `a5ca525ec156` |
| `reads/proxy-alloc@4k` | JS-R14-07 | `freshOwnTraps = 0`; `freshProxies = 4000`; `bytesPerProxy ≤ 512`; monotone | `9c81aeec7297` |
| `components/connect-retention@4k` | JS-R15-06 | `connectedOwnTraps = 0`; `connectedProxies ≥ 8000`; connected/plain bytes ≤ 1.9 (ratio passes both builds) | `a6be80b0d25e` |
| `state/resource-history@plain-10k` | R16-PERF-01 / #25 partial | construction/capture defines = 0; `captureCopies = 10000`; intermediate copies = 0; original duplicate-construction attribution pending | `fabde0984e9c` |
| **PG-HARNESS** | | | |
| `components/fast-properties@2` | JS-R14-05 | `secondFast = true` with `--allow-natives-syntax` | `ec98a4bb7fd1` |
| `resource/serialization@100` | JS-R13-09 | `stringifyCalls = 100`; `newAbsentViews = 0` | `587587820608` |
| **PG-RESID** | | | |
| `components/live-view-notes@4k` | JS-R13-05 (#20b grouped with #20) | `renderNotes = 0`; `rowsRendered = 4000`; direct seam control = 1, not development mode | `759c94d8aa71` |
| **PG-DOC alias guards** | | | |
| `aliases/selection-visits@128` | R19-ENGINE-01 | `firstRootVisits ≤ 160`; `128 ≤ firstRowVisits ≤ 320` | `ce08c7f2041a` |
| `aliases/write-read@4k` | `470a912` scalar-index fix | `rootVisits ≤ 150`; `4000 ≤ rowVisits ≤ 12000` | `e41828a41747` |
| **PG-HEAP-CTRL** | | | |
| `cache/forget-all@4000-persist` | R8-03 | `persistForgetWrites = 1`; `publicationDelta = 1`; `subscriberCalls = 1` | `8b27dc42ac2f` |
| `cache/abort-all@4000` | R9-04 | `versionDeltaAbort = 1`; `storageWritesAbort = 1`; `publicationDelta = 1` | `a67911e6c23b` |
| `views/set-data-identity@4000` | R10-06 | `newViews = 0`; single replacement: `singleNewViews = 1`, `singleSameViews = 3999` | `e45f466ce88e` |
| `state/restore-array-length@sparse` | R7-03 | snapshot and truncation index visits ≤ 10 on a 10⁶-length array with 3 own indices (validation is development-only) | `c15fb04c0472` |
| `state/resource-history@unlocked` | R19-ENGINE-02 | root / dictionary / entry `Object.keys` = 0 / 0 / 0 | `728d5c8c5f3b` |
| `array/memo-window@200k-*-live` | R32-04 | live child-path and branch-marker memo entries ≤ 2048 (fixture-specific) | `523d6a04a5f5` |
| `subscribe/three-path-buckets@4k` | JS-R15-05 | exact and ancestor bucket objects = 0; cache records per subscriber = 0 | `868a74f30925` |
| `subscribe/reads-copy@4k-copy-control` | R6-04 (`control`) | internal copies 0; public and intentional copies detected; no historical separation | — |

Remaining exceptions: #14 and #21b/#21d stay B (no mechanism separates the builds, or the guard is a control); #25 is partial and stays D; #27b stays D (time/model only). #17 closes JS-R15-04 only; JS-R15-05 is guarded by `subscribe/three-path-buckets@4k`. Class counts and per-claim evidence are in the Resolution of `docs/perf-coverage-audit-2026-10-08.md`.

## Outside the suite

`benchmarks/state/unpublishedDraftCheck.mjs` stays outside `perf/` on purpose: it measures the
unpublished-draft diagnostic, which only exists in development builds — it requires
`NODE_ENV != production` and `dist/esm`, while this suite always runs production builds
(`dist/esm-prod`, `NODE_ENV=production`).

## CI plan (not wired yet)

The counter, `equals`, ratio and `scale` gates are deterministic across machines — candidates for a
required CI job (`npm run build && npm run bench`). Timing ceilings are deliberately generous but
not noise-proof on a shared runner, so the `--against` comparison and any remaining absolute
ceilings belong in a separate, optional job. Nothing under `.github/` runs the suite yet.
