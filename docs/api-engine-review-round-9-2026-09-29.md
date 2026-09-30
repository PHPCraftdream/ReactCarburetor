# API and engine review, round 9 — 2026-09-29

Scope: the current JavaScript/TypeScript API, store engine, React bridge, resource cache, and opt-in tooling at `3dee3e8`. This is a source-only review. No test, build, benchmark, runtime probe, or profiler was run. The round 7 repairs summarized in round 8, and all four findings closed by round 8's Resolution, were excluded. The `abortAll()` candidate below was explicitly left open by that Resolution; it is separate from the completed `forgetAll()` repair.

All R9 mechanisms and proposed outcomes below are **code-derived**, not newly measured. A regression must establish each outcome before a fix is accepted. Performance improvements are proposals until a before/after benchmark measures them.

## Findings

### R9-01 — P1 — Public `ResourceCache.setData()` bypasses eviction bookkeeping

`ResourceCache` inherits the public `setData(data)` replacement API (`lib/src/Carburetor/Store/Carburetor.ts:173-196`; `lib/src/Carburetor/Resource/Cache/ResourceCache.ts:36-54`). Its lifecycle rebuilds the eviction ledger in `restore()` (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:59-70,79-109`), and increments the ledger only when `markLoading()` creates an entry (`:474-480`). `evict()` trusts that count for its early exit (`:303-311`; `lib/src/Carburetor/Resource/Cache/EvictionLedger.ts:95-106`). A direct `setData({entries: ...})` therefore replaces live entries without adjusting `count`, `lastUsed`, or the retained-scan watermark. For example, after a direct replacement containing two settled entries on a cache with `maxEntries: 1`, loading a third key raises the ledger count from zero to one, so eviction skips even though three entries exist. The existing benchmark seed manually calls `cache.eviction.setCount(count)` after `cache.setData(...)`, which also exposes this missing integration (`scripts/benchmarks/forgetAll.mjs:26-30`); that script was only read, not run. Existing invariant coverage checks load/forget/refresh/get/invalidate and `restore()`, but not direct `setData()` (`__tests__/Engine/Resource/ResourceCacheLifetime/CacheInvariants.test.ts:24-105`).

The capacity guarantee and LRU order can diverge for a documented public base API. Rebuild the ledger on every wholesale state replacement, or narrow the public cache API so replacement must pass through a lifecycle-aware method. Account for in-flight requests and synchronous abort-listener re-entry before changing the route: tests already use direct `setData()` from those paths (`__tests__/Engine/Resource/ResourceCache/ReentrantLoads.test.ts:342-357,416-456`). Verify entry count, order, and eviction after adding and removing entries via `setData()`.

### R9-02 — P2 — DevTools drops prototype-named stores and can apply absent time-travel state

`connectDevTools()` accepts caller-chosen object keys as store names, then creates `snapshots` and each outgoing `state` as ordinary `{}` dictionaries (`lib/src/Carburetor/Tooling/connectDevTools.ts:30-52`). An own key named `__proto__` (for example from `Object.fromEntries`) is enumerated in `names`, but assigning `snapshots[name]` and `state[name]` invokes inherited prototype setters instead of creating own keys. The outgoing state consequently lacks that store's own name. The reverse path tests `name in next` (`:77-85`), which accepts inherited `__proto__` or `constructor` even when the DevTools payload omitted them and passes an inherited object/function to `fromJSON()`. The current tests register only ordinary names (`__tests__/Engine/Tooling/Tooling.test.ts:393-543`).

Use null-prototype dictionaries or `Map` for snapshots and outgoing state, and require an own payload key before time travel. Test `__proto__`, `constructor`, and an absent named store through initial publication, update, and jump/rollback. This is a tooling correctness issue; no render or speed claim is made.

### R9-03 — P2 — An effect named `__proto__` loses its unmount cleanup

`useEffect(name, callback, deps)` accepts any string name (`lib/src/Carburetor/Component/AntiHookComponent/Effects.tsx:65-69`; `README.md:435`). The lazy effect table is `{}`, and the new record is assigned with `this.ensureEffects()[name] = record` (`Effects.tsx:87-115`). For `name === '__proto__'`, that assignment changes the table's prototype rather than adding an own effect record. `releaseEffects()` enumerates only own keys with `Object.keys(records)` (`:126-146`), so the effect's cleanup is absent from unmount. A timer or subscription created by that effect can remain active after its component leaves. Current effect tests cover ordinary names and teardown failures, but not a prototype-named effect (`__tests__/Engine/Component/AntiHookComponent/effects/effects-basics.test.tsx:275-337`; `__tests__/Engine/Component/AntiHookComponent/effects/teardowns.test.tsx`).

Use a null-prototype effect table and own-key reads. Add a mounted component regression with an effect named `__proto__`, a changed dependency, and unmount; assert setup and cleanup counts at each stage. Include `constructor` to pin the arbitrary-string name contract. This is distinct from round 7's fixed subscriber-id table.

### R9-04 — P2 — `abortAll()` still publishes once per cancelled entry

`abortAll()` snapshots every controller key and calls `abortKey()` for each (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:173-176`). A pending or refreshing entry then calls `update()` (`:353-386`), whose `finally` emits the write (`lib/src/Carburetor/Store/Carburetor.ts:468-485`). Thus cancelling *N* ordinary pending entries produces *N* versions and delivery passes. With default synchronous `persist`, each pass stringifies the whole cache (`lib/src/Carburetor/Tooling/persist.ts:35-53`); the entries remain present, making serialization work O(*N*²) for similarly sized entries. Round 8's Resolution specifically left this bulk operation open after repairing `forgetAll()` (`docs/api-engine-review-round-8-2026-09-29.md:46-51`).

Coalesce the cancellation-state writes into one publication while preserving synchronous abort listeners, requests started again from those listeners, and separate publications for subscriber re-entry after delivery. Add per-key and wildcard subscription, version, persistence, and same-key replacement regressions. The existing `abortAll()` test checks aborted signals and final statuses only (`__tests__/Engine/Resource/ResourceCache/ResourceCache.test.ts:240-254`).

### R9-05 — P3 — Cache option types admit values with contradictory semantics

`IResourceCacheOptions` exposes unconstrained `number` values for `ttl` and `maxEntries`, documenting `Infinity` as the intentional never-stale TTL (`lib/src/Carburetor/Models/Resource.ts:75-81`). The constructor accepts those numbers unchanged (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:51-55`). With `ttl: NaN`, the freshness comparison is always false, so a successful entry never ages out (`:271-277`). With `maxEntries: NaN`, both the early capacity comparison and the victim loop's stop condition compare against `NaN` and are false; a scan can select every unretained key (`lib/src/Carburetor/Resource/Cache/EvictionLedger.ts:95-106,119-140`). Negative, fractional, and infinite capacity values also have no stated policy.

Specify whether zero and `Infinity` are valid capacity settings, then validate the rest at construction. Keep the documented `ttl: Infinity` behavior. Cover `NaN`, negatives, fractions, zero, and infinities at the public constructor boundary. This is an API predictability finding, not an observed leak.

## Measurement boundary and priority plan

The only relevant **previously measured** bulk result is round 8's integrated single-machine sample: 4,000 pending entries passed to `abortAll()` produced 4,000 versions and 4,000 wildcard callbacks or default-persist writes, depending on configuration (`docs/api-engine-review-round-8-2026-09-29.md:51`). It is supporting context for R9-04, not a measurement made in this round. The O(*N*²) serialization statement follows from code structure; elapsed time, allocated bytes, and React render counts have not been measured here.

1. Regress R9-01 through the public `setData()` path before changing lifecycle bookkeeping. Cover added/removed keys, capacity after a later load, LRU order, pending settlement, and abort-listener replacement.
2. Regress R9-02 and R9-03 with prototype-named keys and cleanup/state assertions. Their fixes should be local to the tooling and effect dictionaries.
3. Measure R9-04 before and after coalescing at 100, 1,000, and 4,000 pending entries. Record versions, callbacks, storage writes, elapsed time, and allocated bytes with no subscriber, a wildcard subscriber, synchronous persistence, and coalesced persistence; include abort-listener re-entry. Keep `forgetAll()` as a control, not as a new finding.
4. Fix and test R9-05's constructor contract. Benchmark no new option-validation path unless profiling identifies construction as material.

No P0 was established. R9-01 through R9-05 remain open P1–P3 candidates at this source state. This review has no newly measured performance result and makes no speedup claim.

## Resolution (2026-09-29)

- **R9-01 and R9-05 — `687c7aa`:** A wholesale cache state replacement now rebuilds eviction bookkeeping before subscribers observe the new state. Constructor validation rejects invalid TTL and capacity values while preserving the documented infinite TTL. Regressions cover replacement, capacity/LRU, in-flight requests and the option boundary.
- **R9-02 and R9-03 — `3549fee`:** DevTools state/snapshot dictionaries and named-effect records now handle prototype-shaped names as own keys. Time travel requires an own payload key. Regressions cover `__proto__`, `constructor`, omitted stores and effect cleanup. A nine-round publication microbenchmark measured a median of 0.00129 ms/write in the integrated build, versus 0.00096 ms/write in the pre-fix agent sample; these single-machine results do not support a speedup claim.
- **R9-04 — `687c7aa`:** `abortAll()` now batches ordinary cancellation-state writes into one publication, with tests for listeners and same-key replacement. At 4,000 pending entries, the integrated benchmark measured one version, one wildcard callback or one synchronous persistence write (depending on configuration), versus 4,000 of each in the pre-fix benchmark. The default-persistence wall time was 62.35 ms in the integrated run versus 8,558.79 ms in the pre-fix agent run. At 100 and 1,000 entries, the integrated default-persistence samples were 1.34 and 14.40 ms. These are single-machine samples with separate runs, not a guaranteed speedup or evidence of lower allocation. The benchmark's `heapDeltaBytes` is retained heap change, not allocated bytes.

The integrated build, full test suite, typecheck, lint and layout check passed. `forgetAll()` remained at one publication in the integrated benchmark. All R9 findings are closed; the next review must assess the updated code rather than repeat these resolved mechanisms.
