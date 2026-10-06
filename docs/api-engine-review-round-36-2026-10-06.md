# API and engine review — round 36 — 2026-10-06

## Verdict

Base: `691e2f3` (the code of `f38782a`, round 35 integrated; the checkpoint commit on top changes only
docs), measured through its own production ESM build (`dist/esm-prod`, rebuilt from that tree). Eight
findings: two P1, four P2, two P3. Findings and recorded limits of rounds 30–35 are not re-reported,
with two marked exceptions: R36-01 includes the walk of R5-07, and R36-06 re-raises the positional
matching R34-02 kept, now with a measurement.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R36-01 | P1 | Selections / O | Hook, `connectSelection` and `watch` selections that return a live list are re-walked through the read proxies on every related write (`connectSelection` on every render, even without a write). The walk rebuilds a read set that has not changed. A one-field edit costs 7 / 67–72 / 442–499 ms at 1k / 10k / 50k rows |
| R36-02 | P1 | Class API / renders | A class component cannot depend on a value derived from a shared path without re-rendering on every write to that path. Moving a selection over 5 000 rows re-renders 5 000 rows, through `connectSelection` too; the hooks bridge renders 2 |
| R36-03 | P2 | Drift / O | The constant-time drift answer only says "no" and is lost at every write-log reset. After one unrelated bulk write every observed computed recomputes and every hook re-walks its selection: 90–98 ms instead of 0.5 ms at 10k rows. Every related write also walks the log to rediscover a "yes" the notification already established (8–10 ms of a 90 ms write) |
| R36-04 | P2 | History / O | With history attached, every `setData`, `restore` and `fromJSON` becomes a whole-state snapshot entry, however small the diff. For a one-leaf change at 10k rows: 16.7 ms instead of 2.8 ms, 631 KB kept per entry, undo 36 ms instead of 0.6 ms |
| R36-05 | P2 | Diff / renders | The 2 000-path diff threshold is absolute. Past it a replacement wakes every reader of the replaced branch, and at the root every subscriber of the store. Changing 2 010 of 10 000 row titles re-renders 10 000 rows plus unrelated components (1 990 changed: 1 990 rows) |
| R36-06 | P2 | Selections / renders | A selected list matches members by position (kept by R34-02). Inserting one row at the top re-renders every `React.memo` row (2 001 of 2 001); moving one row re-renders 2 000 |
| R36-07 | P3 | Components / allocations | The props gate `shallowEqual` allocates two key arrays and a closure per child per parent render: 1.6–2.0 ms per 10 000 checks, against 0.9–1.0 ms allocation-free |
| R36-08 | P3 | API docs | README "Derived values" says a title edit recomputes `activeCount`; it recomputes nothing. The caveat "undo/redo records patches — O(changed values)" does not hold for `setData`/`restore`/`fromJSON` |

Fix R36-03 first: one condition, and it also removes the drift fallout of R36-05. R36-01 is the
largest per-edit latency a hooks list meets (and, through `connectSelection`, a class list per render).
R36-02 is the largest render count a class list meets for an everyday interaction: selection, hover,
the row being edited.

## Method and evidence boundaries

- Read at `691e2f3`: the store (notification, drift protocol, write log, subscriber index, diff and
  restore paths, install/emit boundaries), both proxies and the native facades, the class component
  (attempts, commit alignment, `connect`/`connectSelection`, effects, props gate), both hooks, `watch`,
  the selection reconcile, computed recompute/freshness/settlement, history, persist, DevTools,
  scope, the resource cache's read path and the README.
- Every finding was reproduced through the built package's public API (subclassing `Carburetor` for the
  protected `update`; components rendered with React 19.3.0 `createRoot` + `flushSync` in JSDOM
  30.0.1). Node v24.12.0, `NODE_ENV=production`.
- Counters (renders, recomputes, selector runs, write-log consultations, wakes, entry kinds, rendered
  text, final state) are exact and agreed across runs. Timings are either one operation or the median
  of up to 40 repetitions inside one process, 1–3 processes per configuration, given as a range where
  processes differed. The machine
  was shared and isolated samples were off by up to 4× (for example one 880 ms sample against
  113 ms); those were excluded and are named where it matters. Only exact counters and differences
  of about 2× and more are claimed.
- Projections patched throwaway copies of `dist/esm-prod`. They show the size of the available win,
  not a finished implementation, and each was checked for identical counters and output on its probe.
- CPU profiles (`--cpu-prof`) are cited where they locate the cost.
- No product source, test, dependency or tracked generated file was changed. Probes and patched builds
  live in the ignored `worktrees/r36-probes/`; only this report is committed. File references are
  relative to `lib/src/Carburetor/` (and `lib/src/` for `Interop/`).

## Findings

### R36-01 — P1 — a selection that returns a live list is walked whole on every related write

**Mechanism.** All three selection consumers detach through `reconcileSelection`. It walks the
selected value through its read proxies and reads every leaf, both to compare it with the previous
snapshot and to record the read set:

1. **Hook.** After any write that concerns the selection, `getSnapshot` runs the selector into a fresh
   `Set` (`Interop/useCarburetorValue.ts:242`) and reconciles the whole selection (`:273-275`). The
   commit's `install` then compares the fresh set with the filed one, O(read set), only to adopt the
   filed one back (`:157-166`). The R33-02/R34-01 shortcuts apply only while no related write has
   landed.
2. **Class `connectSelection`.** It reconciles on every call (`Component/AntiHookComponent/Reads.tsx:168-184`),
   so on every render, with or without a write (R5-07), because the render attempt has to re-record
   the reads.
3. **`watch`.** It reconciles on every wake (`Store/Tracking/Observation/watchSelection.ts:58-73`).

So a one-field edit of one row costs a walk of every row through the proxy traps, a new read set of
every leaf path, and an O(read set) comparison. The result is a snapshot that differs in one row and a
read set that does not differ at all. Each walk also allocates three `WeakMap`s and a `WeakSet` and
files two ledger entries per container (`Store/Utils/Selection/reconcileSelection.ts:66-69`, `:590-598`).

**Probe.** Rows `{id, title, done}`. A component renders the selection's length (a trivial render, so
the cost is the selection itself); 9–15 one-field writes to different rows.

| Consumer | 1 000 rows | 10 000 rows | 50 000 rows |
|---|---:|---:|---:|
| hook `useCarburetorValue(s, d => d.items)`, one related write | 7.0 ms | 66.9–72.2 ms | 441.7–498.9 ms |
| `connectSelection(s, d => d.items)`, parent render, no write at all | 5.4 ms | 70.3 ms | — |
| `connectSelection`, one related write | 5.7 ms | 64.8 ms | — |
| `watch(d => d.items, …)`, one related write | 3.7 ms | 68.9 ms | — |

Render counts (16) and rendered text are identical across runs. CPU profile of the hook at 50k rows:

- recording into the fresh read set: 18.6% self (the recorder closure);
- the reconcile walkers: ~23%;
- read-proxy traps (`get`, `getOwnPropertyDescriptor`, `branchMarker`, `childPath`, cache lookup): ~17%;
- `install`'s `sameReads`: 6%;
- detach helpers: ~4%.

**Recommendation.**

1. **Same live result, no related write.** Reuse the snapshot and the filed read set. The hook already
   does this. The class path should adopt the connection's filed set into the attempt entry instead of
   re-walking: the connection belongs to this one selection, so its attempt set is exactly the
   selector's own reads plus the previous walk's.
2. **Same live result, related write.** Patch the previous snapshot along the written paths under the
   selection's root instead of walking it:
   - the write log already holds every path written since the entry's version (`WriteLog.last`);
   - copy the spine from the snapshot root to each changed path;
   - re-detach only the changed subtree, through the view, so that leaves new to the selection extend
     the filed set through `CARBURETOR_EXTEND`;
   - treat a `~k` or `length` path as a shallow reconcile of that container.

   Fall back to the full walk when:
   - the log cannot enumerate the changes (a watermark or wildcard since the version);
   - the previous walk saw a shared reference (its ledger met a raw object twice);
   - the change is inside a `Map`/`Set`/`Date` member.
3. **Where the fallback runs, walk raw targets, not views,** and record only the leaves new to the
   selection. R33-04's reference rows show the gap: at 10k rows a plain-data compare costs 10–21 ms
   and a detach 4–11 ms, against 181–210 and 135–212 ms through views.

**Acceptance.**

- Hook, one related one-field write: ≤ 1 ms at 10k rows and ≤ 3 ms at 50k.
- `connectSelection` parent render without writes: ≤ 1 ms at 10k.
- Render counts and text identical.
- A row pushed after the snapshot and edited later still updates the consumer.
- R34-02's differential fuzz and the topology, cycle, sparse and Date/Map/Set suites stay green with
  the fast path enabled.

### R36-02 — P1 — the class API cannot depend on a derived value without re-rendering on its inputs

**Mechanism.** A class component subscribes to the paths its render read and re-renders on any write to
them (`onCarburetorUpdate` → `forceUpdate`, `Component/AntiHookComponent/Subscriptions.tsx:34-36`,
subscribed for every slot at `:261`). A row that renders `selectedId === this.props.id` reads the
shared `selectedId`. Moving the selection therefore wakes every row, and each re-renders only to find
its boolean unchanged.

`connectSelection` does not help. It stabilises the identity handed to children, but the owner is
still woken and re-rendered by the connection's subscription; the selector runs in render.

The hooks bridge avoids this: `useSyncExternalStore` re-runs the selector at notification time, and
React renders only when the result changed. In the class API the only gate is one computed per row
(`computed(read => read(s).selectedId === id)` with `useComputed`). An observed computed costs 2.8 KB,
so 13.5 MB for 5 000 rows.

**Probe.** 5 000 rows; each row renders its title plus an `on` class for `selectedId === id`; nine
selection moves.

| The row reads the selection through | Row renders per move | Per move |
|---|---:|---:|
| `useCarburetor(s).selectedId === id` | 5 000 | 26.6–38.5 ms |
| `connectSelection(s, d => d.selectedId === id)` | 5 000 | 35.2–51.5 ms |
| per-row `computed` + `useComputed` | 2 | 24.3–29.1 ms, +2.8 KB per row |
| `watch(d => d.selectedId === id)` from `componentDidMount`, then `forceUpdate` (a user-land gate) | 2 | 12.5–19.6 ms |
| hook `useCarburetorValue(s, d => d.selectedId === id)` in a `React.memo` row | 2 | 16.6–21.7 ms |

The rendered selection is identical in every variant. These rows are trivial; a real row multiplies the
cost of the 5 000 renders, not the gated variants.

**Recommendation.** Gate `connectSelection` at notification time:

- give each connection its own subscription callback (`alignSubscription` subscribes `this.onCarburetorUpdate` for every slot today);
- for a selection connection, the callback re-runs the selector against the committed props and state
  through a scratch recorder, outside any render attempt, and reconciles with the last snapshot;
- it re-subscribes when the read set moved (the `watchSelection` rule);
- it calls `forceUpdate` only when the snapshot identity changed.

The render-time run stays as it is, or uses R36-01's reuse. No API changes, and the README sentence
"the selector runs on every render" stays true. A selection becomes the documented class answer to
"a derived value per row", at no per-row computed cost.

**Acceptance.**

- The probe runs at 2 row renders per move with `connectSelection`.
- A selector that switches branches on a later write still re-subscribes.
- A selector that reads props sees the committed props.
- StrictMode replayed mounts and Suspense hide/reveal keep the subscription (the existing connection suites).
- The owner still re-renders when its selection changes.

### R36-03 — P2 — the constant-time drift answer is one-sided and lost at every write-log reset

**Mechanism.** `CARBURETOR_HAS_DRIFT` (`Store/Carburetor.ts:153-163`) answers `false` in O(1) for a read
set the store filed when three things hold:

- `record.matchedVersion <= baseline` — no notification matched it since;
- `growthVersion <= baseline`;
- every emit has been notified.

Otherwise it asks the write log, O(read set × depth). Two parts of the rule make it fall back when the
record already holds the exact answer:

1. **The log conditions.** `baseline >= writeLog.getWatermark()` and `getWildcardVersion() <= baseline`
   (`:156-157`) concern only the log, not the record. After any reset — more than 8 192 distinct
   written paths plus ancestors, e.g. one bulk write touching ~4 000 rows, or a session that touches
   ~4 000 distinct rows — every filed consumer falls back. The log answers "cannot tell", that is
   `true`, so every observed computed recomputes and every hook re-walks its selection once, although
   nothing they read changed. A wildcard write is matched at notification anyway
   (`SubscriberIndex.match` returns every id), so `matchedVersion` already covers it.
2. **A known `true`.** When the subscription was matched since the baseline, the answer is known to be
   `true`. Yet the log is walked to rediscover it, on every related write and by every consumer, before
   the recompute or re-walk that answer triggers.

**Probe 1 — reset.** 10 000 items; an observed computed counting `!done`; a hook selecting
`d => d.items`; one unrelated bulk write `d.meta.k1 … k9000`; then `get()` and a hook re-render.

| | Recomputes | Selector runs | Log consultations | Time |
|---|---:|---:|---:|---:|
| current | 1 | 1 (with the full walk) | 2 | 90.4–98.1 ms |
| projection | 0 | 0 | 0 | 0.52–0.65 ms |

**Probe 2 — related writes.** The same consumers; 21 one-row `done` toggles. Current: 2 log
consultations per write, 8.1–10.0 ms spent in the log out of 88–99 ms. Projection: 0 consultations,
71–87 ms. Wakes, values and rendered text are identical.

**Projection.** The O(1) branch answers both ways:
`record && record.reads === reads && baseline >= record.growthVersion && notifiedVersion >= version
? record.matchedVersion > baseline : writeLog.matches(baseline, reads)`.

There is one conservative difference. When a transaction's merged notification straddles a baseline
taken inside that transaction, the answer can be `true` where the log would say `false`. The cost is
an extra recompute, never a missed one.

**Acceptance.**

- Both probes reach 0 log consultations.
- The freshness suites (transaction, throttle, reentrant read, `DriftShortcut`) stay green.
- New tests: a reset followed by `get()` causes no recompute; a matched subscription answers `true`
  without touching the log.

### R36-04 — P2 — history copies the whole state for every `setData`, `restore` and `fromJSON`

**Mechanism.**

- `CarburetorHistory.buildEntry` (`Tooling/CarburetorHistory.ts:476-480`) turns every publication whose
  origin is not `'mutation'` into a snapshot entry. `capture()` owns a full copy of the state,
  `sameHistoryGraph` compares that copy whole with the baseline, and the entry keeps it: one full copy
  per entry, since consecutive entries share endpoints.
- `setData` and `fromJSON` also report `PATCH_OPAQUE` (`Store/Transaction/installState.ts:64-73`),
  although `diffPaths` has already found the exact leaves (`:37`) and accepts a patch collector.
- `restore` applies its diff through the draft, so history receives exact leaf patches — and then
  discards them because the fact's origin is `'restore'`.
- Undoing such an entry installs a whole owned state through `restore` again.

**Probe.** 10 000 rows, history attached (limit 1 000), 40 one-leaf changes; inputs are prepared outside
the timed window.

| Write form | Without history | With history | Kept per entry | Undo |
|---|---:|---:|---:|---:|
| `update` | 0.009 ms | 0.009 ms | ~0 | 1.06 ms (patches) |
| `setData(copy with one leaf changed)` | 2.77 ms | 16.66 ms | 631 KB | 35.9 ms (snapshot) |
| `restore(snapshot with one leaf changed)` | 3.09 ms | 17.89 ms | 642 KB | 36.5 ms (snapshot) |

Wakes (41) and final state are identical.

**Projection (restore only).** Accept a `'restore'` fact with representation `'public'` as a patches
entry when no opaque patch arrived:

- 5.31 ms per restore, against 18.46 ms in the same run;
- 24 KB kept per entry; a run without history keeps 22 KB;
- undo 0.62 ms, against 39.6 ms;
- identical wakes and final state.

**Recommendation.**

1. `buildEntry`: a `'replacement'` or `'restore'` fact with representation `'public'` and only concrete
   patches becomes a patches entry. Operational, history-owned and mixed facts keep the snapshot path,
   so resource stores and replay ownership are unchanged.
2. `installState`: when a patch listener is attached and not opaque, give `diffPaths` a bounded
   collector and deliver its leaf patches instead of `PATCH_OPAQUE`. The threshold fallback (one root
   patch) stays opaque.
3. After that, the README caveat "undo/redo records patches — O(changed values)" holds for these
   forms too (see R36-08).

**Acceptance.**

- With history, both forms take at most 2× their no-history time.
- At most 30 KB kept per entry; undo ≤ 1 ms.
- The history suites stay green: coalesced, throttled, branching, readonly, native graphs, resource time travel.

### R36-05 — P2 — past 2 000 changed leaves a replacement wakes every reader of the replaced branch, at the root every subscriber

**Mechanism.** `diffPaths` gives up once it has recorded `DIFF_PATH_THRESHOLD` = 2 000 paths
(`Store/Paths/Diff/diffPaths.ts:16-22`, `:452-465`) and records the base path instead. For a root
(`setData`, `fromJSON`, the root fallback of `restore`) that base path is the wildcard. The bound is
absolute: it depends neither on the size of the replaced branch nor on how many subscribers it will
wake. Past it:

- every subscriber below the base path wakes — at the root, every subscriber of the store, including
  components that read unrelated branches — and every computed over the store recomputes;
- the write log records a wildcard, so every drift answer with an older baseline falls back (R36-03);
- with history attached, the single fallback patch carries `clonePatchValue` copies of the whole old
  and the whole new branch (`:464`), which history then owns once more;
- the aborted walk is wasted, and `normalizeAssigned` walks the remainder again (`:463`).

`restore` goes further. It applies the first 2 000 differences through the draft before `applyDiff`
gives up, then deep-copies the whole snapshot and diffs it again (`Store/Carburetor.ts:279-281`). It
stays precise up to ~4 000 differences and turns coarse beyond that.

**Probe.** 10 000 rows. A header reads `user.name`, `filter` and a computed `doneCount`; a list reads
`rows.length`; one row component per index. One write changes K row titles.

| Write | K = 1 990 | K = 2 010 | K = 5 000 |
|---|---:|---:|---:|
| `setData(copy)`: row / other renders / recomputes | 1 990 / 0 / 0 | 10 000 / 2 / 1 | 10 000 / 2 / 1 |
| `setData(copy)`: time | 52.5 ms | 163.7 ms | 169–240 ms (one 540 ms sample excluded) |
| `d.rows = next.rows`: row / other renders / recomputes | 1 990 / 0 / 0 | 10 000 / 1 / 1 | 10 000 / 1 / 1 |
| `restore(copy)`: row renders | 1 990 | 2 010 | 10 000 |

**Projection (threshold lifted).**

- `setData`, K = 5 000: 5 000 / 0 / 0 renders/recomputes, 113 ms.
- `setData`, K = 10 000: 10 000 / 0 / 0, 180–329 ms, against 166–185 ms today.
- `d.rows = …`, K = 5 000: 111–133 ms, against 157–161 ms today.
- Engine only (50 000 rows, two subscribers):
  - K = 2 500: 24–30 ms precise, against 40–41 ms through the fallback;
  - K = 50 000: 75–82 ms precise, against 17–24 ms — precise attribution costs about 1.1 µs per
    recorded leaf.

**Recommendation.**

1. Never collapse a same-kind root to the wildcard. On overflow, record the top-level keys whose values
   differ, plus `~k` if the key set changed; unrelated branches stay asleep.
2. Make the bound relative. Give up only when the recorded paths exceed both a floor (2 000) and a fixed
   fraction, for example half, of the leaves visited in the replaced branch. A near-total change still
   takes the cheap coarse answer; a partial change of a large branch stays precise.
3. Cap patch collection separately, so history can fall back to an opaque entry without coarsening path
   attribution. Give `applyDiff`'s budget the same rule instead of applying 2 000 writes and then
   replacing the root.

**Acceptance.**

- At 10k rows, K = 2 010 and K = 5 000 wake exactly the changed rows and nobody else.
- 50 000 fully changed rows take at most 1.5× today's time.
- The diff, restore, history and threshold-fallback suites stay green.

### R36-06 — P2 — inserting at the top of a selected list re-renders every memo row (R34-02's positional matching)

This is a recorded R34-02 decision (members are matched by position), re-raised with its cost.

**Mechanism.** `reconcileArray` (`Store/Utils/Selection/reconcileSelection.ts:289-350`) pairs
`previous[i]` with `live[i]`. A moved element meets the previous copy of another raw object, the pair
maps report a topology mismatch, and the element is detached fresh (`:108-116`).

**Probe.** `useCarburetorValue(s, d => d.rows)` rendered as `React.memo` rows, 2 000 rows:

- `unshift` of one row: 2 001 row renders (43 ms);
- moving one row from the end to position 1: 2 000 row renders (62 ms).

Identity matching would render 1 row in each case, because a moved row's content is unchanged.
Inserting at the top (newest first) and reordering by drag are the commonest list edits after a field
edit.

**Recommendation.** Keep the previous walk's raw→copy ledger (the `copies` `WeakMap`, already keyed by
raw targets) on the snapshot owner: the hook entry, the selection closure, the watch. When
`previous[i]` belongs to another raw object, reconcile `live[i]` against the previous copy of its own
raw object. "One raw object, one copy" (R5-01) still holds. This shares its bookkeeping with R36-01's
patching.

**Acceptance.**

- The probe renders 1 row for the insert and 1 for the move.
- Moved and duplicated references keep their topology (R34-02's fuzz, extended with moves).
- The cost is one retained `WeakMap` per snapshot.

### R36-07 — P3 — the props gate allocates on every child of every parent render

`shouldComponentUpdate` (`Component/AntiHookComponent/Foundation.tsx:198-200`) calls `shallowEqual`.
For objects, `shallowEqual` builds `Object.keys` of both sides and an `every` closure
(`Component/shallowEqual.ts:43-51`). A list parent that re-renders on a push therefore allocates three
objects per row. 10 000 comparisons of three-key props objects take 1.62–1.99 ms, against
0.86–1.03 ms for an equivalent loop with no allocation: own enumerable keys counted on both sides,
`in` plus `Object.is` per key. Small next to React's own reconcile of 10 000 children, but free.

**Acceptance.** Same verdicts (the props-gate suites); no allocation per comparison.

### R36-08 — P3 — README statements that no longer hold

- **"Derived values"** (`README.md:358`) says "Editing a todo's title invalidates `items.<id>`, so the
  computed recomputes — but the count comes out the same". Since branch markers (R16-03), a title edit
  invalidates nothing that `activeCount` read. Measured: 0 recomputes after a title edit, 1 after a
  `done` edit, 1 wake.
- **Caveat** (`README.md:1005`): "Ordinary plain-tree undo/redo records patches — O(changed values), not
  O(state)." This is false for `setData`/`restore`/`fromJSON` until R36-04 lands.
- **"Replacements are diffed"** (`README.md:275-279`): it does not say that a root replacement past the
  threshold wakes every subscriber (R36-05).

**Acceptance.** The text describes the behaviour; no code change.

## Not findings

- **`connect()` against `useCarburetor`.** The facade adds a dispatch only for reads at the root. One
  render reading ~37 000 tracked paths at 10k rows costs 20.2–24.7 ms through `connect` and
  18.5–26.4 ms through `useCarburetor`, against 0.18–0.22 ms on plain data.
- **Per-row engine cost.** Mounting 5 000 rows (one subscribed leaf each), measured against a plain
  `React.Component` (4.2 KB, 19 µs per row): a bare `AntiHookComponent` adds 0.7 KB and ~5 µs;
  `useCarburetor` adds another 2.3 KB and ~10 µs; `connect` costs 0.2 KB more than `useCarburetor`. Each
  component builds its own read proxy tree: 1 261 B per row, against 640 B per row on one shared tree.
  A shared tree would need a process-wide "current recorder" and would change what a read outside
  render records, so it is not proposed. The profile of the mount is dominated by React and JSDOM;
  the engine functions are at 1.4% and below.
- **Class commits rebuild and compare the read set** (R34's non-finding, now measured at scale). In a
  render that reads 183 000 paths, filling the set is 18.6% of the samples and the commit's `sameReads`
  5.6%. At the sizes components actually read (a 10 000-id list parent reads ~10 000 paths), it stays
  within ~5% of the render, next to React reconciling the children.
- **`persist`** stringifies the whole store once per microtask burst, by contract. A time-based
  throttle would be new API, not a fix.
- **`connectDevTools`** copies the changed store per action. The extension serializes the whole state
  anyway, and it is development tooling.
- **The native alias index** is rebuilt over the whole state after a topological write when a
  `Map`/`Set` member exposes plain objects (R19 design, hazard H19). It is not reachable from plain state.
- **`CarburetorHistory.past.shift()`** is O(limit), negligible at the default of 50.

## Known limits not re-reported

- R33-06: the subtree write with history stays at 0.67× against the 0.6× gate.
- R34-04: one-leaf `restore` is borderline at 2× `snapshot()`.
- R30: the alias answer cache with two roots; the R30-02 read-tree gates.
- R31: mixed active readonly `forgetAll`; cyclic key working sets above the memo budget.
- R32: a fresh large container assigned to a new key is walked once; the read-view rolling-window gate.
- R35: R19-01 has no gate failing on its own parent build; heap gates depend on the Node/V8 version.

## Recommended order

1. **R36-03** — one condition; it also stops the drift fallout of R36-05 and R36-01's fallback.
2. **R36-01** — first the class path's adoption of the filed read set (small), then path-guided
   patching for related writes.
3. **R36-02** — a per-connection callback with the notification-time selector.
4. **R36-04** — the history entry rule plus patches from `installState`.
5. **R36-05**, **R36-06**.
6. **R36-07**, **R36-08**.

## Measurement tooling

The probes of this round live in the ignored `worktrees/r36-probes/`. They load the build under test
from `DIST_ROOT` through `perf/harness/lib.mjs`, and each ends with a correctness tail: rendered text,
final state or values.

| Probe | Finding |
|---|---|
| `hook-walk.mjs` | R36-01 |
| `class-selection-walk.mjs` | R36-01 |
| `selection-rows.mjs` | R36-02 |
| `log-overflow.mjs` | R36-03 |
| `matched-drift.mjs` | R36-03 |
| `history-setdata.mjs` | R36-04 |
| `diff-cliff.mjs` | R36-05 |
| `diff-cost.mjs` | R36-05 |
| `hook-unshift.mjs` | R36-06 |
| `shallow.mjs` | R36-07 |
| `readme-derived.mjs` | R36-08 |
| `rows-mount.mjs` | not findings |
| `read-cost.mjs` | not findings |
| `tree-memory.mjs` | not findings |
| `computed-memory.mjs` | not findings |

The patched builds are `dist-exactdrift`, `dist-nowatermark`, `dist-nothreshold` and `dist-restorepatches`.

When a finding is fixed, its probe becomes a `perf/` scenario whose gates are its exact counters, so
each gate fails on this round's build by mechanism:

- R36-01: selector walks and read-set size per related write;
- R36-02: row renders per move;
- R36-03: write-log consultations, through `countWriteLogMatches`;
- R36-04: entry kind and KB kept per entry;
- R36-05: renders per K;
- R36-06: memo renders per insert.

## Reproduction recipes

Every recipe runs against `dist/esm-prod` with `NODE_ENV=production`, using
`class S extends Carburetor { run(fn) { this.update(fn); } }`.

- **R36-01.** JSDOM with `createRoot`. A component renders
  `useCarburetorValue(s, d => d.items).length`. Time `flushSync(() => s.run(d => { d.items[i].title = 'x'; }))`
  at 1k, 10k and 50k rows. For the class path, render `this.items = this.connectSelection(s, d => d.items)`
  and time a parent `setState` with no write. For `watch`, time `s.run` with `s.watch(d => d.items, cb)`
  attached.
- **R36-02.** 5 000 `AntiHookComponent` rows rendering `d.selectedId === this.props.id` through
  `useCarburetor` or `connectSelection`. Count row renders for `s.run(d => { d.selectedId = 'r7'; })`.
  Compare with per-row `computed` + `useComputed`, and with `useCarburetorValue` in `React.memo` rows.
- **R36-03.** An observed `computed(read => read(s).items.filter(i => !i.done).length)` plus a hook on
  `d => d.items`. Run `s.run(d => { for (k of 1..9000) d.meta['k' + k] = k; })`, then `open.get()` and
  a re-render; count recomputes, selector runs and `s.writeLog.matches` calls. For related writes,
  time inside `writeLog.matches` while toggling `items[i].done`.
- **R36-04.** `new CarburetorHistory(s, {limit: 1000})` over 10 000 rows. Run 40 times
  `s.setData(copyWithOneLeafChanged)` or `s.restore(snapshotWithOneLeafChanged)`; time each call,
  measure the heap delta after `gc()` per entry, the kind of `history.past` entries, and one `undo()`.
- **R36-05.** 10 000 row components plus a header reading `user`, `filter` and a computed. Call
  `s.setData(copy)` with K = 1 990 / 2 010 / 5 000 changed titles; count row and other renders and
  recomputes. Repeat with `s.run(d => { d.rows = copy.rows; })` and `s.restore(copy)`.
- **R36-06.** `useCarburetorValue(s, d => d.rows)` rendered as `React.memo` rows. Count renders for
  `d.rows.unshift(row)` and for moving one row with two `splice` calls.
- **R36-07.** `shallowEqual(a, b)` on 10 000 pairs of `{id, store, index}` against an allocation-free loop.
- **R36-08.** The README's `activeCount`. Count body runs after `d.items.a1.title = …` and after
  `d.items.a1.done = true`.
