# API and engine review, round 30 — 2026-10-01

Scope: the JavaScript/TypeScript API and engine on `master` at `470a912`. Round 29 closed the
correctness cycle with zero findings, so this round looks for cost rather than defects: allocations,
renders, asymptotic work per operation, constant factors on hot paths, and API surface that can be
made smaller. No product source was changed by this review.

**Method.** Source reading of the read/write proxies, native facades and alias index, render
attempts and commits, the subscriber index, emit/notify, `Computed`, `watch`, the interop hook,
selection comparison/detachment, the resource cache read path, the patch observer registry and the
public interfaces. Every finding below that claims a cost was confirmed by a bounded probe against a
production build (`dist/esm-prod`) of the same commit, built in a scratch worktree, Node 24.12.0,
`NODE_ENV=production`. The machine was shared with other agents during the run, so absolute timings
are noisy; ratios come from interleaved rounds (median of 15–21), and the registry measurement in
R30-02 toggles one call inside a single module copy so both sides run the same JIT state. The probe
scripts are not part of the repository.

**Verdict:** P1 = 1, P2 = 4, P3 = 5. One finding (R30-05) needs a product decision before it can be
implemented.

| # | Sev. | Area | Finding |
|---|---|---|---|
| R30-01 | P1 | Engine, O | Reading any opaque value walks its whole reachable graph, every read |
| R30-02 | P2 | Engine, allocations | A process-wide registry insert per proxy doubles fresh-tree construction |
| R30-03 | P2 | Renders | A detached Map/Set/Date in a selection always counts as changed |
| R30-04 | P2 | API, perf | Selections compare and copy by descriptor while state is plain data |
| R30-05 | P2 | Engine, decision | Computed and watch rebuild their read tree on every run |
| R30-06 | P3 | API | Public interfaces carry engine internals and duplicate state transfer |
| R30-07 | P3 | API | Two restore-ownership channels and a one-shot handoff in the registry |
| R30-08 | P3 | Engine, allocations | The resource cache read path pays serialization, clock and LRU work per render |
| R30-09 | P3 | Engine, allocations | Subscriber filing allocates an ancestor array and closure per path |
| R30-10 | P3 | Allocations | Hook initializers run every render; watch re-files an unchanged read set |

## Findings

### R30-01 — P1 — reading any opaque value walks its whole reachable graph, every read

`createReadProxy.ts:281-292`: a leaf read whose value is an object (a class instance, Date, or a
member handed out by a Map/Set facade) calls `recordNativeAliasReads(root, value, record)`.
`Aliases/NativeAliasReads.ts:14-56` then allocates two `Set`s and visits everything reachable from
that value — Map/Set members and every own data property through `Reflect.ownKeys` plus
`Reflect.getOwnPropertyDescriptor`, recursing through plain objects and arrays as well. When the walk
finds any plain object it asks `nativeAliasIndex.paths(root)` (`Aliases/NativeAliasIndex.ts:8-32`),
which rebuilds an index of the whole plain store after every topology change, and looks every
exposed object up in it. The Map/Set facade does the same per member read and, for
`forEach`/`keys`/`values`/`entries`, for the whole receiver (`Proxy/liveViews.ts:72-76, 100-108,
120-144`). This runs in production, on every read, in render as well.

The purpose is sound — a plain object reachable through an opaque value may also live at a plain
path, and a raw read of it must subscribe to that path — but nothing caches the answer, so the cost
of reading what the README calls a leaf is proportional to the size of whatever the leaf holds.

Probe (production build, µs per read through a read view):

| Read | Payload | µs/op |
|---|---|---:|
| `view.flag` (primitive) | — | 0.3–0.5 |
| `view.model` (class instance holding `{items: rows}`) | 10 rows | 31.6 |
| same | 1,000 rows | 1,480 |
| same | 10,000 rows | 15,245 |
| `view.model` (class instance holding `number[]`) | 1,000 | 349.5 |
| same | 100,000 | 52,991 |
| `for (const r of view.byId.values())` (Map of plain rows) | 1,000 | 1,514 (raw Map: 34.7) |
| same | 10,000 | 10,663 (raw Map: 200.6) |
| `view.at` (Date) | — | 0.9 |

A component that renders `view.model` with a 10,000-row payload spends 15 ms per render on this walk
alone; iterating a 10,000-entry Map through a view is 53× the raw iteration.

**Fix.** Cache the alias answer per opaque object instead of recomputing it per read:

- Give the alias index a generation per root, bumped by `nativeAliasIndex.invalidate(root)` (every
  topology write and every facade mutation — `set`/`add`/`delete`/`clear` — already calls it).
- Keep `WeakMap<object, {root, generation, paths | wildcard}>` for opaque values. A read whose entry
  matches the current root and generation records the cached paths and returns; otherwise it walks
  once and refills the entry. Map/Set member reads and iteration use the same cache keyed by member
  or receiver.
- In-place mutation of a class instance (or of a Map bypassing the facade) can then leave a cached
  alias set stale until the next topology change. That matches the documented contract — in-place
  mutation of an opaque value is invisible — but it is a narrowing of today's behaviour and should be
  stated in the README next to that contract.

**Tests.** The existing alias suites must stay green (native-alias, selection, history). Add: a second
read of the same opaque value performs no `Reflect.ownKeys` walk (spy count 0); a facade `set` and a
plain topology write each force exactly one re-walk; a cached alias still subscribes the reader to its
plain path.

**Benchmark.** Extend `benchmarks/state/tracking/` with the probe's shapes. Gates against the current
build: a repeated read of a class instance with a 10,000-row payload ≤ 2 µs after the first read;
Map(10,000) iteration through a view ≤ 1.5× the raw iteration after the first call; the first read
after a topology change no slower than today.

### R30-02 — P2 — a process-wide registry insert per proxy doubles fresh-tree construction

Every read proxy and every draft proxy registers itself in the shared `knownViews` WeakMap
(`createReadProxy.ts:442`, `createWriteProxy.ts:501`, `Proxy/liveViews.ts:19-21, 193-195`), so that
`liveViews.readTarget` can map a view back to its raw object (`createWriteProxy.ts:234, 372`,
`detachOpaque.ts:85`, `sameSelection.ts:27`, `cloneOwnedGraph.ts:26`). That is a second ephemeron
insert per proxy on top of the proxy cache's own — the shape R16's integration measured at about
20× slower build when it was proposed for the cache itself, and dropped (R16 Resolution).

Probe: the same module copy with the read proxy's `noteTarget` call guarded by a flag (the draft
proxy's call left on), interleaved:

| Workload (4,000 rows) | Registry on | Registry off | Ratio |
|---|---:|---:|---:|
| Fresh read tree, walk every row | 14.70 ms | 7.25 ms | 2.03 |
| Computed recompute after one write | 38.07 ms | 27.18 ms | 1.40 |
| `watch` fire after one write | 31.40 ms | 25.91 ms | 1.21 |
| Cached view, re-walk (control) | 3.42 ms | 3.71 ms | 0.92 |

Every path that builds a fresh tree pays this: computed recomputes, `watch` fires, the hook's first
snapshot, and the first render of every `useCarburetor`/`connect` view after `setData`/`restore`/undo.

**Fix.** Let the handlers answer the reverse lookup themselves. A shared
`Symbol.for('react-carburetor.rawTarget')` read through the `get` trap returns the target in O(1) for
read proxies, draft proxies and native facades, exactly like the existing `PROXY_CACHE` hatch;
`readTarget(value)` becomes `Reflect.get(value, RAW_TARGET)` for objects. The WeakMap stays only for
persistent `connect()` facades, which need a dynamic resolver and are few. `Symbol.for` keeps the
cross-copy identity the registry provides today. The trade-off: probing an arbitrary object with that
symbol runs a foreign Proxy's own `get` trap, which the WeakMap lookup never does — document it, and
fall back to "not an engine view" if the probe throws.

**Tests.** Cross-copy detachment, draft unwrapping of an assigned read view, selection
comparison against facades and history ownership keep their current suites. Add one test that a read
proxy is not inserted into any global registry (registry size unchanged after building a 100-row view).

**Benchmark.** Fresh read walk at 4,000 rows ≤ 0.6× current; computed recompute ≤ 0.8×; cached
re-walk unchanged (≤ 1.03×).

### R30-03 — P2 — a detached Map/Set/Date in a selection always counts as changed

`sameSelection.ts:10-11, 118-120` returns "changed" whenever either side holds a Map, Set, Date or
class instance, before any content comparison. The comment's reason is that such a value can mutate in
place under the same reference. But the previous side of every comparison is a detached copy:
`detachOpaque.ts:109-155` copies Dates, Maps and Sets, and the hook and `watch` reject class instances
outright (`useCarburetorValue.ts:90-102`, `Utils/Selection/detachWatchSelection.ts`). Comparing a
detached copy with the live value by content is sound — an in-place mutation of the live Date shows up
as a different time — so the conservative rule protects nothing there and only forces churn.

Probe: `sameSelection(detachSelection({title, at}), {title, at})` with the same Date is `false`; the
same with a Map `{1: 'a'}` is `false`; the plain-only selection is `true`.

Consequences, all on unchanged content:

- `connectSelection` (`Reads.tsx:174-178`) hands out a new snapshot on every render, so a `React.memo`
  child receiving a selection with a `createdAt: Date` re-renders on every parent render.
- `useCarburetorValue` (`useCarburetorValue.ts:241-248`) returns a new value on every recompute, so
  its component re-renders whenever its selector re-runs, and its memoized children with it.
- `watch` (`Observation/watchSelection.ts:36-44`) calls `onChange` on every write that touches its
  read set.

**Fix.** Compare a detached Date by `getTime()` and its own data fields; compare a detached Map/Set by
size and entries when keys are primitives, falling back to "changed" for object keys (a detached key
is a copy, so matching it would need a structural key search). Keep the conservative rule for class
instances, which reach `connectSelection` live. Register the pairs in the existing topology maps so
alias checks still hold.

**Tests.** Each consumer: unchanged Date/Map content keeps the previous identity (class memo child
render count stays 1 over a parent re-render; hook render count stays 1; `watch` callback count 0); an
in-place `setTime` or a Map `set` on the live value is reported as changed; a class instance in
`connectSelection` is still always changed.

**Benchmark.** Render counts, not time: a 100-row list whose rows select `{title, at}` through
`connectSelection` into a memo child — parent re-render with no data change: expected today 100 child
renders (each snapshot identity changes; not measured here), target 0.

### R30-04 — P2 — selections compare and copy by descriptor while state is plain data

Since R6-02 the store's state is own enumerable string-keyed data, an array's being its elements and
`length`. Selections did not follow: `sameSelection.ts:16-74` enumerates `Reflect.ownKeys` on both
sides, allocates two descriptor objects per key, compares `enumerable`/`configurable`/`writable`, and
recurses; `detachOpaque.ts:7-37, 183-191, 224-230` copies through `getOwnPropertyDescriptor` and
`Object.defineProperty`, symbols and non-enumerable keys included. Every `connectSelection` render and
every hook recompute pays this on the selector's result.

Probe, a two-field plain selection read through a view:

| Operation | Today | Plain-data equivalent | Ratio |
|---|---:|---:|---:|
| Compare (`sameSelection` vs `Object.keys` + `Object.is`) | 3,535 ns | 580 ns | 6.1 |
| Detach (`detachSelection` vs spread copy) | 3,679 ns | 305 ns | 12.1 |

At 4,000 rows using `connectSelection`, that is ~14 ms of comparison per full re-render pass (derived
from the per-call figure, not measured as a pass).

**Fix (API simplification, breaking).** Define a selection the way state is defined: own enumerable
string keys of plain objects, elements and `length` of arrays, detached copies of Map/Set/Date, class
instances live (class API) or rejected (hook, `watch`). Compare with `Object.keys` and direct reads;
copy by assignment. Drop descriptor flags, symbol keys and non-enumerable keys from the selection
contract. This also makes R30-03 cheaper to implement. Keep a property read per key so selected leaves
stay subscribed.

**Tests.** Rewrite the descriptor-specific selection tests as "not part of a selection"; keep holes,
`length`, null-prototype dictionaries, topology (shared references, cycles) and the class-instance rules.

**Benchmark.** Compare ≤ 1 µs and detach ≤ 0.6 µs for the two-field case; a 4,000-row
`connectSelection` re-render pass ≤ 0.5× today.

### R30-05 — P2, decision required — computed and watch rebuild their read tree on every run

`Computed.recompute` reads each store through a fresh `source.read(...)` (`Computed.ts:235-252`), and
`watch` does the same on every fire (`Observation/watchSelection.ts:11-16`). Each run mints a root
proxy, a cache, a handler and a branch proxy per row, new path strings per handler, and (R30-02) a
registry entry per proxy. Components avoid this: `buildTrackedView.ts` keeps one view per store and
redirects its recorder to the current attempt.

Probe, the recompute shape — walk 4,000 rows recording into a fresh `Set`, fresh tree per run versus
one persistent tree whose recorder points at the current run: 46.4 ms versus 21.4 ms, ratio 2.16. With
R30-02 fixed the fresh side drops, but the persistent tree still avoids every per-row proxy and string.

This is R16-08's third piece, deferred because it waits for R15-10 (1). Since then the README's
"Derived lists" section has made the supported pattern explicit — a computed feeding a list returns
ids or plain values, and rendering through a computed's live result from a non-subscriber is reported
in development. What a persistent tree changes is only that live elements escaping a computed keep
their identity across recomputes. That makes the discouraged pattern — live elements passed to memo
rows — stale-prone, where today it is merely expensive.

**Decision.** Close R15-10 (1) as the documented "ids or plain values" pattern. Then give each
`Computed` dependency and each `watch` one persistent view per source, with the recorder gated to the
run in progress — the `buildTrackedView` rule: a late read lands in the current dependency (at worst
an extra subscribed path, never a missed one), and `extend` keeps working for it.

**Tests.** Conditional dependencies, overlap counting, late reads extending the live dependency,
`setData`/`restore` rebuilding the view, and the escape diagnostic still firing. A new test pins that a
read through a view returned by an earlier recompute records into the current dependency.

**Benchmark.** Observed computed recompute after one write at 4,000 rows ≤ 0.5× today; `watch` fire
≤ 0.6× today.

### R30-06 — P3 — public interfaces carry engine internals and duplicate state transfer

- `ICarburetor.extend(id, path)` (`Models/Store.ts:129`) and the optional
  `ICarburetorSubscription.hasDriftSince` (`Models/Store.ts:69`) take path strings, the grammar R16-10
  declared internal. Only `Computed` calls `extend`, only commits call `hasDriftSince`; a hand-written
  `ICarburetor` must still implement `extend`.
- State transfer has six members (`Models/Store.ts:76-99`, `Carburetor.ts:203-294`): `setData`,
  `restore`, `snapshot`, `toJSON`, `fromJSON`, `serialize`. `toJSON` is `snapshot` under another name,
  base `fromJSON` is `setData`, and `serialize` exists only because `toJSON` clones before stringifying.
- `captureHistory` is mandatory whenever `snapshot` is overridden, detected by prototype identity
  (`Carburetor.ts:212`): a subclass that overrides `snapshot()` for logging and calls `super` cannot
  create a `CarburetorHistory`.

**Fix (API simplification).** Move `extend` and `hasDriftSince` to an internal symbol-keyed protocol
that `Carburetor` implements and the engine probes for. Make `toJSON()` the wire form without a clone
(live data for ordinary stores, data plus settled key for resources), delete `serialize`, and call
`snapshot()` explicitly where a detached copy is needed (scope dehydration, DevTools). Keep
`fromJSON` as "install wire state, normalizing" (resources already route it through `restore`), so the
pairs read: `toJSON`/`fromJSON` for the wire, `snapshot`/`restore` for memory, `setData` to adopt. Give
`captureHistory` a default of `own(this.data)` and require an override only from classes whose wire
state differs (the resource stores already override it).

**Tests.** Type tests that `ICarburetor` no longer exposes `extend`; persistence, scope and DevTools
round trips unchanged; a subclass overriding `snapshot()` with `super` can attach a history.

### R30-07 — P3 — two restore-ownership channels and a one-shot handoff in the registry

`IPatchObserver` offers `ownRestore(state): boolean` and `restoreClaim(state)` for the same purpose
(`Models/Paths.ts:122-137`). To keep the boolean form working, `PatchObserverRegistry` stashes a
one-shot claim keyed by object identity (`PatchObserverRegistry.ts:38, 154-169`), clears it in seven
places, and `installState` consumes it on the next installation of the same object
(`Transaction/installState.ts:22`). Commit `470a912` fixed one lifetime bug in that handoff; the
temporal coupling is what makes such bugs possible.

**Fix (0.x, breaking).** Keep `restoreClaim` only and delete `ownRestore`, the pending-claim field and
`consumeRestoreClaim`; `restore` already obtains claims synchronously through `claimRestore`.

**Tests.** History and custom-producer suites ported from `ownRestore` to `restoreClaim`; the
claim-lifetime test becomes unnecessary and is removed with the mechanism.

### R30-08 — P3 — the resource cache read path pays serialization, clock and LRU work per render

`useResource` calls `ResourceCache.resolve(args)` in every render (`Reads.tsx:221`). Per call:
`keyOf` runs `JSON.stringify` before its memo check, so the memo never saves it
(`ResourceCache.ts:136-162`); `pathOfKey` concatenates a new path string (`:178-180`); `resolve`
allocates a record (`:239-244`); `getEntryByKey` moves the key in the LRU map with a delete and a set
(`:203`, `EvictionLedger.ts:44-48`) and calls `Date.now()` even when `ttl` is `Infinity`
(`State/Runtime/ResourceCacheState.ts:297-300`).

Probe, 4,000 distinct numeric ids: `resolve` 795 ns per call; of that, `JSON.stringify` 138 ns,
`Date.now()` 125 ns, LRU delete+set 102 ns. A 4,000-row list pays ~3.2 ms per render pass (derived
from the per-call figure).

**Fix.** A primitive-args fast path (`Map<primitive, {key, path}>`, no stringify, escape or concat;
object args keep the mutation check); skip the clock when `ttl` is `Infinity`; touch the LRU only when
`maxEntries` is finite, or record a touched bit and reorder lazily at eviction time.

**Benchmark.** `resolve` for primitive ids ≤ 300 ns; eviction order and TTL tests unchanged.

### R30-09 — P3 — subscriber filing allocates an ancestor array and closure per path

`SubscriberIndex.file`/`unfile` (`Paths/SubscriberIndex.ts:246-262`) call `ancestorsOf(path)`
(`:270-282`), which slices every ancestor into a fresh array, then iterate it with a closure. `match`
already walks ancestors in place (`:185-190`). Every mount and every changed re-registration files each
read path this way. Probe on the row shape (three paths per row): 481 ns versus 320 ns per filed path
for an in-place walk, 1.5×; about 2 ms per 4,000-row mount (derived: 12,000 filed paths).

**Fix.** Walk ancestors in place in `file`/`unfile`, as `match` does. **Benchmark:** subscribe 4,000
three-path subscribers ≤ 0.8× today; existing index differential tests unchanged.

### R30-10 — P3 — hook initializers run every render; watch re-files an unchanged read set

- `useCarburetorValue` passes `useRef` a seven-field object literal and `completeReads(new Set())`
  (`useCarburetorValue.ts:132-144`). The arguments are evaluated on every render and discarded after
  the first. Initialize lazily (`useRef(null)` plus a first-render fill).
- `watch` re-subscribes on every fire (`Observation/watchSelection.ts:43`), so the subscriber index
  diffs the full read set and a new subscriber record is allocated even when the selector read the same
  paths. The class and hook paths skip this with `sameReads`; reuse it here.

**Tests.** Hook allocation count per re-render (no new `Set`); `watch` registration untouched when the
read set is unchanged, re-filed when it moves.

## Not findings

- Path-precise tracking of `ids.map(...)` records every index the parent reads; that is the cost of
  precision, not waste.
- `persist`'s synchronous stringify per write was measured in R16 and has an opt-in `coalesce`.
- The scheduler's per-subscription key no longer coalesces one component's notifications from two
  stores into one updater call. React 18+ automatic batching renders once anyway; this was not
  measured on a legacy root and is not reported.

## Recommended order

1. R30-01 — the only asymptotic hazard, and independent of everything else.
2. R30-02 — mechanical, large constant factor on every fresh tree; land before measuring R30-05.
3. R30-03 together with R30-04 — one change to the selection model; the user-visible part is fewer
   renders.
4. R30-05 after the R15-10 (1) decision.
5. R30-06, R30-07 — API cleanups for the next breaking release.
6. R30-08, R30-09, R30-10 — small, independent.

## Verification boundaries

Probes are bounded single-process measurements against a production build of `470a912`, on a machine
shared with other agents; they are not load tests or application profiles, and absolute numbers vary
between runs. React render counts in R30-03 follow from the cited code (`sameSelection` returns false,
so a new snapshot identity is handed out); they were not measured in a browser. No product source,
tests, dependencies or generated files were changed; only this report is committed.
