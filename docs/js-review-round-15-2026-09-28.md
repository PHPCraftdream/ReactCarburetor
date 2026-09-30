# JS review, round 15 — performance, renders, allocations, API — 2026-09-28

Scope: the engine (`lib/src/Carburetor`) and the hooks bridge (`lib/src/Interop`) at `origin/master`
`5b60758`, after every round 14 fix. The brief was the same as rounds 13 and 14: fewer allocations,
fewer renders, lower asymptotic cost, and a simpler API.

Method:
- Every claim marked Confirmed comes from a short, bounded probe against the built production engine
  (`dist/esm-prod`) on Node 24.12.
- Render counts come from a real `react-dom/client` root in jsdom and are exact.
- Probes use React's production build, driven by `flushSync`, unless a finding is specifically about
  React's development build, which needs `act()`.
- Memory figures are `heapUsed` deltas between forced GCs (`--expose-gc`).
- Millisecond figures are single-machine numbers. Growth rates and ratios matter more than the
  absolute values.

Round 14 made one write wake only the components it concerns. This round found where that precision
still leaks:
- symbol reads subscribe a reader to the whole store;
- a computed-backed list re-renders every row for a one-row edit;
- a computed has no way to say "same result".

It also found that the per-component cost the engine adds at mount, in memory and in time, is now
larger than React's own per-component cost.

## Priority index

| ID | Priority | Area | Summary | Verdict |
|---|---|---|---|---|
| R15-01 | P1 | Tracking | Any symbol read records the wildcard. `concat`, `Object.prototype.toString`, `String(obj)` and React 19's development prop logging each subscribe the reader to every write in the store | Confirmed |
| R15-02 | P1 | Derived / Component | A list rendered from a computed's live result re-renders the parent and every visible row when one row's field changes: 500 row renders at 1000 rows, 2000 at 4000 | Confirmed |
| R15-03 | P2 | Derived / API | A computed judges "changed" by reference only, so a recompute that yields equal content re-renders every consumer. The demo works around it with hand-written side state | Confirmed |
| R15-04 | P2 | Store | A read set that moves by one path re-files the whole set: 29–36% of a list `push` | Confirmed |
| R15-05 | P2 | Store | Subscriber index bookkeeping costs 1.9 KB per three-path subscriber, and 99.98% of its buckets hold a single id | Confirmed |
| R15-06 | P2 | Component | `connect()`, the documented default, allocates a closure-based facade per declaration: +1.1 KB and about +10% mount time per row compared with `useCarburetor` | Confirmed |
| R15-07 | P2 | API | Four exported classes still declare members as arrow fields, so a subclass override written as a method is silently ignored — the R14-06 trap, outside the stores | Confirmed |
| R15-08 | P3 | Tracking | Every read builds its path string anew. In a model of the same trap this is about 35–40% of a list-render walk | Model |
| R15-09 | P3 | Various | Allocation removals that are easy to make | Code-derived |
| R15-10 | API | Surface | Decisions worth making before 1.0 | Proposal |

Recommended order:
1. R15-01 first. It is a small change in one trap, and it removes the widest over-subscription left.
2. R15-02 together with R15-03, as one "derived lists" change: documentation first, engine support
   after.
3. R15-04 and R15-05 as one `SubscriberIndex` patch.
4. R15-06 and R15-07: mechanical changes that follow the patterns round 14 set.
5. Then R15-08 and R15-09.

---

## R15-01 — [P1] Symbol reads subscribe to the whole store

**Where.** `ReadProxyHandler.get` (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:139-142`) and
`getOwnPropertyDescriptor` (`:244-247`).

**Mechanism.**
- Round 14 stopped recording inherited keys (`isRecordable`). A key that is absent everywhere still
  records, so that a later own-key write wakes a reader that probed early.
- For string keys that is right. For symbol keys it records `WILDCARD_PATH`, and the probes that
  matter are exactly the absent ones: well-known symbols that plain data never owns.
  - `Array.prototype.concat` reads `Symbol.isConcatSpreadable` on each argument.
  - `Object.prototype.toString` reads `Symbol.toStringTag`. So do lodash's `isPlainObject`, many
    `typeOf` helpers and Node's `util.inspect`.
  - `String(obj)` and `` `${obj}` `` read `Symbol.toPrimitive`.
- Each of these records the wildcard, and the wildcard matches every write to the store.
- React 19.3's development build logs component renders with a props diff
  (`logComponentRender` → `addObjectDiffToProperties`). It stringifies prop values, which runs
  `Object.prototype.toString` on any live view passed as a prop.
  - The computed's recorder has no render gate, so it catches that read.
  - Once caught, every write to the store recomputes the computed and re-renders its consumers.
  - A development build therefore shows a different, much worse render profile than production.

**The wildcard buys nothing.** The write side already collapses every symbol write to the wildcard:
- `WriteProxyHandler.writtenPath` returns `WILDCARD_PATH` for a symbol key, and for any key inside a
  symbol-keyed branch (`createWriteProxy.ts:75-78, :102`);
- `SubscriberIndex.match` answers a wildcard write with every subscriber.

So a reader that recorded nothing for a symbol read is still woken by any write that could change
what it read. The read-side wildcard only adds wake-ups for writes that cannot change the answer.

**Evidence (Confirmed).**

A `connect()` component per read form, then one write to an unrelated field (`other`), production
React:

| Render body | Renders after the unrelated write |
|---|---|
| `d.tags.join(',')` | 0 |
| `` `${d.user.name}` `` | 0 |
| `d.tags.concat(['x']).join(',')` | **1** |
| `Object.prototype.toString.call(d.user)` | **1** |

A computed list (`read(todos).items.filter(t => !t.done)`) at 1000 rows, 500 visible, rows receiving
the elements as props, React development build:

| Write | Recomputes | List renders | Row renders |
|---|---|---|---|
| unrelated field | 1 | 1 | 500 |
| a hidden row's title | 1 | 1 | 500 |

The same two writes on React's production build: 0 / 0 / 0. A stack trace confirmed the wildcard
comes from `Proxy.toString` inside React's `addObjectDiffToProperties`.

**Fix.** Record nothing for symbol keys in `get` and `getOwnPropertyDescriptor`; `has` already
records only string keys. Keep
wrapping own symbol-keyed branches as today, so writes through them stay guarded. Paths recorded
below a symbol branch (`*.x`) are harmless and can stay. Regression tests:
- `concat` and `Object.prototype.toString` in render, with no wake on an unrelated write;
- an own symbol-keyed field, still woken when it is written through `draft`.

---

## R15-02 — [P1] A computed-backed list re-renders every row for a one-row edit

**Where.** `Computed.recompute` (`lib/src/Carburetor/Derived/Computed.ts:229, :241`).

**Mechanism.**
1. A computed hands out its result live. Rows that receive the result's elements as props and read
   `todo.title` in render amend the computed's dependencies (R14-01, now O(depth)).
2. A title edit therefore wakes the computed. It recomputes, and each recompute calls `source.read()`
   anew, which builds a fresh proxy tree.
3. Every element of the new array is a new proxy, so every row's `todo` prop changes identity. The
   props gate lets every row through.
4. The rows are correct only because of that re-render. A row reading through the computed's
   proxies records into the computed, not into its own subscription. If the elements kept their
   identity, the edited row would bail out at the props gate and show stale text.

The cost of a one-field edit is therefore O(visible rows) renders plus a full recompute. This is not
a bug in the O(depth) amend; it is what "a computed's result is live" costs once the result crosses a
component boundary. The README describes the semantics ("an edit inside the list wakes the computed
and, through it, the consumer") but not this cost.

**Evidence (Confirmed, production React).** Half the rows are visible. Renaming a visible row:

| Rows | Recomputes | List renders | Row renders | Time |
|---|---|---|---|---|
| 1000 | 1 | 1 | 500 | 25.5 ms |
| 4000 | 1 | 1 | 2000 | 44.1 ms |

The ideal is one row render. The demo avoids the problem by design: `TodoViews.visibleIds` returns
ids, and each `TodoItem` connects to the store itself, so a title edit wakes exactly one row.

**Options.**
- **Now: document and diagnose.**
  - Add a short "derived lists" section to the README: return ids or plain values from a computed
    that feeds a list, and let each row read the store.
  - Add a development diagnostic, like `reportLiveViewEscape` for `connectSelection`: warn when a
    component renders from a computed-result proxy it received through props.
- **Later: attribute render-time reads of a computed result to the reader.**
  - When a render attempt is open, a leaf read through a computed's proxy could also be recorded
    into that component's own subscription to the underlying store. This needs a module-level
    "current attempt" pointer that the component boundary sets and clears.
  - Rows would then subscribe to their own leaves, and the computed could keep one persistent proxy
    tree across recomputes, as `buildTrackedView` does. Element identity would survive, and
    together with R15-03 a one-row edit would render one row.
  - This is a design change. Decide it together with R15-10 (1).

---

## R15-03 — [P2] A computed cannot say "same result"

**Where.** `Computed.settle` (`Computed.ts:536`): `Object.is(baseline, this.value)` is the only
equality.

**Mechanism.**
- A body that builds a new array or object — `filter`, `map`, `slice`, an object literal — announces
  a change on every recompute, even when the content is identical.
- Every `useComputed` and `useComputedValue` consumer re-renders.
- The demo shows the gap: `TodoViews.computeVisibleIds` keeps a mutable `lastIds` field and a
  `sameIdsOr` helper just to hand back the previous array when the ids match.

**Evidence (Confirmed, production React).**
- Setup: 1000 visible ids, rows connected by id, and a computed
  `ids.filter(id => !byId[id].done)` with no hand-written memo.
- 20 writes that add a *done* item, so the visible ids do not change: 20 recomputes, 20 list
  renders, 0 row renders, **6.74 ms per write**, all of it avoidable.

**Fix.**
- Add `computed(body, {equals})`, with a comparator applied in `settle` after the exotic-value
  check.
- Export a shallow array/object comparator (or accept the existing `shallowEqual`).
- Changing the default to shallow comparison is tempting for arrays of primitives, but it changes
  behaviour for callers who rely on identity. Keep it opt-in.
- The demo's `sameIdsOr`/`lastIds` then becomes `{equals: shallowEqual}`.

---

## R15-04 — [P2] A one-path change to a read set re-files the whole set

**Where.**
- `Subscriptions.alignSubscription` (`lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx:176`)
  calls `Carburetor.subscribe`;
- `subscribe` calls `SubscriberIndex.add` (`lib/src/Carburetor/Store/Paths/SubscriberIndex.ts:45`);
- `add` starts with `this.remove(id)`.

**Mechanism.**
- `sameReads` already skips re-registration when a read set is unchanged.
- When it did change — a list parent that now reads one more index after a `push` — `add` removes
  all N paths from `exact` and `branch`, then files N+1 again.
  - Filing re-slices every ancestor.
  - The round 14 ancestor cache is dropped by `remove` and rebuilt by `add`, so it does not help
    this path.
- The work is O(N·depth) for a delta of one path.

**Evidence (Confirmed).**

`subscribe` with the same id and a set one path larger, 50-run mean:

| Read-set size | One re-subscribe |
|---|---|
| 1000 | 1.14 ms |
| 4000 | 4.54 ms |

Share of a real `push` (a list connected to `ids`, rows connected by id, production React, 20-run
mean):

| Rows | Whole push | Of which `subscribe()` |
|---|---|---|
| 1000 | 2.44 ms | 0.71 ms (29%) |
| 4000 | 13.84 ms | 5.05 ms (36%) |

**Fix.** Give `SubscriberIndex` a diffing re-registration. For a known id:
- walk the old set and unregister the paths absent from the new one;
- walk the new set and file the paths absent from the old one;
- reuse cached ancestor chains for the paths that stay.

The cost becomes O(N) membership checks — the same order as the `sameReads` that already runs — plus
O(Δ·depth) index work. `Computed.attachDependencies` benefits the same way when a recompute
changes one path.

---

## R15-05 — [P2] Index bookkeeping costs 1.9 KB per subscriber

**Where.** `SubscriberIndex` (`register`, `file`, `ancestorsById`).

**Mechanism.**
- Each read path gets an `exact` bucket, and each ancestor a `branch` bucket, always as a
  `Set<string>`.
- In a list, most paths are unique to one row (`byId.k17.title`, `byId.k17.~p`, and the branch
  bucket `byId.k17`), so nearly every bucket is a Set holding a single id.
- Round 14 added a per-id `Map<path, ancestor[]>` on top, with freshly sliced ancestor strings.

**Evidence (Confirmed).**
- 4000 subscribers, each with three paths shaped like a connected row: **1877 bytes per
  subscriber**, read sets excluded.
- Of the 12,002 buckets, **12,000 hold exactly one id**.

A model of the same maps:

| Model | Bytes per subscriber |
|---|---|
| three buckets as `Set([id])` | 812 |
| three buckets as the id string itself | 115 |
| the per-id ancestor cache (a lower bound: the model reuses ancestor strings, the engine slices fresh ones) | 373 |

For scale:

| Row type | Retained per row | Mount time for 4000 rows |
|---|---|---|
| plain `React.Component` | 4169 B | 59–64 ms |
| `useCarburetor` | 8498 B | 100–104 ms |

About 1.9 KB of the engine's 4.3 KB per row is this index.

**Fix.**
- Store a single-id bucket as the id string, and promote it to a Set on the second id. `collect`
  and `unregister` branch on `typeof`.
- Drop the per-id ancestor cache in favour of R15-04's diff, which removes the only path that
  re-slices on a hot loop. If a cache stays, make it one shared `Map<path, ancestors>`,
  reference-counted with the `exact` bucket, instead of one per subscriber.

---

## R15-06 — [P2] `connect()` allocates a closure facade per declaration

**Where.** `buildPersistentView` (`lib/src/Carburetor/Component/Connection/buildPersistentView.ts:52,
87, 113`) and `declareConnection`.

**Mechanism.**
- Each `connect()` or `connectSelection()` call allocates:
  - a connection object and three closures (`getCarburetor`, `resolveAttemptSource`, `recorder`);
  - three more closures (`assertDeclaredKind`, `resolveView`, `forbidWrite`);
  - a handler object with twelve trap closures, the facade `Proxy`, and its empty target.
- Round 14 removed exactly this shape from the read and write proxies (R14-07). The facade was not
  covered.
- Every root-level read also goes through two proxies (facade, then view), plus a
  `resolveAttemptSource` Map lookup.
- Since round 14, the README recommends `connect()` as the default read, so this is the cost most
  components pay.

**Evidence (Confirmed, production React, 4000 rows, each reading one field by id).**

| Row reads through | Mount | Retained per row |
|---|---|---|
| plain `React.Component` | 59–64 ms | 4169 B |
| `useCarburetor` | 100–104 ms | 8498 B |
| `connect()` | 108–119 ms | 9611 B |

**Fix.**
- One `ConnectionFacadeHandler` class with prototype traps. Its per-declaration state lives in one
  object (`connection`, `cachedTarget`, `cachedView`, `arrayFacade`, `probeError`).
- Recorder and resolver become methods of that object, with one bound recorder if the proxy needs
  a detached function.
- Target: `connect()` at or below `useCarburetor`'s footprint, which removes the one cost argument
  against the documented default.

---

## R15-07 — [P2] Arrow-field members still shadow subclass overrides

**Where.** Remaining arrow-field members on exported classes:
- `ComponentUpdateThrottle`: `schedule`, `cancel`, `setupTimeout`, `clearTimeout`, `runUpdater`,
  `letsUpdate`;
- `CarburetorScope`: `get`, `set`, `has`, `dehydrate`, `hydrate`, `isInspectable`;
- `CarburetorHistory`: `canUndo`, `canRedo`, `undo`, `redo`, `clear`, `disconnect`, `record`, `apply`;
- `Diagnostics`: `isEnabled`, `setEnabled`, `report`.

**Mechanism.** This is the R14-06 trap. An arrow field is an own property installed after the
subclass's prototype is built, so a subclass method of the same name is never reached. `super.x()`
does not work either, because there is no `x` on the base prototype.

`runUpdater` is documented as "a seam for tests and subclasses", and it cannot be used that way.

**Evidence (Confirmed).**

| Subclass | Result |
|---|---|
| `class Logged extends ComponentUpdateThrottle { runUpdater(u) { ran++; u(); } }` | The updater ran; the override was called **0** times |
| `class CountingScope extends CarburetorScope { get(token) { … } }` | The override was called **0** times |

**Fix.**
- Convert to prototype methods, as round 14 did for stores.
- Keep a bound function only where it is handed off detached: the throttle's timer callback, and
  `CarburetorHistory.record`, which is passed to `watch`. The
  internal singletons (`UpdateWave`, `UpdateBatch`, `SyncUpdateScheduler`) can follow for
  consistency.
- `CarburetorHistory.undo`/`redo` are plausible `onClick={history.undo}` targets. Converting them is
  a breaking change of the same kind as R14-06. Either document binding, or keep bound aliases.
- No lint rule catches this today. `require-method-for-closure` (H29) targets closures, not the
  override hazard, so a check for public, non-bound arrow members on exported classes would need its
  own rule.

---

## R15-08 — [P3] Every read builds its path string anew

**Where.** `ReadProxyHandler.get`, `has` and `getOwnPropertyDescriptor` (`createReadProxy.ts:163, :206,
:270`) call `joinPath(basePath, key)` on every access, and `branchPath` concatenates again for branch
reads. `WriteProxyHandler.get` (`createWriteProxy.ts:102`) builds the path before it knows whether
anything will be recorded, so a primitive read through `draft` builds a path for nothing.

**Mechanism.**
- A persistent view (round 13's `useCarburetor` root, `connect()`, and the round 14 interop root)
  reads the same keys through the same handler on every render.
- Each read allocates a fresh string, and every `Set.add` and index lookup hashes it again, because a
  new string has no cached hash.

**Evidence (Model).**
- Workload: a 3000-leaf walk (1000 rows × 3 fields) through a trap of the engine's shape, with a
  recorder that adds each path to a Set.
  - Concatenating per read: 1.16–1.18 ms per walk.
  - Memoizing the child path per handler (`Map<key, path>`, plus a memoized branch marker):
    0.73–0.80 ms per walk.
- The engine itself runs the same walk in 1.43–1.68 ms.

**Fix.**
- A per-handler `Map<key, path>` and a memoized branch marker. Both are created lazily; handlers are
  already persistent per tree.
- In the write proxy, build the path only on the branches that use it.
- Related: each branch read allocates a `() => createReadProxy(...)` closure for the cache call,
  even on a hit (`:159, :181, :263, :285`; write proxy `:107`). Split the cache API into a lookup
  and a store, so a hit allocates nothing.

---

## R15-09 — [P3] Small removals

- **`emitUpdate` replaces `this.writes` on every emit** (`Carburetor.ts:367`), including when it was
  empty. Keep the empty Set; replace it only when handing it off.
- **Each `notifyWrites` allocates a `failures` array** (`Carburetor.ts:215`), and `match` copies the
  wildcard set into a fresh result Set (`SubscriberIndex.ts:144`). Allocate `failures` on the first
  failure. The match Set is needed, but it can skip the copy when `wildcard` is empty.
- **Each commit allocates new slot and description objects** per tracked source
  (`Subscriptions.tsx:95-102`). Update the existing slot in place.
- **Attempts are retained after commit.** `pendingAttempt`/`committedAttempt` keep the attempt's
  `tracked`/`connections` Maps alive after the commit has copied what it needs. Only the identity
  is used afterwards, so clear the collections once the commit consumes them.
- **Every instance allocates eagerly**: the `tracked` Map, the `effects` dictionary, and the
  `onCarburetorUpdate` and `getRenderAttempt` closures (`Foundation.tsx:29, :40`; `Reads.tsx:31`;
  `Subscriptions.tsx:34`). A `connect()`-only component never uses `tracked`. Create both lazily.
  The two closures could become one bound pair per instance, or a shared static function with
  instance state, as with R14-05's accessor.
- **A stale docstring.** `connect()` still says "`useCarburetor` allocates a fresh read-tracking proxy
  every render" (`Reads.tsx:70`). That has not been true since round 13.

---

## R15-10 — API decisions before 1.0

1. **Derived lists (R15-02, R15-03).** Pick the supported pattern and make it cheap:
   - Either "a computed feeding a list returns ids or plain values", documented and backed by a
     diagnostic and `equals`;
   - or render-time attribution, so a computed's live elements can go to rows directly.

   The first is small and matches the demo. The second makes live results first-class across
   component boundaries.
2. **`extend` on the public `ICarburetorSubscription`.**
   - Round 14 added `extend(id, path)` as a *required* member of an exported interface. Only a
     computed's dependency sources call it, and those are always stores.
   - `IComputed` now carries a no-op for it, and any third-party subscription source has to
     implement it.
   - Move it to `ICarburetor`, or to an internal interface, and have `Computed` call it only on
     store sources, which it already tells apart with `'read' in source`.
3. **`computed(body, options)`.** R15-03's `equals` is the first option a computed would take. Shape
   the signature as an options object now, so later additions do not need another positional
   parameter.
4. **`connect()` as the default (R14-09 (3)).** Once R15-06 lands, the default is also the cheaper
   form, and the README's decision tree needs no performance caveat.

---

## Verification and limits

- All probes were bounded single runs of a few seconds each, at 1000 and 4000 rows. They lived in
  the gitignored `.consumer-matrix/r15/` directory and were deleted after this report was written.
  The descriptions above are enough to recreate them.
- Render counts (R15-01, R15-02, R15-03) are exact, taken from real `react-dom/client` commits in
  jsdom.
  - Production-build numbers were driven by `flushSync`.
  - The development-build rows in R15-01 used `act()`.
  - The React 19.3 development logging path was identified from a stack trace.
- Memory figures (R15-05, R15-06) are `heapUsed` deltas between forced GCs. They include jsdom's DOM
  nodes and React's fibers, which is why the plain-component baseline is shown alongside.
- R15-05's per-bucket and ancestor-cache numbers, and R15-08's before/after timing, come from minimal
  models of the same data structures, not from a patched engine.
- R15-09 is derived from the code.
- No engine source was changed in this round.

---

## Resolution (same day)

Every finding except R15-10 (1) was fixed on `react-compat`. Each fix was made by an agent in its
own worktree, then reviewed and integrated one at a time, with a commit per finding. Every fix comes
with regression tests, and each one was shown to fail against the pre-fix code.

| Finding | Commit | Change |
|---|---|---|
| R15-04, R15-05, R15-09 (store) | `d006c59` | `SubscriberIndex.add` diffs a known id against what it filed; a single-subscriber bucket holds the bare id; the per-subscriber ancestor cache is gone; `emitUpdate` keeps an empty write set; `notifyWrites` allocates its failure list lazily |
| R15-01, R15-08 | `2768ed6` | A symbol read records nothing. Read handlers memoize child paths and branch markers: one inline slot, and a Map only for branches read through several keys. The write proxy builds a path only when it records one. The proxy cache splits `get`/`set`, so a hit allocates nothing |
| R15-02, R15-03, R15-10 (2, 3) | `868617c` | `computed(body, {equals})`; `extend` moved from `ICarburetorSubscription` to `ICarburetor`; README "Derived lists"; the demo drops its hand-written id memo; a development-only diagnostic for a computed result rendered by a non-subscriber |
| R15-07 | `ed24689` | Throttle, scheduler, wave, batch, scope, history and diagnostics members are prototype methods; only the throttle's timer callback and the history's `watch` callback stay bound |
| R15-09 (component) | `a6be80b` | Components allocate `tracked`/`effects` on first use, update commit slots in place, and release a consumed attempt's collections |
| R15-06 | `650ae81` | One `ConnectionSource` object per declaration and one `ConnectionFacadeHandler` class with prototype traps; `Reads` reuses its bound attempt accessor; the stale `connect()` docstring is fixed |

Integration corrections:
- **The path memo.** The first version gave every read handler its own Map. That added 1041 B per
  row to a 4000-row mount, because each row has its own small proxy tree. It was replaced by one
  inline slot per handler, plus a Map only for branches read through several keys, which is
  memory-neutral. The proxy cache became a class.
- **The render-owner pointer** behind the R15-02 diagnostic allocated an object and a closure on
  every render, in production too. It now runs in development only. Its type moved out of the
  public `Models/` barrel.

Before and after, on the built production engine (`dist/esm-prod` at `868a74f` against the rebuilt
`dist`), with the same probes as the report:

| Probe | Before | After |
|---|---|---|
| Renders after an unrelated write, for `concat` / `toString` / `String(obj)` | 1 / 1 / 1 | 0 / 0 / 0 |
| 20 writes leaving a computed's ids equal: list renders | 20 | 20; 0 with `{equals: shallowEqual}` |
| Re-subscribe with one added path, 1000 / 4000 paths | 1.7–2.4 / 9.4–10.8 ms | 0.10–0.11 / 1.2–1.4 ms |
| List `push`, 1000 / 4000 rows | 5.3–13.4 / 26.6–38.4 ms | 1.7–3.8 / 10.3–20.5 ms |
| Index bookkeeping per three-path subscriber | 1880 B | 483 B |
| 3000-leaf walk through a persistent view | 2.1–3.0 ms | 1.34–1.43 ms |
| Retained per `useCarburetor` row (4000 rows) | 8495 B | 6861 B |
| Retained per `connect()` row (4000 rows) | 9608 B | 6904 B |

A plain `React.Component` row retains 4168 B, so the engine's overhead per row fell from 4.3 KB to
2.7 KB for `useCarburetor`, and from 5.4 KB to 2.7 KB for `connect()`. `connect()` now costs the same
as `useCarburetor`, which was R15-06's target.

The millisecond figures come from a machine that was not idle, so they vary between runs; the
ranges are several runs each. The byte figures repeat to within a few bytes.

Not changed:
- **R15-02's O(visible rows) cost when a computed's live elements are passed to rows.** It is now
  documented and diagnosed; the engine behaves as before (1 list render and 500 row renders at
  1000 rows).
- **R15-10 (1), render-time attribution**, which would let live elements cross component
  boundaries cheaply. It stays a design decision.

Verification at the integration point:
- 860 tests;
- `cargo test`: 350 + 24;
- lint, typecheck, the demo's `tsc` and the layout check are clean;
- consumer matrix: 16/16.

`cargo test` first failed all 24 CLI tests. The cause was a stale test binary in the `native/target`
directory, which agent worktrees share. The binary had been built in a removed round 14 worktree,
and that worktree's path was compiled into it. The tests passed once it was rebuilt. Agent worktrees
no longer share `native/target`.
