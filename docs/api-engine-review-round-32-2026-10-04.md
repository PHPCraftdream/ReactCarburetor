# API and engine review — round 32 — 2026-10-04

## Verdict

Base: `1d377b9a2e93da28fd1fca64ba1c55e703bb4d78` (round 31 integrated), measured through its own
production ESM build (`dist/esm-prod`). Eight findings: two P1, four P2, two P3. R30 and R31 findings
and their recorded known limits are not re-reported.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R32-01 | P1 | Correctness / renders | A container built from draft branches (`map`, `filter`, spread, `concat`) stores write proxies inside state; later reads publish phantom writes |
| R32-02 | P1 | Derived / O | An outer computed over K computeds that share one store recomputes in O(K²·M): 488 ms per write at K = 1600 (2.9 ms with distinct stores) |
| R32-03 | P2 | Writes / O / allocations | Positional array methods through `draft` field-diff every shifted element: `splice(0, 1)` on 10k rows records 49 998 paths in 167–229 ms; the write log indexes 50 000 paths only to discard them |
| R32-04 | P2 | Memory | Per-handler path memos keep every key ever touched: a rolling 100-key window grows the heap by 52.5 MB per 200k keys; a `maxEntries: 50` cache grows by 12 MB per 100k loads |
| R32-05 | P2 | Writes / allocations | `diffPaths` allocates ≈ 450 B per unchanged element: a one-row `setData` on 10k rows allocates 4.5 MB; a reference-skipping walk allocates 4 KB |
| R32-06 | P2 | Reads / allocations | `Object.keys`/`for…in` through a read view wraps every value it discards: 50 ms and 2.9 MB retained for 10k keys (2 ms raw); 16.8 ms per warm pass |
| R32-07 | P3 | API | `notifyWrites` — the batch coordinator's callback — is a public store method that wakes subscribers for a write that never happened |
| R32-08 | P3 | Allocations | `deepClone` builds every plain object with `Object.create`; a literal fast path copies 10k rows ≈ 1.35× faster |

Fix R32-01 first: it is a contract violation the engine's own tests state ("a proxy must not leak into
it", `__tests__/Engine/Store/Carburetor/updates.test.ts:64`). R32-02 is the only asymptotic blow-up and
has a small, local fix. R32-05 is the cheapest broad win (every `setData`, `restore`, `fromJSON` and
branch replacement walks it).

## Method and evidence boundaries

- Read the store, both tracking proxies, the subscriber index and write log, the transaction and
  publication path, computed freshness and dependency capture, the class component layer, both hooks,
  the resource cache and the history/diff utilities at `1d377b9`.
- Every finding below was reproduced through the built package's public API (subclassing `Carburetor`
  where the protected `update` is needed). Node v24.12.0, `NODE_ENV=production`, single process.
- Counters (written paths, wakes, versions, heap after forced GC) are exact for the scenario. Wall-clock
  numbers are medians of 7–41 runs on a machine shared with an IDE language server and other sessions;
  single ratios carry roughly ±15% noise. Ratios of 10× and more are reported; small deltas are not.
- Two projections (R32-02, R32-05) used throwaway code that never touched the product tree: a patched
  copy of the built `captureLeafVersions.mjs` module, and a probe-local diff prototype. They show the
  size of the available win, not a finished implementation.
- No product source, tests, dependencies or tracked generated files were changed. Probes lived in the
  ignored `worktrees/` directory and were removed. Only this report is committed.

## Findings

### R32-01 — P1 — draft-derived containers store write proxies inside state

**Mechanism.** The write proxy unwraps only the value assigned at the top level:
`createWriteProxy.ts:236-238` (`liveViews.readTarget(value) ?? value`), then `Reflect.set(source, key,
raw)` at `:265-269`. A container *built from* draft branches — `d.rows.map(r => r)`,
`d.rows.filter(...)`, `[...d.rows, row]`, `d.rows.concat(...)`, `{...d.meta, extra: d.rows[0]}` — is a
fresh plain object whose elements are the write proxies the get trap handed out (`:196-197`). It is
stored as is.

From then on state holds `Proxy` objects:

- `isTrackable(proxy)` is true (its prototype is `Object.prototype`), so a read view wraps the write
  proxy (`createReadProxy.ts:266-282`). A read of an opaque field (Date, Map, class instance) through it
  runs the **write** proxy's get trap, which records a write path, reports `PATCH_OPAQUE` to history
  and invalidates the alias index (`createWriteProxy.ts:204-212`). The recorded path is published by
  the next, unrelated emit.
- The leaked proxy keeps the path it was created for. After a positional change (`filter`), a write
  through the current index also runs the stale handler, which records the old index's path.
- `getData()` hands out proxies, so identity checks against the original objects fail.
- Development's state-model check (`AliasLedger.checkState`) does not notice: the same leaks occur in
  the development build, silently.

**Probe** (production build, three rows `{id, title, tags: {a}}`):

| Pattern inside `update` | Proxies left in state |
|---|---:|
| `d.rows = d.rows.map(r => r)` | 3 |
| `d.rows = d.rows.map(r => r.id === 1 ? {...r, title: 'x'} : r)` | 3 (one nested: `rows.1.tags`) |
| `d.rows = d.rows.filter(r => r.id !== 1)` | 2 |
| `d.rows = [...d.rows, row]` | 3 |
| `d.rows = d.rows.concat([row])` | 3 |
| `d.meta = {...d.meta, extra: d.rows[0]}` | 1 |
| `d.meta.first = d.rows[0]`, `d.rows.push(d.rows[0])` (top-level values) | 0 |

Observed consequences (rows `{id, title, at: Date}`):

- After `filter`, reading `view.rows[0].at` through a `read()` view (read paths recorded: `rows.~p`,
  `rows.0.~p`, `rows.0.at`) and then an unrelated `d.other = 1` woke a `rows.0.at` subscriber once.
- After a `filter` that shifted rows, `d.rows[0].title = 'edited'` also woke a `rows.1.title` subscriber
  (the stale handler's path) — one spurious render.
- `getData().rows[2] === original` is false after `map(r => r)`; `util.types.isProxy` is true.
- With `persist` attached (it runs `JSON.stringify(store)` per write), five unrelated writes woke a
  `rows.1.at` reader four times; the raw-array control woke it zero times. The leaking assignment itself
  bumped the version (6 vs 5): diffing the stored proxies against the old rows read `at` through them.

**Recommendation.** Normalize assigned values at the write boundary: replace every engine view found
inside a newly assigned container with its raw target (the `RAW_TARGET` hatch) before it is stored.
When the previous value is a same-kind container the set trap already walks the new value with
`diffPaths`; a view is never reference-equal to the raw element, so that walk visits every leaked view
and can replace it in place at the cost of one hatch probe per visited object. Where no diff runs (new
key, kind change, `setData` of a caller-built root), walk the fresh value once — the development state
check already walks the same subtree. Make the development ledger report a view found in state.

**Acceptance.** For every pattern in the table, no `Proxy` is reachable from `getData()`, original row
identities survive `map(r => r)`, and an opaque read through a view followed by an unrelated write wakes
nobody. A positional `filter` followed by a write at the new index wakes only that index's readers.
Regression tests for each pattern in both builds.

### R32-02 — P1 — computed fan-in over one shared store is quadratic

**Mechanism.** Every recompute flattens the leaf versions of all dependencies
(`Computed.ts:317` → `recordVersions` `:399-405` → `captureLeafVersions`). When several inner computeds
read the same store, `addLeafVersion` (`Derived/Freshness/captureLeafVersions.ts:7-20`) merges their read
sets by copying the accumulated Set and adding the next one: `new Set(previous.reads)` at `:11`. With K
inner computeds of M paths each, one capture copies M + 2M + … + KM = O(K²·M) entries. Computeds
"compose" by design (README "Derived values"), and a total over per-row computeds is the natural shape.

**Probe.** K per-row computeds, each reading five fields of `store.rows[i]`; an observed outer
computed sums them; one row field changes per write.

| K | Shared store, ms/write | Distinct store per row (control) | Throwaway linear merge, ms/write |
|---:|---:|---:|---:|
| 100 | 0.83 | 0.35 | 0.43 |
| 200 | 2.02 | 0.41 | 0.86 |
| 400 | 6.01 | 0.76 | 1.53 |
| 800 | 59.0 | 1.67 | 3.46 |
| 1600 | 487.7 | 2.86 | 11.65 |

At K = 800 a sampled profile attributes 67.9% of self time to the merge in `captureLeafVersions` and
23.9% to garbage collection. Outer runs (26) and wakes (25) were identical in the patched run.

**Recommendation.** Within one capture, give each shared leaf one combined Set owned by that capture —
created on the first merge, then appended to — so every path is inserted once. Sets that belong to
dependencies or to an earlier announcement stay untouched, which is what the current copy protects.

**Acceptance.** Shared-store fan-in grows linearly in K·M: K = 1600 within ~5× of the distinct-store
control (≤ 15 ms per write on the probe), with unchanged outer runs, wakes and announcement semantics.
A regression test with K inner computeds over one store that bounds merge insertions to K·M.

### R32-03 — P2 — positional array methods through `draft` field-diff every shifted element

**Mechanism.** `splice`, `shift`, `unshift`, `reverse`, `sort` called on a draft array run their spec
algorithm through the proxy: every moved element is read through the get trap (a write proxy is minted
per element on first access, `createWriteProxy.ts:139-152`) and written back through the set trap.
Each index write replaces one row object with a *different* row object of the same kind, so the set
trap diffs them field by field (`:298-303`): F recorded paths per shifted index, instead of one. The
emit then indexes every path in the write log, which builds `last`/`under` entries for all of them
before discovering it is over capacity and clearing everything (`Store/Paths/WriteLog.ts:50-72`), and
the subscriber index walks every path's ancestors.

**Probe.** 10 000 rows of six fields; one subscriber per row reading `rows.<i>.title`:

| Operation inside `update` | ms (10k subscribers) | ms (no subscribers) | Written paths | Rows woken |
|---|---:|---:|---:|---:|
| `d.rows.splice(0, 1)` | 228.7 | 186.2 | 49 998 | 10 000 |
| `d.rows.splice(5000, 1)` | 118.7 | 87.8 | 24 998 | 5 000 |
| `d.rows.unshift(row)` | 302.7 | 218.0 | 50 002 | 10 000 |
| `d.rows.shift()` | 272.3 | 167.5 | 49 998 | 10 000 |
| `d.rows.reverse()` | 242.7 | 167.3 | 48 572 | 10 000 |
| `d.rows.sort(byRankDesc)` | 236.2 | 169.2 | 48 572 | 10 000 |
| `d.rows = rawRows.slice(1)` (control) | 8.0 | 3.4 | 1 | 10 000 |

- Profile of `splice(0, 1)` without subscribers: 35.7% in the emit (the inlined write-log indexing),
  10.7% recording paths, ≈ 17% in `diffPaths`, 6.4% subscriber matching, 7.5% GC.
- `WriteLog.record` alone for one 50 000-path emit: 28.7 ms, all of it discarded (capacity 8192;
  a 2 000-path emit costs 0.66 ms). Answers afterwards are the same as an immediate watermark.
- With a `CarburetorHistory` attached the same splice costs 296 ms and its undo 104 ms.
- Floor of the recommended shape — native `splice` on the raw array, then one index-level write per
  index whose element identity changed, plus `length` and the keys marker: 9.4 ms without subscribers
  and 38.9 ms with all 10 000 rows woken (10 002 written paths).

**Recommendation.**

1. Write log: stop indexing an emit as soon as it exceeds capacity (raise the watermark and skip the
   rest) — no behavioural change, removes ≈ 29 ms from this case.
2. Intercept the in-place reordering methods (`sort`, `reverse`, `splice`, `shift`, `unshift`,
   `copyWithin`, `fill`) on draft arrays: run them natively on the raw array with unwrapped arguments,
   compare old and new element identities per index, record an index-level path for each changed
   index plus `length`/keys marker, and report index-level patches (or the opaque fallback) to
   history. No per-element write proxies and no field diffs between different entities.
3. Decision required: index-level paths are less precise than today's field diff for a reader of a
   field that happens to be equal between neighbouring rows (`done` here), which is woken under (2).
   Shifted rows are different entities, so field-level equality between them is coincidental; the
   recommendation accepts that trade.

**Acceptance.** `splice(0, 1)` on the probe ≤ 15 ms without subscribers and ≤ 50 ms with 10 000 row
readers; written paths ≈ N + 2 instead of N·F. An oversized emit leaves the write log in the same
answering state with no per-path indexing. Existing array, history and order regressions stay green.

### R32-04 — P2 — per-handler path memos grow with every key ever touched

**Mechanism.** Each read handler memoizes `key → path` (`childPaths`) and `path → branch marker`
(`branchMarkers`), `createReadProxy.ts:123-194`; each write handler memoizes `key → path`
(`createWriteProxy.ts:68-99`). Entries are strong strings and are never removed: a deleted key's
entries stay. The draft proxy tree lives until the next root installation — `setData`, a `restore`
fallback, an operational install (`installState.ts:33`) — and read trees
live as long as their persistent view (`connect`, hooks, `computed`, `watch`) sees the same root. A
dictionary with key churn — feeds, chat messages, notifications, and the resource cache's own
`entries` — therefore grows its handler's memo forever while the live key count stays flat.

**Probe.** Add key `m<i>`, delete `m<i-100>`, 200 000 times (100 live keys):

| Keys written | Draft only, heap growth | Draft + one persistent read view |
|---:|---:|---:|
| 50 000 | +4.7 MB | +13.8 MB |
| 100 000 | +9.1 MB | +27.3 MB |
| 150 000 | +15.4 MB | +45.2 MB |
| 200 000 | +18.1 MB | +52.5 MB |

That is ≈ 90 B per key ever written in the draft tree plus ≈ 170 B per key per persistent read tree.
A `ResourceCache` with `maxEntries: 50` loading 100 000 distinct keys keeps 50 entries but grows by
4.3 / 7.5 / 10.3 / 12.1 MB at 25k / 50k / 75k / 100k loads; 10.6 MB of that is released by
`setData(getData())`, which only drops the draft proxy tree.

**Recommendation.** Bound the memos to the live key set: the write handler drops a key's memo entry in
`deleteProperty`; both handlers rebuild (clear) a memo once its size exceeds twice the source's current
own key count, checked only when the memo size crosses a doubling threshold so the check stays
amortized O(1). The branch-marker memo follows the same rule.

**Acceptance.** The rolling-window probe stays within a constant heap band (≤ 1 MB drift between 50k and
200k keys) in both columns, the bounded cache probe likewise, with no regression in the read-path
benchmarks (`readTreeRegistry`, `derivedPersistentTree`).

### R32-05 — P2 — `diffPaths` allocates per unchanged element

**Mechanism.** `walkContainer` (`Store/Paths/Diff/diffPaths.ts:38-117`) builds `Object.keys` for both
sides (array indices included), a `seen` Set of every old key, and for every key a child path
(`joinPath`) and a segments array (`[...segments, key]`) — `:95` — *before* `walk` checks
`Object.is` and returns (`:127`). An immutable update that changes one element of a large array pays
all of that per untouched element. This walk runs for `setData`, `fromJSON`, operational installs,
`restore`'s fallbacks and every same-kind branch replacement through `draft`.

**Probe.** 10 000 rows `{id, title, done}`, one row replaced:

| Operation | Time | Allocated (no GC between) |
|---|---:|---:|
| `diffPaths({rows}, {rows: next})` | 3.6–6.2 ms | 4 554 KB |
| `setData({...data, rows: next})` | 5.8 ms | 4 554 KB |
| Probe prototype: index loop for arrays, identical references skipped before any path/segment, no `seen` Set when key lists are equal | 0.04–0.05 ms | 4 KB |

The prototype produced the same changed set (`rows.5000.done`). It omits patch collection, the
threshold and hole/own-`undefined` handling, which a production version keeps — none of them needs
work per *identical* element.

**Recommendation.** Skip reference-equal children before building their path or segments; iterate
arrays by index (checking own-ness only where a value is `undefined`); compare the two key lists first
and use the `seen` Set only when they differ; build segments lazily, only for paths that are recorded
or descended into while patches are requested.

**Acceptance.** One-row `setData` on 10 000 rows ≤ 0.5 ms and ≤ 100 KB allocated with no history
attached; identical changed sets, patches and threshold behaviour across the existing diff, history and
key-order suites.

### R32-06 — P2 — key enumeration through a read view wraps every value

**Mechanism.** `Object.keys`, `for…in` and spread call the proxy's `getOwnPropertyDescriptor` trap for
every key to check enumerability. The trap wraps each trackable value (`createReadProxy.ts:363-386`) —
a proxy and handler per row, a cache entry and a memoized child path — and the engine then discards
the value. Normalized state (`byId` dictionaries) enumerated in render pays this per reader tree.

**Probe.** `byId` with 10 000 rows `{title, done}`:

| Operation | Fresh view | Retained by the view tree |
|---|---:|---:|
| raw `Object.keys(byId)` | 2.1 ms | 20 KB |
| `Object.keys(view.byId)` | 50.1 ms | 2 970 KB |
| `for (const k in view.byId)` | 39.8 ms | 2 969 KB |
| `Object.values(view.byId)` (values needed) | 48.1 ms | 4 331 KB |

Warm, with every wrapper cached: 16.8 ms per `Object.keys(view.byId)` against 1.7 ms raw.

**Recommendation.** The trap cannot tell `Object.keys` from `Object.getOwnPropertyDescriptor(view, k)`,
whose `.value` must stay a tracked view, so the wrap cannot simply be skipped. Two complementary steps:

1. Cheaper wrappers: let the handler double as the cache entry (one allocation fewer per branch) and
   move the rarely used memo fields to a lazily allocated side object.
2. Decision required: an explicit enumeration helper (for example `keysOf(view)`) that records the
   keys marker and returns the raw key array without wrapping, recommended in the README for large
   dictionaries — an API addition, which is why it needs a decision.

**Acceptance.** (1) cuts retained bytes per wrapped branch by ≥ 25% on this probe; (2), if accepted,
enumerates 10 000 keys within 2× of raw `Object.keys` while waking on key additions and deletions.

### R32-07 — P3 — `notifyWrites` is a public store method

**Mechanism.** `Carburetor.notifyWrites(writes)` (`Store/Carburetor.ts:378-415`) is public so the batch
coordinator can call it (`INotifiable`, exported from `Models/Store.ts:120`). Its parameter is the path
grammar R16-10 declared internal, and the README states the batch coordinator is not exported.

**Probe.** `store.notifyWrites(new Set(['count']))` from outside woke a `count` subscriber once with the
version unchanged; history was unaffected.

**Recommendation.** Move it behind the internal symbol protocol introduced for `extend`/`hasDriftSince`
in R30-06, and stop exporting `INotifiable`. Breaking for anyone calling it, which nothing documented
does.

**Acceptance.** The method is absent from the public class type and package exports (type test), and
transactions across package copies still deliver once per store.

### R32-08 — P3 — `deepClone` uses `Object.create` for every plain object

**Mechanism.** `Store/Utils/deepClone.ts:51` creates each copied object with
`Object.create(Object.getPrototypeOf(source))`. `detachOpaque` already uses a literal for the common
`Object.prototype` case. `snapshot()`, `restore()` and history replay all copy through `deepClone`.

**Probe.** 10 000 rows with a nested object: `deepClone` 3.86–4.78 ms, the same walk with a literal for
`Object.prototype` 2.85–3.33 ms; reading the copies afterwards showed no difference beyond noise.

**Recommendation.** Use `{}` when the prototype is `Object.prototype`, keep `Object.create` for null and
other supported prototypes.

**Acceptance.** `snapshot()` of the probe state ≥ 1.25× faster; prototypes of null-prototype
dictionaries and array subclasses unchanged.

## Not findings

- A single-field write costs two Sets and four string slices per emit, and subscriber matching is
  O(path depth); not worth a change.
- `useCarburetorValue` re-runs its selector on a render that follows unrelated writes; it compares and
  returns the cached reference, so no extra render results.
- `ResourceCache.resolve` hits after R31's intrusive LRU: 129–158 ns against 113–185 ns before R31
  (three paired runs), within the ≤ 300 ns gate — no regression visible.
- `EvictionLedger.selectVictims` re-walks retained-but-old entries per eviction, bounded by
  `maxEntries`; small at realistic sizes.
- Update-wave and batch drains allocate only when work is pending; native Map/Set facades are one per
  collection per tree, cached.

## Known limits not re-reported

R30: the alias answer cache recomputes when one native is read alternately through two roots; the
R30-02 read-tree gates remain unconfirmed on a busy machine. R31: mixed active readonly `forgetAll`
stays per-key; a cyclic working set above the default key memo capacity misses every time.

## Recommended order

1. R32-01 — correctness; the same diff walk as R32-05 can carry the normalization.
2. R32-02 — asymptotic and local to one function.
3. R32-05 — small, and every root installation benefits.
4. R32-03 — the write-log early exit first (no behaviour change), then the positional methods after
   the precision decision.
5. R32-04 — memo bounds.
6. R32-06 — cheaper wrappers; the helper after its API decision.
7. R32-07, R32-08.

## Reproduction recipes

Each recipe runs against the built package (`dist/esm-prod/Carburetor/index.mjs`) with
`NODE_ENV=production`; `class S extends Carburetor { run(fn) { this.update(fn); } }`.

- R32-01: `s = new S({rows: [{id: 0, at: new Date()}, {id: 1, at: new Date()}], other: 0})`;
  `s.run(d => { d.rows = d.rows.filter(r => r.id !== 1); })`; `util.types.isProxy(s.getData().rows[0])`
  is true. Subscribe `{reads: new Set(['rows.0.at'])}`, read `s.read(() => {}).rows[0].at`, then
  `s.run(d => { d.other = 1; })`: the subscriber fires.
- R32-02: K computeds `computed(read => sum of five fields of read(store).rows[i])`, an outer
  `computed(read => rows.reduce((a, c) => a + read(c), 0))` with one subscriber; time
  `update(d => { d.rows[j].a++; })` + `outer.get()` for K = 100…1600, then the same with one store per
  row.
- R32-03: 10 000 six-field rows; override `notifyWrites(w)` in the subclass to read `w.size`; time
  `s.run(d => { d.rows.splice(0, 1); })` against `s.run(d => { d.rows = s.getData().rows.slice(1); })`.
- R32-04: keep one `s.read(() => {})` view; 200 000 × `s.run(d => { d.byId['m' + i] = {n: i}; delete
  d.byId['m' + (i - 100)]; })` plus `view.byId['m' + i].n`; sample `heapUsed` after `gc()`.
- R32-05: `diffPaths` from `Store/Paths/Diff/diffPaths.mjs` on `{rows}` vs `{rows: next}` with one
  replaced row; `heapUsed` before/after without GC.
- R32-06: `Object.keys(s.read(() => {}).byId)` on 10 000 keys, fresh view per run and then repeated on
  one view.
- R32-07: `s.notifyWrites(new Set(['count']))` with a `count` subscriber.
- R32-08: `deepClone` from `Store/Utils/deepClone.mjs` against the same walk using `{}`.

## Resolution

Decisions taken for the user under the standing "best solution, breaking the API is fine": positional
array methods record index-level paths (R32-03); no new public `keysOf` helper (R32-06); `notifyWrites`
moves behind the symbol protocol (R32-07). Four `/wrush` agents worked in isolated worktrees; every
diff was reviewed and every number below comes from the integrating session's own runs against a
production build of `1d377b9` (each side in its own process, one benchmark at a time). A gate that did
not pass is recorded as not passed.

| Finding | Change | Gate | Result |
| --- | --- | --- | --- |
| R32-01 | assigned containers exchange engine views for raw targets (diff walk, direct walk, root install; development ledger throws on a view in state) | no `Proxy` reachable from `getData()` for every pattern; raw assignment ≤ 1.3× | 11 development tests and the same in `dist/cjs` and `dist/cjs-prod` child processes; raw assignment 0.41× — pass |
| R32-02 | one capture-owned combined Set per shared leaf | K = 1600 ≤ 15 ms per write | 468 → 14.6 ms (0.03×); K = 800 112 → 7.1 ms — pass, close to the limit |
| R32-03 | positional methods run natively on the raw array, index-level paths; `WriteLog` stops indexing past capacity | `splice(0,1)` ≤ 15 ms, ≤ 50 ms with 10k readers; others ≤ 25 / ≤ 50 ms | 143 → 6.7 ms, 135 → 10.6 ms with readers; `shift` 7.1, `unshift` 6.4, `reverse` 6.1, `sort` 6.5 ms — all pass. With a history attached 242 → 114 ms (patch clones dominate), undo/redo unchanged and verified |
| R32-04 | memos dropped on delete and bounded by the live key set (draft and read trees) | rolling-window heap drift ≤ 1 MB | draft/write benchmark 19.0 → 0.64 MB — pass; the read-view benchmark reports 2.36 MB — **not passed as defined**: the series is flat at 2.4–2.8 MB from 100k to 400k keys (baseline +13.8 MB per 50k, 102 MB at 400k); the 50k sample sits below the plateau |
| R32-05 | reference-equal children skipped before any path/segment; index loop for arrays; sparse arrays by own index | one row of 10k ≤ 0.5 ms and ≤ 100 KB | `setData` 2.44 → 0.305 ms, `diffPaths` 2.84 → 0.149 ms, 85.5 → 1.46 KB — pass |
| R32-06 | handler doubles as the cache entry; rarely used memos in a lazy side object; no path memo from enumeration | retained ≤ 0.75×; fresh `Object.keys` ≤ 1.0× | 2891 → 1740 KB (0.60×); 20.7 → 17.7 ms (0.86×) — pass; warm pass unchanged (16.6 → 17.1 ms) |
| R32-07 | `notifyWrites` behind `Symbol.for('react-carburetor/v1/store-notify-writes')`; `INotifiable` unexported | none (API) | type and runtime surface tests, dual-copy transaction test |
| R32-08 | `{}` for `Object.prototype` | `snapshot()` ≥ 1.25× | 4.20 → 4.07 ms (0.97×) — **not passed** cross-process; the same walk measured in one process was 1.24–1.27× |

Changes made while closing the round: the agent's index loop in `diffPaths` made long sparse arrays
O(length) (35.8 ms at length 10⁶ against 5.3 ms, and unbounded at length near 2³²); a first fix sent
every long array to the own-index walk and moved the 10k-row gate from 0.3 to 1.7 ms, so the own-index
walk now starts only when an even spread of probes finds a hole. An aborted `diffPaths` (path threshold)
left the unvisited part of the value unnormalized; it is normalized after the abort. A cache without the
internal handler hook is fed through its public `set`.

Read-path cost of the R32-06 wrappers was checked directly (current build against the same build without
the read-proxy change, `readTreeRegistry` and `derivedPersistentTree`, three runs each): ratios between 0.87×
and 1.31× in both directions, no consistent direction — within machine noise, not attributable.

Known limits. Assigning a large fresh container to a new key walks it once to find views (not gated).
A `sort` comparator and a `fill` value no longer receive write proxies. Moving a hole to an own
`undefined` through a positional method is recorded as no change. The R30-02 read-tree gates remain
unconfirmed on a busy machine.
