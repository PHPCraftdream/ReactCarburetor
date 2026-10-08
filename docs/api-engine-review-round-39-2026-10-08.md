# API and engine review — round 39 — 2026-10-08

## Verdict

Base: `3d0bbcb` (the code of `c5a3bc3`, round 38 integrated; the checkpoint commit on top changes
only docs). Seven findings: two P1, three P2, two P3. Two of them are regressions of round 38
(R39-01, R39-04). The other five are older and were never reported. The comparison build is the cached
`worktrees/bench-dist/ba80fcb70719` (the code of round 36, before the round 37 and 38 fixes).
Rounds 36–38 reviewed selections almost exclusively. This round also covers the write log, history,
native leaves, the diff walk, resources and the public protocol surface.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R39-01 | P1 | Selections / O (regression of R38) | A hook, `watch` or `connectSelection` that selects a live list loses the write-log patch after two unrelated publications in the same store. The next related one-field write walks the whole selection again: 3 → 80 009 recorded reads and 0.2 → 117–457 ms at 10k rows. The R36 build keeps 3 reads for any interleaving |
| R39-02 | P1 | History / O / memory | One `Map`, `Set` or `Date` anywhere in the state turns every history step into a whole-state snapshot. At 10k rows with one `Date` field: 32 ms instead of 0.03 ms per one-leaf write, undo 54 ms instead of 0.03 ms, and 627 KB instead of 4 KB retained per entry (31 MB at the default limit of 50) |
| R39-03 | P2 | Native leaves / O / allocations | After any container add, replace or delete anywhere in the store, reading a class instance that holds a plain object (dayjs-, luxon- or moment-style) rebuilds an ownership index of the whole store. One read costs 0.8 / 8 / 43 ms at 1k / 10k / 50k rows, against 0.002–0.02 ms warm. Each `Date` read after such a write allocates two Sets |
| R39-04 | P2 | Write path / allocations (regression of R38) | Every published write now allocates raw-target bookkeeping (one Map per publication, one Set per written path), with or without a consumer that can use it. Per 1000 one-path updates: Maps 3 → 1002, Sets 1998 → 2997; 9–47 % more time per update than the R36 build |
| R39-05 | P2 | Diff / renders / O | `draft.rows = draft.rows.filter(...)`, the reassignment the README recommends, aligns shifted rows by index only. It diffs every field of every shifted row, then collapses to `rows` and wakes readers of the untouched prefix too. Removing the middle row of 10k: 32–37 ms and 200 of 200 sampled readers woken; `splice`: 6–9 ms and 64 |
| R39-06 | P3 | API simplification | The public custom history producer contract (`IPatchSource`) is built from types and symbols the package does not export. `CarburetorHistory`'s parameter type names the internal symbol protocol. The repository's own custom-producer test imports them from the source tree, which a consumer cannot do |
| R39-07 | P3 | Resources / renders | `useResource` subscribes to the whole cache entry and hands out a plain copy. A reader that shows only `data.name` re-renders 3 times when an `invalidateAll()` refresh returns equal data, and 3 times on mount |

Fix R39-01 and R39-04 together: both live in the write log's raw-target proof, which round 38 added.
One redesign brings back the round-36 patch path under realistic interleavings and removes the
per-write bookkeeping. R39-02 is the largest per-edit cost an application with history meets as
soon as its state holds one date.

## Method and evidence boundaries

- Read at `3d0bbcb`:
  - the store: subscribe and notify, drift protocol, write log, target ledger, install and emit boundaries;
  - both proxies, native facades and native alias reads;
  - the diff walk;
  - the subscriber index;
  - selection patching across the hook, `watch` and class routes;
  - computed recompute, freshness and settlement;
  - transactions, waves and the throttle;
  - history and its replay;
  - the resource cache's read, load and settle paths;
  - persist, the scope, and the class component (attempts, commits, effects, props gate);
  - both hooks, the public exports and their built `.d.mts`, and the README.
- Every finding was reproduced through the built package's public API.
  - Stores subclass `Carburetor` for the protected `update`.
  - Components were rendered with React/ReactDOM 19.3.0 `createRoot` + `flushSync` in JSDOM 30.0.1.
  - Node v24.12.0, `NODE_ENV=production`, `dist/esm-prod`.
  - That build was produced after `c5a3bc3`, and `lib/src` has not changed since (`git log`/`git status`).
  - It contains the round-38 write-log code.
- Counters are exact and agreed across runs: recorded read paths, constructor counts of `Set`/`Map`, `Reflect.ownKeys` and
  `getOwnPropertyDescriptor` calls, history entry kinds, renders, subscriber wakes and rendered text.
  - Constructor counts are counts, not bytes.
  - Retained heap was measured with `--expose-gc` and two forced collections around the measured region.
- Timings are medians of 7–41 repetitions inside one process. One to three processes ran per
  configuration; where they differed, the range is given.
  - The machine is shared, and absolute timings drifted by up to 3× between runs: R39-01's class route measured 146–160 ms in one process and 354–457 ms in another.
  - The gates the fixes should add belong on the counters, not on these times.
- Not run: the project test suite, the full benchmark suite, the packed consumer matrix and CI.
  Earlier green runs are not presented as checks of this review.
- No product source, test, dependency or version was changed. No sub-agents were used.
  - Throwaway probes are in the git-ignored `worktrees/r39-probes/` and are kept there for the implementation round.
  - The commit contains only this report.
- Recorded limits of rounds 30–38 are not re-reported. These include:
  - structural array changes in selection patching;
  - the outer-spine copy of a flat immutable array snapshot;
  - the conservative equality of object-keyed native collections;
  - the cyclic key working set;
  - coarse native leaves, and their alias answers being refreshed only by a topological write;
  - class instances rejected from history endpoints.

## R39-01 — P1 — two unrelated publications switch selection patching off

### Repro and behavior

```js
class S extends Carburetor { run(fn) { this.update(fn); } }
const s = new S({tick: 0, items: rows10k});
s.watch(d => d.items, onChange);           // or useCarburetorValue(s, d => d.items),
                                           // or this.connectSelection(s, d => d.items)
s.run(d => { d.tick++; });                 // K unrelated publications: nothing woken
s.run(d => { d.tick++; });
s.run(d => { d.items[j].title = 'x'; });   // one related one-field write
```

Recorded read paths during the related write, median of 7 related writes per K, 10k rows:

| Route | K = 0 | K = 1 | K = 2 | K = 3 | K = 8 | R36 build, every K |
|---|---:|---:|---:|---:|---:|---:|
| `watch` | 3 | 3 | 80 009 | 80 009 | 80 009 | 3 |
| `useCarburetorValue` | 3 | 3 | 80 009 | 80 009 | 80 009 | 3 |
| `connectSelection` | 4 | 4 | 80 010 | 80 010 | 80 010 | 4 |

The same writes in milliseconds:

| Route | K ≤ 1 | K ≥ 2 | R36 build, every K |
|---|---:|---:|---:|
| `watch` | 0.12–0.21 | 176–216 | 0.07–0.25 |
| `useCarburetorValue` (with render) | 0.21–0.41 | 117–144 | 0.14–0.35 |
| `connectSelection` (with render) | 0.20–0.60 | 146–457 | 0.23–0.54 |

At 1k rows the shape is the same: 3 → 8 009 reads, 10–25 ms for K ≥ 2.

Rendered output and callback counts are correct in every case. The cost is the lost patch path:
round 36 brought this write from 67 ms down to 0.75 ms, and it is now back to a full walk. A list
store whose other fields (a filter, a status, a counter, a selection) change between two edits of
the list is the ordinary case, not an edge case.

### Mechanism

- A consumer's baseline is the version of its last wake. That is the hook's `entry.version`, the
  `version` in `watch`'s closure, and the class connection's `committed.baselineVersion`. A write
  outside the selection advances the store version but wakes nobody here, so the baseline lags.
- `patchFromWriteLog` (`Store/Utils/Selection/Patch/patchFromWriteLog.ts:51-82`) treats every
  outside-root path since the baseline as a possible alias. It demands that path's raw mutation
  targets from `CARBURETOR_TARGETS_SINCE`.
- `WriteLog.targetsSince` (`Store/Paths/WriteLog.ts:194-213`) keeps the targets of the latest two
  publications only. At K = 2 the third publication since the baseline is uncovered, the method
  returns `undefined`, and the consumer takes the full reconcile.
- The proof itself would have passed. The unrelated write's only target is the store root, which no
  selection ledger ever holds. Only the retention window fails.
- Secondary, same structure: `WriteLog.pathsSince` (`:176-183`) scans every entry of `last`, which
  holds every distinct path written since the last log reset, to return the few written after the
  baseline. After 0 / 4000 distinct earlier writes it scanned 21 / 4021 entries per call to return
  one path. The time stayed within noise (0.05–0.09 ms per write at 4k rows), so this is noted, not a
  finding of its own.

`CARBURETOR_TARGETS_SINCE`, the two-publication ring and `WriteTargetLedger` all came in `c5a3bc3`
(round 38).

### Direction

Bound the raw-target proof by count, not by the number of publications. It should cover every
baseline the ordinary path log still covers.

- Keep per-path accumulated target sets since the last raw reset. A union across publications is a
  superset of the targets since any baseline, which keeps the ledger check conservative.
- A newer publication that writes a path without attribution marks that path unknown. This keeps
  round 38's rule that a missing current target is never filled from an older one.
- Cardinality overflow resets the proof and raises `targetsWatermark`. A lagging consumer then falls
  back once, as at a log reset today.
- Keep a per-version record of written paths, so `pathsSince` costs O(paths since the baseline).
- Do not drop the proof itself: it is what keeps round 38's cyclic and native-alias snapshots correct.

### Acceptance

- After K = 2, 8 and 64 unrelated publications, one related leaf write on a 10k-row selection records
  ≤ 4 paths on all three routes. Renders and DOM are identical to the full walk.
- Overflow past the cap and an incomplete or unattributed publication each fall back conservatively,
  once.
- Round 38's suites stay green: cyclic equality, missing current-publication targets, raw member
  exposure, native aliases and sparse budgets.
- Retained targets are bounded by count, and targets dropped by a reset become collectable.
- The gate counts recorded reads across a K sweep and is validated to fail on `c5a3bc3`.

## R39-02 — P1 — any native value in the state turns history into whole-state snapshots

### Repro and behavior

```js
const s = new S({items: rows10k, lastSync: new Date()});   // drop lastSync for the plain control
const history = new CarburetorHistory(s, {limit: 50});
s.run(d => { d.items[i].title = 'x' + i; });               // a primitive leaf; the Date is not touched
```

| 10k rows | ms per one-leaf write | ms per undo | Entry kind | Retained per entry |
|---|---:|---:|---|---:|
| plain | 0.032 (R36 build 0.017) | 0.034 (0.057) | `patches` | 4 KB |
| plus one `Date` field | 32.0 (R36 build 45.3) | 53.9 (74.0) | `snapshot` | 627 KB |

That is 1000× per write and 1600× per undo. Fifty entries retain 31 MB instead of 0.2 MB. Undo
restores the correct values in both cases. A `createdAt`, `updatedAt` or `lastSync` date is enough,
or one `Map` of options anywhere in the state.

### Mechanism

- `CarburetorHistory.onPatch` (`Tooling/CarburetorHistory.ts:269-271`):
  `if (this.baselineContainsExotic) { this.pendingOpaque = true; return; }`. A primitive patch on a
  plain path becomes opaque because some native value exists somewhere in the baseline, not because
  the write touched it.
- `buildEntry` then takes `buildSnapshotEntry` (`:514-537`). That makes `capture()`, an owned deep
  clone of the whole state (`cloneOwnedGraph`), plus `sameHistoryGraph` over both whole endpoints. The
  entry keeps the whole owned graph.
- Undo cannot use the draft replay: `applyPatchesEntryOnDraft` refuses exotic baselines
  (`Tooling/Graph/replayPatchesOnDraft.ts:44`). It reconstructs and restores at O(state).
- The scalar cancellation proof also excludes exotic baselines (`CarburetorHistory.ts:361`).
- Long-standing: the R36 build behaves the same. The README states the rule ("Native-containing state
  ... use owned graphs") without its cost.

### Direction

Classify per patch, not per baseline.

- A primitive-to-primitive patch whose segments walk only plain own-data containers of the owned
  baseline (an O(depth) check at record time) cannot touch native identity, native descriptors or
  `Map` key aliases. Keep it as a patch, install it on the owned baseline, and let the draft replay
  accept entries made only of such patches.
- An object shared between a plain path and a native member stays one object in the owned graph, so
  installing the scalar keeps both views consistent, as the live store does.
- Natives touched by the write keep the owned-graph route: a container patch with native content, an
  opaque draft read of a native, a `Map` or `Set` facade mutation. They already report
  `PATCH_OPAQUE` or classify as exotic.

### Acceptance

- At 10k rows plus one `Date`: a one-leaf write records a `patches` entry and costs ≤ 2× the plain
  store's write. Undo and redo cost O(patches). Retained memory per entry is O(changed values).
- The native history suites stay green: `Map` key aliases, backlinks, native descriptors, branching
  and `clear`.
- A write that replaces, mutates or reads a native through `draft` still produces an owned-graph
  entry.
- The gate counts entry kinds and owned-graph clones per write; it fails on the current build.

## R39-03 — P2 — one native leaf read after a topology write walks the whole store

### Repro and behavior

```js
class Day { constructor(ms) { this.$d = new Date(ms); this.$x = {}; } }  // the shape dayjs uses
const s = new S({current: {at: new Day(t)}, items: rowsN});
const view = s.read(record);
+view.current.at;                     // warm
s.run(d => { d.meta = {rep}; });      // any container added, replaced or removed, anywhere
+view.current.at;                     // measured
```

One read of `current.at` after that write. The warm read is in parentheses:

| Rows | `Date` leaf | dayjs-like leaf | `getOwnPropertyDescriptor` calls for that one read |
|---:|---:|---:|---:|
| 1 000 | 0.009–0.013 ms | 0.83–0.85 ms (0.006) | 3 007 |
| 10 000 | 0.002–0.003 ms | 7.6–8.3 ms (0.02) | 30 007 |
| 50 000 | 0.003–0.004 ms | 42.6–43.7 ms (0.02) | — |

The R36 build shows the same shape (dayjs-like: 1.1 / 16.3 / 88.6 ms), so this is long-standing.
The cost scales with the store, not with the value read.

Reading every `items[i].at` of 10k rows through one persistent view:

| Leaf | Warm | After a leaf write | After a topology write | Calls after the topology write |
|---|---:|---:|---:|---|
| number | 17–21 ms | 19–21 ms | 17–21 ms | none |
| `Date` | 20–24 ms | 21–23 ms | 27–29 ms | 10 000 `ownKeys`, 20 000 `Set`s |
| dayjs-like | 24–26 ms | — | 47–51 ms | 60 003 descriptor lookups |

Topology writes are common. Every `push`, every new or replaced row object, every resource answer
whose `data` is an object, and every `Map.set` through `draft` counts as one.

### Mechanism

- The read proxy's `get` calls `recordNativeAliasReads` for every non-plain object leaf
  (`Store/Tracking/createReadProxy.ts:350`).
- The answer is cached per value but keyed by the root's generation
  (`Aliases/NativeAliasReads.ts:30-35`).
- `nativeAliasIndex.invalidate` bumps the generation. It is called for:
  - every container change through `draft` (`createWriteProxy.ts:293, 368, 485, 550`);
  - positional array methods (`positionalArrayMethods.ts:115`);
  - every `Map`/`Set` facade mutation (`liveViews.ts:122, 142, 175`);
  - every root install and every emit that bypassed `draft` (`installState.ts:65-66`, `emitStoreUpdate.ts:31`).
- On a stale generation the value is walked again. That allocates two Sets, a closure, an answer
  record and a paths array (`NativeAliasReads.ts:40-72`).
- If the walk finds any plain object or array inside the value, `nativeAliasIndex.paths(root)`
  rebuilds the ownership index of the entire plain store (`Aliases/NativeAliasIndex.ts:11-30`): every
  container gets a `joinPath` string and a Map entry. Examples are dayjs `$x`, luxon `c`, moment
  `_pf`, or any class with a plain options field. The index exists only to learn that the private
  object has no store path at all.
- A `Map` facade's `get`, `forEach`, `values` and iterator take the same route for plain members and
  for the collection itself (`liveViews.ts:93-131`).

### Direction

- Make the answer for a value that holds no object allocation-free, and reuse its record across
  generations. Dates and flat instances are such values.
- Answer "is this private object a store container?" without rebuilding a whole-store index. Either
  maintain ownership incrementally from the write proxy's topology events (each knows the path, the
  previous container and the next), or keep a membership pre-check so that objects never seen as plain
  store containers short-circuit to "no paths".
- Invalidate separately. A `Map`/`Set` mutation can change which members a native exposes, but not
  plain ownership paths. Plain topology writes need the index refreshed, but should not re-walk every
  cached `Date`.

### Acceptance

- One dayjs-like read after a topology write costs O(own data of the value): at 10k and 50k rows
  within 2× of the warm read.
- `Date` reads after a topology write construct no Set.
- The native alias suites stay green: `Map` members aliased by plain paths, keys, root backlinks
  subscribing to the whole store, and native-read precision.
- The README caveat "refreshed only by a topological write" still holds.
- The gate counts descriptor lookups and Set constructors per read across store sizes.

## R39-04 — P2 — every write pays for a proof no consumer may ask for

### Behavior

Each update is `s.run(d => { d.rows[0].a = i; })` or `d.n = i`. Store sizes are tiny, so this is the
fixed per-write cost.

| Build | Maps per 1000 updates | Sets per 1000 updates | ns per scalar update, no subscribers | ns per nested update, one precise subscriber |
|---|---:|---:|---:|---:|
| current | 1 002 | 2 997 | 1 074–1 314 | 3 176–3 212 |
| R36 build | 3 | 1 998 | 891–949 | 2 744–2 917 |

Each timing is 7 rounds of 200 000 updates per process, two processes per build. The counters are
exact. The timing difference also includes the other round 37–38 changes; the counters are entirely
the target ledger.

### Mechanism

- `Carburetor.writeRecorder` (`Store/Carburetor.ts:108-109`) calls `WriteTargetLedger.add`
  (`Store/Utils/Graph/WriteTargetLedger.ts:26-37`), which allocates `new Set([target])` for every
  written path. A replacement diff records the same target for each changed leaf.
- `emitStoreUpdate` (`Transaction/emitStoreUpdate.ts:40-45, 64`) hands the Map to the write log.
  `reset()` allocates a fresh Map for every publication (`WriteTargetLedger.ts:50-54`).
- The only reader is `patchFromWriteLog`, and only for writes outside a patchable selection's root. A
  store without such a consumer — the class `useCarburetor`/`connect` app, a computed-only app,
  persistence — pays the cost on every write and never reads it.

### Direction

Record targets only while a consumer can use them, for example with a store-level count of live
patchable snapshots. At zero, hand the log no targets, exactly as for an incomplete publication.
Alternatively record `(path, target)` pairs into a flat array reused across publications, and build
per-path sets lazily inside `targetsSince`. Do this in the same change as R39-01, so the accumulated
proof adds no retention for stores that never ask.

### Acceptance

- A store with no patchable selection constructs no target Map or Set per write. Per one-path update
  it is back to the R36 build's counts: 2 Sets, 0 Maps.
- With such a consumer, R39-01's acceptance holds.
- The gate counts constructors per update with and without a consumer.

## R39-05 — P2 — `filter` reassignment diffs shifted rows field by field, then wakes everyone

### Repro and behavior

There are 10k rows `{id, title, done}`, and 200 precise subscribers read `items.(i·37 mod N).title`.
One row is removed:

| Write | Time | Paths recorded | Subscribers woken (of 200) |
|---|---:|---:|---:|
| `d.items.splice(0, 1)` | 15.4–16.2 ms | 10 002 | 200 (every index shifts) |
| `d.items.splice(mid, 1)` | 5.6–9.4 ms | 5 002 | 64 |
| `d.items = d.items.filter(r => r.id !== id)`, first row | 53–86 ms | 1 (`items`) | 200 |
| the same, middle row | 32–37 ms | 1 (`items`) | 200, including 136 that read the untouched first half |

The R36 build gives the same split, so this is long-standing. The README's "Selection results and
ownership" section (`README.md:154`) recommends exactly this form: "Containers built from draft
branches are fine to assign back: `draft.rows = draft.rows.filter(...)`". Prepending with
`draft.rows = [row, ...draft.rows]` shifts every row the same way.

### Mechanism

- The set trap sees an array replacing an array and walks `diffPaths`
  (`Tracking/createWriteProxy.ts:389-394`).
- `walkArray` aligns by index only (`Paths/Diff/diffPaths.ts:292-327`). Every shifted index holds a
  different raw row, so `walkChild` descends into both rows and records each differing field: O(shifted
  rows × fields).
- Past the 2000-path floor, round 36's relative threshold collapses the whole diff to `items`
  (`diffPaths.ts:544-571`). That wakes every reader below it, including the prefix that did not change.
- `splice` takes the positional route and records one path per changed index without any field walk.

### Direction

Make the array walk identity-aware.

- When the new element at an index is a raw object the old array holds at another index (a moved or
  shifted row), record the index path and an index-level patch instead of diffing two different rows.
  This is what the positional methods already record.
- Build the old-element identity set lazily on the first object mismatch: O(N) once.
- Count index paths as units in the threshold, so an unchanged prefix stays quiet.
- Rows that really are new objects (`map(r => r.id === id ? {...r, done} : r)`) keep today's
  leaf-precise diff.

### Acceptance

- In the fixture, removing the middle row by `filter` wakes only readers at or after the removed
  index (64 of 200) and costs within 1.5× of `splice`. Removing the first row costs within 1.5× of
  `splice`.
- Replacing one row by `map` stays leaf-precise.
- History records index-level patches, and undo/redo restore the array.
- Round 36's threshold tests are unchanged for genuinely different rows.
- The gate counts paths and woken subscribers.

## R39-06 — P3 — the custom history producer contract is public in name only

### Evidence

- `IPatchSource` (`Models/Store.ts:125-141`) is exported from the package entry. The README requires
  custom producers to implement it (`README.md:1037-1047`):
  `attachPatchListener({patch, publication?, restoreClaim?})` and `captureHistory(own)`.
- Its member types live in `Models/Paths`, which the entry does not export (`Carburetor/index.ts:5-18`;
  the built `index.d.mts` has no `Models/Paths` line). They are `IPatchObserver`, `TPatchRecorder`,
  `IWritePatch`, `IStatePublication` and `IStateRestoreClaim`, plus the values a producer must send:
  `PATCH_OPAQUE`, `PATCH_ARRAY_LENGTH_LOCK` and `PATCH_KEY_ORDER_CHANGE`. The runtime export list
  contains none of them.
- `CarburetorHistory`'s constructor parameter is
  `Pick<ICarburetor<T>, ...> & IPatchSource & IInternalSubscriptionProtocol`
  (`Tooling/CarburetorHistory.ts:118-121`). The built `.d.mts` imports
  `../Store/Utils/Models`, the internal symbol protocol.
- The repository's own custom-producer test (`__tests__/Engine/Tooling/history/HistoryPublication.test.ts:2`)
  imports `IPatchObserver` and `PATCH_OPAQUE` from `@/Carburetor/Models/Paths`, a source path no
  package consumer has.
- The protocol changed shape in rounds 30, 31, 33, 34, 36, 37 and 38: publication facts, restore
  claims, owners, representations, deferred publication.

### Direction (simplification)

Make history producers internal.

- `CarburetorHistory` accepts the `Carburetor` family. `Carburetor`, `ResourceCarburetor` and
  `ResourceCache` are the only producers.
- The patch, publication and claim protocol moves behind shared symbols, like the other internal
  protocol members. `IPatchSource` leaves the public types.
- The README paragraph becomes "history works with any `Carburetor` subclass; override `captureHistory`
  for a different wire form".
- The alternative, exporting every protocol type and symbol, would freeze a protocol that changed in
  each recent round.
- Before the first release is the cheapest moment. This is a breaking type change; no version is
  bumped by this review.

### Acceptance

- No exported declaration of the entry refers to an unexported type. A d.ts check walks the built
  declarations.
- The history suites for `Carburetor`, `ResourceCarburetor` and `ResourceCache` pass unchanged.
- The README no longer documents an untyped producer contract, or documents a fully exported one.

## R39-07 — P3 — `useResource` re-renders readers for bookkeeping they never show

### Repro and behavior

There are 50 class readers, each rendering only `view.data?.name` through
`this.useResource(cache, id)`. The loader returns `{id, name}`.

| Transition | Renders per reader | Visible change |
|---|---:|---|
| Mount: miss → Pending → Success | 3 | yes, once |
| `cache.invalidateAll()` → background refresh with equal data | 3 | none (`textContent` unchanged) |

### Mechanism

- `useResource` adds the entry path itself (`Component/AntiHookComponent/Reads.tsx:328-330`) and
  returns a plain copy of the entry (`Resource/Cache/ResourceCache.ts:319`).
- Every bookkeeping write under the entry therefore wakes every reader:
  - `invalidated` and `failed` (`State/Mutation/applyCacheInvalidation.ts`);
  - `refreshing = true` (`ResourceCacheLifecycle.ts:182`);
  - `status`, `updatedAt`, `refreshing`, `invalidated` and `failed` on settle (`:220-228`).
- The `data` diff records nothing when the data is equal.

### Direction

Track the view's fields.

- Return a tracked entry view, or record field paths as the view's fields are read, so a reader
  subscribes to what it renders. `stale` stays computed.
- `useResource`'s own refetch decision subscribes only to what can re-arm a fetch (`invalidated`,
  `failed`, staleness). This preserves "the ones on screen refetch themselves on the next render".
  The request deduplication in `fetch` already makes `refreshing` unnecessary for correctness.
- Readers that do render `refreshing` or `status` keep their indicator renders.

### Acceptance

- In the fixture, data-only readers render once for an equal refresh: the render that schedules the
  refetch. They render at most twice on mount.
- Readers of `refreshing` render as today.
- No mounted reader misses its refetch after `invalidate`/`invalidateAll`.
- Deferred loads still start after commit, and `suspend` is unaffected.

## Recommended order

1. R39-01 + R39-04: one write-log change. It restores the round-36 patch path for interleaved writes
   and removes the per-write proof bookkeeping, keeping round 38's safety.
2. R39-02: scalar history patches over native-containing state.
3. R39-03: native leaf alias answers without whole-store indexing.
4. R39-05: identity-aware array diff.
5. R39-07: field-level resource views.
6. R39-06: internalize the producer protocol before the first release.

No new public knob is needed for any proven cost. The only API change proposed removes surface.

## Not reported as findings

- `persist` serializes the whole wire form once per coalesced microtask: 2.28 ms per separate write
  of a 10k-row store (408 KB of JSON, in-memory storage). That is the documented contract; a debounce
  would be new API.
- `WriteLog.pathsSince` scans the whole `last` map. It is noted under R39-01 because its measured
  time stays within noise.
- `useCarburetorValue` with an inline selector builds `Array.from(reads)` for the read-coverage check
  on each new selector identity. This is a constant factor, not measured as material.
- When a `connectSelection` result does change, the notification-time selector run and reconcile are
  repeated by the render they trigger. This is the trade-off of R36-02's gate, not measured as a
  finding here.
- Recorded limits of rounds 30–38, listed under Method, are not re-reported.

Probes (git-ignored, kept for the fixes): `worktrees/r39-probes/lag.mjs`, `lag-class.mjs`,
`history-scan.mjs`, `history-exotic.mjs`, `history-exotic-heap.mjs`, `instance-single.mjs`,
`instance-single-count.mjs`, `instance-reads.mjs`, `date-reads.mjs`, `write-throughput.mjs`,
`array-remove.mjs`, `resource-renders.mjs`, `persist-cost.mjs`. Each prints one `@@ {json}` line. Run
them with `NODE_ENV=production node <probe>`, and set `DIST_ROOT=<build>/esm-prod` to measure another
build.

## Resolution

Findings R39-01..05 and R39-07 are implemented in the working tree (not committed); R39-06 is resolved by
documentation only. Each implemented finding has a gate in `perf/` (`writelog39`, `history39`, `alias39`,
`diff39`, `resource39`) that fails on the build before R39 (`e8c3b34`: 8 of 9, 6 of 6, 5 of 5, 4 of 6 and
1 of 2 entries fail; the remaining entries are correctness controls) and passes on the current one, plus
tests that fail without the change. Numbers are medians of three processes of the probes above, the current
build against `e8c3b34`; timings come from a shared machine, counters are exact.

| Finding | Done | Before → after |
|---|---|---|
| R39-01 | The raw-target proof accumulates per write (1 024 unique pairs per publication, 2 048 accumulated) instead of a two-publication window; `pathsSince` no longer scans the history. An overflow, an unattributed write or a wildcard costs one full walk, then patching resumes. | One related write after two or more unrelated publications, 10k rows: paths read 80 009 → 3 (`watch`, hook), class 80 010 → 4; about 200 ms → 0.06 (`watch`) / 0.18 (hook) / 0.19 (class) ms. At 1k rows: 8 009 → 3, 12.5 → 0.07 ms. |
| R39-04 | Proofs are recorded only once a `watch`, `useCarburetorValue` or `connectSelection` with an object selection asks for them (`CARBURETOR_TRACK_TARGETS`); the ledger reuses one pairs buffer. | Per 1 000 updates without a consumer: Maps 1 002 → 3, Sets 2 997 → 1 998. Scalar write 1 496 → 1 219 ns; nested write with one precise subscriber 3 510 → 3 459 ns (unchanged). |
| R39-02 | A scalar write on a plain path stays a patches entry when the state holds a `Date`/`Map`/`Set`; the replay attempt is owner-scoped and the baseline advances before subscribers run. | 10k rows with one `Date`: write 26.6 → 0.019 ms, undo 58 → 0.023 ms, retained 627 → 2 KB per entry. A plain state is unchanged (0.020 → 0.024 ms, within noise). |
| R39-03 | `noteChange` repairs the ownership index incrementally for the changed subtree; a scalar-leaf read answers from the descriptor chain. Ambiguous cases invalidate the index whole. Also fixed: an array `length` truncation did not invalidate the index. | Descriptor lookups for one dayjs-like leaf read after a topology write: 3 007 / 30 007 → 3 at 1k / 10k rows. Time: 0.93 / 11.0 / 61.7 ms → 0.009 / 0.006 / 0.008 ms at 1k / 10k / 50k rows. |
| R39-05 | `walkIdentityArray` aligns rows by raw identity; a row that is the same object at another index records the index path, as `splice` does. Genuinely new rows stay leaf-precise; round 36's thresholds are unchanged. | `filter` removing the middle row of 10k: paths 1 → 5 002, subscribers woken 200 → 64 of 200. Removing the first row: paths 1 → 10 002, wakes 200 → 200 (every row shifts). Time is not the claim: 42.6 → 38.9 ms (middle), 70 → 45 ms (first). |
| R39-06 | Documentation only: README and TSDoc say `attachPatchListener`, `IPatchSource` and `IPatchObserver` are the engine's internal protocol, history supports the `Carburetor` family, and a store with another wire form overrides `captureHistory(own)`. | No code or type change. The report's d.ts criterion could not be met as written (protected members of exported classes already name unexported types), so the symbol-keyed protocol was not built. |
| R39-07 | `useResource` subscribes to the entry fields the reader reads (`fieldView`, `present`); a custom source without a field view keeps the whole-entry subscription. | A reader showing only `data.name`: renders 3 → 2 on mount and 3 → 2 on an equal refresh after `invalidateAll()`; 50 of 50 mounted readers still refetch. |

Found after the first integration and fixed (independent read-only review of the integrated tree):

- A data-only `useResource` reader whose pending entry was removed inside the throttle window (`forget`,
  `restore`) was never reloaded. `ResourceCacheState` now counts removals (`removalEpoch`) and only the
  first default-only creation is suppressed; tests `FieldReaderRemoval` pin it.
- A custom source's `load` rejection became invisible once the call was chained; sources without a field
  view keep the fire-and-forget call.
- The accumulated proof held up to 4 096 raw targets strongly; the cap is now 2 048. A weak-reference design
  was rejected because the build targets ES2020.

Deviations and limits:

- R39-04 follow-up: the internal tracking protocol returns an idempotent release. The first owner enables
  proofs; the last disables the ledger and clears pending targets, accumulated targets and recent paths. Watches
  release through their disposer; hooks and class selections acquire at commit and release on teardown or source
  change, including StrictMode replay. Patch reads no longer acquire owners. Reacquisition starts at the current
  version, so an older baseline conservatively falls back. While a consumer lives, at most 2 048 accumulated
  pairs are held until the next full walk. `trackrelease39` measures all three routes: after disposal, baseline
  1 000 Maps / 3 000 Sets become 0 Maps / 2 000 Sets per 1 000 writes; live related writes keep the 3/3/4-path
  fast route.
- Write cost (follow-up). The first integration measured a list-watch write about 11–13 % above round 38. Three
  changes removed it: the pending ledger is cleared by popping instead of assigning `length` (that assignment cost
  8 % of an untracked scalar write), a repeat of the previous single (path, target) pair skips the accumulated
  merge and the recent-path relink, and `targetsSince` returns the live accumulated map instead of copying it
  per query. Tracking-on allocation fell from 904 to 696 B per write (untracked 627 B). In-process interleaved
  A/B on a loaded machine (41 rounds, medians; round 36 / round 38 / now, ns): scalar 3530 / 4227 / 3522, nested
  write with a precise subscriber 7685 / 9165 / 7091, list-watch 15982 / 16631 / 16007 — at round-36 level and
  below round 38 in all three; p10 values agree within about 10 %. Timing on a shared machine is noisy, so the
  guarded quantity is bytes (`writelog39/write-bytes`: untracked ≤ 900 B per write, tracking adds ≤ 60 B).
- The `diff39` timing gates were removed as unstable on a shared CPU (filter/splice ratio 1.84–2.84 against
  a limit of 2.0; the 10×-row `filterMs` scale gate once measured 26× against 20×); the exact path and wake
  counters stay.
- Aliases of one plain object across branches (`{rows: [a, b], selected: a}`) remain outside the contract, as
  recorded for earlier rounds.

Verification on the final tree: `npm run build`, the four typechecks, oxlint (warnings only), `check:layout`
and the gate lint (153 entries) are clean; the full suite passes (2 108 tests, 0 failed) and the full
`npm run bench -- --runs 3` passes all 153 entries with no violations. The first full bench after the integration
had caught one regression, `write/one-row@10k` (1 302 KB allocated per diff, round 32's ceiling 64 KB): the
identity alignment of R39-05 built two Sets over all rows for one replaced row. It scans while at most eight
positions differ and builds the Sets only beyond that (3.0 KB now, `diff/copy` 1.0 against 12.6).
