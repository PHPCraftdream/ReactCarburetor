# Round 19 independent API/engine review — engine — 2026-09-30

**Freeze:** `f1f1f06e7a07725ae977697e9a5d6cc94d8734f9`, worktree `cycle-review-r19-engine-xs`. Product files were reviewed without modification. The copied CJS/ESM development and production distributions were used for bounded real Node reproductions, not rebuilt here.

**Verdict: P0 = 0, P1 = 0, P2 = 1, P3 = 1. Not a zero round.** Both findings concern independently measured unnecessary traversal on supported ordinary state, not the two corrected round-18 behavioral defects. I found no additional evidence-backed correctness finding on the examined surfaces; green tests are not used as a substitute for this review.

## R19-ENGINE-01 — Each keyed native alias read searches the entire plain store again (P2)

**Location and mechanism.** `lib/src/Carburetor/Store/Tracking/liveViews.ts:96-103` calls `recordNativeAliasReads(root, result, record)` on *every* `Map.get`, including calls through an already cached facade/method. `Store/Tracking/Aliases/NativeAliasReads.ts:19-43` reflects the exposed member, then `:50-64` walks every enumerable ordinary branch of the complete root, recursively and without an index/cache, to find identity matches. An ordinary keyed read from a Map of $N$ rows alongside an array of those same rows costs $N$ full root walks for $N$ lookups, even when the root and alias topology have not changed; the result is approximately quadratic work within a single tracked selection. Correct subscription paths (`map` and individual `rows.i`) do **not** require rediscovering all unrelated rows independently for each key. This directly affects render selectors, `watch`, and `Computed` bodies on otherwise stationary store data.

**Actual consumer-sized bounded reproduction.** Run from this frozen worktree against the copied production CJS entry:

```js
const {Carburetor} = require('./dist/cjs-prod/Carburetor/index.js');
for (const n of [1, 32, 128]) {
  const rows = Array.from({length: n}, (_, i) => ({n: i}));
  const members = new Set(rows);
  const store = new Carburetor({rows, map: new Map(rows.map((row, i) => [i, row]))});
  const original = Reflect.getOwnPropertyDescriptor;
  let visits = 0;
  Reflect.getOwnPropertyDescriptor = function (obj, key) {
    if (members.has(obj)) visits++;
    return original(obj, key);
  };
  let total = 0;
  const paths = new Set();
  try {
    const view = store.read(path => paths.add(path));
    for (let i = 0; i < n; i++) total += view.map.get(i).n;
  } finally { Reflect.getOwnPropertyDescriptor = original; }
  console.log({n, total, paths: paths.size, visits});
}
```

**Observed** `{n:1,total:0,paths:2,visits:2}`, `{n:32,total:496,paths:33,visits:1056}`, `{n:128,total:8128,paths:129,visits:16512}`. These counts cover only descriptors on the original plain row objects; they exclude root/array reflection, sets allocated for each lookup and native member visitation. They are reflection work, **not bytes allocated or an isolated latency benchmark**. The ordinary rows and raw Map entries are identical graph members; this is the documented writable-alias scenario, not an unsupported native subclass or a synthetic dummy loop. A stable cached facade was separately exercised after `draft` retargeted `row` and `map` to a new row: the old facade's subsequent `.get('k').n` returned `2`, then `3` after a draft row write, and each read recorded `row`. Thus merely caching the original result or path forever would make a correctness regression.

**Expected / remedy.** A repeated keyed native read must preserve the current raw Map member, discover all actually writable ordinary aliases (including nested and root backlinks), and record the right paths after draft writes, `setData`/restore and facade reuse, without repeatedly traversing every unrelated branch in a stable graph. Reuse or incrementally maintain ownership/path discovery with invalidation against the relevant live graph and mutation epoch; test fresh and cached facade lifetimes and topology changes. Do not wrap raw entries, omit alias reads or fall back to wildcard for every Map: those would reintroduce the round-18 bug or discard path precision. Severity is P2 because a commonplace row-list selection scales quadratically in render-path reflection; the counts show the mechanism, not a claim that every 128-row render breaches a particular frame budget.

## R19-ENGINE-02 — Opaque plain history changes repeat full endpoint traversal to classify locked arrays (P3)

**Location and mechanism.** `lib/src/Carburetor/Tooling/CarburetorHistory.ts:43-117,243-249` already fully visits and owns the current graph for every opaque history endpoint; `sameHistoryGraph.ts:11-61` compares those complete endpoints. After comparing, `CarburetorHistory.ts:465-484` calls `containsLockedArray(before)` and `containsLockedArray(capture.state)` whenever both ends are non-exotic and no length-lock patch arrived. `:138-156` walks their entire ordinary graph with `Object.keys`, even when *neither contains an array*. This happens for every ordinary opaque publication (including public `setData` of a populated `ResourceCache`), increasing synchronous publication work with the complete old **and** new store size rather than just the changed entry. It is not needed to restore an unlocked cache.

**Actual bounded public API reproduction.** In the copied development CJS entry, create `new ResourceCache(async n => n)` and `new CarburetorHistory(cache)`, await `cache.load(i)` for `i=0..7`, then replace the first entry's `data` via `cache.setData({entries: {...cache.getData().entries, [cache.keyOf(0)]: {...cache.getData().entries[cache.keyOf(0)], data: 17}}})`. Instrumenting `Object.keys` only during this replacement, and attributing its stack to `containsLockedArray`, observed **two root visits, two entries-dictionary visits and 16 individual entry-body visits** for eight entries; `history.canUndo()` was `true`. A separate stack capture placed the root calls at `containsLockedArray` → `CarburetorHistory.buildEntry` twice, *in addition to* the two root `Object.keys` calls made by the needed `diffPaths`. These are actual `Object.keys` invocations in the published update, not inferred allocations or timing numbers. No array existed in the input or either endpoint.

**Expected / remedy.** Preserve full owned-graph replay for *actual* locked array descriptors, including a locked array installed via `setData` without a length-lock patch, but classify array-length writability during ownership/capture (and maintain that metadata when baseline changes) or another already-required pass instead of repeatedly walking two complete unlocked graphs per opaque update. Native-containing endpoints are excluded from this particular fallback by the exotic guard; plain opaque endpoints are not. Severity is P3: an avoidable extra O(state) pass per endpoint on an already O(state) opaque operation; no independent isolated end-user latency measurement is asserted.

## Examined surfaces and bounded controls

- Reviewed root read/write and restore/publication, tracked proxy get/set/define/delete, native Map/Set receiver/argument/facade caching and raw entry behavior, development alias validation, root backlink wildcard, structural array length conversion/truncation/partial failure, branch/key/write-log and subscriber indexes, transaction/update wave/scheduler/patch observer dispatch and reentrancy, Computed dependency maintenance, freshness/announcement/disposal, graph ownership/equality/diff/patch installation, history pending publication/clear/cursor rollback/branching/independent observers, resource-cache state and documented native/plain ownership. Inspected representative existing tests for native aliases, array locking/partial truncation, native history, computed publication and subscription indexes. No claim of exhaustive input-state proof.
- Bounded copied-CJS actual run with a non-configurable array index and two independently attached histories under a manually flushed real `ComponentUpdateThrottle`: `Object.defineProperty(draft.items,'length',{value:0,writable:false})` threw `TypeError` **after** effective truncation to `2` and flag lock; clearing one recorder and flushing before an unrelated `marker=7` then undoing gave `items.length=2`, `marker=0`, first recorder `canUndo=false`, other recorder `canUndo=true`. This delimits the cursor/partial-write repair without rerunning a suite.
- Bounded mixed copied CJS-store/history plus ESM-`Computed` actual run: writable plain row also referenced from a raw Map; `row.n=2` delivered one `watch` event and one computed wake; descriptor-lock/truncate then undo/redo yielded array `length=1→2→1`, `writable=false→true→false`, and `map.get('k')===row` after replay. The expected duplicate-package development diagnostics printed; they did not prevent the observed behavior.
- Bounded cached native facade run with the same root mutated through `draft`: method and proxy identity stayed cached, a retargeted Map entry gave latest values `2→3`, and both later method calls recorded the live `row` path. The separately documented `connect()` facade rebuilding on whole-root retarget was inspected at `ConnectionFacadeHandler.ts:92-106`; old tracked data held across renders is explicitly outside the public contract. No product code or tests were changed; no build, test suite, formatter, linter or benchmark was run by this reviewer.

**Report commit:** recorded in this report's committing response (the commit cannot refer to its own hash in tracked content without changing the hash).
