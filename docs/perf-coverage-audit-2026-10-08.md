# Performance gate coverage audit — 2026-10-08

Question: is every performance optimization or performance fix claimed in `CHANGELOG.md` and in the
Resolution sections of the review reports (`docs/api-engine-review-round-6…39-*.md`,
`docs/js-review-round-13…16-*.md`) guarded by a permanent `perf/` gate that would catch its return?

## 1. Summary

97 in-scope performance counting units are registered (correctness-only fixes and API/type/doc
items are excluded; JS-R13-02/05 is one explicitly grouped unit with distinct subclaims; see §2).
Classes: **A** covered-mechanism, **B** covered-weak, **C** unit-test only, **D** uncovered.

| Round | Claims | A | B | C | D |
|---|---:|---:|---:|---:|---:|
| api-engine R6 | 2 | 0 | 2 | 0 | 0 |
| api-engine R7 | 1 | 0 | 1 | 0 | 0 |
| api-engine R8 | 1 | 0 | 1 | 0 | 0 |
| api-engine R9 | 1 | 0 | 1 | 0 | 0 |
| api-engine R10 | 1 | 0 | 1 | 0 | 0 |
| api-engine R11 | 3 | 3 | 0 | 0 | 0 |
| api-engine R12–R14, R18, R20–R29 (no performance claims registered) | 0 | 0 | 0 | 0 | 0 |
| api-engine R15 | 1 | 1 | 0 | 0 | 0 |
| api-engine R16 | 1 | 0 | 0 | 0 | 1 |
| api-engine R17 | 1 | 0 | 0 | 0 | 1 |
| api-engine R19 | 2 | 0 | 2 | 0 | 0 |
| Fixed, unnumbered scalar-alias-index claim | 1 | 0 | 1 | 0 | 0 |
| JS-R13 | 8 | 2 | 3 | 1 | 2 |
| JS-R14 | 6 | 0 | 0 | 4 | 2 |
| JS-R15 | 6 | 0 | 1 | 3 | 2 |
| JS-R16 | 7 | 1 | 1 | 5 | 0 |
| R30 | 8 | 7 | 0 | 1 | 0 |
| R31 | 6 | 6 | 0 | 0 | 0 |
| R32 | 7 | 4 | 3 | 0 | 0 |
| R33 | 7 | 6 | 0 | 1 | 0 |
| R34 | 5 | 3 | 2 | 0 | 0 |
| R35 | 1 | 1 | 0 | 0 | 0 |
| R36 | 7 | 6 | 0 | 0 | 1 |
| R37 | 4 | 4 | 0 | 0 | 0 |
| R38 | 4 | 4 | 0 | 0 | 0 |
| R39 | 6 | 6 | 0 | 0 | 0 |
| **Total** | **97** | **54** | **19** | **15** | **9** |

Counting convention: one claimed mechanism per counted Matrix row, except the explicit grouped
unit JS-R13-02/05; not one gate, size, metric or benchmark number. JS-R14-02/03/04 are three
rows (three render mechanisms). JS-R13-02 removes quadratic proxy-cache retirement;
JS-R13-05 eliminates production `liveViews.note` invocations. They are distinct subclaims of
shared fix `a5cf42c`, counted together by convention, not duplicate descriptions. Their IDs
are split below; the auxiliary JS-R13-05 row adds no separate counting unit. R37-01 and R37-02
are separate uncounted correctness rows, consistent with §2 (the previous Summary counted them).
The prior Matrix had 96 physical rows: 15 older api-engine rows, 25 JS rows, and 56
R30–39 rows. Splitting the three combined-ID rows adds 4 rows: **100 − 1 grouped subclaim − 2
correctness-only rows = 97**. The consolidated zero row affects the Summary only, not the Matrix's
100 physical rows. The prior Summary's JS total happened to be 25, but its C=11
was wrong (13 before the JS-R14 split); R37's six IDs occupied five rows, not six claims.
Equivalently: **15 + (8 + 6 + 6 + 7) + (8 + 6 + 7 + 7 + 5 + 1 + 7 + 4 + 4 + 6) = 97**.
Class totals: **54 + 19 + 15 + 9 = 97**. The consolidated zero-claims row adds no counting unit;
it means no distinct performance
position in this registry, not an assertion that those rounds have no correctness gates.
The native linter benchmark is outside `perf/` and excluded, not a numbered 98th claim.

Rounds 30–39 have 47 mechanism-covered positions out of 55. The largest remaining gaps are
older quadratic costs and render multiplication guarded only by tests. R39 now has timing,
heap and write-cost companions, but those companions do not independently qualify as A.

## 2. Method and limits

1. Claim registry: every item of `CHANGELOG.md` (`Unreleased` → Changed/Added/Fixed) and of the Resolution
   or integration sections of the review reports that states a speed, allocation, retention, render-count
   or asymptotic improvement. Correctness-only findings with gates (R6-01, R6-03, R7-04, R8-01, R8-04,
   R9-02, R10-01…R10-04, R12-E01, R12-E02, R37-01, R37-02) are recorded as correctness entries and not
   counted, except where the report itself claims a cost change. API, type-only and documentation items
   (R30-06/07, R32-07, R33-08, R34-06, R36-08, R38-03, R39-06) are excluded.
2. Gate index: all 35 files of `perf/gates/*.mjs`; the parent ran the static manifest check
   `node perf/run.mjs --lint-gates` once successfully: **150 entries, 0 lint problems**,
   including 39 R39 entries (14 + 8 + 7 + 7 + 3). No build, test or benchmark was run for
   this audit; the worker did not run lint-gates.
   Sources also include scenario headers, `perf/README.md` (format rules, baseline table,
   "Outside the suite"), `benchmarks/`, and `scripts/`.
3. Classification: **A** — a counter/verdict/render-count gate on the mechanism the fix removed, and the
   README, the gate comment or the round report states that it fails on the pre-fix build. **B** — a gate
   exists but is time-only, a time ratio, a V8-dependent heap ceiling, indirect, carries the `control`
   label, or its pre-fix validation is not documented / contradicted. **C** — only a unit test in
   `__tests__` guards it. **D** — nothing guards the claimed cost.
4. Limits. Nothing was re-measured: no scenario was run on the current or on any baseline build. "Fails on
   the pre-fix build" is taken from documentation (`perf/README.md`, gate-file comments, R35/R37/R38/R39
   reports). Where documentation is silent or contradictory the entry is B and says so. Statements marked
   INFERRED are deductions from code or numbers, not observations. Test files named in class C were located
   by name/title search; they were not executed, and whether they fail on the pre-fix code is taken from the
   reports' "every fix has tests that fail without it" statements. Expected baseline values in §4 are taken
   from the reports' before/after numbers; where none exists the value is marked INFERRED.

## 3. Matrix

`gate id(s)` use entry ids from `perf/gates`. Claimed numbers are quoted from the source named in the note.

### api-engine R6–R29

| Finding | Optimization | Claimed number | Gate id(s) | Class | Note |
|---|---|---|---|---|---|
| R6-02 | `deepClone` walks `Object.keys`, symbols dropped | `deepClone(row)` 0.43–0.48×, `snapshot()` 4000 rows 0.51–0.55× | `state/state-model@4k` | B | Only `snapshotMs` scale 4k/1k ≤ 15: a constant-factor regression passes; counters are correctness |
| R6-04 | internal callers hand read sets over without a copy | internal path +0.8 B/subscriber | `subscribe/reads-copy@4k` | B | `transferBytes / publicBytes ≤ 0.95` is a V8 heap ratio; also test `Engine/Derived/Computed/LiveResults.test.tsx` ("transferReads(), not a copied read set") |
| R7-03 | sparse work by stored elements, not length | — (O(holes) → O(own)) | `state/restore-array-length@sparse` | B | Gates wakes only; clone/validator hole walk unmeasured; README `c15fb04c0472` is the verified parent of `c234c5c`, but no metric validation on it is documented |
| R8-03 | `forgetAll()` one publication | 4000 → 1 storage write, 5971 → 10.77 ms | `cache/forget-all@32-fallbacks` | B | Counter `persistForgetWrites = 1` exists but entry is `control`, 32 entries only; pre-R8 build `8b27dc42ac2f` listed but no validation recorded for this metric |
| R9-04 | `abortAll()` batched | 4000 → 1 version/callback/write; 8558 → 62 ms | `cache/forget-all@32-fallbacks` | B | `versionDeltaAbort`/`storageWritesAbort = 1` under `control`; table's `687c7aa405e6` already contains the R9-04 fix (same commit) — no pre-fix baseline |
| R10-06 | cache view identity kept across `setData` | N → 0 new views | `views/set-data-identity@100` | B | Labelled `control`; no pre-R10-06 build in table |
| R11-05 | Date detachment copies once | Date copies 50 400 → 100 | `state/date-aliases` | A | Copy/lookup counters; validation build INFERRED to be `b5d41aefbae1` (R15 integration baseline predates R11–R14 fixes) |
| R11-06 | throttle cancellation drops captured callbacks | delivered 128 000 → 2 000 | `delivery/throttle-cancel` | A | Exact delivered counts + same-run cost ratio |
| R11-07 | stable NaN cache views | 30 001 → 1 view identities | `delivery/cache-views` | A | `viewIdentities = 1` |
| R15 (api) | per-pull dependency bookkeeping | 128 deps 96 → 0.34 ms; unrelated evals 1 → 0 | `computed/pulls@1`, `@128` | A | `unrelatedEvals = 0`; plus scale/time ceilings |
| R16-PERF-01 | history ownership without duplicate copies | owned capture 109.8 → 21.0 ms | — | D | Timing-only claim; no counter of copies per capture |
| R17-ENGINE-04 | mixed plain/native capture owns once | root/row visits 2 → 1; 0.963 → 0.287 ms | — | D | `history39` counts clones after construction, not the double visit |
| R19-ENGINE-01 | root-owned native alias path index | row visits 16 512 → 256, 4.90 → 0.33 ms | `aliases/selection-visits@128` | B | Row gate (≤ 320) would separate, but R35 "Open" says R19-01 has no gate failing on its parent build while README lists `ce08c7f2041a` as its baseline — contradiction unresolved; `firstRootVisits ≤ 300` passes the pre-fix 256 |
| R19-ENGINE-02 | locked-array classification inside the capture pass | root 2 → 0, dictionary 2 → 0, entries 8 → 0 `Object.keys` | `state/resource-history` | B | Counters exist, but label `R19-02` is ambiguous (R19-API-02 is a cache fix) and `ce08c7f2041a` *is* the fix commit, so no pre-fix build is listed |
| (Fixed) | scalar draft write keeps the native-alias index | 128 → 2 rebuilds over 64 cycles | `aliases/write-read@4k` | B | Labelled R19-ENGINE-01; same R35 contradiction; parent build of this fix not in table |

### js-review R13–R16 (`JS-`)

| Finding | Optimization | Claimed number | Gate id(s) | Class | Note |
|---|---|---|---|---|---|
| JS-R13-02 | per-tree `WeakMap` proxy cache, no watcher ledger | SSR 4000 rows 2599 → 61 ms; 4000 proxies 1824 → 7.4 ms | `components/ssr@4k` | B | Only `ssrLargeMs / ssrSmallMs ≤ 6`; baseline `a5cf42c^` not listed |
| JS-R13-05 | eliminate production `liveViews.note` invocations | profile: 51 ms note self time | `components/ssr@4k` (indirect) | B | Distinct subclaim grouped with JS-R13-02 under shared fix `a5cf42c`; auxiliary row adds zero counting units; production invocation counter gap #20b |
| JS-R13-03 | primitive write is O(1) in live readers | 2000 writes with 1000 readers 533 → 5.9 ms | — | D | No scenario holds live readers while writing |
| JS-R13-04 | `Computed` subscribers in a `Map` | 4000 subscribers 9843 → 2.2 ms (5 waves) | `computed/hook-publication@1000` | B | `mapMs` scale vs @100 ≤ 25 (10× consumers): time scale only |
| JS-R13-06 | no instance Proxy, prototype methods | SSR cost; 9 closures/instance → 0 | `components/ssr@4k` | A | `instanceMethodFields = 0`; baseline `a5cf42ca06e0` |
| JS-R13-07 | `persist` stringifies `getData()`; `deepClone` assigns | persist 4.62 → 0.3 ms, clone 4.77 → 1.7 ms | `state/date-aliases` (`persistSnapshots = 0`) | B | Incidental counter under R11-05 label; `defineProperty`-per-key regression ungated (`store/r32-deep-clone` counts `Object.create` only) |
| JS-R13-08 | structural default comparator in hooks | re-render avoided | — | C | `Engine/Tooling/InteropDefaultComparator.test.tsx` |
| JS-R13-09 | one serialization per `useResource`, frozen absent view | — | — | D | Low value |
| JS-R13-10 | persistent `useCarburetor` root view | 3–4× per read | `components/proxy-reads` | A | `steadyViews = 0`, `steadyReadCalls = 0`; baseline `ac9bc8907bb0` |
| JS-R14-01 | `extend`/`addPath` instead of re-subscribe per leaf | 1 edit at 1k rows 4431 → 13 ms; 2002 → 1 subscribe calls | — | C | `LiveResults.test.tsx` ("2000-row computed subscribes a bounded number of times") |
| JS-R14-02 | `has` branch marker for `items.map` parent | map parent 1 → 0 renders | — | C | `list-render-precision.test.tsx`; gap #8 |
| JS-R14-03 | index/length paths for push/splice/index assignment | push 1001 → 1 renders | — | C | `list-render-precision.test.tsx`; gap #8 |
| JS-R14-04 | array iterator does not subscribe to whole store | for…of 1 → 0 renders | — | C | `list-render-precision.test.tsx`; gap #8 |
| JS-R14-05 | fast properties on `AntiHookComponent` | dictionary mode → fast | — | D | Needs `%HasFastProperties`; harness spawns with `--expose-gc` only |
| JS-R14-07 | handler classes, traps on prototype | ~9 → 1 allocation per proxy | — | D | No allocation-per-proxy gate |
| JS-R15-01 | symbol read records nothing | 1 → 0 renders (`concat`, `toString`, `String`) | — | C | `list-render-precision.test.tsx` (concat/toString/String tests) |
| JS-R15-03 | `computed(body, {equals})` | 20 → 0 list renders | — | C | `Engine/Derived/Computed/Core.test.tsx`, `Demo/DerivedFeatures.test.tsx` |
| JS-R15-04 | `SubscriberIndex` files only the delta | re-subscribe 1000 paths 1.7 → 0.1 ms | — | C | `Engine/Store/Paths/subscriberIndex.test.ts:305,329` |
| JS-R15-05 | single-id buckets, no ancestor cache | 1880 → 483 B per 3-path subscriber | `subscribe/match-precision@1k/@4k` | B | `heapBytesPerSubscriber ≤ 1500` (V8 heap, different shape, label R16-02) |
| JS-R15-06 | one `ConnectionSource` per declaration | 9608 → 6904 B retained per `connect()` row | — | D | — |
| JS-R15-08 | memoized string child paths/branch markers; deferred draft paths | ~35–40 % of a walk (model) | — | D | Persistent handlers cache `joinPath` strings and `branchPath` markers; ordinary keys require no escape arrays. Model timing is not a mechanism gate; gap #27b |
| JS-R16-01 | key-set marker for enumeration | parent renders 1 → 0, 5–13.6 → 0.4 ms | — | C | `list-render-precision.test.tsx` ("not the Object.keys(items) parent") |
| JS-R16-02 | structural diff behind `setData`/`restore`/undo | undo 4000 → 1 render | `subscribe/match-precision@*` | A | Wake counters; baseline `1c100299e00c` |
| JS-R16-03 | draft object replacement records differing leaves | filter recompute 2 → 0, 17–28 → 0.3 ms | — | C | `Engine/Tooling/history/CarburetorHistoryPatches.test.ts:323` and diff tests (INFERRED to cover the recompute) |
| JS-R16-04 | `EvictionLedger` instead of O(N) scan per fetch | 4000 rows 8073 → 1622 ms | — | C | `Engine/Resource/ResourceCacheLifetime/EvictionScaling.test.ts` (walk count ∝ N) |
| JS-R16-05 | commit drift by read paths | mount 8000 → 4000 row renders | — | C | `Engine/Component/AntiHookComponent/effects/precise-drift.test.tsx:52` |
| JS-R16-06 | `markStale` returns once stale | 1 149 795 → 99 marks, 74 → 0.2 ms | — | C | `Engine/Derived/Computed/DependencyMaintenance.test.ts:433` |
| JS-R16-07 | history records patches | 2.5–5.4 → 0.01 ms; 16.3 → 0.1 MB / 50 entries | `history/undo-one-field@*`, `history39/date-heap@10k`, `history39/scale@*` | B | Incidental real plain draft patch verdict guards already exist: `plainKind = 'patches'` and `patchKindsCorrect = true` includes the plain control; `plainPerEntryKB ≤ 50` is a heap guard. Zero-clone counters probe native state only. Missing direct plain clone counter and documented validation specifically on pre-JS-R16-07 `2aa36c7^`; pre-R39 failures do not establish that proof |

### R30–R39

| Finding | Optimization | Claimed number | Gate id(s) | Class | Note |
|---|---|---|---|---|---|
| R30-01 | per-native alias answer cache | 9110 → 0.24 µs; Map view 17.9× → 1.11× raw | `aliases/selection-visits-repeat@128`, `aliases/read-cache@10k` | A | `secondRowVisits = 0`; read-cache adds an absolute 0.02 ms ceiling and a time ratio |
| R30-02 | `RAW_TARGET` hatch, no registry insert | fresh walk 0.57–0.75× (not confirmed) | `reads/fresh-walk@4k/@16k` | A | `registryInserts = 0`, `probeControl = 4` |
| R30-03 | detached Date/Map/Set compare by content | renders avoided | `selection/date-equal` | A | Verdict + descriptor-visit counters |
| R30-04 | selection model = state model | compare 0.34×, detach 0.19× | `selection/compare@plain` | A | Descriptor visits 0 + negative verdicts |
| R30-05 | persistent read tree for computed/watch | 0.42× / 0.34× | `reads/persistent-tree@4k` | A | Read-tree rebuilds 0 |
| R30-08 | `resolve` primitive fast path | 435.7 → 146.7 ns | `resource/resolve@4k`, `cache/key-memo@4096` | A | `stringifyCalls = 0`; "clock/LRU only when finite" sub-claim ungated |
| R30-09 | in-place ancestor walk in `SubscriberIndex` | 0.738× | `subscribers/filing@1k/@4k` | A | `ancestorArrayWalks = 0` + `probeSelfCount` |
| R30-10 | lazy hook initializers; watch keeps unchanged subscription | — | — | C | `Engine/Derived/Computed/Freshness/PersistentTree.test.ts:138`, `Engine/Store/Carburetor/Selections/selector-watch.test.ts` |
| R31-01 | ordered Map/Set equality | stale DOM → updated | `selection31/native-order@watch/@react` | A | — |
| R31-02 | settled readonly `forgetAll` one preparation | roots 128 → 1; 324 → 0.6 ms | `cache/forget-all@32/128/1000/4000-settled` | A | `roots = 1`, `entryVisits = 0` |
| R31-03 | sparse selection by own indices | checks 196 608 → 6 | `selection31/sparse@256/@65536` | A | Dense control |
| R31-04 | scalar cancellation without full capture | capture 1 → 0, row visits 1536 → 0 | `history31/scalar-cancellation@32/@512` | A | `constructionCaptures = 1` control |
| R31-05 | equal Invalid Date stable | renders 2 → 1 | `selection31/native-order@react` | A | — |
| R31-06 | intrusive LRU key memo | hot 64 → 0 stringify | `cache/key-memo@8192-budget`, `@hotcold` | A | — |
| R32-01 | raw targets in assigned containers | raw assignment 0.41× | `write/normalize@10k` | A | Proxy counters + probe |
| R32-02 | combined capture Set for shared leaf | K = 1600: 468 → 14.6 ms | `derived/r32-fan-in@1600` | B | Only `settle1600Ms / settle100Ms ≤ 80` (time ratio; quadratic ≈ 256 INFERRED) |
| R32-03 | positional methods record index paths | splice 143 → 6.7 ms | `array/positional@10k`, `@10k-subs` | A | Exact paths/wakes; `WriteLog` capacity stop ungated |
| R32-04 | memos bounded by live key set | heap +13.8 MB/50k keys → flat 2.4–2.8 MB | `array/memo-window@200k-*` | B | `driftKb ≤ 2048` heap metric, V8-dependent (R35 Open) |
| R32-05 | `diffPaths` skips equal children | 2.44 → 0.31 ms; 85.5 → 1.5 KB | `write/one-row@10k` | A | `allocKb ≤ 64` measured without GC (3.7 MB/op before per R35) |
| R32-06 | enumeration does not wrap values | retained 2891 → 1740 KB | `readenum/fresh@2500/@10000` | B | Heap ceilings: 580 KB vs ~723 KB pre-fix at 2.5k (~20 % margin), V8-dependent |
| R32-08 | `{}` for `Object.prototype` clones | (gate not passed in report) | `store/r32-deep-clone@10k` | A | `snapshotObjectCreates = 0` + control |
| R33-01 | live computed result not walked per settle | 1802 → 0.098 ms | `derived/r33-live-branch@10k` | A | `settleWalks = 0`, control 10 000 |
| R33-02 | hook snapshot reuse | 417–476 → 6–15 ms | `hooks/r33-snapshot@10k` | A | Selector runs 0 |
| R33-03 | O(1) drift for filed read set | 7.49 → 0.0015 ms | `derived/r33-drift-get-after-write@10k` | A | `writeLogMatches = 0`; R33 report said the original agent bench showed baseline == after, R35 P-3 says rewritten |
| R33-04 | internal keys hatch | 2.2–2.9× | `selection/keys-hatch@10k` | A | `probeSelfCount = 2` |
| R33-05 | `equals` keeps announced reference | memo children not re-rendered | — | C | `Engine/Derived/Computed/Core.test.tsx:8` |
| R33-06 | folded object patches | 50–72 → 0.05–0.10 ms | `history/r33-patches@10k` | A | `depRowWalks = 0` + control |
| R33-07 | `persist` coalesces | 218 → 3 ms; 50 → 1 `setItem` | `store/r33-persist@10k` | A | — |
| R34-01 | drift answer kept after re-subscription | 8.4 → 0.0012 ms; 200 → 0 consultations | `derived/drift-*@10k`, `hooks/drift-after-related@10k-*` | A | `writeLogMatches* = 0` |
| R34-02 | structural sharing in reconcile | 10 000 → 1 memo row renders | `hooks/memo-rows@1k/@10k` | A | — |
| R34-03 | undo/redo replay O(patches) | 10k: 89 → 0.024 ms; 50k: 636 → 0.03 ms | `history/undo-one-field@10k/@50k` | B | Only `undoMs`/`redoMs` ceilings and scale; `wakes = 28` equal on both builds |
| R34-04 | restore wraps only changed path | 1000 → 1 row wraps | `store/restore-one-leaf@1k/@10k` | A | Read-wrap positive control |
| R34-05 | `CarburetorScope.toJSON` one pass | 0.50× of `dehydrate()` | `store/dehydrate@10k` | B | Time ratio ≤ 0.8; pre-fix build lacks `scope.toJSON` and emits `scopeStringifyMs: null` (nonnumeric), not a missing metric; no mechanism separation |
| R35-01 | live result drifts on data-object swap | stale → fresh, 0 extra primitive re-runs | `liveresult/replace-data@10k` | A | Correctness fix with run counters; `getMs ≤ 0.5` sanity |
| R36-01 | live-list selection patched from write log | 60 005 → 3 paths/write; 67 → 0.75 ms | `selection36/related-walk@1k/@10k` | A | Control ≥ rows |
| R36-02 | `connectSelection` gates at notification | 2000 → 2 row renders | `selection36/class-selection@2k` | A | Plain control 2000 |
| R36-03 | two-sided drift answer | 21 → 0 consultations; 1 → 0 recomputes | `drift36/*` | A | — |
| R36-04 | public replacements record patches | 638 → 13 KB/entry; undo 56 → 1.5 ms | `replace36/public-replacements@10k` | A | Verdict `kind = 'patches'`; KB/entry ungated |
| R36-05 | relative 2000-path threshold | 10 000 → 2010 renders | `replace36/relative-diff@10k` | A | `diffPaths`-level; render/recompute counts not end-to-end |
| R36-06 | member matching by raw identity | 2001 → 1 renders on insert | `selection36/memo-moves@2k` | A | — |
| R36-07 | allocation-free `shallowEqual` | 3 objects/child → 0 | — | D | `Engine/Derived/R36/shallowEqual-equivalence.test.ts` checks verdicts only, not allocation |
| R37-03 | bounded read ownership | 23 paths after 64 cycles | `selection37/bounded-reads@64` | A | — |
| R37-04 | relative patch budget | 65/128 writes: no cliff | `selection37/patch-budget@4k`, `selection38/sparse-raw-cap@*` | A | — |
| R37-05 | primitive wake allocates no ledger | 4 → 0 collections | `selection37/primitive-wake@1` | A | — |
| R37-06 | equal branch migration without render | 1 extra class render → 0 | `components/branch-migration@1` | A | — |
| R37-01 | (correctness) alias topology | — | `selection37/alias-topology@2` | A | Not counted; README documents baseline verdict failure |
| R37-02 | (correctness) complete patch delivery | — | `history/r37-02-delivery@4-fields` | A | Not counted; README documents baseline verdict failure |
| R38-01 | equal cyclic snapshots; mutation-target proofs | 144 009 → 2 reads; 5 → 0 false callbacks | `selection38/cyclic-equality@production`, `footprint-lifecycle@5000` | A | — |
| R38-02 | inactive copy released | retained → collectible | `selection38/inactive-copy-release@10k` | A | Reachability, not bytes |
| R38-04 | flat primitives without graph collections | 3/1 → 0/0 per watcher | `selection38/flat-primitive@128` | A | — |
| R38-05 | primitive class getter no ledger | 3 → 0 WeakMaps | `selection38/class-primitive-ledger@3` | A | — |
| R39-01 | per-write proof accumulation; `pathsSince` bounded | 80 009 → 3 paths; ~200 → 0.06–0.19 ms | `writelog39/interleaved-*`, `paths-since@4000`, `bound-write-*` | A | Counter failures on `e8c3b34337f8`; `paths-since@0` is control. Related-write timing companion ≤10 ms: README baseline 298–412 ms → watch 0.11–0.14, hook 0.23–0.34, class 0.28–0.44 ms; time-only companion is B, not independent A |
| R39-02 | native-holding state keeps patch history | write 26.6 → 0.019 ms; 627 → 2 KB/entry | `history39/native-scalar-*`, `scale@*`, `date-heap@10k`, `date-timing@10k` | A | Patch verdicts and zero owned clones remain mechanism A. Heap companion ≤50 KB/entry (snapshot control ≥100); README after 1.6 KB, baseline 627 KB from report/comment, not a fresh audit observation. Timing ceilings write ≤2/undo ≤3 ms; README baseline 40.6/96.3 → 0.08/0.06 ms. Heap/time evidence alone is B |
| R39-03 | incremental ownership repair | 30 007 → 3 descriptor lookups | `alias39/*` | A | Descriptor/Set counters remain A; `truncate-invalidates@64` rejects stale owner `rows.63`, expects empty owner and 0 stale wakes. `instance-leaf-time@50k` ≤5 ms is a B timing companion, README 115 → 0.02 ms, sharing counter samples |
| R39-04 | proofs only once requested | Maps 1002 → 3, Sets 2997 → 1998 / 1000 writes; 1496 → 1219 ns | `writelog39/write-allocs@1000`, `write-bytes@6000`, `raw-retention@10000` | A | Constructor counters preserve A. Heap/write-cost companion: toggle available and saved bytes ≥50, README 4 → 204 B/write (off 731 B), monotone no-scavenge control. Byte magnitude is B; ns figure remains ungated. Raw-retention is control: ≤2112 reachable/≤2048 pairs, after 1866/1869; baseline pairs −1 makes its bound trivial |
| R39-05 | identity alignment for `filter` reassignment | paths 1 → 5002; wakes 200 → 64 | `diff39/filter-assign-*`, `external-alias-history@2` | A | External alias values now gated: baseline `undoSelected = b` → `a`; identity outside contract is not gated. `map-replace-one@10k` and `genuine-leaves@5k` explicitly control |
| R39-07 | field-level `useResource` subscription | renders 3 → 2 | `resource39/data-only-readers@50`, `forget-reload` | A | Reader render mechanism stays A. Forget/restore including throttle: loader calls =2 and extra renders ≥1; reload gates pass baseline, only `controlExtraRenders` 1 → 0 rejects it. Status replacement is control |

## 4. Gaps, prioritized

Priority weighs value (asymptotic class, renders, memory) against how easy a regression is (one-line
change in a hot path). "Baseline" names a build from the `perf/README.md` table or, when missing, the build
that must be added (`node perf/harness/baseline.mjs <ref>`).

| # | Claim | Class | Proposed gate (scenario · metric · baseline → after · baseline build) |
|---:|---|---|---|
| 1 | JS-R16-04 `EvictionLedger` | C | `cache/eviction-scaling@{1k,4k}`: load N keys with default `maxEntries`, settle all · `Object.keys` calls on the entries dictionary plus ledger walk count per load, `equals` 0 on hits and `scale` 4k/1k ≤ 4.4 · ~N per load (O(N²) total) → O(1) amortized · new baseline: `3394b26^` |
| 2 | JS-R16-06 `markStale` | C | `computed/diamond-ladder@26`: one write through a 26-node diamond ladder · stale marks (wrap `Computed.prototype.markStale` via `loadPath`) `max` 120, body runs `equals` 26 · 1 149 795 → 99 · `9e4ef94^` |
| 3 | JS-R14-01 computed list `extend` | C | `computed/live-list@{1k,4k}`: hook list rendered from a computed's live result, one title edit · `subscribe` calls on the store per edit `equals` 1, `extend` calls ≤ rows · 2002/8002 → 1 · `ec98a4b^` |
| 4 | R34-03 O(patches) undo | B | add to `history/undo-one-field`: count `Reflect.ownKeys`/`Object.keys` on raw rows during `undo()`/`redo()` · `equals` 0 (+ positive control: a snapshot-entry undo ≥ rows) · ≥ 10 000 → 0 · `d300b9a44c84` |
| 5 | JS-R16-05 commit drift by paths | C | `components/mount-sibling-writer@4k`: 4000 rows mounted next to a sibling writing an unrelated path on mount · row renders `equals` 4000 · 8000 → 4000 · `dc7eb03^` |
| 6 | JS-R13-03 write vs live readers | D | `reads/live-readers@{0,1000}`: hold N read views (or mounted `useCarburetor` rows), 2000 primitive writes · Map/WeakMap/Set method calls during the write loop, `scale` 1000/0 ≤ 1.1 · ~N per write → constant · `a5cf42c^` |
| 7 | JS-R16-01 key-set marker | C | `components/keys-parent@4k`: parent renders `Object.keys(items)`, one row title edit · parent renders `equals` 0, row renders `equals` 1 · 1 → 0 · `e52def0^` |
| 8 | JS-R14-02/03/04 list precision | C | `components/list-precision@1k`: JS-R14-02 nested edit under `items.map` · parent renders 1 → 0; JS-R14-03 push and `items[5] = …` (also splice) · row renders 1001/1000 → 1/1; JS-R14-04 unrelated write after `for…of` · renders 1 → 0 · exact parent to add `89a5af7^`; fixture count specializations INFERRED |
| 9 | JS-R16-07 plain history patches | B | Extend the existing plain draft control in `history39/scale@10k` with a separate `countOwned` plain-write probe outside timing; retain `patchKindsCorrect = true`, and `date-heap`'s `plainKind = 'patches'` / `plainPerEntryKB ≤ 50`. Add direct plain `ownedClones`/`clonedNodes = 0` with construction/snapshot nonzero controls · pre-fix snapshot/nonzero clones → patches/0 (INFERRED fixture counts, not measured) · validate specifically on `2aa36c7^`; existing native-only zero-clone probes and pre-R39 documentation are not that validation. No duplicate plain scenario needed |
| 10 | R19-ENGINE-01; Fixed scalar-alias-index claim | B | `aliases/selection-visits@128` · row visits 16 512 → 256 and root visits 256 → ≤8 (latter INFERRED target; old ≤300 does not separate) · README `ce08c7f2041a`, validation conflict unresolved. `aliases/write-read@4k` · rebuilds over 64 cycles 128 → 2 · exact parent to add `470a912^`; before/after from claim, gate failure not verified |
| 11 | JS-R16-03 draft object replacement | C | `write/object-replace-filter@4k`: `draft.items[i] = {...items[i], title}` under an observed computed reading only `done` · recomputes `equals` 0, recorded paths `equals` 1 · 1–2 → 0 · `1c100299e00c` |
| 12 | JS-R13-04 computed subscribers | B | add counter to `computed/hook-publication`: `Object.keys` calls (or array allocations) inside `get()` across 5 waves · `equals` 0 · S per get → 0 · `9386cd9^` |
| 13 | R32-02 fan-in | B | add to `derived/r32-fan-in`: `Set` constructions and `add` calls per write at K = 1600, `scale` vs K = 100 ≤ 20 · ~K² → ~K · `523d6a04a5f5` |
| 14 | R34-05 scope `toJSON` | B | `store/dehydrate@10k` · count snapshot/clone calls during `JSON.stringify(scope)`, control `dehydrate()` ≥1 · ≥1 → 0 (INFERRED counter values) · README `d300b9a44c84` lacks API and emits `scopeStringifyMs: null`; cannot prove counter separation. Also validate an explicit `toJSON`→`dehydrate` negative control, not a missing API |
| 15 | R36-07 `shallowEqual` allocation | D | `components/props-gate@10k`: 10 000 three-key comparisons · allocated KB without GC in window (technique of `write/one-row`) ≤ 16 · ~3 objects × 10 000 → 0 · exact parent to add `27dce28^` |
| 16 | R17-ENGINE-04 mixed capture | D | `history/mixed-capture@128`: `{rows[128], last: Map}` + history construction · `Reflect.ownKeys` calls per original row `equals` 1 · 2 → 1 · `15748fc^` |
| 17 | JS-R15-04 delta re-file | C | `subscribe/refile-delta@{1k,4k}`: re-subscribe same id using a distinct read Set with one added path, fixed depth and no removals · instrument exact-path filing and ancestor filing separately: unchanged paths untouched, one new exact path plus its ancestor chain; fixed-depth filing work scale 4k/1k ≤ 1.1 · O(paths × depth) → O(depth) index work (INFERRED fixture counts; membership scans remain O(paths)) · `d006c59^`. Count internal filing work, not public `add` calls or total Map/Set operations `= 1`; ancestor bookkeeping and readsById updates invalidate that bound |
| 18 | JS-R14-07 / JS-R15-06 per-proxy and per-row memory | D | `reads/proxy-alloc@4k`: allocated bytes per fresh proxy (no GC window) and retained bytes per `connect()` row vs plain `React.Component` row (same-run `over` ≤ 1.9) · ~9 objects → 1; 9608 → 6904 B · exact parents to add `57277e2^`, `650ae81^` |
| 19 | R6-02 / JS-R13-07 clone cost | B | Extend `store/r32-deep-clone` with two isolated probes on ordinary string-keyed plain objects: R6-02 `Reflect.ownKeys` calls attributable to `deepClone` · >0 per object → 0 (`Object.keys` replaces it; not `Object.getOwnPropertySymbols`) · `171c1fa781f3`; JS-R13-07 `Object.defineProperty` calls during clone · per ordinary key → 0, with an own `__proto__` clone as nonzero positive control · `f19f6f0^`. Proposed fixture counts are INFERRED; isolate cloning from unrelated ownership/introspection calls and validate both baselines separately |
| 20 | JS-R13-02 SSR quadratic | B | add to `components/ssr`: Map/WeakMap method calls per rendered row, `scale` 4k/1k ≤ 1.2 · ~N per row → constant · `a5cf42c^` |
| 20b | JS-R13-05 production notes (grouped subclaim) | B | `components/ssr@4k` in production · instrument `liveViews.note` invocations while creating/reading 4000 row proxies · ≥4000 → 0 (INFERRED fixture count; development-mode note calls as positive control) · exact parent to add `a5cf42c^`; present SSR timing ratio does not isolate this cost |
| 21a | R32-04 memo window | B | `array/memo-window@200k-*` · live memo entries after 200k transient keys · 200 000 → ≤2048 (INFERRED; choose bound matching implementation) · README `523d6a04a5f5`; companion to +13.8 MB → flat 2.4–2.8 MB |
| 21b | R32-06 enumeration | B | `readenum/fresh@10000` · wrappers constructed for own-key enumeration alone · 10 000 → 0 (INFERRED) · README `523d6a04a5f5`; companion to retained 2891 → 1740 KB |
| 21c | JS-R15-05 subscriber buckets | B | `subscribe/three-path-buckets@4k` · bucket objects/ancestor-cache records per three-path subscriber · ≥3/≥1 → 0/0 (INFERRED; hold single-id buckets distinct) · exact parent to add `d006c59^`; retained bytes 1880 → 483 are report values, not this fixture's proof |
| 21d | R6-04 read-set handover | B | Extend `subscribe/reads-copy@4k`: instrument Set copies attributable to subscription, excluding fixture and index collections; transferred internal reads must incur zero copies, public reads a nonzero copy control (INFERRED fixture counts). `65b7b05^` already adopts internal AND public sets: internal baseline 0 → 0, not 1 → 0; the public copy/brand is introduced by R6. Validate a deliberate internal-copy negative control on the candidate to guard the no-added-copy claim; missing transfer API metrics on the parent do not prove a performance improvement. No separating historical internal-copy count is established |
| 22a | R8-03 forgetAll | B | `cache/forget-all@4000-persist` · publications/storage writes · 4000 → 1 · README `8b27dc42ac2f`; present 32-fallback control is not documented as failing there |
| 22b | R9-04 abortAll | B | `cache/abort-all@4000` · version delta/callbacks/storage writes · 4000 → 1 · exact parent to add `687c7aa^` (README `687c7aa405e6` already contains fix) |
| 22c | R10-06 cache views | B | `views/set-data-identity@4000` · newly created unchanged views · 4000 → 0 (INFERRED specialization of N → 0 claim) · exact parent to add `52a4a61^` |
| 23 | R7-03 sparse holes | B | `state/restore-array-length@sparse`: snapshot, validation and truncation of length-10⁶ array with 3 own indices · index visits ≤10 with dense control · ~10⁶ → 3 (INFERRED fixture values) · README `c15fb04c0472` = `c234c5c^` (git verified); existing baseline needs metric validation, not a new parent |
| 24 | JS-R14-05 fast properties | D | needs a harness option to pass `--allow-natives-syntax`; `%HasFastProperties` of the 2nd instance `equals` true · false → true · `c793167^` |
| 25 | R16-PERF-01 ownership capture | D | `state/resource-history@plain-10k` · instrument plain-node ownership copies per capture with native snapshot control · 2 → 1 (INFERRED; report timing 109.8 → 21.0 ms is not a copy proof) · exact parent to add `984ad79^` |
| 26a | R30-10 lazy initializers/unchanged watch | C | `hooks/lazy-watch@100` · initializer calls per stable re-render and subscription replacements per unchanged notification · 100/1 → 0/0 (INFERRED) · README `1a02d29eec30` |
| 26b | R33-05 comparator keeps reference | C | `hooks/equals-reference@100` · memo child renders after equal computed publication · 100 → 0 (INFERRED) · README `829c3ea9c8bf` |
| 26c | JS-R13-08 default comparator | C | `hooks/default-equal@100` · extra renders on structurally equal replacement · 100 → 0 (INFERRED) · exact parent to add `759c94d^` |
| 26d | JS-R15-01 symbol reads | C | `components/symbol-reads@1` · renders after unrelated write following concat/toString/String · 1 → 0 · exact parent to add `2768ed6^` |
| 26e | JS-R15-03 computed equals | C | `computed/equals-list@20` · list renders after equal result · 20 → 0 · exact parent to add `868617c^` |
| 27a | JS-R13-09 resource serialization/absent view | D | `resource/serialization@100` · key serialization calls per hook render and new absent views per stable render · ≥2/1 → 1/0 (INFERRED) · exact parent to add `a819e9f^`, identified in the JS-R13 Resolution |
| 27b | JS-R15-08 string-path memo | D | `reads/repeat-child@4k`: warm a persistent plain read-proxy tree, then repeat the same nested `get`/`has` traversal with ordinary keys containing neither `~` nor the separator; no enumeration/descriptor probes, native exposure or key churn. Count BOTH `joinPath` and `branchPath` calls attributable to traversal via equivalently instrumented baseline/candidate builds · pre-fix per-read >0 → warmed 0 for each (INFERRED fixture counts), cold/fresh-tree controls nonzero for both · `2768ed6^`. Read `childPath`/`branchMarker` retain strings/markers; draft `writtenPath` caches branch strings and `get` avoids primitive paths. A separate warmed plain draft read probe can guard deferred paths (INFERRED >0 → 0); do not include native `get`, which still calls `branchPath`. Do not monkeypatch immutable or inlined ESM exports: instrumentation must be implemented in both builds at the call sites/functions. If unavailable, timing/model evidence is only weak and this implementation remains needed; path-array counts do not measure this mechanism |
| 28 | R19-ENGINE-02 lock classification | B | `state/resource-history` · Object.keys on root/dictionary/entries during ordinary unlocked cache replacement ownership capture · 2/2/8 → 0/0/0 · exact parent to add `ce08c7f^`; README `ce08c7f2041a` is the fix, not baseline |

All proposed counter values without a matching published measurement are **INFERRED**, including
asymptotic counts in #1, #3, #4, #6, #8, #9, #12, #13, #15, #17, #19, #20, #21d and #27b.
#27b's warmed-zero expectations count string-building calls, not actual string allocations or hashes;
its cold/control counts and draft specialization still need instrumented-build implementation and validation.
#21d has no historical internal-copy separation: pre-R6 adoption is observed in source, not measured. Timing/heap
before/after values copied from reports do not prove proposed counters fail on the baseline.
For #7 use literal parent ref `e52def0^`, matching the JS-R16 Resolution; for #11 use README `1c100299e00c`. Parent refs in the table are literal git
refs, not instructions to use a later integration build. #1=`3394b26^`, #2=`9e4ef94^`,
#3=`ec98a4b^`, #5=`dc7eb03^`, #6/#20=`a5cf42c^`, #9=`2aa36c7^`, #12=`9386cd9^`,
#16=`15748fc^`, #17=`d006c59^`, #18=`57277e2^` and `650ae81^`, #19=`171c1fa781f3`
and `f19f6f0^`, #24=`c793167^`. #15's exact pre-R36 ref to add is `27dce28^`, rather than
an abbreviated report freeze; proposed allocation bytes are INFERRED. #18 has two scenarios:
`reads/proxy-alloc@4k` for JS-R14-07 (~9 → 1 allocations, INFERRED) and
`components/connect-retention@4k` for JS-R15-06 (9608 → 6904 B/row, reported).

Parent-ref provenance: git-log inspection confirmed implementing commit identities/titles for
`470a912`, `27dce28`, `65b7b05`, `52a4a61`, `c234c5c`, `984ad79`, `759c94d`,
`2768ed6`, `868617c`, `a819e9f`, `57277e2`, `650ae81`, `d006c59`, `ce08c7f` and
`89a5af7`; the JS Resolution tables also identify their shared fix mappings. Literal `<fix>^`
refs specify parents for validation, not measured baseline distributions; some are already listed.
R16-PERF-01 → `984ad79^` and R6-04 → `65b7b05^` are **INFERRED attribution** from commit titles;
R6-04's parent source already adopts reads, so this ref is not an internal-copy regression proof.
R36-07 →
`27dce28^` is **INFERRED attribution** to the round integration commit. None of these proposed
new baseline proofs was executed, and exact first-fix attribution needs confirmation before acceptance.

Supplemental subclaims of A rows (not extra B/C/D Matrix positions): R30-08 finite clock/LRU
work: `resource/resolve@4k`, clock/LRU calls with infinite TTL 4000 → 0 (INFERRED), README
`1a02d29eec30`; R32-03 capacity stop: `array/positional@10k-subs`, path additions after
WriteLog overflow 10 000 → bounded capacity (INFERRED; derive exact bound from code), README
`523d6a04a5f5`. R39's headline companions are present (§3); ns/write and a tight pre-R38
list-watch ratio still lack a permanent gate. A 10 ms ceiling does not catch +11–13%.

### Exhaustive B/C/D Matrix ID → gap row crosswalk

| Matrix ID | Class | Gap row |
|---|---|---|
| R6-02 | B | 19 |
| R6-04 | B | 21d |
| R7-03 | B | 23 |
| R8-03 | B | 22a |
| R9-04 | B | 22b |
| R10-06 | B | 22c |
| R16-PERF-01 | D | 25 |
| R17-ENGINE-04 | D | 16 |
| R19-ENGINE-01 | B | 10 |
| R19-ENGINE-02 | B | 28 |
| Fixed scalar-alias-index claim | B | 10 |
| JS-R13-02 | B | 20 |
| JS-R13-05 (auxiliary grouped subclaim) | B | 20b |
| JS-R13-03 | D | 6 |
| JS-R13-04 | B | 12 |
| JS-R13-07 | B | 19 |
| JS-R13-08 | C | 26c |
| JS-R13-09 | D | 27a |
| JS-R14-01 | C | 3 |
| JS-R14-02 | C | 8 |
| JS-R14-03 | C | 8 |
| JS-R14-04 | C | 8 |
| JS-R14-05 | D | 24 |
| JS-R14-07 | D | 18 |
| JS-R15-01 | C | 26d |
| JS-R15-03 | C | 26e |
| JS-R15-04 | C | 17 |
| JS-R15-05 | B | 21c |
| JS-R15-06 | D | 18 |
| JS-R15-08 | D | 27b |
| JS-R16-01 | C | 7 |
| JS-R16-03 | C | 11 |
| JS-R16-04 | C | 1 |
| JS-R16-05 | C | 5 |
| JS-R16-06 | C | 2 |
| JS-R16-07 | B | 9 |
| R30-10 | C | 26a |
| R32-02 | B | 13 |
| R32-04 | B | 21a |
| R32-06 | B | 21b |
| R33-05 | C | 26b |
| R34-03 | B | 4 |
| R34-05 | B | 14 |
| R36-07 | D | 15 |

43 counted weak positions = 19 B + 15 C + 9 D; the crosswalk has 44 rows because it also
names the JS-R13-05 auxiliary subclaim of grouped counting unit JS-R13-02/05.

## 5. Anomalies

1. **RESOLVED: improvement-labelled passing R39 controls.** Direct manifest inspection finds
   `writelog39/paths-since@0`, `diff39/map-replace-one@10k` and `diff39/genuine-leaves@5k`
   labelled `control`. README now documents 12/14 writelog, 8/8 history, 7/7 alias, 5/7 diff,
   2/3 resource failures on `e8c3b34337f8`; the five passing entries are named controls.
   This is documentary evidence, not a rerun.
2. **Mechanism counters hidden under `control`.** `cache/forget-all@32-fallbacks` carries the R8-03
   (`persistForgetWrites`) and R9-04 (`versionDeltaAbort`, `storageWritesAbort`) counters;
   `views/set-data-identity@100` carries R10-06. They are guards without a guard label or baseline.
3. **Baseline table gaps.** Missing pre-fix builds for R9-04 (`687c7aa405e6` contains the fix),
   R10-06, R19-ENGINE-02 (`ce08c7f2041a` is the fix commit), R36 (`bf6af47` is cited in the R36 report),
   R38 (`c703dbd` is cited in the R38 report), R35-01, and all js-review R14–R16 fixes. The README rule
   "validate both ways" cannot be re-executed for those entries from the table. R7-03's parent
   `c15fb04c0472` is listed and git verified; only mechanism-metric validation is missing there.
4. **Documentation conflict, R19.** R35 "Open" and R36 "Known limits": "R19-01 has no gate failing on its
   own parent build". `perf/README.md` lists `ce08c7f2041a` as "before R19-01 / R19-ENGINE-01" and
   `aliases.mjs` says "Each gate fails on the build before its improvement". At most one is true.
5. **Gates that cannot separate.** `aliases/selection-visits@128` `firstRootVisits ≤ 300` (pre-fix 256);
   `history/undo-one-field` `wakes = 28` (same on both builds); `state/state-model@4k` `snapshotMs` scale
   ≤ 15 for 4× rows (linear 4, quadratic 16) — does not guard R6-02's constant-factor claim;
   `subscribe/match-precision` `heapBytesPerSubscriber ≤ 1500` vs ~1880 B pre-R15 for a different shape;
   `readenum/fresh@2500` `retainedKb ≤ 580` vs ~723 KB pre-fix (~20 % margin, V8-dependent).
6. **Failure by missing API, not mechanism.** `store/dehydrate@10k` on the pre-R34 build has no
   `scope.toJSON`; the scenario emits `scopeStringifyMs: null`, not an omitted metric. A null timing
   cannot prove the one-pass mechanism; add the explicit negative control in gap #14.
7. **Absolute timing ceilings still present** despite "ceilings are the last resort" and the comment in
   `selection.mjs` that absolute microsecond caps were not ported: `aliases/read-cache` `cachedReadMs ≤ 0.02`,
   `derived/*` `getMs ≤ 0.05`, `computed/pulls@128` `pullsMs ≤ 10`, `cache/forget-all` `removeMs`,
   `hooks/*` `renderBeforeMs`/`stableWriteMs`, `history/r33-patches` `dep10kMs ≤ 8`. Each sits next to a
   counter, so they add noise risk, not protection.
8. **Label namespace collision.** `R13-06`, `R13-10`, `R16-02` refer to js-review rounds; `R10-*`, `R11-*`,
   `R12-E01`, `R15`, `R19-*` refer to api-engine rounds, which reuse the same numbers. `R19-02` is
   ambiguous (R19-API-02 vs R19-ENGINE-02), scenario comments use `R19-E01` for `R19-ENGINE-01`.
   `--lint-gates` accepts all of them.
9. **PARTIALLY RESOLVED: headline gaps.** R39-02 retained KB/entry now has `date-heap@10k`;
   R39-01 related-write timing and R39-03 instance-leaf timing now have explicit ceilings;
   R39-04 proof opt-in byte savings now has `write-bytes@6000`. README documents current values,
   baseline failures and the missing-toggle caveat. These supplement, not replace, mechanism A.
   Still ungated exact claims include R39-04 1496 → 1219 ns, R36-04 638 → 13 KB/entry,
   R34-02 238 → 163 ms, R33-04 2.2–2.9×, R30-02 unconfirmed 0.57–0.75×,
   R31 −30.6% allocation sampling and historical JS retained/index bytes. The native linter
   20/270 ms and development-only unpublished-draft script remain outside this scope.
10. **PARTIALLY RESOLVED: list-watch write-cost risk.** `bound-write-{watch,hook,class}@10000`
    now bounds median related writes at 10 ms and has render/text correctness checks. README
    reports baseline 298–412 ms and current route medians 0.11–0.44 ms. This catches the old cliff,
    not the report's +11–13% over R38; no tight cross-build ratio is documented.
11. **RESOLVED: orphan scenario.** `diff39/external-alias-history@2` now references the scenario
    and gates selected/row values across undo/redo plus receipts, exceptions and diagnostics.
    README records baseline `undoSelected = b` instead of `a`. Identity remains explicitly ungated.
    `history39/fixture` and `owned-counter` remain helpers.
12. **Runner coverage.** `run.mjs` discovers every `perf/gates/*.mjs`; no gate file is skipped.
    `benchmarks/` holds only `state/unpublishedDraftCheck.mjs` (documented, needs a development build);
    `scripts/` holds no benchmarks (the `scripts/benchmarks/round31/*` drivers cited in the R31 report were
    removed during migration; their workloads live in `selection31`, `cache`, `history31`, `readable`).
13. **RESOLVED: CHANGELOG Added overclaim.** The current paragraph says "Most performance
    improvements of rounds 6-37", and explicitly points to this audit for unit-test-only,
    time-ratio and heap-ceiling coverage. The former "Every" assertion is removed.
    README's opening "Every performance improvement" remains broader than this Matrix supports.
14. **RESOLVED: duplicate notification gate.** `selection31/dense@256` contains exactly one
    `{metric: 'notifications', equals: 0}` in the inspected manifest.
15. **New baseline qualifications.** `raw-retention` is rightly control: baseline `trackedPairs = -1`
    makes the upper bound trivial. `forget-reload` reload counts pass baseline; its failure is
    only bare-creation extra renders 1 → 0. `write-bytes` baseline lacks the opt-in toggle and
    saves only 4 B/write, so its failure is partly API availability; constructor counters remain
    the R39-04 mechanism proof. Heap values depend on GC/V8 despite no-scavenge controls.
    README provides aggregate history failures and current 1.6 KB/entry, not an independently
    reproduced baseline `datePerEntryKB` sample. Gate comments' timing estimates differ from
    README's later medians; do not treat them as identical measurements.

## 6. Suggested order of work

1. Resolve remaining baseline/documentation issues first: R19 contradiction (anomaly 4),
   control-hidden counters (2), missing parents (3), and toJSON negative control (6).
   Do not repeat resolved R39 relabelling, orphan registration, CHANGELOG or duplicate cleanup.
2. Convert the highest-value C items into counter gates, one scenario each: gaps #1 (`EvictionLedger`),
   #2 (`markStale`), #3 (computed-list `extend`), #5 (commit drift), #7 and #8 (list render precision).
3. Augment the existing plain patch verdict guard (#9) with direct plain clone counters and pre-JS-R16-07
   validation; do not duplicate its plain scenario or call it time-only. Replace time-only/indirect guards
   with counters: #4 (R34-03 undo), #12, #13, #14, #19, #20.
4. Fill the D items: #6 (live readers), #15 (`shallowEqual` allocation), #16, #18; then the harness option
   for #24.
5. Give every heap gate a deterministic companion (#21) so a Node/V8 upgrade cannot blind or break them.
6. Remove absolute timing ceilings that sit next to a counter (anomaly 7), or move them to the optional
   timing job named in the README's CI plan.
7. Keep the new R39 headline companions; investigate a noise-tolerant R38-relative list-watch
   write-cost bound only if the +11–13% claim is to be guarded. Record exact baseline heap samples,
   toggle availability and reload-vs-render failure reasons rather than claiming all new entries
   independently fail by mechanism.

## Resolution — protection plan (2026-10-08)

Executed per `docs/perf-protection-plan-2026-10-08.md`. Every new gate was run on the current build five times in a
row after integration (41 entry prefixes, zero failures) and on the pre-fix build named below: the improvement
entries fail on the mechanism counter and the positive controls pass. Per-entry before/after values are in
`docs/perf-protection-results-2026-10-08.md`; the index of entries is the
[Coverage of earlier optimizations](../perf/README.md#coverage-of-earlier-optimizations) section of `perf/README.md`;
added pre-fix builds are in its [Baseline builds](../perf/README.md#baseline-builds) table.

### Step-to-gap resolution

Sizes are collapsed; companion controls are kept in the manifests.

| Step | Gaps | Actual entries |
|---|---|---|
| PG-C1 | #1, #2, #3, #17 | `cache/eviction-scaling@{1k,4k}`; `computed/diamond-ladder@26`; `computed/live-list@{1k,4k}`; `subscribe/refile-delta@{1k,4k}` |
| PG-C2 | #5, #7, #8, #11, #26a–e | `components/mount-sibling-writer@4k`; `components/keys-parent@4k`; `components/list-precision@1k`; `write/object-replace-filter@4k`; `hooks/lazy-watch@100`; `hooks/equals-reference@100`; `hooks/default-equal@100`; `components/symbol-reads@1`; `computed/equals-list@20` |
| PG-B1 | #4, #9, #12, #13, #19, #20 | `history/undo-one-field@{10k,50k}`; `history39/scale@10k-plain`; `computed/hook-publication-keys@1000`; `derived/r32-fan-in@1600`; `store/r32-deep-clone@10k-{ownkeys,define}`; `components/ssr-count@4k` with `@1k` control |
| PG-D1 | #6, #15, #16, #18; #25 partial | `reads/live-readers@1000` with `@0` control; `components/props-gate@10k`; `history/mixed-capture@128`; `reads/proxy-alloc@4k`; `components/connect-retention@4k`; `state/resource-history@plain-10k` |
| PG-HARNESS | #24, #27a | `components/fast-properties@2`; `resource/serialization@100` |
| PG-RESID | #20b | `components/live-view-notes@4k` |
| PG-DOC | #10 (two claims) | `aliases/selection-visits@128`; `aliases/write-read@4k` |
| PG-HEAP-CTRL | #21a, #21c, #22a–c, #23, #28; #21d as control | `array/memo-window@200k-*-live`; `subscribe/three-path-buckets@4k`; `cache/forget-all@4000-persist`; `cache/abort-all@4000`; `views/set-data-identity@4000`; `state/restore-array-length@sparse`; `state/resource-history@unlocked`; `subscribe/reads-copy@4k-copy-control` |

### Evidence and attribution qualifications

- **#10:** alias selection guards `firstRootVisits ≤ 160` and `128 ≤ firstRowVisits ≤ 320`; current root visits are 130
  against 384 on `ce08c7f2041a`. That build contains R19-ENGINE-02 and is the parent of R19-ENGINE-01 (`b33be10`),
  not the pre-R19-ENGINE-02 build. Scalar `aliases/write-read@4k` keeps attribution `470a912`, guards
  `rootVisits ≤ 150` and `4000 ≤ rowVisits ≤ 12000`, parent `e41828a41747` (192 / 256064 → 66 / 4001).
- **#15:** the baseline is `bf6af47e7990`, not the plan's preferred parent `27dce28^`. Guards: `keyCopies = 0`,
  `allocatedKB ≤ 16`, `monotone = true`; copying control `controlKeyCopies = 20000`, `copyingKB ≥ 1000`.
- **#17 closes JS-R15-04 only:** exact/ancestor files 1/2, unfiles and unchanged touches 0, filing work 3, scales
  ≤ 1.1 (baseline 1001/2002, work 6003). JS-R15-05 is guarded separately by #21c.
- **#18:** the connected/plain retained-byte ratio passes both builds (1.67 → 1.55), so the separating guards are the
  deterministic counters `freshOwnTraps = 0` and `connectedOwnTraps = 0` (36000 → 0 on `9c81aeec7297`, 40000 → 0 on
  `a6be80b0d25e`); positive controls expose 8 own traps on 4 proxies.
- **#20b:** `renderNotes = 0` during a 4000-row render (12000 on `759c94d8aa71`). The production build bakes the
  development flag off, so the positive control is a direct `note()` call (`seamNotes = 1`), not a development-mode
  render.
- **#21a:** the live-memo bound (≤ 2048) is fixture-specific, derived from the 128-entry threshold and doubling in the
  read/write proxies; measured 100 plain and 149 + 50 view live entries (baseline 200000 plain, 599998 view).
- **#21c:** exact and ancestor bucket objects are counted separately (12000 / 12000 → 0 / 0; 6 buckets and 3 cache
  records per subscriber → 0) on `868a74f30925`.
- **#22a–c:** hidden counters moved out of the controls into finding-labelled entries at 4000 (4000 → 1; unchanged
  views 4000 → 0, a single replacement keeps 3999 views); parents `8b27dc42ac2f`, `a67911e6c23b`, `e45f466ce88e`.
- **#23:** index visits during snapshot and truncation of a 10⁶-length array with 3 own indices fall from 1000000 /
  999999 to ≤ 10 (baseline `c15fb04c0472`). The validation walk exists only behind the development-only ledger,
  which the production build excludes; the production path is fully gated.
- **#25 stays D for the original duplicate-construction claim:** on `fabde0984e9c` construction copies are
  10000 → 10000 (1 → 1 per node), not 2 → 1. Publication copies fall 20000 → 10000, publication defines 60000 → 0,
  construction defines 30000 → 0; the gate comment records that mirror-copy removal is not in `984ad79` itself.
- **#28:** `Object.keys` on root/dictionary/entries during an unlocked cache replacement 2 / 2 / 8 → 0 / 0 / 0 on
  `728d5c8c5f3b`, label R19-ENGINE-02.

### Remaining weak positions

| Gap | Class | Why |
|---|---|---|
| #14 `store/dehydrate` | B | `d300b9a44c84` has no `scope.toJSON`; stringify yields `{"instances":{}}` without visiting the Map, so the snapshot counter is 0 → 0. The timing gate and a synthetic negative control remain; no historical separation. |
| #21b `readenum/fresh` | B | `Object.keys` constructs 10000 wrappers on both builds (the read proxy wraps descriptor values), so no counter separates them. |
| #21d `subscribe/reads-copy` | B | Kept as `control` (internal copies 0, public 4000, intentional copy detected); the parent already adopted internal sets, so no historical separation exists. |
| #25 `state/resource-history@plain-10k` | D | See above: the new gates protect publication copies and per-key defines, not the original duplicate construction. |
| #27b `reads/repeat-child` | D | Immutable ESM exports and inlined `joinPath`/`branchPath` cannot be instrumented identically on the frozen builds; time/model evidence only. |

### Class recount

Counting follows the original claim units, not entries, sizes or metrics.

| Class | Before | Promotions | After |
|---|---:|---|---:|
| A | 54 | +9 B +15 C +7 D +7 B | **92** |
| B | 19 | −9 −7 | **3** |
| C | 15 | −15 | **0** |
| D | 9 | −7 | **2** |
| Total | **97** | 0 | **97** |

- **B → A: 16** = #4, #9, #10 (2 claims), #12, #13, #19 (2: R6-02 and JS-R13-07), #20 with #20b (1) — 9 in all —
  plus #21a, #21c, #22a, #22b, #22c, #23, #28 (7).
- **C → A: 15** = #1/#2/#3/#17 (4), #5/#7 (2), #8 (3 claims: JS-R14-02/03/04), #11 (1), #26a–e (5).
- **D → A: 7** = #6/#15/#16 (3), #18 (2: JS-R14-07 and JS-R15-06), #24 (1), #27a (1). #25 and #27b remain D.
- **Remaining B: 3** = #14, #21b, #21d.
