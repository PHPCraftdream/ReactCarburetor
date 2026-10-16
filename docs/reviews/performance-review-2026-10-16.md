# Runtime performance review — 2026-10-16

## Scope

Runtime cost of the library engine under `lib/src` at `master` / `f124880`:

- store core: `Carburetor`, `emitStoreUpdate`, `UpdateBatch`, `UpdateWave`, schedulers;
- path machinery: `SubscriberIndex`, `WriteLog`, `WriteTargetLedger`, read-coverage markers;
- tracking: read/write proxies, live views, native alias index;
- observation and selections: `watchSelection`, `reconcileSelection`, `reconcileFlatSelection`,
  write-log patching;
- derived values: `Computed` and its freshness helpers;
- history: `CarburetorHistory`, owned-graph cloning, patch folding;
- resources: `ResourceCache` key, resolve and field-view paths;
- the `AntiHookComponent` render/commit path (`Foundation`, `Reads`, `Subscriptions`);
- interop hooks: `useCarburetorValue`, `createResourceReader`.

Out of scope: correctness, the API surface, tests, build and CI. Development-only diagnostics
(alias ledger, escape reports, `renderOwner`) are mentioned only where they touch production paths.

## Method

Static, read-only review: I read the source and the existing gates in `perf/gates` and
`perf/scenarios`, and checked history with read-only git. I ran no tests, benchmarks, builds or
scripts. Each finding is marked:

- **OBSERVED**: the mechanism is in the code at the cited lines.
- **INFERRED**: the size of the effect, or a code path behaving as described at runtime, comes
  from reasoning about the code, not from a measurement.

No timings in this report were measured. Every magnitude is an estimate and has to be confirmed
with a scenario before anyone acts on it. The "Protection" field names the existing gate that
would catch a regression, or says that none exists and sketches a counter-based gate in the style
of `perf/README.md`: a mechanism counter plus a positive control, with no absolute timing.

Priorities:

- **P1**: a cliff (super-linear cost or O(state) work per operation) on a realistic path, or a
  cost paid on every render or commit by every consumer.
- **P2**: substantial cost on common but conditional paths.
- **P3**: micro-allocations and constant factors; cheap to fix, low risk.

---

## P1

### PERF-01 — History: quadratic patch folding for object-valued patches (positional array methods, bulk inserts)

- **Where:** `lib/src/Carburetor/Tooling/Graph/foldDependentPatch.ts:18-30`;
  `lib/src/Carburetor/Tooling/CarburetorHistory.ts:288-314`;
  `lib/src/Carburetor/Store/Tracking/Proxy/Positional/positionalArrayMethods.ts:75-111`.
- **Mechanism (OBSERVED):** after the first pending patch with a trackable `next`,
  `pendingPossibleOwnedTarget` turns true (`CarburetorHistory.ts:313`). From then on every later
  patch, scalar or object, calls `foldDependentPatch`. That function scans **all** pending patches
  backwards. For each earlier patch it allocates an `every` closure, and on the intermediate check
  it also allocates `patches.slice(index + 1)` and `some` closures:

  ```ts
  for (let index = patches.length - 1; index >= 0; index--) {
      const earlier = patches[index];
      if (!earlier.nextExists || !isTrackable(earlier.next) ||
          earlier.segments.length > patch.segments.length ||
          !earlier.segments.every((segment, part) => segment === patch.segments[part])) continue;
  ```

  A positional method on a row array emits one patch per shifted index. Examples are
  `splice(0, 1)`, `shift`, `unshift`, `sort` and `reverse`; the `array/positional@10k` gate pins
  10 002 paths for a head splice. Each of those patches has object `previous`/`next` endpoints, so
  patch *k* scans *k* earlier patches.
- **Cost (INFERRED):** about N²/2 iterations, plus one closure allocation per iteration, for one
  `draft.rows.splice(0, 1)` on an N-row array while a `CarburetorHistory` is attached. At 10k
  rows that is about 5·10⁷ iterations inside a single `update()`, likely hundreds of ms to
  seconds. A loop of `push`es in one update (a bulk insert) has the same quadratic shape on a
  smaller scale.
- **Fix:** index the pending owned-target patches by their joined path. Use a
  `Map<string, number>` that is filled when an owned-target patch is pushed and cleared together
  with `pendingPatches`. The fold then becomes "look up each proper prefix of the new patch's
  path", O(depth) per patch. The "intermediate patch owns the subtree" check is answered by the
  same map: the nearest prefix found wins. Even without the index, replace the per-iteration
  `every`/`slice`/`some` closures with indexed loops. Separately, positional methods could
  degrade to one opaque or snapshot entry above a threshold of shifted indices, in the spirit of
  `DIFF_PATH_THRESHOLD`; see also PERF-04.
- **Protection:** none. `array/positional@10k` runs without a history, and `history43/*` covers
  scalar fold work only. Suggested gate: `history4x/positional-fold@{1k,4k}`. It would count
  `foldDependentPatch` loop iterations, through an `engineKey` tap or a counting subclass of
  `CarburetorHistory`, for a head splice with a history attached. It would gate the count at
  ≤ c·N and use `scale` 4k/1k ≤ 4.4, with an undo/redo correctness tail and a bulk-push control.

### PERF-02 — Every commit rebuilds, prunes and compares a fresh read set (all-ancestor prefix Set in `prune`)

- **Where:** `lib/src/Carburetor/Store/Paths/Markers/readCoverage.ts:5-17, 52-71`;
  `lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx:189-226, 305-315`;
  `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:574-596`;
  `lib/src/Interop/useCarburetorValue.ts:255, 337`;
  `lib/src/Carburetor/Store/Tracking/Observation/watchSelection.ts:34, 129-133`.
- **Mechanism (OBSERVED):** each render attempt records into a brand-new `Set`
  (`Reads.tsx:591`, `declareConnection.ts` `recordPath`). The commit runs `completeReads`, then
  `readCoverage.prune`. Once a set has more than 8 paths and contains any `.~p` branch marker
  (almost every traversal records one), `prune` calls `prefixes(reads)`. That function allocates a
  `Set` of **every** ancestor of **every** path through `path.slice(0, cut)` in a loop, plus one
  more `slice(0, -3)` per marker. The commit then runs `sameReads` (another O(N) walk) against the
  installed set, and in the steady state adopts the installed set and drops the fresh one.
- **Cost (INFERRED):** for a list parent reading N rows at depth 3, each re-render allocates
  roughly a 2N-entry `Set` with its backing store, about 3N short strings, and an N-entry prefix
  `Set`. That is the same order as React's own element allocation for the list, so the GC
  pressure of a stable re-render roughly doubles. This is paid on every commit by every class
  component, every `useCarburetorValue` recompute and every `watch` wake.
- **Fix:**
  1. *Cheaper prune.* Under hierarchical recording, traversing into `X.k` always records
     `X.k.~p` first, so a marker `X.~p` is implied exactly when some other path's **immediate
     owner** is `X`. The immediate owner of `X.k` is `X`; the owner of `X.k.~p` is also `X`.
     Compute one owner slice per path, matched against a small set of marker bases, instead of all
     ancestors: O(N) slices instead of O(N·depth). Where recording is not hierarchical (resource
     field paths) the worst case keeps an implied marker, which is redundant but correct.
  2. *Copy-on-divergence recording.* While an attempt records, test each path against the
     installed set. Count distinct hits with a per-slot epoch stamp (`Map<path, epoch>`) instead
     of a fresh `Set`, and materialize a new `Set` only at the first miss. If the attempt ends
     with hits equal to `installed.size` and no misses, reuse the installed set and skip `prune`
     and `sameReads` entirely. The existing `sharedReads` adoption in `connectSelection` already
     does this for selections.
- **Protection:** partial. `readset40/prune-work` pins zero `Set` constructions for completions
  of ≤ 8 paths and exactly one for the 2002-path set, so the current prefix `Set` is
  *allowed*. Suggested gate: `readset4x/stable-commit@1000`. A class list parent re-renders with
  an unchanged read set; count `Set` constructions and `String.prototype.slice` calls inside
  completion (= 0 after the fix), plus `subscribe` calls (= 0, as today). Positive control: a
  branch switch must still construct the new set and refile.

---

## P2

### PERF-03 — Map/Set mutation through draft discards the whole native-alias ownership index

- **Where:** `lib/src/Carburetor/Store/Tracking/Proxy/liveViews.ts:120-123, 140-143, 174-176`;
  `lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasIndex.ts:20-26`;
  `lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasReads.ts:97-103`;
  `lib/src/Carburetor/Store/Tracking/Aliases/buildOwnershipIndex.ts:11-37`;
  `lib/src/Carburetor/Store/Tracking/Proxy/Positional/positionalArrayMethods.ts:114-116`.
- **Mechanism (OBSERVED):** the draft Map/Set facade's `set`, `delete`, `add` and `clear` call
  `nativeAliasIndex.invalidate(root)`. That bumps the generation **and** deletes the ownership
  index. `buildOwnershipIndex` only walks `isTrackable` (plain object or array) own enumerable
  data. It never descends into a `Map`/`Set`, so a Map/Set membership change cannot change any
  entry of that index. Only the per-native answer cache, which is keyed by generation, needs
  invalidating. The next read that exposes plain members, such as `data.byId.get(id)` through the
  read facade or a Map/Set iteration, then calls `nativeAliasIndex.paths(root)`, which re-walks
  every plain container of the state with one `joinPath` string per container. Positional moves
  of containers (`splice`/`sort` on row arrays) also drop the index wholesale; those shift paths
  legitimately, but could be repaired for the moved range only.
- **Cost (INFERRED):** O(plain containers in state) on the first native-alias read after every
  `draft.map.set(...)`. Normalized `Map<id, Row>` state next to a large plain list pays a full
  walk per write/read cycle, for example about 10k objects and 10k path strings per cycle.
- **Fix:** for Map/Set facade mutations, bump the generation only and keep `ownership`. Add a
  `nativeAliasIndex.touch(root)` next to `invalidate`. Keep the full `invalidate` for raw
  emits, root installs and truncation. For positional methods, consider repairing only the
  moved index range, using the same disjoint-subtree proof `noteChange` already uses.
- **Protection:** none. `aliases/write-read@4k` covers scalar writes only, and
  `alias39/instance-leaf@*` covers set-trap repair. Suggested gate:
  `aliases4x/map-mutation-read@{1k,4k}`. It runs cycles of `draft.byId.set(k, row)` followed by
  `view.byId.get(k).n`, counts descriptor visits on raw rows the way `aliases/write-read` does
  (target ≈ 0 per cycle after warm-up), and checks the `scale` 4k/1k. Positive control: a
  plain-path alias of a Map member still subscribes to its plain path.

### PERF-04 — History clones every object patch endpoint twice (four times per row for positional methods)

- **Where:** `lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:166-184`;
  `lib/src/Carburetor/Store/Tracking/Proxy/clonePatchValue.ts:9-27`;
  `lib/src/Carburetor/Tooling/CarburetorHistory.ts:293-306`;
  `lib/src/Carburetor/Store/Utils/Graph/cloneOwnedGraph.ts:18-101`;
  `lib/src/Carburetor/Store/Tracking/Proxy/Positional/positionalArrayMethods.ts:105-110`.
- **Mechanism (OBSERVED):** the write proxy deep-clones `previous`/`next` with
  `clonePatchValue`, which makes one `getOwnPropertyDescriptor` call per key. `onPatch` then
  clones both endpoints **again** through `cloneOwnedGraph`, which allocates a fresh `WeakMap`
  per call, makes a `liveViews.readTarget` hatch probe (a proxy `get` under `try`) per object,
  and calls `Reflect.ownKeys` plus a descriptor per key. The first clone is private engine output
  that is never aliased to user state, yet history does not trust it. In positional patches
  every shifted row appears as `next` of patch *k* and `previous` of patch *k+1*, so each row is
  cloned 4 times, and 2N retained clones end up in one history entry.
- **Cost (INFERRED):** about 2× the clone work and garbage for every object-valued write with a
  history attached, such as `push(row)` or a branch replacement. For a head splice on N rows it
  is 4N row clones and 2N `WeakMap`s, on top of PERF-01.
- **Fix:** merge the two walks. Either let `clonePatchValue` take the classify callback and
  report `exotic`/`lockedArray`/`restricted` while it copies, or mark engine-produced patches as
  already detached so history runs a classify-only walk instead of `own()`. In positional
  attribution, clone each moved row once and share the clone between adjacent patches, or emit a
  single structural entry (see PERF-01).
- **Protection:** partial. `history/mixed-capture@128` (`intermediateCopies = 0`) and
  `history39/scale@10k-plain` (owned clones = 0 for scalars) guard capture, not patch
  endpoints. Suggested gate: count `cloneOwnedGraph`/`clonePatchValue` object constructions per
  object `push` (target 1 per endpoint), plus the same count for a head splice at 1k (≤ 2N).

### PERF-05 — Reading a Date (or any opaque value) through `draft` publishes a write and forces a full-state history snapshot

- **Where:** `lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:283-302`;
  `lib/src/Carburetor/Tooling/CarburetorHistory.ts:278, 457-464, 498-522`.
- **Mechanism (OBSERVED):** the draft `get` trap treats **any** non-plain object value as
  exposure. On a read alone it emits `PATCH_OPAQUE`, records `path` and `path.~p` with
  `RAW_EXPOSURE`, and calls `nativeAliasIndex.noteChange`. So
  `update(d => { if (d.task.due.getTime() < now) d.task.done = true; })` wakes every reader of
  `task.due` and refuses write-log selection reuse, because `patchFromWriteLog` rejects
  `RAW_EXPOSURE`. With a history attached it also turns the entry into a snapshot:
  `buildSnapshotEntry` runs `capture()`, a full `cloneOwnedGraph` of the state, then
  `sameHistoryGraph(before, after)`, a full compare, and retains a full copy per entry, up to
  `limit` (50).
- **Cost (INFERRED):** O(state) clone plus O(state) compare per publication, and up to 50
  full-state copies retained, all triggered by a read. It also causes spurious wakes for readers
  of the Date path.
- **Fix:** wrap `Date` in a draft facade, as Map/Set already are (`adaptNativeCollection`). Read
  methods (`getTime`, `toISOString`, `valueOf`, …) pass through untouched, and only `set*`
  methods emit `PATCH_OPAQUE` and record the path. Until then, document `getData()` for
  draft-side reads of opaque values.
- **Protection:** partial. `history39/native-scalar-{write,undo}` and `history39/date-heap@10k`
  cover scalar writes *next to* a Date, not a Date *read* through draft. Suggested gate: one
  update that reads `draft.row.due.getTime()` and writes a sibling scalar. Assert
  `history.past.at(-1).kind === 'patches'`, zero wakes of a `due` reader, and retained heap per
  entry at most the `date-heap` bound. Positive control: `draft.row.due.setTime(...)` still
  yields an opaque entry and wakes the reader.

### PERF-06 — Per-node overhead in the full `reconcileSelection` walk

- **Where:** `lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts:59-64, 69-154,
  157-253, 256-299, 456-463`.
- **Mechanism (OBSERVED):**
  - `reconcileKeyed` allocates `{present: true, value}` **per key** (line 195), two closures
    (`lookup`, `ensure`) and a `cycleEntries` array per container, and two `viewKeys` arrays.
  - `reconcileArray` allocates `cycleEntries` and three closures per array, and runs
    `claimedByLedger`, an extra pass over all members with `rawOf` and a ledger lookup per
    member.
  - `rawOf` is a `liveViews.readTarget` hatch probe: a proxy `get` trap inside `try/catch`. It
    runs 2–3 times per member: in `claimedByLedger`, in `baseFor`, and twice at the
    `reconcile(…, rawOf(childLive), …)` call sites, lines 324 and 326.
  - `register` does 2 `WeakMap.set` calls plus 2 array pushes per container. `reconcile` adds
    2 more `WeakMap.set` calls plus a `WeakSet` add/delete.
  - Each call allocates a context with 2 `WeakMap`s, a `WeakSet`, 2 arrays and a closure, even
    for small selections.
- **Cost (INFERRED):** a constant factor of several allocations and 3+ trap invocations per
  selected node. This hits every full reconcile: first render, inline selectors, fresh projected
  objects, and any wake that the write-log patch route (`patchFromWriteLog`) cannot serve, in
  hooks, `watch`, `connectSelection` and `useResourceValue`.
- **Fix:** replace `found` with two locals. Compute `rawOf(childLive)` once per member and pass
  it down; cache it inside `claimedByLedger` by index when the ledger exists. Hoist
  `lookup`/`ensure`/`baseFor`/`appended` into module functions that take the context and frame
  state. Allocate `cycleEntries` lazily on the first cycle. Create `previousToFresh`,
  `freshToPrevious` and `open` lazily, since they are only needed once a container pair is
  entered.
- **Protection:** partial. `selection44/array-spine-prototype` counts JS-level loops in the
  spine copier, `selection43/*` covers projection work, and `resource41/machinery@1000` counts
  `WeakMap` constructions in a warm window. None counts hatch probes or per-key objects.
  Suggested gate: on a 1k-row object selection, count `RAW_TARGET` hatch reads per full
  reconcile (≤ 1 per member) and `WeakMap`/`WeakSet` constructions per call (≤ 2).

### PERF-07 — `useResource` allocates a field facade and fresh path strings on every render

- **Where:** `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:387-399`;
  `lib/src/Carburetor/Resource/Cache/Reader/resourceReader.ts:13-29, 38-41`;
  `lib/src/Carburetor/Resource/Cache/Reader/createResourceFieldView.ts:10-12, 67-78`.
- **Mechanism (OBSERVED):** every `useResource` call in render creates:
  - a recorder closure (`Reads.tsx:394`);
  - through `collect`, 2–4 `joinPath(path, 'invalidated' | 'failed' | 'status' | …)`
    concatenations;
  - through `fieldView`, a `{...resolution.view}` spread of about 12 fields, a `Proxy` and a
    `FieldHandler`;
  - one more `joinPath(this.path, key)` on **every field read** (`createResourceFieldView.ts:71-75`).

  None of these strings are memoized, so each one is freshly hashed by `reads.add`, by
  `sameReads` at commit and by the `SubscriberIndex` on refile. A warm render of an unchanged
  entry pays all of this.
- **Cost (INFERRED):** about 4 objects plus 4–8 strings per reader per render. A list of a few
  hundred resource-backed rows re-rendering together sees this next to React's own work.
- **Fix:** memoize field paths per entry path. A small frozen record
  `{invalidated, failed, status, isIdle, updatedAt, refreshing, data, error, …}` keyed by `path`
  can hang off the primed key record (`IPrimedKey`) or live in a bounded map in
  `ResourceCache`. Use it in both `collect` and `FieldHandler.get`. Cache the field facade per
  (resolution, attempt): `resolve()` already returns the identical resolution object while the
  view is unchanged.
- **Protection:** partial. `resource41/machinery@1000` and `resource41/inline-cost@1000` count
  accessor definitions, `WeakMap`s and selector calls on the hooks path, and
  `resource39/data-only-readers@50` counts renders. None covers the class `useResource` facade.
  Suggested gate: warm class re-renders of 1000 readers on an unchanged entry, counting `Proxy`
  constructions (target 0 after the fix) and distinct path-string identities per field (1).

### PERF-08 — `connectSelection` wake runs the heavy reconcile without the flat fast path

- **Where:** `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:193-252` (line 216),
  compared with the render path at `Reads.tsx:326-338`.
- **Mechanism (OBSERVED):** on every notification, `selectionUnchanged` runs the selector into a
  fresh scratch `Set` and calls `reconcileSelection(snapshot.value, next, undefined, rejectArraySubclass)`
  directly. It never tries `reconcileFlatSelection` first, although the render path does. A
  typical row projection like `{title: data.items[id].title}` is flat, but at wake time it still
  pays the full context: 2 `WeakMap`s, a `WeakSet`, a fresh copies `WeakMap` and arrays (see
  PERF-06). This happens synchronously inside the store's notify loop, once per woken component.
- **Cost (INFERRED):** 4 weak collections plus a context per woken selection per write. Weak
  collections are among the more expensive allocations for the GC (ephemeron processing).
- **Fix:** mirror the render path. Try `reconcileFlatSelection(snapshot.value, next)` first and
  compare `flat.value === snapshot.value`. Fall back to `reconcileSelection` with the retained
  `ledger` only for non-flat results.
- **Protection:** none for this path. `selection38/flat-primitive@128` proves zero graph
  collections for `watch` wakes only; `components/branch-migration@1` checks migration
  correctness. Suggested gate: 128 flat `connectSelection` rows, one related write each, counting
  `WeakMap`/`WeakSet` constructions during delivery (= 0), with the existing branch-migration
  assertions as positive control.

---

## P3

### PERF-09 — Read-proxy `getOwnPropertyDescriptor` builds a path string before knowing it needs one

- **Where:** `lib/src/Carburetor/Store/Tracking/createReadProxy.ts:426-452` (line 436).
- **Mechanism (OBSERVED):** `joinPath(this.path, key)` runs for every descriptor probe, but
  `path` is only used for a trackable value (wrap or the locked error). Primitive keys, the
  common case, allocate and drop a string. This trap runs for every key of `Object.keys`,
  `Object.entries`, spread and `for…in` over a view, and for every key in
  `reconcileFlatSelection` (PERF-10).
- **Fix:** move the `joinPath` call inside `if (isTrackable(value))`.
- **Protection:** none for transient strings; `readenum/fresh@*` gates retained heap only. A
  unit-level counter on `joinPath` calls during `Object.keys(view)` over primitive rows (= 0)
  would guard it.

### PERF-10 — `reconcileFlatSelection` makes three proxy round-trips and a `defineProperty` per key

- **Where:** `lib/src/Carburetor/Store/Utils/Selection/reconcileFlatSelection.ts:26-38, 40-57`.
- **Mechanism (OBSERVED):**
  - For arrays: `Reflect.ownKeys(fresh)` goes through the proxy `ownKeys` trap, and the
    `filter(isArrayIndexKey)` does a `Number`/`String` round-trip per index.
  - Per key: a `getOwnPropertyDescriptor` trap (descriptor object, plus PERF-09's string) and a
    `get` trap.
  - The result is built with `Object.defineProperty` and a fresh descriptor literal per key,
    even when the descriptor is the plain default.
  - It also allocates `values`/`descriptors` arrays and two closures per call.

  A `d => d.ids` selection over a large id list pays all of this per change.
- **Fix:** for dense plain arrays, iterate `0..length` with `hasOwnProperty` on the raw target
  (`liveViews.readTarget`) and read values through the view only, which keeps recording. Use
  plain assignment when the source descriptor is writable, enumerable and configurable, falling
  back to `defineProperty` otherwise, as `clonePatchValue` already does.
- **Protection:** none; the `selection44/timing` diagnostics are ungated. Suggested: count
  descriptor-trap calls per flat array element (= 0 for dense plain arrays).

### PERF-11 — Eager O(reads) `Array.from(...).every(...)` in hot reuse checks; cache-entry spreads

- **Where:** `lib/src/Interop/useCarburetorValue.ts:272-277, 281, 338-345, 175`;
  `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:307`.
- **Mechanism (OBSERVED):** `readsCoverSelection` copies the read set into an array and runs
  `covers` per path *before* the cheap checks it is AND-ed with (`fresh === entry.liveSelection`,
  `isEqual === sameSelection`). So every recomputing `getSnapshot` with `noReadDrift` pays it even
  when reuse is impossible. `Reads.tsx:307` does the same on every reused render. Each recompute
  also builds the cache entry twice: a `completed` literal plus a `{...completed, …}` spread.
- **Fix:** evaluate the identity and comparator conditions first, iterate the `Set` directly
  with an early exit, and build the cache entry once.
- **Protection:** `hooks/*` and `selection*/` cover behaviour, not these allocations. Low risk;
  a unit counter on `readCoverage.covers` calls when `fresh !== liveSelection` (= 0) suffices.

### PERF-12 — `Computed` `track()` allocates a recorder closure and a key string on every call

- **Where:** `lib/src/Carburetor/Derived/Computed.ts:256-282, 312-318, 291`.
- **Mechanism (OBSERVED):** each `track(store)` call concatenates `':' + source.getUID()` and
  calls `this[C.createReadRecorder](slot)`, which creates a new closure. `PersistentViews.view`
  only uses that `route` when it rebuilds the view, so on the warm path the closure is
  discarded. Bodies that call `track(store)` inside a loop multiply this. `hadValue` builds
  `Object.keys(this[C.versions])` just to test for emptiness.
- **Fix:** store the recorder on the `IActiveReadSlot` (create it once per slot), cache the
  `':' + uid` key per source in a `WeakMap`, and test emptiness with a `for…in` early return.
- **Protection:** `computed/pulls@*`, `computed41/dependencies-*` and `computed42/fan-in-*`
  cover body runs and dependency work, not per-`track` allocation. Suggested: a closure-count
  probe (count `createReadRecorder` invocations per recompute ≤ distinct sources).

### PERF-13 — Notify/emit micro-allocations: duplicate ancestor slicing, closure per bucket, closures per notify

- **Where:** `lib/src/Carburetor/Store/Paths/WriteLog.ts:113-118`;
  `lib/src/Carburetor/Store/Paths/SubscriberIndex.ts:180-184, 208-210, 475-478`;
  `lib/src/Carburetor/Store/Carburetor.ts:421-426, 434-443`;
  `lib/src/Carburetor/Store/Transaction/UpdateBatch.ts:91, 95`;
  `lib/src/Carburetor/Store/Scheduling/UpdateWave.ts:70`.
- **Mechanism (OBSERVED):**
  - `WriteLog.record` and `SubscriberIndex.match` each slice every ancestor of every written path
    in the same emit, so the strings are allocated and hashed twice.
  - `collect` allocates an arrow per multi-id bucket (`source.forEach((id) => target.add(id))`).
  - `CARBURETOR_NOTIFY_WRITES` allocates two `forEach` closures per notify.
  - `UpdateBatch.flush` always allocates `failures`.
  - Drains allocate an `Array.from(entries)` per round.
- **Fix:** use `for…of` loops instead of closure `forEach`. Allocate `failures` lazily, as
  `UpdateWave` does. Optionally compute the ancestor list once per emit, or intern ancestors
  through `WriteLog`'s `under` keys, and hand it to `match`.
- **Protection:** `writelog39/write-allocs@1000` and `writelog39/write-bytes@6000` (bytes per
  write) would catch growth on the write path; `subscribe42/*` counts bucket visits. These are
  constant-factor changes, so keep them under the existing byte gate.

### PERF-14 — Native-alias answer cache invalidated by every container write

- **Where:** `lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasIndex.ts:29-33`;
  `lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasReads.ts:27-31, 52-68`.
- **Mechanism (OBSERVED):** `noteChange` bumps the root generation on every container write,
  even when it then repairs the index locally. Every cached per-native answer is therefore
  recomputed on its next read. For a plain `Date` leaf that means `isScalarLeaf`, which allocates
  two arrays (`getOwnPropertyNames`, `getOwnPropertySymbols`) per Date per render after any
  structural write.
- **Fix:** keep a separate "scalar leaf" verdict cache keyed by the native object alone. A plain
  `Date` with no own data is a scalar leaf regardless of topology, so revalidate only when its own
  keys change. Alternatively, bump the generation only when the repair touched exposed members.
- **Protection:** `alias39/date@10k` and `alias39/instance-leaf@*` count descriptor lookups.
  Extend them with a reflection-array count per Date read after an unrelated row insert (= 0).

### PERF-15 — `ResourceCache.subscribe` per-call allocations on every refile

- **Where:** `lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts:190-213`.
- **Mechanism (OBSERVED):** every `subscribe`, including each commit-time refile when a read set
  moved, allocates `getInitialCacheEntry()` (a full default entry), an `absent` `Set`, and per
  read two slices, a prefix template string and two regex `replace` calls.
- **Fix:** use a module-level frozen defaults key set, and decode the key only for paths under
  `entries.`, skipping the regex when there is no `~` (as `reconcileFailureWrite` already does).
- **Protection:** `resource4x/*` cover behaviour; no allocation gate. Low priority.

### PERF-16 — Tooling: DevTools snapshots every update uncoalesced; persist stringifies the whole state per microtask

- **Where:** `lib/src/Carburetor/Tooling/connectDevTools.ts:43-58, 62-71`;
  `lib/src/Carburetor/Tooling/persist.ts:61-74, 96-112`.
- **Mechanism (OBSERVED):** each notification of a connected store runs `snapshot()`
  (`deepClone`, O(state)) and `connection.send`. A stream of writes is not coalesced. `persist`
  coalesces per microtask but still stringifies the full state per burst; there is no time-based
  throttle option.
- **Fix:** coalesce DevTools sends per microtask, as `persist` does. Consider an optional
  `throttleMs` for `persist` on large states.
- **Protection:** none. Both are development or tooling paths, hence P3.

### PERF-17 — Diff overflow path: up to four walks, an `Error` with a stack per overflow, and spread-based key unions

- **Where:** `lib/src/Carburetor/Store/Paths/Diff/diffPaths.ts:15, 24-28, 286-331`;
  `lib/src/Carburetor/Store/Paths/Diff/Threshold/countDiffLeaves.ts:33, 49, 73`;
  `lib/src/Carburetor/Store/Paths/Diff/applyDiff.ts:36`.
- **Mechanism (OBSERVED):** past `DIFF_PATH_THRESHOLD`, the walk throws `DiffOverflow`, a
  subclass of `Error` that captures a stack trace. It then runs `countDiffLeaves.changed` and
  `.total`, and may re-walk everything. The count walks and `applyDiff` build
  `new Set([...Object.keys(a), ...Object.keys(b)])` per object node.
- **Fix:** throw a preallocated sentinel object (no stack capture), or return a flag. Iterate
  `Object.keys(a)` and then the keys of `b` not in `a` (`hasOwnProperty`) instead of spreading
  into a temporary array and a `Set`.
- **Protection:** `diff39/*`, `replace36/*` and `store/restore-one-leaf` cover paths and wakes.
  A `Set`-constructor counter on a 5k-row `restore` would guard the union change.

### PERF-18 — Small repeated concatenations in write-log selection patching

- **Where:** `lib/src/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog.ts:55-57`;
  `lib/src/Carburetor/Store/Utils/Selection/Patch/planSelectionPatch.ts:43-46`;
  `lib/src/Carburetor/Store/Utils/Selection/Patch/reuseSelection.ts:69`.
- **Mechanism (OBSERVED):** `rootPath + PATH_SEPARATOR` and `path + PATH_SEPARATOR` are
  concatenated per path per call. `reuseSelection` merges sets with
  `new Set([...a, ...b])`, which goes through a temporary array.
- **Fix:** hoist the prefix once per call, and build the merged set with `new Set(a)` followed by
  `add` in a loop.
- **Protection:** `selection36/*`, `selection37/patch-budget@4k` and `writelog39/interleaved-*`
  pin path-read counts; the change is behaviour-neutral.

---

## Summary

| ID | Priority | Area | Issue | Evidence | Existing gate |
|----|----------|------|-------|----------|---------------|
| PERF-01 | P1 | History | O(P²) `foldDependentPatch` scan with closure allocation per step; a head splice on N rows with history ≈ N²/2 iterations | OBSERVED mechanism, INFERRED magnitude | none |
| PERF-02 | P1 | Render/commit | Fresh read `Set` per attempt, all-ancestor prefix `Set` in `prune`, O(N) `sameReads` per commit | OBSERVED, INFERRED magnitude | partial (`readset40/prune-work` allows one Set) |
| PERF-03 | P2 | Aliases | Map/Set draft mutation deletes the ownership index although the index never covers Map/Set members; O(plain state) rebuild on next native read | OBSERVED, INFERRED magnitude | none |
| PERF-04 | P2 | History | Object patch endpoints cloned twice (×4 per row for positional); `WeakMap` per `own()` call | OBSERVED | partial |
| PERF-05 | P2 | Draft/history | Reading a Date through draft publishes a write, refuses selection reuse, forces an O(state) snapshot entry | OBSERVED | partial |
| PERF-06 | P2 | Selections | Per-key/per-container allocations and 2–3 hatch probes per member in full reconcile | OBSERVED, INFERRED magnitude | partial |
| PERF-07 | P2 | Resources | Class `useResource`: spread, Proxy, handler, closure and unmemoized field path strings per render | OBSERVED | none for the class path |
| PERF-08 | P2 | Selections | `connectSelection` wake skips the flat fast path; 4 weak collections per woken component | OBSERVED | none for this path |
| PERF-09 | P3 | Read proxy | `getOwnPropertyDescriptor` builds a path for primitive keys | OBSERVED | none |
| PERF-10 | P3 | Selections | Flat reconcile: 3 proxy round-trips plus `defineProperty` per key | OBSERVED | none |
| PERF-11 | P3 | Hooks/class reuse | Eager `Array.from(...).every` before cheap checks; double cache-entry allocation | OBSERVED | none |
| PERF-12 | P3 | Computed | Recorder closure and key string per `track()` call | OBSERVED | none |
| PERF-13 | P3 | Notify/emit | Duplicate ancestor slicing; closures per bucket and per notify; eager `failures` array | OBSERVED | `writelog39/write-bytes` (bytes) |
| PERF-14 | P3 | Aliases | Generation bump per container write recomputes Date leaf verdicts (2 arrays each) | OBSERVED | partial (`alias39/*`) |
| PERF-15 | P3 | Resources | `subscribe` allocates defaults, `Set`, slices and regex per refile | OBSERVED | none |
| PERF-16 | P3 | Tooling | DevTools deep snapshot per update; persist full stringify per burst | OBSERVED | none |
| PERF-17 | P3 | Diff | Overflow: `Error` stack capture, extra walks, spread-based key unions | OBSERVED | partial |
| PERF-18 | P3 | Selections | Repeated prefix concatenation; spread set merge | OBSERVED | behaviour-only |

Counts: **P1: 2, P2: 6, P3: 10** (18 findings).

### Suggested order of work

1. PERF-01: index pending owned-target patches. A small, local change that removes a quadratic
   cliff. Add a `history4x/positional-fold` scale gate in the same change.
2. PERF-03: generation-only bump for Map/Set facade mutations. A one-line change in intent; gate
   it with a Map-mutation write/read counter.
3. PERF-02: owner-only prune first (local to `readCoverage`, guarded by `readset40/*`), then
   copy-on-divergence recording as a separate change with its own stable-commit gate.
4. PERF-04/PERF-05: unify patch cloning, and add a Date draft facade.
5. PERF-06/PERF-08/PERF-07, then the P3 batch.

Every proposed gate should follow `perf/README.md`. Validate it both ways: the mechanism counter
must fail on the current build before the fix lands. Use `scale`/`over` ratios rather than
absolute timings.
