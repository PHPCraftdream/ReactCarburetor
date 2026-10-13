# Performance audit — 2026-09-22

Hunting one pattern across the engine: real work done unconditionally where a check would show
nothing changed. This is the same family as the two findings already confirmed for this effort
(`useCarburetor` allocates a fresh read-tracking proxy on every render; `commitSubscriptions()`
unsubscribes and resubscribes through `SubscriberIndex` on every commit even when the read set is
byte-identical). Ground rules from `CONTRIBUTING.md`: "Never create an unnecessary re-render"
(precision beats smoothing) and "Render stays pure". Everything below was established by reading
the current source on branch `perf-audit` (commit `e3019fa`); no benchmarks were run for this
audit, and no engine code was changed.

Findings per area, then the priority ranking a follow-up fix task should use.

## 1. `ResourceCache.getEntry` via `AntiHookComponent.useResource` — Confirmed

`AntiHookComponent.useResource` (`lib/src/Carburetor/Component/AntiHookComponent.tsx:116-132`)
runs on every render and calls the cache unconditionally:

```tsx
this.track(source).reads.add(source.pathOf(args));   // :120

const view = source.getEntry(args);                  // :122
```

`getEntry` (`lib/src/Carburetor/Resource/Cache/ResourceCache.ts:90-97`) allocates on every call:

```ts
const key = this.keyOf(args);                        // :91
const entry = this.data.entries[key] || getInitialCacheEntry<T>();   // :92

this.touch(key);                                     // :94

return {...entry, stale: this.isStale(entry)};       // :96
```

What this costs per render, even when the underlying entry has not changed since the last render:

- `{...entry, stale}` — a fresh view object every call (`IResourceView<T>`). The entry in the
  store may be the exact same object as last render; the component still gets a new one.
- `keyOf(args)` → `encodeCacheKey` (`encodeCacheKey.ts:17-25`) — `JSON.stringify` plus two
  `split(...).join(...)` passes, i.e. several strings and two arrays, on every call.
- The same `encodeCacheKey(args)` runs a second time per render, because `useResource` calls
  `source.pathOf(args)` (:120) and `getEntry` calls `keyOf(args)` (:91) — two serializations of
  identical arguments per render.
- A first read of a not-yet-loaded entry additionally allocates `getInitialCacheEntry()`
  (`getInitialCacheEntry.ts:5-12`) on every render until the entry exists.

`this.touch(key)` (:94) is O(1) bookkeeping (counter bump + `Map.set`), not counted against it.

**When it fires:** every render of every component that calls `useResource` — mount, every
re-render triggered by any subscribed path, and every parent re-render that passes
`shouldComponentUpdate`. Same frequency class as the already-confirmed per-render proxy
allocation in `useCarburetor`.

**Secondary effect (inferred from code, not measured):** because the view is a new object on
every render, a consumer passing `view` down as a prop defeats the child's
`shallowEqual` gate in `shouldComponentUpdate` (`AntiHookComponent.tsx:57`) — the child
re-renders on every parent render even though nothing it reads changed. That is literally
"creating an unnecessary re-render", the thing the design rules forbid.

**Caveat for the fix task:** `stale` is a verdict computed at read time from `Date.now()` and the
TTL (`isStale`, `ResourceCache.ts:215-221`; the docstring at :84-89 says "the freshness verdict
computed now"). A cached view must still recompute staleness cheaply per call, or TTL expiry
stops being visible. Caching keyed on the entry object's identity would preserve the entry-data
half; the `stale` half must stay live.

## 2. `ComponentUpdateThrottle` / `SyncUpdateScheduler` — Ruled out

- `SyncUpdateScheduler.schedule` (`Scheduling/SyncUpdateScheduler.ts:12-14`) is `updater()` — a
  direct call. Zero allocation, nothing pending to check, nothing to gate.
- `ComponentUpdateThrottle.schedule` (`ComponentUpdateThrottle.ts:20-23`) is a `Map.set` plus
  arm-the-timeout-if-not-armed — O(1), no arrays, sets or closures per schedule call. The only
  array copy, `Array.from(this.updaters.values())` (`:69`), runs inside the flush — i.e. only
  when updates are actually queued — and is required there: the queue must be cleared before
  running the batch because updaters may queue again mid-flush. It fires at most once per
  coalescing window, and only when there is real work.

No per-schedule-call allocation when nothing is pending. Not the pattern.

## 3. `UpdateBatch` / `Transaction` — Ruled out as asked; one minor adjacent finding

The question was whether a `Set` is copied repeatedly during a single transaction instead of
accumulating once. It is not: `UpdateBatch.add` (`Transaction/UpdateBatch.ts:37-47`) keeps one
merged set per carburetor — the first emission copies (`new Set<TPath>(writes)`, `:41`), and
every subsequent emission merges element-wise (`writes.forEach(... merged.add(path))`, `:46`).
`transaction()` itself (`transaction.ts:20-38`) allocates nothing — begin/end are depth
counters. The flush's `Array.from(this.pending.entries())` (`:53`) runs only when work is
pending.

**Minor adjacent finding (confirmed):** in the transaction path the write set is copied twice
per carburetor per transaction. `Carburetor.emitUpdate` already hands over a detached copy —
`new Set<TPath>(this.writes)` (`Store/Carburetor.ts:251`) — and `add` then copies that copy at
`UpdateBatch.ts:41`, although nothing else retains it. One redundant O(paths) copy per
carburetor per transaction. Frequency: per write batch inside a transaction — per user action,
not per render. Real but small; fix only alongside other transaction work, not as its own task.

## 4. `snapshot()` / `deepClone` call sites — one Confirmed (devtools), the rest Ruled out

`deepClone` has exactly two entry points: `Carburetor.snapshot` (`Store/Carburetor.ts:91-93`)
and `Carburetor.restore` (`:96-98`); `toJSON` (`:101-103`) delegates to `snapshot`. All call
sites in `lib/src/`:

| Call site | Fires | Verdict |
|---|---|---|
| `connectDevTools.publish` → `composeState` (`Tooling/connectDevTools.ts:44-50, 15-23`) | every write | **Confirmed** |
| `CarburetorHistory.record` (`Tooling/CarburetorHistory.ts:80-93`, snapshot at `:92`) | once per change | Ruled out |
| `CarburetorHistory.apply` → `restore` (`CarburetorHistory.ts:96-108`, restore at `:103`) | once per undo/redo | Ruled out |
| `persist` watcher (`Tooling/persist.ts:26-28`) | once per change | Ruled out |
| `CarburetorScope.dehydrate` (`Component/Scope/CarburetorScope.ts:39-49`) | once per SSR request | Ruled out |

**Confirmed — `connectDevTools`:** every carburetor gets a wildcard subscriber (`:52-54`) whose
callback is `publish`, and `publish` calls `composeState(carburetors)` (`:49`), which calls
`toJSON()` — a full `deepClone` — on **every** carburetor in the map (`:19`). So a write to one
store deep-clones every store; a transaction touching three stores produces three notification
passes, each cloning all N stores: 3N full state copies for one user action. The actual need is
one snapshot of the store that changed (the payload only differs in which store changed).
Scope caveat: opt-in tooling — without the Redux DevTools extension installed `connectDevTools`
is a no-op (`:33-35`), so this costs nothing in a clean production session, but it fires per
write in any session where devtools is wired up (typically development).

**Ruled out:**

- `CarburetorHistory.record` — one snapshot per change is the documented floor for
  snapshot-based undo ("Cost: one deep copy of the state per change", class docstring
  `CarburetorHistory.ts:10-13`). The watch is per carburetor with `WILDCARD_PATH` (`:27`), so it
  fires once per notification pass — once per change, not once per subscriber notified. And
  `apply` deliberately reuses the history entry instead of taking a second copy (`:100-103`
  comment) — undo/redo costs exactly one `restore` copy, which is required so the store never
  aliases the history entry.
- `persist` — one `snapshot` + `JSON.stringify` per change is its documented contract
  ("writes a snapshot on every change", `persist.ts:8`).
- `CarburetorScope.dehydrate` — once per server request, by definition of the API.

## 5. `shallowEqual` in `shouldComponentUpdate` — Ruled out

The comparison is the gate itself. `shouldComponentUpdate`
(`AntiHookComponent.tsx:56-58`) calls `shallowEqual` on props and state exactly when React hands
the component a possible update (parent render, `setState`); the engine's own
`forceUpdate` deliberately bypasses it (`AntiHookComponent.tsx:221-223`), so it never runs for
the precise carburetor-driven updates. The only other engine call site is the `useEffect` deps
check (`:186`) — also a genuine change gate. No redundant caller exists (grep over `lib/src`:
these two only; `ScopedAntiHookComponent` does not override `shouldComponentUpdate`).

Cost: two `Object.keys` arrays per call (`shallowEqual.ts:17-19`), O(props size), on every
React-initiated update check — inherent to a shallow compare and identical to what React.memo's
builtin check does. When a component has no state, `Object.is(null, null)` short-circuits the
state half. Micro-observations, not the pattern and not worth a task on their own: the
right-hand `Object.keys(rightRecord)` is allocated only to read `.length` (`shallowEqual.ts:19`),
and `leftKeys.every` allocates a closure per call (`:23-25`).

## Priority ranking for the follow-up fix task

1. **`ResourceCache.getEntry` per-render allocations** (item 1) — fires on every render of every
   resource-reading component, and the fresh view identity additionally defeats children's
   `shallowEqual` prop gate. Same frequency class as the already-confirmed `useCarburetor`
   proxy allocation; fix both in the same effort if possible.
2. **`connectDevTools` full-state re-clone per write** (item 4) — per write × every connected
   carburetor (× stores touched per transaction). Heaviest single occurrence (full deep clones),
   but only in devtools-connected sessions.
3. **Transaction write-set double copy** (item 3, minor) — one redundant O(paths) copy per
   carburetor per transaction. Batch with other transaction work; never as a standalone fix.

No follow-up needed: items 2 and 5, `CarburetorHistory`, `persist`, `dehydrate`.
