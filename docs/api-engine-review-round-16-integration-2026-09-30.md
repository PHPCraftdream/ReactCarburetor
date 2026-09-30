# Round 16 integration — 2026-09-30

## Verdict

All named round-16 findings and integration regressions were repaired and transferred to `master`. This is **not** an independent zero-finding verdict. The next XS API/engine round reviews the same final committed product snapshot and may reopen any real P0–P3 issue, including the disclosed ownership cost below.

Incoming independent review counts: engine P0=0/P1=0/P2=2/P3=1; API P0=0/P1=0/P2=3/P3=0. API clear/deferred-publication duplicates the engine clear finding. Review reports are in `api-engine-review-round-16-engine-2026-09-30.md` and `api-engine-review-round-16-api-2026-09-30.md`.

## Completed repairs

| Finding | Verified behavior |
|---|---|
| R16-ENGINE-01 | History owns ordinary Map/Set/Date before/after graphs, including root/native in-place writes. `snapshot()` remains opaque-by-reference. Undo/redo install real changed endpoints instead of publishing a successful no-op. |
| R16-ENGINE-01A | Producer capture runs on the authoritative raw graph before a plain snapshot can separate a tracked key from its Map key. Native-owned replay preserves Map lookup, root backlinks, aliases, descriptors and wire identity. |
| R16-ENGINE-02 / R16-API-03 | `clear()` captures the current baseline, discards pre-clear pending work and retains later coalesced writes. An independent history keeps its own records. |
| R16-ENGINE-03 | Required `previousExists`/`nextExists` separate presence from payload. Every legal symbol, own undefined, sparse hole, escaped key and null-prototype branch survives replay. The absent sentinel is removed; only the opaque event marker remains shared. |
| R16-API-01 | A distinct keyless single-slot `setData` drops the old settled key before subscribers, including equal-valued replacement. Exact-object no-ops retain their legitimate key; explicit keyed restore/hydration remains valid; requests remain alive. |
| R16-API-02 | Raw cache failures belong to their entry object. Whole-entry draft/update replacement clears old raw failure before publication; identical replacement cannot inherit it; unrelated same-entry writes retain it. |
| R16-PERF-01 | Removed descriptor-heavy generic native traversal for plain copies, prototype churn, duplicate opaque endpoint copying and a separate publication classifier walk. Saved endpoints remain immutable; the baseline detaches lazily before an actual patch. Capture metadata is local to each invocation, not shared module state. |
| R16-PERF-01A | Capture metadata preserves the existing opaque classification of a non-array object with Array.prototype. Actual failing-before/passing-after key/sibling alias probe and permanent replay regression prevent classification drift. |

Custom snapshot projections require explicit `IPatchSource.captureHistory(own)`. No optional producer fallback guesses private wire state. Ordinary public restore semantics remain unchanged; native replay ownership is an exact-argument handoff after cancellation guards. Unsupported mutable classes and native accessors retain the strict refusal behavior; existing callable references are unchanged.

## Main delivery

The user explicitly changed the delivery policy: transfer each completed worktree task to `master` and commit it immediately, without waiting for a zero review round. No push or version bump was made.

- `f8312a1`: previously verified repair set through round 15; user lock/plan/scratch files excluded.
- `74603e4`: keyless single-slot settled-key ownership.
- `e02fbc2`: entry-owned raw cache failure.
- `21ee6b2`: symbol-safe patch presence.
- `f50dd34`: producer-owned native history and clear boundary.
- `9f2f328`: generated `/dist/` ignored and untracked, local artifacts retained; prepack rebuild added.
- `7973af0`, `35d812c`: independent round-16 reports transferred to master.
- `29c9d45`: completed renamed-file cutover, test grouping and packing harness repair.
- `fabde09`: benchmark instrumentation observes the implementation's native capture API without overriding its wire projection.
- `984ad79`, `6a086b4`, `a594e1c`: independently verified incremental ownership performance transfers; latest product snapshot is `a594e1c`.

`dist` remains in the npm `files` allowlist. Actual `npm pack` executed prepack and shipped the ignored output. The consumer matrix already builds explicitly, so its pack call uses `--ignore-scripts` rather than running another build and corrupting JSON stdout.

## Verification observed on the final product

- Typecheck passed.
- Lint passed with existing warnings retained and the unrelated user-owned `scratch/**` excluded only from the local command; no scratch file or committed lint policy was changed.
- Layout passed: at most 7 directory entries, 600 lines per code file, one export per file. Obsolete rename origins were removed; related history tests are grouped by responsibility.
- Full suite: **1356/1356** in 126 files, no failures/skips/todos/snapshot changes; 223.094 s test-run total.
- Focused final history/patch/wire suite: **97/97** in 6 files; no skips or snapshot changes.
- Packed consumers: **16/16**, no skips or failures; React 18/19, npm/pnpm, ESM/CJS, mixed-format selections/history, Next 16.3.5 Turbopack and webpack.
- Real npm archive and actual built consumer: 54 mixed-format history/resource boundary cases, plus class/hook SSR graph selections and root topology cases.
- Real browser: both class and hook readers display Map/Set/Date `1|1|1|key → 2|2|2|key → 1|1|1|key → 2|2|2|key → 3|3|3|key`; undo/redo/fork results `true,true,false`; zero browser errors. Owned tabs/services stopped.
- Native source-identical verification: 350 unit + 24 CLI tests passed, no ignored tests. Main release binary rebuilt with locked dependencies; actual Map diagnostic now states snapshot-by-reference without the obsolete undo limitation.

Initial failures were fixed in the same cycle: wrong before-endpoint expectation in a native regression, undefined timestamp increment in a throwaway probe, long source/test lines, old rename origins left by a deletion-only transfer list, and duplicate prepack stdout in the packing harness. No failing test or flaky check was deferred.

## Measurements and limits

Nine existing bounded paired drivers completed at below-normal priority. Counts below are actual API/work observations, not byte-allocation measurements. Timings are local trends, not CI thresholds. Duplicate-copy diagnostics during mixed-distribution runs are intentional and were not suppressed.

| Workload | Baseline → final / observed work |
|---|---|
| computedPulls, 10,000 reads / 1,12,128 dependencies | Medians 1.661→0.382 ms, 6.442→0.050 ms, 107.981→0.355 ms. Stable evaluations remain 0; unrelated evaluations 1→0; a real changed dependency evaluates once. |
| computedFreshness | 40 measured records cover native/adapter sources at several dependency counts; stable/changed evaluation and snapshot/version work counters recorded separately. |
| descriptorHistory | 300 writes and 300 undo + 300 redo: write median 4.921→3.282 ms; replay 40.126→81.955 ms. Both execute 600 attempted definitions, 900 versions/deliveries and restore length 301. Replay is slower; no speedup claimed. |
| delivery cancellation | 128,000 queued /126,000 cancelled: actual delivered 128,000→2,000; median 21.246→33.697 ms. Uncancelled control retains 128,000 deliveries, 15.674→21.668 ms. Correct cancellation has bookkeeping cost. |
| stable NaN cache views | 30,000 reads: view identities 30,001→1; median 24.479→18.814 ms. |
| persistence/native aliases | 100 writes retain 0 snapshots and 7,530,292 characters; 44.846→45.979 ms. Date copies 50,400→100, internal Map lookups 0→100; detachment 96.649→85.708 ms. Plain-key aliases 200→100 copies, correct lookups 0→100; key-first 81.824→79.030 ms, map-first 79.492→92.379 ms. |
| unpublished draft callback | 10,000 real writes/sample: median 27.030→12.898 ms; 10-write control preserves 9 deliveries/1 warning, distinct callbacks 9→1. |
| shared scheduler delivery | 32,000 real deliveries on both sides: median 2.421→2.627 ms. |
| inherited reads | Paired ratios approximately 0.980–1.067 for plain leaves, array methods/indices and 2,000 proxy constructions. Read sink unchanged. |
| ordinary history | Final old-baseline comparison: 128 writes, one complete capture on both sides; median 0.499→0.587 ms. Pure-tree publication remains patch-based. |
| resource history vs older incomplete history | 64 loads/128 transitions: capture calls 1→129; median 0.735→14.096 ms. The old baseline omitted required wire snapshots, so this is not an equal-work speed comparison. |

The isolated comparison against the already-correct round-15 wire-history baseline executes **129 captures on both sides**. The introduced generic ownership candidate was 109.838 ms versus 8.523 ms. Subsequent verified deltas measured 79.367, 55.489 and finally **21.027 ms versus 6.848 ms** (last pair ranges 17.410–28.045 and 4.845–8.989). Duplicate copies/classification/prototype churn were removed. **Residual descriptor-safe graph ownership cost remains; baseline parity is not claimed.** It is explicitly in next independent review scope.

Raw observations: session artifacts `r16-master-paired-benchmark-observations.json`, `r16-history-owned-capture-impact.json`, `r16-history-owned-capture-impact-after.json`, `r16-history-standard-shape-impact.json`, `r16-history-single-capture-impact.json`, and final native-history UI proof. The next report must use its own P0–P3 counts, not infer zero from this integration report or green gates.
