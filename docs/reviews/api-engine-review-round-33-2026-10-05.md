# API and engine review — round 33 — 2026-10-05

## Verdict

Base: `6c90d59` (its code is identical to `829c3ea`, round 32 integrated), measured through its own
production ESM build (`dist/esm-prod`, built after the last source change). Eight findings: two P1,
four P2, two P3. Findings and recorded known limits of rounds 30–32 are not re-reported.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R33-01 | P1 | Derived / O / renders | A computed that returns a live branch (`read(store).rows`, the documented form) walks the whole branch through read proxies on every settle: 242–419 ms per edit at 10k rows (0.2–1.5 ms without the walk), and the walk subscribes the computed to 20 004 key markers |
| R33-02 | P1 | Hooks / O | `useCarburetorValue` re-reads and deep-compares the whole selection on every render with an inline selector, and after any unrelated write with a stable one: 79–162 ms per render for a 10k-row selection (7.3 ms with a same-result shortcut) |
| R33-03 | P2 | Derived / O | `get()` on an observed computed after any write to its store re-matches its whole read set in the write log: 5.1 ms per read at 10k rows (84% in `WriteLog.matches`), repeated after every unrelated write |
| R33-04 | P2 | Selection / allocations | Engine-internal compare and detach enumerate live views through `Object.keys` (`ownKeys` plus one descriptor trap per key): an internal keys hatch halves view compare and detach with identical read sets |
| R33-05 | P2 | Derived / renders | `equals` suppresses the announcement but not the identity change: `get()` hands out the new, content-equal object, so a consumer's next unrelated render passes a new reference down |
| R33-06 | P2 | History / O | One history entry with overlapping object patches clones the whole baseline (19–28 ms at 10k rows against 0.02 ms); every object patch is copied three times and walked once more (10.2–10.5 ms against 0.38–0.50 ms without history for a 1000-row subtree) |
| R33-07 | P3 | API / performance | `persist` stringifies the whole state on every write by default: 50 one-field writes on 10k rows cost 218 ms, 6.1 ms with `coalesce` |
| R33-08 | P3 | API | Superseded lookup members and helpers keep the internal key/path grammar public: `ResourceCache.keyOf/pathOf/pathOfKey/getEntryByKey`, `encodeCacheKey`, `getInitialCacheEntry`, `Computed.getSnapshotVersion` |

Fix R33-01 first: one condition removes the cost, and the walk also changes what the computed
subscribes to. R33-02 is the largest cost a hooks user meets — a list component selecting its rows
pays it on every render. R33-02 and R33-03 share the recommended mechanism (a per-subscription
matched version).

## Method and evidence boundaries

- Read at `6c90d59`: computed settle, announcement and freshness, the write log, both hooks, the
  selection compare and detach, the read proxy's enumeration traps, the class component commit
  path, the history recorder and its owned-patch preflight, `persist`, the resource cache's public
  surface and the API docs.
- Every finding was reproduced through the built package's public API (subclassing `Carburetor`
  where the protected `update` is needed; hooks rendered with React 19.3.0 `createRoot` and
  `flushSync` in JSDOM 30.0.1). Node v24.12.0, `NODE_ENV=production`.
- Counters (filed paths, wakes, selector runs, renders, read sets) are exact for the scenario.
  Wall-clock numbers are medians of 7–61 runs on a machine shared with other sessions; separate
  runs disagreed by up to 2× on the slowest scenarios, so ranges are given where they did, and only
  ratios of about 2× and more are reported.
- Projections (R33-01, R33-02, R33-04) patched a throwaway copy of `dist/esm-prod`. They show the
  size of the available win, not a finished implementation; each was checked for identical
  behaviour on its probe (wakes, renders, rendered text, read sets, verdicts).
- CPU profiles (`--cpu-prof`) are cited where they locate the cost.
- No product source, tests, dependencies or tracked generated files were changed. Probes lived in
  the ignored `worktrees/r33-probes/` directory (a plain directory, not a git worktree) and were
  removed. Only this report is committed.

## Findings

### R33-01 — P1 — a live computed result is walked through its read proxies on every settle

**Mechanism.** `announceIsUnchanged` (`Derived/Freshness/announceIsUnchanged.ts:43-49`) computes
both `liveChanged` and `opaqueChanged` whenever the result keeps its raw identity and a dependency
moved. `liveChanged` already decides the verdict for an engine view, but `opaqueChanged` still calls
`containsExoticValue(next)` (`:45`). That walk (`Store/Utils/Graph/containsExoticValue.ts:34-48`)
runs `Reflect.ownKeys` and `Object.getOwnPropertyDescriptor` on every container reachable from the
result — through the read proxies:

- the read proxy's `ownKeys` trap records the key-set marker (`createReadProxy.ts:391-395`) into the
  computed's persistent view, that is into its published dependency, and
  `Computed.recordDependencyRead` files each marker into the store's subscriber index through
  `CARBURETOR_EXTEND` (`Computed.ts:305-308`);
- the `getOwnPropertyDescriptor` trap builds a path and wraps every branch (`createReadProxy.ts:419-431`).

A persistent read tree keeps a view's identity across recomputes (R30-05), so
`computed(read => read(store).rows)` — the form the README documents ("A computed's result is live,
not a copy") — reaches this walk on every settle: a consumer reading a deeper field extends the
computed, an edit of that field settles it, and the settle walks all rows. The unobserved recompute
path calls the same function with `dependenciesMoved = true` (`Computed.ts:276-277`).

**Probe.** Rows `{id, title, tags: {a}}`; `c = computed(read => read(s).rows)`; one subscriber that
re-reads `c.get()[5].title` when woken (what a re-render does); then `d.rows[5].title = …`, three
times.

| Rows | Per edit (current) | Per edit, walk skipped for live results | Paths filed for `c` (current / skipped) | Wakes (both) |
|---:|---:|---:|---:|---:|
| 1 000 | 33.7 ms | 0.18 ms | 2 004 / 3 | 3 |
| 10 000 | 242–419 ms | 0.17–1.46 ms | 20 004 / 3 | 3 |

Second scenario — the body reads `filter` and returns `rows`; three `filter` writes on 10 000 rows:
521–701 ms per write against 0.16–3.7 ms, filed paths 2 → 20 003 against 2. Afterwards adding a key
inside row 5, which nothing read, woke the computed once (zero times with the walk skipped). The
projection changed one condition: `opaqueChanged` evaluated only when `liveChanged` is false.

**Recommendation.**

1. Evaluate `containsExoticValue` only when `liveChanged` is false.
2. Never walk through engine views: stop at any value that answers the `RAW_TARGET` hatch (a live
   member is judged by `liveChanged`'s rule) and walk plain containers through their raw objects,
   so no engine-internal walk can record a read or allocate a wrapper.

**Acceptance.** The 10k-row probe settles in ≤ 2 ms per edit; a settle leaves the computed's filed
read set unchanged; an unrelated key addition wakes nobody; the R6-02/R7-02 exotic-envelope suites
stay green.

### R33-02 — P1 — `useCarburetorValue` re-compares the whole selection on almost every render

**Mechanism.** `getSnapshot` reuses its cached result only while the carburetor, the selector
*identity*, the comparator and the store *version* all match (`Interop/useCarburetorValue.ts:212-218`).
Otherwise it runs the selector, deep-compares the result with the cached snapshot through the live
view (`sameSelection`, `:241`) and detaches it on a change (`:243`). Two common cases miss the cache:

- an inline selector — the README's own example,
  `useCarburetorValue(profileCarburetor, (data) => data.name)` — has a new identity on every render;
- with a stable selector, any write to the store moves the version, including writes the
  subscription was correctly not woken for (input text kept in the same store).

R32 listed the re-run under "Not findings" because no extra render results; this measures its cost.
For a container selection the comparison reads every selected leaf through the view (50 002 paths
for the probe's 10 000 rows) and allocates ledger entries per container.

**Probe.** 10 000 rows `{id, title, done}`; `List` selects `d => d.rows`; its parent re-renders
through local state.

| Case | Per parent render | Selector runs per render |
|---|---:|---:|
| stable selector, no write since the last render | 3.5–9.2 ms | 0 |
| stable selector, one unrelated write (`d.draft = …`) | 79.7–161.7 ms | 1 |
| stable selector + projection A, one unrelated write | 24.7 ms | 0 |
| inline selector (README form), no write | 79–123 ms | 1 |
| inline selector, one unrelated write | 83–99 ms | 1 |
| inline selector + projection B, no write | 7.3 ms | 1 |
| inline selector + projection B, one unrelated write | 18.7 ms | 1 |

Projection A reuses the entry when `CARBURETOR_HAS_DRIFT(entry.version, entry.reads)` is false.
Projection B runs the selector and, when it returns the *same live view* as the cached entry and the
drift check is false, returns the cached snapshot without comparing. On a correctness probe (an
unrelated write plus a parent render, an edit of row 5, a push, a replacement of row 5, another
parent render) the current build and projection B rendered identical text with identical render
counts (6). The remaining 11–20 ms in both projections is the write-log check over the selection's
50 002 read paths (see R33-03).

**Recommendation.** In `getSnapshot`, before comparing:

1. when the carburetor and comparator match and no write since `entry.version` concerns
   `entry.reads`, reuse the entry if the selector is the same, or if a freshly run selector returns
   the identical live view — the comparison's read set already covers everything below it;
2. answer "no write concerns these reads" in O(1) from the notification side (R33-03) instead of
   O(read set).

The identical-live-result shortcut is also sound for `connectSelection`: R5-07 runs the selector on
every call because a selector may read props, but the walk is not needed when the selector returned
the very same live branch and nothing under it moved.

**Acceptance.** On the probe, a parent render of the inline-selector list costs ≤ 2× the no-write
stable-selector render, with or without an unrelated write; related writes still produce a new
snapshot (interop suites plus the edit/push/replace probe).

### R33-03 — P2 — reading an observed computed after an unrelated write re-matches its whole read set

**Mechanism.** `Computed.get()` → `hasDrifted()` (`Computed.ts:203-216`). Any write anywhere moves the
shared epoch, so the fast path fails; `leafVersionsDrifted` then asks the store, for every leaf whose
version moved, `CARBURETOR_HAS_DRIFT(recorded.version, reads)` (`Derived/Freshness/leafVersionsDrifted.ts:26`),
and `WriteLog.matches` loops over the whole read set with an ancestor scan per path
(`Store/Paths/WriteLog.ts:92-119`). A negative answer leaves the baseline where it was, so the next
write repeats the loop. For an observed computed this re-derives what the store's notification
already decided: the store matched the write against this very subscription (`Carburetor.ts:381-417`)
and did not wake it.

**Probe.** 10 000 items; `open = computed(read => count of !done)` with one subscriber; then
`d.draft = …` followed by `open.get()`, 400 times: median 5.1 ms per `get()`, no recompute; after
3 000 distinct-key writes, 4.7 ms median and 15.2 ms max. A fresh recompute of the same body costs
22.5 ms. Profile: 84.0% of samples in `WriteLog.matches`.

**Recommendation.** Record per subscriber the store version at which `notifyWrites` last matched it
(before scheduling, so a throttling scheduler does not matter), and per store the last version that
went through `notifyWrites` (a transaction defers it). Expose "matched since `v`?" through the
internal symbol protocol. When every emit has been matched, the answer for an observed computed
(subscribed under its uid, its dependency Set filed by reference) and for an installed hook
subscription whose reads are the cached entry's reads is one comparison; otherwise fall back to the
write log.

**Acceptance.** On the probe, `get()` after an unrelated write ≤ 0.05 ms; drift inside an open
transaction and under `ComponentUpdateThrottle` is still detected (freshness suites).

### R33-04 — P2 — engine-internal walks enumerate live views through `Object.keys`

**Mechanism.** `sameSelection` (`Component/Connection/sameSelection.ts:44`) and `detachOpaque`
(`Store/Utils/Selection/detachOpaque.ts:39`, `:191`) call `Object.keys` on a live view. Through a
proxy that is the `ownKeys` trap, V8's invariant checks and one `getOwnPropertyDescriptor` trap per
key, which builds a path string and wraps every branch value only for the engine to discard it
(`createReadProxy.ts:409-435`). R32-06 made those wrappers cheaper and declined a public `keysOf`;
the engine's own walks still pay the whole protocol.

**Probe.** 10 000 rows `{id, title, done, tags: {a}}`, a persistent read view, the previous snapshot
detached; three interleaved process pairs:

| Operation | Current | Internal keys hatch | Plain data (reference) |
|---|---:|---:|---:|
| `sameSelection(snapshot, view.rows)`, equal | 181–210 ms | 72–103 ms | 10–21 ms |
| `detachOpaque(view.rows)` | 135–212 ms | 69–101 ms | 4–11 ms |

The projection answered a `Symbol.for` key in the read proxy's `get` trap by recording the key-set
marker and returning `Object.keys(raw)`, and used it in both walks. Read sets (356 paths on a 50-row
probe) and verdicts were identical. Profile of the current compare: 38% self time in the anonymous
content walkers of `sameSelection`, where V8 attributes the proxied `Object.keys`, and 12% in the two
enumeration traps.

**Recommendation.** An internal, unexported keys hatch on read views and the connection facade,
used by `sameSelection`, `detachOpaque` and the development escape walk. It keeps R32-06's decision
(no public helper).

**Acceptance.** ≥ 1.6× on both view rows of the table; identical read sets and verdicts across the
selection, detach and interop suites.

### R33-05 — P2 — `equals` keeps the announcement but not the reference

**Mechanism.** `recompute` stores the new body result as the cached value (`Computed.ts:271`) before
`settle` asks `announceIsUnchanged`; when `equals` says the content is the same, nothing is announced
(`:524-528`), but `get()` already returns the new object. The announced value and the handed-out
value diverge. An unobserved computed never consults `equals` (`announced` is undefined,
`announceIsUnchanged.ts:46`).

**Probe.** `visible = computed(read => ids of open items with a non-empty title, {equals: shallowEqual})`
with one subscriber; editing an open item's title: no announcement (version 0), the same ids, a new
`get()` reference. The same for an unobserved computed. A class component that renders for any
other reason passes the new array to a memo child, which re-renders; `useComputedValue` builds a new
snapshot record.

**Recommendation.** When `equals(previousValue, next)` holds and the result is neither live nor
exotic, keep the previous reference as the cached value (the result-equality memo `reselect`
applies); for an unobserved computed compare with the previous cached value.

**Acceptance.** After a content-equal recompute `get()` returns the previously handed-out reference,
observed and unobserved; exotic and live results keep announcing (R6-02/R7-02 suites).

### R33-06 — P2 — history: overlapping object patches clone the whole baseline

**Mechanism.**

1. `preflightOwnedPatches` (`Tooling/Graph/canInstallOwnedPatch.ts:67-103`) replays a dependent patch
   list — one patch path at or under another — on `cloneOwnedGraph(root)`, a copy of the *entire*
   owned baseline (`:97`). Writing a new object and then a field inside it, or replacing it, in one
   update or one transaction produces such a list.
2. Every object patch value is copied three times and walked once more: `clonePatchValue` in the
   write proxy (`createWriteProxy.ts:178-179`), `containsExoticValue` and `own()` in
   `CarburetorHistory.onPatch` (`CarburetorHistory.ts:273-286`), and `deepClone` when it is installed
   into the baseline (`installPatch.ts:36-40`, called from `CarburetorHistory.ts:495`). The first two
   are descriptor-based.

**Probe.** History attached, state `{docs: {}, rows: N rows}`, a fresh key per run:

| One update (or transaction) | N = 1 000 | N = 10 000 |
|---|---:|---:|
| `d.docs[k] = {id}` | 0.02 ms | 0.02 ms |
| `d.docs[k] = {id}; d.docs[k].id = -i` | 2.76 ms | 27.9 ms |
| `d.docs[k] = {id}; d.docs[k] = {id: -i}` | 2.32 ms | 20.8 ms |
| two updates in one transaction (new object, then its field) | 2.21 ms | 19.3 ms |

A debug run confirmed the copy: `baseline.rows` changed identity after one such update. Writing a
1000-row subtree to a new key: 0.38–0.50 ms without history, 10.2–10.5 ms with it; profile:
`cloneOwnedGraph` 34%, `clonePatchValue` 19%, `containsExoticValue` 19%, `deepClone` 6%.

**Recommendation.** Fold a later patch whose path lies at or under an earlier object patch of the
same entry into that patch's owned `next`, keeping the earliest `previous`, so the list stays
independent and needs no preview; where a preview is still needed, copy only the spine from the root
to the patched paths. Let history adopt the write proxy's private clone, classifying it in one pass,
instead of owning it again.

**Acceptance.** The dependent rows above ≤ 0.5 ms at N = 10 000 with identical undo/redo results;
the 1000-row subtree write with history ≤ 0.6× of today.

### R33-07 — P3 — `persist` stringifies the whole state on every write by default

**Mechanism.** Without `coalesce`, `persist` subscribes `write` directly (`Tooling/persist.ts:70-71`),
and every write runs `JSON.stringify` over the whole store (`:59`). Writes outside a transaction — a
drag, a stream, a loop of `update` calls — each pay O(state).

**Probe.** 10 000 rows, in-memory storage, 50 one-field writes in one task: 218.1 ms by default,
6.1 ms with `coalesce: true` (36×).

**Recommendation.** Coalesce by default (one stringify per microtask; the disposer already flushes a
pending write) and keep `coalesce: false` for callers that need storage updated before the writing
call returns. Breaking for the engine's own tests that read storage synchronously.

**Acceptance.** The probe at ≤ 10 ms by default; storage holds the latest state after the microtask
and after dispose.

### R33-08 — P3 — superseded lookup members and helpers keep the internal grammar public

R16-10 declared the path grammar internal, and R16-10(4) replaced the cache's lookup members with
`resolve(args)`. The model's own comment says the split "existed only so a caller already holding the
key (`pathOfKey`, `getEntryByKey`) would not re-serialize `args` to get it, which `resolve` no longer
requires anyone to do" (`Models/Resource.ts:88-91`). Yet:

- `ResourceCache.keyOf`, `pathOf`, `pathOfKey` and `getEntryByKey` stay public (`ResourceCache.ts:232`,
  `:269`, `:280`, `:300`); `pathOf` and `pathOfKey` return path strings. None is in the README.
- `encodeCacheKey` is exported (`index.ts:36`) though the engine never calls it (the cache escapes its
  own JSON); `getInitialCacheEntry` is exported (`:37`). Neither is in the README export table.
- `Computed.getSnapshotVersion()` (`Computed.ts:127`) is an internal render-to-subscription token read
  by duck typing (`getComputedSnapshotVersion.ts:4-6`) and not part of `IComputed` — the shape R30-06
  and R32-07 moved behind the `Symbol.for` protocol for `extend`, `hasDriftSince` and `notifyWrites`.

**Recommendation.** Make the four cache members protected (keep `resolve` and `getEntry`), stop
exporting `encodeCacheKey` and `getInitialCacheEntry`, and move the snapshot version behind the
internal symbol protocol. Breaking only for undocumented use; tests that call these members go
through a subclass or `resolve`.

**Acceptance.** A type-level surface test without these members; the export pin updated; the
cross-copy hook and computed suites green.

## Not findings

- Replacing the per-call `WeakMap` ledgers in `sameSelection`, `detachOpaque` and `cloneOwnedGraph`
  with `Map`: no consistent difference on 10k plain rows (compare 11.1–11.3 against 11.3–12.9 ms,
  detach 5.2–7.0 against 5.6–6.4 ms, owned copy 19.5–24.5 against 19.0–21.3 ms).
- Array iteration through a read view: the `has` trap adds little (`map` 12.1–15.7 ms against an index
  loop 11.1–12.2 ms at 10k rows); the per-element `get` trap and the recorder dominate, about 1.1 µs
  per row read.
- `reportLiveViewEscape` walks every `connectSelection` result a second time — development only.
- `ResourceCarburetor` and `ResourceCache` overlap (two status models, duplicated private
  `describeError` and superseded-error helpers), but their semantics differ (the single slot aborts on
  new arguments and keeps its status at the root); no cost was measured.

## Known limits not re-reported

R5-07: `connectSelection` runs its selector and comparison on every call (R33-02's
identical-live-result shortcut would remove the comparison). R30: the alias answer cache with two
roots; the R30-02 read-tree gates remain unconfirmed. R31: mixed active readonly `forgetAll`; cyclic
key working sets above the memo budget. R32: a fresh large container assigned to a new key is walked
once; the read-view rolling-window gate.

## Recommended order

1. R33-01 — one condition, then the view-free walk.
2. R33-02 together with R33-03 — the matched-version protocol serves both; projection B alone already
   removes most of the hook cost.
3. R33-04 — an internal hatch, local to two walks.
4. R33-05 — local to `Computed`.
5. R33-06 — patch folding, then the single owned copy.
6. R33-07, R33-08 — API decisions.

## Reproduction recipes

Each recipe runs against `dist/esm-prod` with `NODE_ENV=production`;
`class S extends Carburetor { run(fn) { this.update(fn); } }`.

- R33-01: 10 000 rows; `c = computed(read => read(s).rows)`; `c.subscribe(() => { void c.get()[5].title; })`;
  `void c.get()[5].title`; time `s.run(d => { d.rows[5].title = 'x' + i; })`; count
  `s.subscriberIndex.readsById.get(c.uid).size`. Projection: in `announceIsUnchanged.mjs`, evaluate the
  `containsExoticValue` term only when the live term is false.
- R33-02: JSDOM and `createRoot`; `List` calls `useCarburetorValue(s, d => d.rows)` inline, or with a
  module-level selector; the parent re-renders through `useState`; time `flushSync(() => bump())` with
  and without a preceding `s.run(d => { d.draft = … })`.
- R33-03: 10 000 items; `open = computed(read => …count…)`; `open.subscribe(() => {})`; time `open.get()`
  after each `s.run(d => { d.draft = 'x' + i; })`.
- R33-04: `sameSelection` and `detachOpaque` from `dist/esm-prod/Carburetor/...` on `view.rows` of a
  persistent `s.read(...)` view against the detached snapshot.
- R33-05: `computed(read => read(s).items.filter(r => !r.done && r.title !== '').map(r => r.id),
  {equals: shallowEqual})`; subscribe; `a = get()`; edit an open item's title; `get() !== a` with no
  announcement.
- R33-06: `new CarburetorHistory(s)`; time `s.run(d => { d.docs[k] = {id: i}; d.docs[k].id = -i; })`
  at 1 000 and 10 000 rows; compare the identity of `history.baseline.rows` before and after.
- R33-07: `persist(s, {key, storage})` over an in-memory storage; 50 × `s.run(d => { d.rows[i].done = true; })`,
  then `await Promise.resolve()`; again with `coalesce: true`.
- R33-08: `import {encodeCacheKey, getInitialCacheEntry} from 'react-carburetor'` resolves;
  `new ResourceCache(loader).pathOf(1)` returns `'entries.1'`.

## Resolution

Implemented one commit per group: `e856cd6` (R33-01, R33-05), `ab9424b` (R33-03), `51ed6d1` (R33-02),
`3e5fa69` (R33-06), `fe5754c` (R33-04), `4da99c4` (R33-07, R33-08; breaking).

Full suite on the committed tree: 166 files, 1660 tests. One failure, `__tests__/Demo/ToolingFeatures.test.tsx`
("the filter is restored from storage and written back on change"): it read storage synchronously after a click,
which R33-07 deliberately changed. The test now awaits a flush; the file passes. Typecheck and layout checks pass.

| ID | Status | Evidence |
| --- | --- | --- |
| R33-01 | fixed | The live computed result is no longer walked per settle. Agent benchmark 1802 ms -> 0.098 ms at 10k; its first version was invalid (baseline == after) and the figure comes from the corrected run. |
| R33-02 | fixed | Own probe: inline-selector render 417-476 ms -> 6-15 ms; with a write 244-527 ms -> 31-37 ms; identical output and 6 renders. |
| R33-03 | fixed | Own probe: 7.49 ms -> 0.0015 ms per get after an unrelated write. The agent's benchmark showed baseline == after and does not demonstrate this. |
| R33-04 | fixed | Agent-reported 2.19x / 2.94x on selection compare / detach; not re-measured by me. |
| R33-05 | fixed | Behaviour covered by tests (`equals` keeps the announced reference). |
| R33-06 | partly | Dependent patches: 50-72 ms -> 0.05-0.10 ms, undo/redo checked. The subtree-write-with-history gate was **not met**: 0.67x against the 0.6x target. The remaining copies are in `createWriteProxy` / `clonePatchValue`; an agent rewrite of those was rejected (public export, R32-08 regression, aliasing risk). |
| R33-07 | fixed (breaking) | `persist` coalesces by default; `coalesce: false` keeps the synchronous path. 2.98 ms vs 218 ms for the 50-write recipe. |
| R33-08 | fixed (breaking) | `keyOf`/`pathOf`/`pathOfKey`/`getEntryByKey` protected; `encodeCacheKey`, `getInitialCacheEntry`, `Computed.getSnapshotVersion` left the public surface (snapshot version behind a `Symbol.for` protocol). |

Decisions taken for the user under the standing "best solution, breaking the API is fine": R33-07 default flip and
R33-08 surface reduction.

Not verified in this round: React 18 projection, consumer matrix, and a baseline-vs-after rerun of the derived and
drift agent benchmarks (both showed baseline == after and should be fixed or removed).
