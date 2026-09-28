# JS review, round 14 — performance, renders, allocations, API — 2026-09-28

Scope: the engine (`lib/src/Carburetor`) and the hooks bridge (`lib/src/Interop`) at `origin/master`
`7c95ab9`, after the round 13 fixes and the `"use client"` work. The brief was the same as round 13:
fewer allocations, fewer renders, lower asymptotic cost, and a simpler API.

Every claim marked Confirmed comes from a short, bounded probe against the built production engine
(`dist/esm-prod`) on Node 24.12. Render counts come from a real `react-dom/client` root in jsdom,
using React's development build, which `act()` needs. The counts are exact. The millisecond figures
include React's development overhead and GC noise, so the growth rate matters more than the absolute
value. The server-render profile uses the production build of both React and the engine.

Round 13 looked mostly at how expensive one render or one write is. This round found that the bigger
cost is how many components a write wakes: four of the P1 findings wake more components than the
write actually concerns.

## Priority index

| ID | Priority | Area | Summary | Verdict |
|---|---|---|---|---|
| R14-01 | P1 | Derived | Reading a computed's live result re-subscribes the whole dependency once per new leaf, so a list re-render is O(N²): one title edit takes 4.4 s at 1000 rows and 129 s at 4000 | Confirmed |
| R14-02 | P1 | Tracking | `.map`/`.forEach`/`.filter` run the `has` trap per index, which subscribes the reader to each whole element, so the list parent re-renders on every nested edit | Confirmed |
| R14-03 | P1 | Tracking | Any write on an array itself (`push`, `splice`, `items[i] = …`) is recorded as the whole array, so every row re-renders | Confirmed |
| R14-04 | P1 | Tracking | `for…of`, spread and array destructuring read `Symbol.iterator`, which records the wildcard, so the component re-renders on any write to the store | Confirmed |
| R14-05 | P2 | Component | The per-instance `render` accessor puts every `AntiHookComponent` instance after the first into dictionary mode | Confirmed |
| R14-06 | P2 | API / Store | Store methods are arrow fields: a subclass that overrides one with a method (`preEmit() {}`) is silently ignored, and every store allocates ~20 closures | Confirmed |
| R14-07 | P2 | Tracking | Each read proxy allocates ~9 objects (a handler plus 7 closures); GC takes 25% of a list server render | Code-derived + profile |
| R14-08 | P3 | Various | Allocation and scan removals that are easy to make | Code-derived |
| R14-09 | API | Surface | Decisions worth making before 1.0 | Proposal |

Recommended order:
1. R14-01 first: it is the one finding that can freeze a tab.
2. R14-02, R14-03 and R14-04 as one tracking patch. Together they make list updates proportional to
   what changed.
3. R14-05 and R14-06: small, mechanical changes that remove a silent trap.
4. Then R14-07 and R14-08.

---

## R14-01 — [P1] A computed-backed list re-renders in O(N²)

**Where.** `Computed.recordDependencyRead` (`lib/src/Carburetor/Derived/Computed.ts:255`), which
calls `Carburetor.subscribe` (`lib/src/Carburetor/Store/Carburetor.ts:135`), which calls
`SubscriberIndex.add` (`lib/src/Carburetor/Store/Paths/SubscriberIndex.ts:43`).

**Mechanism.**
- A computed hands out live read proxies. A consumer that reads a deeper leaf off the result — every
  row title of a list the computed returns — records that leaf into the computed's dependency after
  the body has already finished.
- `recordDependencyRead` publishes each new leaf immediately. It calls
  `source.subscribe(onDependencyChanged, {id, reads: dependency.reads})`.
- `subscribe` copies the whole read set (`new Set(options.reads)`). `SubscriberIndex.add` then
  removes the old registration and files every path again, slicing every ancestor of each one.
- One new leaf therefore costs O(current read-set size × path depth). A render that reads N rows
  through the computed pays 1 + 2 + … + 2N.

This is not a one-off mount cost. Every settlement recomputes the body, and the fresh dependency
then holds only the body's own reads (`items.~p`). The consumer's next render re-adds every leaf,
one subscribe call at a time. So every write that reaches the computed pays the quadratic cost again.

**Reproduction.** `new Computed((read) => read(store).items)`. One `AntiHookComponent` calls
`useComputed` and reads `items[i].title` for every row, then `store.setTitle(5, 'xx')` runs inside
`act`:

| Rows | One title edit | `store.subscribe` calls |
|---|---|---|
| 500 | 643 ms | 1 002 |
| 1 000 | 4 431 ms | 2 002 |
| 2 000 | 10 726 ms | 4 002 |
| 4 000 | 129 415 ms | 8 002 |

That is two subscribe calls per row: the branch marker `items.i.~p` and the leaf `items.i.title`.

**Fix direction.** Either of these makes an amendment O(path depth) instead of O(read set):
1. Add an incremental path to the index — `SubscriberIndex.addPath(id, path)` — and a store-level
   `extend(id, path)` that files one path into an existing registration without copying or
   re-filing the rest. `recordDependencyRead` would call it instead of `subscribe`.
2. Collect amendments and publish them once per consumer render. For example, mark the dependency
   dirty and re-subscribe it once from a microtask, or at the consumer's commit. The window this
   opens is the same render→commit window components already close with their version check. The
   computed's `version`/`hasDrifted` machinery can close it the same way.

Option 1 is the smaller, local change. Add a regression test with 2 000 rows and a budget, and count
subscribe calls in the test rather than wall-clock time.

---

## R14-02 — [P1] The standard `items.map(...)` parent re-renders on every nested edit

**Where.** The read proxy's `has` trap (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:158`).

**Mechanism.** `Array.prototype.map`, `forEach`, `filter`, `some`, `every`, `reduce`, `indexOf` and
`lastIndexOf` call `HasProperty(O, k)` for every index before reading it. On the proxy that is the
`has` trap, which records `joinPath(basePath, key)` — here `items.0`, `items.1`, and so on. That path
is the whole element.

A later write to `items.5.title` has `items.5` as an ancestor. `SubscriberIndex.match` looks up
`exact` for every ancestor of a write, so it finds the parent. The parent was only laying out rows,
yet it is subscribed to every field of every row.

Recorded paths for `d.items.map((it) => it.t)` over two items:

```
items.~p | items.map | items.length | items.constructor | items.0 | items.0.~p | items.0.t | items.1 | items.1.~p | items.1.t
```

**Reproduction.** 1 000 rows. The parent renders `items.map((_, i) => <Row i={i}/>)` and each `Row`
reads its own title. Then `setTitle(5)` runs:

| Parent style | Renders | Time |
|---|---|---|
| `for (i < items.length)` loop | 1 row | 13 ms |
| `items.map(...)` | 1 row **+ the parent** | 61 ms |

The parent's re-render is O(N): 1 000 elements rebuilt and 1 000 props gates run. It happens on
every keystroke in any row.

**Fix direction.** `has` answers a presence question, and presence already has a precise path: the
branch marker.
- When the value under the key is trackable, record `branchPath(path)`, as `get` does for a
  traversal.
- When the value is not trackable, record the leaf path, as today.

After this change a nested write under `items.5` no longer matches the parent. Replacing or deleting
`items.5` still does, because the marker sits below `items.5`.

The spurious inherited reads (`items.map`, `items.constructor`) are covered in R14-08.

---

## R14-03 — [P1] `push`, `splice` and index assignment wake every row

**Where.** `writtenPath` in the write proxy (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:68`):
`return isArray ? (basePath || WILDCARD_PATH) : joinPath(basePath, key)`.

**Mechanism.** Any `set`, `defineProperty` or `deleteProperty` on an array records the array's own
path, whatever index or `length` was touched.
- A write to `items` matches `branch['items']`, which holds every subscriber reading anything below
  `items` — every row.
- Nested writes (`items[5].title = …`) are precise, because they go through the element's own proxy.
- Only writes on the array object itself collapse: exactly the list operations — add, remove,
  replace a row, sort.

**Reproduction.** 1 000 rows, each reading `items[i].title`. The parent loops over `items.length`.

| Write | Row renders | Parent | Time |
|---|---|---|---|
| `d.items[5].title = 'x'` | 1 | 0 | 13 ms |
| `d.items.push({title})` | 1 001 (1 000 re-renders + 1 mount) | 1 | 139 ms |
| `d.items[5] = {title: 'y'}` | 1 000 | 1 | 120 ms |

The ideal numbers are 1 mount plus the parent for `push`, and 1 row for the replacement.

**Fix direction.**
- Record `joinPath(basePath, key)` for index keys, as objects do. A replaced element then wakes its
  own readers through `branch['items.5']`, and the parent through its `items.5` read.
- Record `items.length` when `length` changes. The parent reads `length` and is woken by `push`.
- `sort` and `splice` write every index they move, so the rows whose element really moved are woken.
  That is correct, and no longer "all rows" for a `push`.
- One case needs care: assigning a smaller `length` directly truncates without calling
  `deleteProperty` per index. When a `length` write shrinks the array, record each removed index, or
  fall back to the coarse array path. `pop`, `shift` and `splice` delete explicitly, so they need no
  special case.
- The symbol and wildcard branches stay as they are.

---

## R14-04 — [P1] Iterating a tracked array subscribes to the whole store

**Where.** The `typeof key === 'symbol'` branch of the read proxy's `get` trap
(`createReadProxy.ts:106-111`).

**Mechanism.** Any symbol read records `WILDCARD_PATH`. `for…of`, spread (`[...items]`),
destructuring (`const [first] = items`), `Array.from(items)` and `new Set(items)` all read
`items[Symbol.iterator]` first.

That value is `Array.prototype.values`, which is not data. The iteration it drives then reads
`length` and each index through the proxy, and those reads are already recorded precisely. The
wildcard adds nothing except a subscription to every write in the store.

Recorded paths:

```
for-of break     items.~p | * | items.length | items.0.~p | items.0.t
spread           items.~p | * | items.length | items.0.~p | items.1.~p
destructure [a]  items.~p | * | items.length | items.0.~p | items.0.t
```

**Reproduction.** A component that only counts `for (const _ of items)` re-renders on an unrelated
write (`d.other += 1`): 1 render where 0 are expected.

**Fix direction.** When the symbol key is not an own property of the source — an inherited
well-known symbol such as `Symbol.iterator` or `Symbol.toStringTag` — return the value without
recording anything. An own symbol-keyed value keeps today's wildcard treatment. An absent symbol key
whose value is `undefined` also stays a wildcard read, because a later own symbol write must still
wake it. The `getOwnPropertyDescriptor` trap needs no change: it only ever sees own keys.

---

## R14-05 — [P2] `AntiHookComponent` instances run in dictionary mode

**Where.** `installRenderBoundary` (`lib/src/Carburetor/Component/AntiHookComponent/Foundation.tsx:84`).

**Mechanism.** Every instance calls `Object.defineProperty(this, 'render', {get, set})` with a fresh
pair of closures. V8 keeps the accessor functions inside the hidden class. The first instance gets a
map with its own pair; the second pair does not match that transition, so the object is normalized
to dictionary properties.

From then on every property access on an instance is a hash lookup. That includes `this.props`,
`this.state` and `this.renderAttempt` in render and commit, and React's own reads in the reconciler.
Property-access sites also stop being monomorphic.

**Reproduction** (`node --allow-natives-syntax`):

```
AntiHookComponent fast properties: true false      <- first, second instance
same hidden class for two instances: false
plain React.Component fast properties: true
```

A minimal model of the same constructor pattern:

| Accessor functions | Instances with fast properties | Construct 200 000 |
|---|---|---|
| Fresh closures per instance | first only | 170 ms |
| Shared module-level functions | all | 52 ms |

In the model, a class-field `render` still throws `TypeError` with shared functions.

**Fix direction.**
- Define the accessor with two module-level functions that use `this`, and keep the per-instance
  state (`rawRender`, `boundary`, `assigned`) in ordinary fields initialized in the constructor.
- Keep `configurable: false`, so the class-field guard is unchanged.
- The boundary closure built per raw render can stay; it is created once per instance.
- Add a test that asserts `%HasFastProperties` on two instances, run with the natives flag. Or
  assert the observable part only: two instances share `Object.getOwnPropertyDescriptor(…).get`.

---

## R14-06 — [P2] Store methods are arrow fields: method overrides are silently ignored

**Where.** `Carburetor` (`lib/src/Carburetor/Store/Carburetor.ts`) declares
`getUID`, `getVersion`, `getData`, `read`, `setData`, `snapshot`, `restore`, `toJSON`, `fromJSON`,
`subscribe`, `unsubscribe`, `watch`, `notifyWrites`, `update`, `emitSoon`, `touchDraft`,
`recordWrite`, `markAllChanged`, `preEmit` and `emitUpdate` as arrow-function fields.
`ResourceCacheLifecycle`, `ResourceCache`, `ResourceCarburetor`, `Computed` and `SubscriberIndex`
follow the same pattern.

**Mechanism.**
- A field is an own property installed by the base constructor. A subclass *method* with the same
  name lives on the subclass prototype, which the own property shadows.
- The README documents `preEmit()` as a protected hook to override. Writing it the way that
  signature reads makes it silently dead.
- The demo happens to use `preEmit = () => {…}`, which works only because subclass fields are
  assigned after base fields.
- Overriding `subscribe` or `setData` as a method, for example to add logging, fails the same way,
  and `super.x()` cannot reach a base arrow field at all.

**Reproduction.**

```js
class Totals extends Carburetor {
    preEmit() { this.data.total = this.data.items.reduce((a, b) => a + b, 0); }
    add(n) { this.update((d) => { d.items.push(n); }); }
}
store.add(5);  // total stays 0: the method never runs
```

An overridden `subscribe(cb, o) { log(); return super.subscribe(cb, o); }` is never called either.

The allocation side matters less: about 20 closures per store, and more per resource cache.

**Fix direction.**
- Make every overridable or public member a prototype method, as round 13 did for components.
- Keep a bound field only where the function itself is handed out as a callback. `recordWrite` is
  passed to `createWriteProxy`. `getData`/`read` might be destructured by callers; if detaching them
  is meant to stay supported, bind those two explicitly.
- The native rule set already knows `preEmit`. A lint that flags a method-syntax override of a base
  arrow field becomes unnecessary once the base uses methods.

---

## R14-07 — [P2] Each read proxy allocates about nine objects

**Where.** `createReadProxy` (`createReadProxy.ts:59-93`).

**Mechanism.** Every branch proxy creates:
- `forbidWrite`, `lockedError` and `lockedAgainstWrapping`;
- a fresh handler object;
- fresh `get`, `has`, `ownKeys` and `getOwnPropertyDescriptor` closures;
- the proxy itself.

None of these depends on the branch except through `basePath`, `record`, `aliases` and `cache`.
The receiver the `get` trap closes over (`proxy`) is also passed to the trap as its third argument.

A row that reads `items[id].title` through `useCarburetor` builds 3 proxies — root, `items` and the
row — so roughly 27 allocations per row per root rebuild.

**Evidence.** A CPU profile of `benchmarks/ssrAntiHookComponent.mjs` (4 000 rows, production build,
median 42 ms per pass) attributes 24.7% of self time to the garbage collector. It is the largest
single entry, ahead of the engine's own trap code.

**Fix direction.**
- One handler class with prototype traps, holding `{basePath, record, aliases, cache}` as fields: one
  small object per proxy instead of eight.
- The write-forbidding traps become shared constants.
- Use the trap's `receiver` argument instead of the closed-over proxy.
- `createWriteProxy` gets the same treatment.

Measure the benchmark before and after; the round 13 number to beat is 61 ms mean for 4 000 rows.

---

## R14-08 — [P3] Small removals

- **Inherited reads are recorded.** `items.map(...)` records `items.map` and `items.constructor`
  (see R14-02), and so does any prototype method call. They cost read-set entries and index
  registration, and the paths are not data. Skip recording when the key is not an own property and
  resolves on `Array.prototype`/`Object.prototype`. An absent own key must still record, so that a
  later add wakes the reader.
- **`Carburetor.subscribe` copies the read set** (`Carburetor.ts:140`) even when a component hands
  over an immutable committed set. Accept ownership, as `UpdateBatch.add` does since round 13, and
  keep the copy for external callers through `watch`.
- **`SubscriberIndex.eachAncestor` slices a new string per ancestor** on every `add` and `remove`. A
  4 000-row mount with depth-3 paths slices tens of thousands of strings. Cache each path's ancestor
  list in `readsById`, or compute it once per add and reuse it for remove.
- **Render attempts allocate eagerly.** `openRenderAttempt` creates `entries`, `sources` and
  `deferredLoads` on every render (`Foundation.tsx:216-217`). `sources` is used only by
  `connect()`, and `deferredLoads` only by `useResource`. Create them lazily.
- **`track()` concatenates its attempt key on every call** (`Reads.tsx:307`): `"t:" + uid` for each
  `useCarburetor`/`useComputed`/`useResource` call in every render. Memoize the key per source in a
  `WeakMap`, or key the attempt map by the source object itself.
- **`useCarburetorValue.getSnapshot` builds a fresh read-proxy tree per miss**
  (`useCarburetorValue.ts:168`). An inline selector is a new function every render, so the cache
  misses on every render and snapshot check. Keep one persistent root view per hook, as
  `buildTrackedView` does for `useCarburetor`, and key the cache on the version plus the selector's
  previous result.
- **`ResourceCache.evict` scans every subscriber's read set** (`retainedKeys`,
  `ResourceCacheLifecycle.ts:228`) on each fetch over capacity. `SubscriberIndex.branch` already
  answers "is anyone reading below `entries.<key>`" in O(1) per key.

---

## R14-09 — API decisions before 1.0

1. **Prototype methods on stores (R14-06).** This is the one API change with a correctness payoff.
   It stays compatible for callers of `store.x()`. It breaks callers that detach methods without
   binding (`const {getData} = store`), unless those are bound explicitly.
2. **A computed's result is live.** R14-01 exists because consumers read through the result and
   amend the computed's dependencies after the fact. Fixing the cost (R14-01) keeps the semantics.
   The alternative — a computed returning detached data, like `connectSelection` — would make
   derived lists cheap to compare and would let a structural comparison skip re-renders. But
   consumers could no longer subscribe to deeper leaves through it. Worth deciding explicitly and
   documenting either way.
3. **Four ways to read in a class component** (`useCarburetor`, `connect`, `connectSelection`,
   `useComputed`), plus two hooks. The first two differ only in when the root view is built, now that
   `useCarburetor` keeps a persistent root (round 13). Documenting `connect` as the default and
   `useCarburetor` as the dynamic-source form would shorten the README's decision tree without
   removing anything.
4. **`toJSON`/`fromJSON` duplicate `snapshot`/`restore`** in type-erased form. If the only consumer
   is `CarburetorScope` dehydration, they could become internal. Low value; mention only.

---

## Verification and limits

- All probes were bounded single runs. The largest, R14-01 at 4 000 rows, ran for about two minutes
  of CPU because of the very quadratic cost it measures. Smaller sizes would have been enough to show
  the growth, and future re-runs should stop at 2 000 rows.
- The probes, the profile and the scratch scripts lived in the gitignored `.consumer-matrix/r14/`
  directory and were deleted after this report was written. The snippets above are enough to
  recreate them.
- Render counts (R14-02, R14-03, R14-04) are exact, taken from real `react-dom/client` commits in
  jsdom. Their millisecond figures use React's development build.
- R14-05 was confirmed on the shipped engine. The before/after construction timing comes from a
  minimal model of the constructor pattern, not from a patched engine.
- R14-07 is derived from the code plus the profile's GC share. The alternative handler design was not
  benchmarked.
- R14-08 is derived from the code.
- No engine source was changed in this round.
