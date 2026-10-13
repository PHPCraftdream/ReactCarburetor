# JS review, round 16 — performance, renders, allocations, API — 2026-09-28

Scope: the engine (`lib/src/Carburetor`) and the hooks bridge (`lib/src/Interop`) on `react-compat` at
`8dd7e67`, after every round 15 fix (`dist` rebuilt at `d8ab724`). The brief was the same as rounds 13–15:
fewer allocations, fewer renders, lower asymptotic cost, and a simpler API.

Method:
- Every claim marked Confirmed comes from a short, bounded probe against the built production engine
  (`dist/esm-prod`) on Node 24.12.
- Render counts come from a real `react-dom/client` root in jsdom (React 19.3, production build, driven by
  `flushSync`) and are exact.
- Memory figures are `heapUsed` deltas between forced GCs (`--expose-gc`).
- Millisecond figures are single-machine numbers from a machine that was not idle. They are given as
  min–median ranges over two runs unless marked as a single run. Growth rates and ratios matter more than
  the absolute values.
- Two findings (R16-04, R16-08) were also CPU-profiled (`--cpu-prof`). The profiler inflates absolute times,
  so only shares are quoted from it.

Round 15 made a leaf write wake only the components that read that leaf. This round found the read and
write *shapes* that still wake far more than they change — and three of them are the shapes the README
itself recommends:
- enumerating a branch (`Object.keys`) subscribes to every leaf under it;
- replacing an object through `draft` (`draft.items[id] = todo`) wakes every reader of every field of it;
- `setData`, `restore`, undo and redo wake every subscriber of the store.

It also found two superlinear costs: `ResourceCache` bookkeeping is O(N²) over a list, and computed
invalidation is exponential in the depth of a diamond-shaped dependency graph.

## Priority index

| ID | Priority | Area | Summary | Verdict |
|---|---|---|---|---|
| R16-01 | P1 | Tracking | `Object.keys`/`values`/`entries`/`for…in` on a branch subscribe to every write below it; at the root, to every write in the store. A keys-enumerating list parent re-renders on every title edit: 5.0–13.6 ms per edit at 4000 rows against 0.39–0.79 ms with an `ids` array | Confirmed |
| R16-02 | P1 | Store / Tooling | `setData`, `restore`, `fromJSON`, undo and redo record the wildcard: undoing one title edit re-renders all 4000 rows (68–116 ms); `setData` with an identical copy re-renders all of them too | Confirmed |
| R16-03 | P1 | Tracking / Docs | Replacing an object through `draft` — the README's and the demo's write pattern — wakes every reader of every field under it. With a filter active, one title keystroke recomputes the filter over the whole list: 17–28 ms at 4000 items, against 0.26–0.38 ms for a field write | Confirmed |
| R16-04 | P1 | Resource | Every `ResourceCache` fetch and every answer scans all entries (`Object.keys`, then filter and sort past `maxEntries`): O(N²) for a list of resource rows — 8.1 s to settle 4000 rows with the default limit, 3.1 s with eviction off | Confirmed + profile |
| R16-05 | P2 | Component | The commit-time drift check compares the store-wide version, not the paths read: any write between a component's render and its commit costs it a second render. Rows that register themselves on mount render twice each | Confirmed |
| R16-06 | P2 | Derived | `Computed.markStale` walks every path of the dependency graph, not every node: 1.15 million marks for one write through a 26-node chain of diamonds | Confirmed |
| R16-07 | P2 | Tooling | `CarburetorHistory` deep-copies the whole state on every write: 2.5–5.4 ms per keystroke and 16 MB for 50 entries at 4000 items | Confirmed |
| R16-08 | P2 | Derived / Tracking | A tracked walk costs ~50× the plain loop and an observed recompute ~75×; a quarter of a recompute is comparing two freshly built read sets | Confirmed + profile |
| R16-09 | P3 | Various | Allocation removals that are easy to make | Confirmed / code-derived |
| R16-10 | API | Surface | Decisions worth making before 1.0 | Proposal |

Recommended order:
1. R16-01 first: one trap and three write traps, and it removes the widest over-subscription left.
2. R16-04 and R16-06: each is local to one method and removes a superlinear cost.
3. R16-02 and R16-03 together: one structural-diff helper, used by `setData`/`restore` and by the write
   proxy's object replacement. Change the README's write example in the same step. R16-07 (history)
   follows, on patches or on the same helper.
4. R16-05.
5. Then R16-08 and R16-09.

---

## R16-01 — [P1] Enumerating a branch subscribes to everything under it

**Where.** `ReadProxyHandler.ownKeys` (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:319-323`)
records `this.basePath || WILDCARD_PATH`.

**Mechanism.**
- `Object.keys`, `Object.values`, `Object.entries`, `for…in`, object spread and `JSON.stringify` all call
  `ownKeys`. The trap records the branch's own path (`items`); at the root it records the wildcard.
- `SubscriberIndex.match` wakes a reader of `p` for every write at `p` *or anywhere below it* (the "read sits
  above the write" lookup, `exact[ancestor]`). So a reader that enumerated `items` is woken by
  `items.k5.title`, a leaf it never read. A reader that enumerated the root is woken by every write in the
  store.
- The README describes the intended behaviour, not the actual one: "Enumerating (`Object.keys`) *does*
  subscribe to the structure, because that genuinely reads it". The structure is the key set, and a title
  edit does not change it.
- The README's own `activeCount` example (`Object.keys(items).filter(...)`, `README.md:317`) recomputes on
  every title edit because of this — not, as its text says, because of the `items.<id>` replacement.

**Evidence (Confirmed).**

One component per read form, 100 items, production React:

| Render body | Renders after a write to `items.k5.title` | Renders after adding `items.kNew` |
|---|---|---|
| `Object.keys(d.items).length` | **1** | 1 |
| `Object.values(d.items).filter(t => t.done).length` | **1** | 1 |
| `Object.entries(d.items).length` | **1** | 1 |
| `for (k in d.items)` count | **1** | 1 |
| `Object.keys(d.items.k0)` | 0 | 0 |
| `Object.keys(d)` (the root) | **1** | **1** |

Only a key-set change should wake a structural reader: the bold cells are over-subscription. The root reader
is woken by adding `items.kNew`, which does not change the root's keys.

A list parent that lays out rows from `Object.keys(items)`, against one that reads an `ids` array; rows
connected by id; one title edited:

| Rows | The list reads | List renders per edit | Row renders per edit | Edit time |
|---|---|---|---|---|
| 1000 | `Object.keys(items)` | 1 | 1 | 1.1–4.0 ms |
| 1000 | `ids` | 0 | 1 | 0.16–0.30 ms |
| 4000 | `Object.keys(items)` | 1 | 1 | 5.0–13.6 ms |
| 4000 | `ids` | 0 | 1 | 0.39–0.79 ms |

**Fix.**
- Give the key set its own marker, like the branch marker: `ownKeys` records `<path>.~k`, and `~k` at the
  root. `~k` cannot collide with data for the same reason `~p` cannot: `joinPath` escapes `~` in keys.
- The write proxy records that marker when a key appears or disappears:
  - `set` on a key that was not own (the trap already calls `hasOwnProperty` for its no-op test);
  - `defineProperty` of a new key;
  - `deleteProperty`;
  - a `length` write that truncates indices.
- A value write under the branch then no longer reaches enumerating readers. Adding or removing a key still
  does, and replacing the branch itself still does, through the ancestor rule (`items` is an ancestor of
  `items.~k`).
- Update the README table: the `items (enumerated)` row no longer wakes on a write to `items.a1`.
- Regression tests:
  - the six forms above, where only key-set changes wake;
  - arrays: `Object.keys(arr)` still wakes on `push` and `pop`;
  - `detachSelection` and `sameSelection` still subscribe to every leaf they copy.

---

## R16-02 — [P1] `setData`, `restore`, undo and redo wake every subscriber

**Where.**
- `Carburetor.setData` (`lib/src/Carburetor/Store/Carburetor.ts:105-113`) records the wildcard.
- `restore` (`:121-123`) and `fromJSON` (`:131-133`) go through it.
- `CarburetorHistory.apply` (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:116-128`) calls `restore`.
- `ResourceCarburetor.restore` and `ResourceCacheLifecycle.restore` end in `setData` too.

**Mechanism.**
- A whole-state replacement records `WILDCARD_PATH`, and `match` answers it with every registered
  subscriber. Every component reading the store re-renders, including every one whose paths hold the same
  values before and after.
- `restore` deep-copies the snapshot first, so the old and new trees share no object and nothing downstream
  can tell an unchanged branch by identity either.
- The callers:
  - undo and redo (`CarburetorHistory`);
  - devtools time travel (`connectDevTools` → `fromJSON`);
  - `persist`'s initial load and scope hydration;
  - "replace the list with the server's answer" — the demo's `applyLoadedList` is
    `this.setData(deepClone(data))` (`lib/src/ToDo/Carburetors/TodoCarburetor.ts:185`).

**Evidence (Confirmed).** Rows connected by id, production React. One title is edited, then undone and
redone through `CarburetorHistory`:

| Rows | Edit renders | Undo renders | Undo time | Redo renders | Redo time |
|---|---|---|---|---|---|
| 1000 | 1 | **1000** | 14–28 ms | **1000** | 7–15 ms |
| 4000 | 1 | **4000** | 68–116 ms | **4000** | 30–31 ms |

A reload that returns identical content, `setData(deepClone(getData()))`:

| Rows | Renders | Time |
|---|---|---|
| 1000 | **1000** | 8–12 ms |
| 4000 | **4000** | 33–42 ms |

**Fix.**
- Diff the old tree against the new one and record the paths that differ, instead of the wildcard.
  - A model of that walk on the same 4000-item shape takes 1.7–2.7 ms whether nothing or one title changed,
    and records 0 or 1 path.
  - That is less than the deep copy `restore` already pays (2.5–3.4 ms on the same data).
- `setData(data)` keeps its identity contract: `getData() === data` afterwards. Only what it announces
  changes.
  - Views keyed by the data object already rebuild on their next render: `buildTrackedView`, the
    `connect()` facade and the interop root view all check `data` identity per call.
  - So a component that is not woken keeps showing correct output — none of its leaves changed — and
    rebuilds its view lazily.
- `restore(snapshot)` can go further: apply the difference into the live tree through `draft`, cloning only
  the values it assigns. No full copy at all, and untouched branches keep their identity.
- Bound the walk:
  - plain objects and arrays only (the tracking boundary); anything else is compared by reference;
  - a changed key set records the R16-01 marker;
  - a difference under a symbol key falls back to the wildcard;
  - past a threshold of differing leaves, record the replaced path itself rather than thousands of leaves.
- Regression tests:
  - undoing one edit wakes one row;
  - `setData` with an equal copy wakes nobody;
  - a changed key set wakes enumerating readers;
  - a root of another kind (array ↔ object, trackable ↔ not) still wakes everyone.

---

## R16-03 — [P1] Replacing an object through `draft` wakes every reader of every field under it

**Where.**
- `WriteProxyHandler.set` (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:164-215`) records the
  assigned key's path.
- The README's write example (`README.md:124`, `draft.items[todo.id] = todo`) and the demo's `updateTodo`
  (`lib/src/ToDo/Carburetors/TodoCarburetor.ts:61`) replace the whole todo.

**Mechanism.**
- `draft.items[id] = {...todo, title}` records `items.<id>`. Every reader of any leaf under it —
  `items.<id>.done`, `items.<id>.~p` — matches through the branch index, whether or not its own value
  changed.
- The row that shows the todo re-renders either way, so the render count looks right. The cost lands on
  computeds.
  - The README's `visibleIds` (`README.md:351-355`, the demo's `computeVisibleIds`) reads
    `items[id].done` for every id.
  - So each keystroke in any title recomputes it over the whole list. `{equals}` then suppresses the
    announcement, but the O(N) walk has already run.
- Combined with R16-01, the README's `activeCount` recomputes on every keystroke as well.

**Evidence (Confirmed, production React).** `visibleIds` under the Active filter (with
`{equals: shallowEqual}`), plus an `activeCount` computed, plus rows connected by id. A keystroke changes one
title. In every case: 1 row render and 0 list renders per keystroke.

| Items | Write | `activeCount` iterates | `visibleIds` recomputes | `activeCount` recomputes | Keystroke |
|---|---|---|---|---|---|
| 1000 | replace the object | `Object.keys(items)` | 1 | 1 | 4.2–7.5 ms |
| 1000 | write the field | `Object.keys(items)` | 0 | 1 | 2.0–3.6 ms |
| 1000 | replace the object | `orderIds` | 1 | 1 | 3.6–4.9 ms (single run) |
| 1000 | write the field | `orderIds` | 0 | 0 | 0.13–0.14 ms |
| 4000 | replace the object | `Object.keys(items)` | 1 | 1 | **17–28 ms** |
| 4000 | write the field | `Object.keys(items)` | 0 | 1 | 8.5–15 ms |
| 4000 | replace the object | `orderIds` | 1 | 1 | 21–36 ms (single run) |
| 4000 | write the field | `orderIds` | 0 | 0 | **0.26–0.38 ms** |

At 4000 items the README's two patterns together cost a keystroke more than a frame. The precise form costs
about 1/80 of that.

**Fix — two layers.**
- **Now, in the documentation.**
  - Show field writes (`draft.items[id].title = title`) or `Object.assign(draft.items[id], patch)` as the
    update form, and say what a replacement costs.
  - The `set` trap's no-op check already makes `Object.assign` record only the fields that actually changed.
  - Change the demo's `updateTodo` the same way.
- **In the engine.** When `set` replaces a plain object or array with another of the same kind, record
  R16-02's diff under that path instead of the path itself. The data still holds the new object; its
  identity changes as today.
  - Who can tell the difference:
    - a leaf reader is woken exactly when its value changed;
    - an enumerating reader is woken when the key set changed (the R16-01 marker);
    - a presence reader (`'k' in items`, the `~p` marker) is no longer woken by a same-kind replacement,
      because its answer did not change. The README's "woken when it is added, replaced or removed" becomes
      "added or removed".
  - What it relies on: views re-read from their root on every render, so no supported read holds the old
    object's proxy past a render (the README caveat "Don't stash tracked data outside render"). A computed
    that returned a live branch is recomputed whenever a leaf read through it changes, as today.
  - Cost: O(size of the replaced subtree) at write time — a subtree the caller has just built.
    Reference-equal children, as left by a spread, are skipped in O(1). R16-02's threshold caps a
    replacement that changes most leaves.

---

## R16-04 — [P1] Every `ResourceCache` fetch and answer scans all entries: O(N²) over a list

**Where.** `ResourceCacheLifecycle.evict` (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:269-314`),
called from `fetch` (`:432`), `settleSuccess` (`:508`) and `settleFailure` (`:549`).

**Mechanism.**
- `evict` starts with `Object.keys(this.data.entries)`, just to count the entries. That runs on every fetch
  and every answer, even with `maxEntries: Infinity`.
- Past `maxEntries` (default 100) it also:
  - filters every key, with a `joinPath` and a `hasReaderAt` each;
  - sorts the survivors.

  It does this even when every entry has a reader and nothing can be evicted.
- In a list where each row reads its own entry, every entry is retained, so every scan evicts nothing.
- A list of N resource rows therefore pays O(N) per load and O(N) per answer: O(N²) in total.

**Evidence (Confirmed, single run).** N rows, each `useResource(cache, id)`; the loader resolves
immediately. "Answers" is the time until every answer has landed.

| Rows | `maxEntries` | Mount | Answers | Scans past the limit | Evicted |
|---|---|---|---|---|---|
| 1000 | default (100) | 178 ms | 428 ms | 1900 | 0 |
| 1000 | `Infinity` | 122 ms | 131 ms | 0 | 0 |
| 4000 | default (100) | 1881 ms | **8073 ms** | 7900 | 0 |
| 4000 | `Infinity` | 1584 ms | **3066 ms** | 0 | 0 |

A CPU profile of the 4000-row `Infinity` run, mount and answers, attributes 2157 ms of self time to `evict`
alone — only the `Object.keys` count, since the scan never starts.

**Fix.**
- Keep an entry count, updated where entries are created and deleted (`markLoading`, `forgetKey`, `evict`,
  `restore`). Evict only when the count exceeds `maxEntries`.
- Keep `lastUsed` in LRU order: delete and re-set on `touch`, so the `Map`'s insertion order is the eviction
  order. Walk it from the oldest and stop after `excess` victims — no filter over every key, no sort.
- When a scan finds fewer victims than the excess (everything retained), do not rescan until the count grows
  further or a reader leaves. `hasReaderAt` per candidate stays.
- Regression tests:
  - 4000 rows with the default limit settle with a scan count proportional to N (assert the count, not a
    time);
  - eviction order stays least-recently-used.

---

## R16-05 — [P2] The commit drift check re-renders on any write to the store, not on writes to what was read

**Where.** `Subscriptions.alignSubscription`
(`lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx:248`) compares
`committed.carburetor.getVersion() !== committed.baselineVersion`, and `commitSubscriptions` (`:151-153`)
force-updates on the result.

**Mechanism.**
- A render captures the store's version at its first read, and the commit compares it with the current
  version. The version moves on every emit, whatever path the emit touched.
- So any write between a component's render and its commit — to any path of that store — costs the component
  a second render, even when nothing it read changed.
- `componentDidMount`s run in tree order after all the renders. One write from an earlier sibling's mount
  therefore lands between every later sibling's render and its commit.
- Rows that register themselves on mount — a measured size, a "seen" flag, a lazy default — make each row's
  write a drift for every row after it.
- The README mentions the mechanism (caveat at `README.md:796`), but not that it ignores paths.
- The hooks bridge does not have the problem: `useSyncExternalStore` re-checks the selected value after
  mount, and an equal value renders nothing.

**Evidence (Confirmed, production React).** Render counts are exact. In a two-row trace of the writing-sibling
scenario, both extra `forceUpdate` calls came from `commitSubscriptions`, called from `componentDidMount`.

| Rows | Scenario | Row renders at mount |
|---|---|---|
| 1000 | rows only | 1000 |
| 1000 | one sibling before the rows writes `other` in `componentDidMount` | **2000** |
| 4000 | rows only | 4000 |
| 4000 | the same, with the writing sibling | **8000** |
| 1000 | every row writes `sizes[own id]` on mount and never reads `sizes` | **1999** |
| 4000 | the same | **7999** |

By the same mechanism (derived from the code, not probed), a time-sliced concurrent render re-renders every
component it committed if any write to the store landed while it was in progress.

**Fix.**
- Make the check path-precise.
  - The store remembers which paths its recent emits touched. Bound it by a count of paths, with a watermark
    below which the store knows nothing.
  - The commit checks its committed read set against the writes since its baseline, with the same three cases
    as `match`: the same path, a written ancestor, and a written descendant (found through the set of the
    read paths' ancestors).
- Fall back to today's force-update when the baseline is older than the watermark. Correctness never depends
  on the log; only the number of extra renders does.
- Regression tests:
  - both scenarios above render each row once;
  - a write to a path the row read, landing between its render and its commit, still re-renders it.

---

## R16-06 — [P2] Computed invalidation walks every path of the graph, not every node

**Where.** `Computed.markStale` (`lib/src/Carburetor/Derived/Computed.ts:488-507`).

**Mechanism.**
- `markStale` sets `valid = false` and recurses into every computed subscriber through `invalidationEdges`,
  with no check for "already stale".
- A node reached by k paths from the written store is marked k times, and so is everything downstream of it.
  In a chain of diamonds, the number of paths grows exponentially with depth.
- Settlement is not affected: `updateWave.defer` keys by uid, so each body still runs once. Only the marking
  explodes, and each mark also allocates `Array.from(subscribers.keys())` and a closure.

**Evidence (Confirmed).** A ladder: each computed reads the two before it. Subscribe to the last one, then
write the store once. Every `markStale` call is counted, recursive ones included.

| Nodes | Body runs | `markStale` calls | One write |
|---|---|---|---|
| 16 | 16 | 9,313 | 1.7–2.3 ms |
| 20 | 20 | 64,035 | 5.4–7.4 ms |
| 22 | 22 | 167,713 | 17–19 ms |
| 24 | 24 | 439,152 | 33–36 ms |
| 26 | 26 | 1,149,795 | 74–79 ms |

Marks grow ×1.62 per node (Fibonacci). By extrapolation, 30 nodes take ~0.5 s per write and 36 about 10 s.

**Fix.**
- Return early from `markStale` when `valid` is already false.
  - This is safe because validity is monotone along edges. A computed becomes valid only by recomputing,
    which reads its upstream through `get()` and so revalidates the upstream first.
  - So a computed that is already invalid has invalid downstream — marked by the pass that invalidated it.
- Iterate `subscribers` without the `Array.from` copy: marking never subscribes or unsubscribes.
- Regression test: the 26-node ladder marks each node once per write (26 calls) and still settles every body
  once.

---

## R16-07 — [P2] `CarburetorHistory` deep-copies the whole state on every write

**Where.** `CarburetorHistory.record` (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:101-113`) calls
`carburetor.snapshot()`, a `deepClone`, after every change; `apply` calls `restore` (R16-02).

**Mechanism.**
- Every recorded change copies the entire state, O(state), and `limit` full copies (default 50) stay alive.
- Undo and redo then pay R16-02: they wake everyone.
- The class docstring calls one deep copy per change "the floor for snapshot-based history". It is the floor
  for *snapshots*, not for history: the write proxy already knows every path it writes and the value it
  replaces.

**Evidence (Confirmed).** One title write, with and without a history attached:

| Items | Write without history | Write with history | 50 entries retain |
|---|---|---|---|
| 1000 | 0.01 ms | 0.59–1.18 ms | 5.46 MB |
| 4000 | 0.01 ms | 2.47–5.40 ms | 16.33 MB |

Models on the same shape:
- **Copy-on-write snapshots** (copy the containers on the written path, share the rest): 0.02 ms per write
  and 0.43 MB for 50 entries at 1000 items. At 4000 items it is 1.2–1.9 ms and 9.4 MB, because copying a
  4000-key dictionary on every write is O(N) on its own.
- **A patch log** costs O(changed values) per entry by construction.

**Fix.**
- Record patches. While a history — or any patch listener — is attached, the write proxy reports
  `(path, previous, next)` for each write it records, deep-copying any replaced plain value it hands out.
- A history entry is the list of inverse patches. Undo applies them through `draft`, so it announces exactly
  the undone paths — R16-02's undo case disappears without a diff.
- Writes the proxy cannot describe — the wildcard (`markAllChanged`, an untrackable root, a symbol key) —
  record a full snapshot entry, as today.
- With nothing attached, the write proxy pays one `undefined` check per write.

---

## R16-08 — [P2] A tracked walk costs ~50× the plain loop; an observed recompute ~75×

**Where.**
- `Computed.recompute` (`lib/src/Carburetor/Derived/Computed.ts:223-249`) calls `source.read(...)` on every
  recompute (`:233`), so each recompute builds a new proxy tree.
- `recordDependencyRead` (`:274-290`).
- `attachDependencies` → `diffDependencies` → `sameReads` (`:293-385`).

**Mechanism.** From a CPU profile of 300 recomputes of a filter over 4000 items:
- **About 60% is in the read traps** (`get`, `has`).
  - About 23% of the total is `recordDependencyRead`.
  - For each new path it does `dependency.reads.has`/`add`, plus
    `this.dependencies[dependency.source.getUID()]` to decide whether the dependency is published.
  - That is a method call and a dictionary lookup per path, 12,000 paths per recompute.
- **About 27% is in `sameReads`**, which compares the fresh 12,000-path set with the previous one.
  - Every path string is new: each recompute builds a new proxy tree, and the path memo lives on that tree's
    handlers.
  - So each lookup hashes the string and compares characters, instead of hitting a cached hash.
  - `forEach` cannot stop early either.
- **The rest** of the recompute is the filter itself and `shallowEqual` on the result (R16-09).
- **GC comes on top**: 9% of the whole profile, fed by a fresh 12,000-entry Set and fresh proxies, handlers
  and cache entries per item on every recompute.

**Evidence (Confirmed, single run, min–median of 40 samples).** A filter over N items, Active filter:

| Items | Plain `filter` on raw data | Tracked walk, fresh tree | Tracked walk, reused tree | Observed computed, recompute after a toggle |
|---|---|---|---|---|
| 1000 | 0.03–0.04 ms | 1.5–2.5 ms | 0.9–1.1 ms | 2.0–3.0 ms |
| 4000 | 0.13–0.16 ms | 6.8–9.8 ms | 4.1–7.2 ms | 10–17 ms |

**Fix.** Three independent pieces:
- Make "published" a flag that `attachDependencies` sets, instead of a lookup per path.
- Fold the comparison into recording. While recording into the fresh set, count how many paths the previous
  set already held; the sets are the same when that count equals both sizes. No second pass.
- Reuse a computed's proxy tree per source across recomputes, as `buildTrackedView` does for components.
  Path strings, handlers and branch proxies would survive, and lookups would hit cached hashes.
  - This one changes the identity of the elements a computed hands out: they would stop changing on every
    recompute.
  - A changing identity is exactly what keeps R15-02's escape pattern correct today. So this piece needs
    R15-10 (1) first; the first two do not.

---

## R16-09 — [P3] Small removals

- **The index files every read set twice.**
  - `SubscriberIndex.filedById` keeps a copy of each subscriber's non-wildcard paths next to `readsById`.
  - Measured on 4000 four-path subscribers, that copy is 240 of the 549 B of index bookkeeping per
    subscriber.
  - The case the copy guards against — `add` handed back the same, already amended set — does not arise with
    the current callers. Components hand over a fresh set per commit, and `alignSubscription` skips an
    identical one. A computed hands over a fresh set per recompute.
  - Diff against the previously adopted set, and keep one of the two maps. A public `subscribe` caller that
    mutates a set it already handed over (out of contract, but possible) is still covered if a re-registration
    handed the very instance the index holds re-files from scratch.
  - `Carburetor.subscribers` records also carry a `reads` field nothing reads.
- **`match` allocates per written path**: an ancestors array and sliced strings, plus two closures per call.
  Walk the ancestors in place.
- **`connect()` allocates two Maps per render.** Every render allocates `attempt.sources` and
  `attempt.connections`. The resolved source and the entry can live on the `ConnectionSource`, tagged with
  the attempt they belong to, while the attempt keeps a list of the connections it touched.
  `useCarburetor`'s `attempt.tracked` allows the same for the single-store case.
- **Commit and unmount allocate closures.** `commitSubscriptions` allocates six closures per commit (the
  `forEach` callbacks, one of them capturing `changedDuringRender`). `componentWillUnmount` allocates three
  closures and an array. Use plain loops.
- **Delivery paths allocate on every call.** `UpdateWave.end` allocates a `failures` array on every wave.
  `Computed.deliver` and `markStale` allocate an `Array.from` copy and a closure per call. Allocate the array
  on the first failure; R16-06 covers the copy.
- **`shallowEqual` on arrays is slow.**
  - It goes through `Object.keys`, which builds a string per index, and `every`.
  - Two 4000-element id arrays take 0.11–0.18 ms, against 0.01 ms for a length-and-index loop.
  - It is the documented `equals` for id arrays. Add an array branch.
- **`sameSelection` allocates two WeakMaps per call**, even for a primitive. A primitive comparison costs
  202 ns against 15 ns for `Object.is`; a two-field object costs ~1.9 µs. Allocate the maps at the first
  container.
- **`fromJSON` copies what it was just handed.**
  - `connectDevTools` and scope hydration pass freshly parsed JSON, and `restore` deep-copies it again.
  - At 4000 items, parse plus `fromJSON` takes 5.3–7.6 ms against 2.0–2.9 ms for the parse alone (single
    run).
  - Let `fromJSON` adopt its argument and document the ownership; keep `restore` copying.
- **`persist` stringifies the whole store on every write**: 0.94–1.44 ms per keystroke at 4000 items (single
  run). Coalesce to one stringify per microtask, or take a `throttle` option.
- **Per-object leftovers:**
  - `ProxyCache` allocates one `{path, proxy}` object per cached branch.
  - Every `connect()` facade gets its own empty target. The target is never mutated — every mutation trap
    throws — so one shared `{}` and one shared `[]` would do.

---

## R16-10 — API decisions before 1.0

1. **Path strings are public API by accident.**
   - `watch(callback, reads?)`, `subscribe(callback, {reads})`, `read(record)` and the exported
     `TPath`/`TPathSet`/`TPathRecorder`/`WILDCARD_PATH` make the path grammar part of the contract: the `.`
     separator, the `~0`/`~1` escapes, the `~p` marker, and R16-01's `~k`.
   - Meanwhile the README says path plumbing is internal.
   - Every precision fix — R14-02/03/04, R15-01, R16-01 — changes which paths a read produces.
   - Either option works:
     - **Hide the grammar.** Add a selector-based `watch(select, onChange)`: track the selector's reads the
       way `useCarburetorValue` does, compare with `sameSelection`, and call `onChange(next, previous)`.
       Document `subscribe` and `read(record)` as the engine's extension contract.
     - **Document the grammar as stable** and version it.
   - `TAliasLedger`, the shape of a development-only ledger, is exported from `Models/Paths` as well.
2. **`setData`'s contract after R16-02.**
   - "Replaces the data and invalidates everything" becomes "replaces the data and wakes the readers of what
     changed". `getData() === data` still holds.
   - Decide whether a wholesale, no-diff replacement is still needed. `markAllChanged()` already provides one.
3. **Replacement or field writes (R16-03).**
   - If the engine diffs replacements, `draft.items[id] = next` becomes a precise form and the README example
     stays.
   - If not, the README should switch to field writes or `Object.assign` and say why.
4. **`IResourceSource` has six members**: `keyOf`, `pathOf`, `pathOfKey`, `getEntry`, `getEntryByKey` and
   `load`.
   - Two of the pairs exist only to avoid re-serializing arguments, and a custom source has to implement all
     six.
   - One `resolve(args) → {key, path, view}` plus `load(args)` would cover everything `useResource` needs.
5. **Two snapshot pairs.** `snapshot`/`restore` and `toJSON`/`fromJSON` do the same thing, one typed and one
   type-erased. With R16-09's ownership change they would differ in copying: say so in the API table, or keep
   one pair.
6. **R15-10 (1) is still open**, and R16-08's third fix depends on it.

---

## Checked, not reported

- **The `has` trap allocates a property descriptor per probe**, once per index in `map`/`filter`. Measured,
  it does not matter: `ids.map` over 4000 ids through a persistent view took 1.26–3.33 ms, and an index loop
  that skips `has` took 1.37–1.78 ms, with the same minimum.
- **The interop hook's version-keyed snapshot cache.** A notification only arrives for the hook's own paths,
  and an inline selector re-runs once per render by design.
- **`ComponentUpdateThrottle`, `UpdateBatch` and `transaction`** allocate once per flush, not per write.

## Verification and limits

- All probes were bounded runs of a few seconds each, at 1000 and 4000 rows (100 items for the per-form
  render table in R16-01).
  - They live in the gitignored `.consumer-matrix/r16/` directory, which the next consumer-matrix run wipes.
  - The descriptions above are enough to recreate them.
- Render counts (R16-01, R16-02, R16-03, R16-05) are exact, from real `react-dom/client` commits.
- `markStale` calls (R16-06) are counted through the shared invalidation-edge map, so recursive calls are
  included.
- The R16-02 diff and the R16-07 copy-on-write figures come from minimal models of the proposed fixes on the
  same data shapes, not from a patched engine.
- R16-09's allocation items without a figure are derived from the code.
- No engine source was changed in this round.

---

## Resolution (2026-09-29)

Every finding was fixed on `react-compat` except the third piece of R16-08, which still waits for
R15-10 (1). R16-10 (1) and (4) were decided by the maintainer: hide the path grammar behind a
selector `watch`, and cut `IResourceSource` to `resolve` plus `load`. Each fix was made by an agent
in its own worktree, then reviewed and integrated one at a time, with a commit per fix. Every
behavioural fix comes with regression tests shown to fail against the pre-fix code.

| Finding | Commit | Change |
|---|---|---|
| R16-01 | `e52def0` | `ownKeys` records a key-set marker (`<path>.~k`, bare `~k` at the root); the write proxy records it when a key appears (`set` on a non-own key, `defineProperty` of a new key), disappears (`deleteProperty`) or an array `length` write truncates |
| R16-05, R16-09 (component) | `dc7eb03`, `dd23cba` | The commit checks the store's recent writes against the paths it read (same path, written ancestor, written descendant); `connect()` keeps its per-attempt source and entry on the connection, facades share one empty target, commit and unmount run plain loops. `dd23cba` re-indexed the write log by path (see below) |
| R16-09 (store) | `ed6263a` | `SubscriberIndex` keeps one copy of each read set and matches without arrays or closures; lazy failure lists; array branch in `shallowEqual`; `sameSelection` allocates its WeakMaps at the first container; `persist(…, {coalesce: true})`; subscriber records drop an unread field; `TAliasLedger` is not exported |
| R16-06, R16-08 (1, 2), R16-09 (Computed) | `9e4ef94` | `markStale` returns once already stale; marking iterates without a copy; delivery copies its id list only past one subscriber; a `published` flag replaces the per-path lookup; read-set equality is counted while recording |
| R16-04 | `3394b26` | An `EvictionLedger` keeps the entry count and LRU order; eviction walks from the oldest and stops after the excess; a scan that finds too few victims is not repeated until the count doubles, a request settles or a reader leaves |
| R16-10 (1, 4) | `1c10029` | `watch(select, onChange)`; path types and `WILDCARD_PATH` are internal, `subscribe`/`read(record)` stay as the extension contract typed with `ReadonlySet<string>`; `IResourceSource` is `resolve(args) → {key, path, view}` plus `load(args)` |
| R16-02, R16-03, R16-09 (`fromJSON`), R16-10 (2, 3, 5) | `b443f8f` | A structural diff (plain objects and arrays, key-set marker, symbol and kind fallbacks, 2000-path threshold) behind `setData`, `restore` (applied through `draft`, copying only what it assigns), `fromJSON` (adopts its argument) and same-kind replacement in the write proxy; the demo writes fields |
| R16-07 | `2aa36c7` | The write proxy reports patches while a listener is attached; history entries are patch lists, with a before/after snapshot only for a change the proxy cannot describe; undo and redo install through `restore` |

Integration corrections:
- **`ProxyCache` stays one entry object per branch.** The R16-09 change to two parallel `WeakMap`s
  was dropped: in a micro-benchmark, building the cache got about 20× slower, and cache hits got no
  faster.
- **`Computed.deliver` keeps a snapshot past one subscriber.** The first version bounded a live
  iteration by the starting count. A subscriber that removed one peer and added another in the same
  pass then delivered to the newcomer too early. A regression test pins the snapshot semantics. The
  read-set overlap count also stops once the new set outgrows the old one.
- **The write log.** The first version preallocated a 4096-slot ring per store (~64 KB) and scanned it
  on every commit. After R16-01 each new key logs two paths, so 4000 rows adding their own key on
  mount overflowed the ring and fell back to 5951 renders. The scan was also O(N²) over those
  mounts. The log is now a pair of Maps: the last version written at each path, and the last
  version written below each ancestor. A write costs O(depth), a commit O(read paths × depth).
  Past 8192 indexed paths the log resets and raises its watermark.
- **Scope hydration clones** before `fromJSON`, and the resource stores override `fromJSON` to keep
  hydrating through their `restore`: once `fromJSON` adopts its argument, both would otherwise share
  or skip state.
- **`resolve()` returns a fresh record.** Reusing one scratch object would alias the results of two
  calls, and the method is public.

Before and after, on the built production engine (`dist/esm-prod` rebuilt at `d8ab724` against the rebuilt
`dist`), with the same probes as the report:

| Probe | Before | After |
|---|---|---|
| Title edit, list parent enumerating `Object.keys(items)`, 4000 rows | 1 parent render, 5.0–13.6 ms | 0 parent renders, 0.36–0.48 ms |
| Renders after adding `items.kNew`, root enumerator | 1 | 0 |
| Undo of one title edit, 4000 rows | 4000 renders, 68–116 ms | 1 render, 14 ms |
| `setData` with an identical copy, 4000 rows | 4000 renders, 33–42 ms | 0 renders |
| Keystroke written as an object replacement, 4000 items, `visibleIds` + `activeCount` over keys | 2 recomputes, 17–28 ms | 0 recomputes, 0.29–0.37 ms |
| 4000 `useResource` rows settling, default `maxEntries` | 8073 ms | 1622 ms |
| Mount with a sibling writing on mount, 4000 rows | 8000 row renders | 4000 |
| Mount where every row writes `sizes[own id]`, 4000 rows | 7999 renders | 4000 renders, 87 ms |
| One write through a 26-node diamond ladder | 1,149,795 marks, 74–79 ms | 99 marks, 0.2 ms |
| One title write with history, 4000 items | 2.47–5.40 ms, 50 entries retain 16.3 MB | ~0.01 ms, 0.1 MB |
| Index bookkeeping per four-path subscriber | 549 B | 360 B |
| `persist`, per write at 4000 items (default, synchronous) | 0.94–1.44 ms | 0.82–1.24 ms |

Two probes barely moved:
- **An observed recompute over 4000 items** takes 9.5–15 ms against 10–17 ms. The published flag
  and the folded comparison remove a pass, but the path hashing they skipped reappears while
  recording. The large share, a persistent proxy tree per computed, is R16-08's third piece and
  still waits for R15-10 (1).
- **`JSON.parse` plus `fromJSON` at 4000 items** takes 4.7–8.1 ms against 5.3–7.6 ms. The second
  copy is gone, but the diff that makes the call wake only the changed readers walks the same tree.

Not run this round: the consumer matrix (`npm run test:consumers`). Its fixture uses none of the
changed APIs, and CI runs it on push.
