# JS review, round 13 — performance, allocations, API — 2026-09-28

Scope: the engine (`lib/src/Carburetor`) and the hooks bridge (`lib/src/Interop`) at
`origin/master` `6841c61` plus the uncommitted React-compatibility work in
`worktrees/react-compat`. The brief was performance-first: fewer allocations, fewer renders,
lower asymptotic cost, and a simpler API.

Unlike rounds 11 and 12, this round measured things. Every performance claim below comes from a
short, bounded probe against the built `dist/esm` output under `NODE_ENV=production`, on Node
24.12. The probes are server rendering of class-component lists through `renderToString`, direct
calls into the store, the cache and computed, and one CPU profile. Numbers are wall-clock
figures from one machine and include GC noise, so the growth rate matters more than the
absolute value. The one correctness finding (R13-01) was reproduced directly.

## Priority index

| ID | Priority | Area | Summary | Verdict |
|---|---|---|---|---|
| R13-01 | P1 | Store / dual package | `getUid` is per copy: CJS+ESM copies mint identical ids, so the shared wave drops a settlement | Confirmed |
| R13-02 | P1 | Tracking | Every proxy-cache construction runs `retire()` over all live watchers, so list render is quadratic | Confirmed |
| R13-03 | P1 | Tracking | A primitive write publishes an invalidation, so each write costs O(live readers) | Confirmed |
| R13-04 | P1 | Derived | `Computed.get()` runs `Object.keys(subscribers)`, so a wave is O(S²) | Confirmed |
| R13-05 | P2 | Tracking | `liveViews.note` runs in production, where nothing ever consults it | Confirmed |
| R13-06 | P2 | Component | Instance proxy plus 10 arrow fields per instance tax construction and every `this.x` access | Confirmed |
| R13-07 | P2 | Tooling | `persist` deep-clones before stringifying, and `deepClone` defines every key | Confirmed |
| R13-08 | P2 | Interop | Default `Object.is` can never hold for an object selection, which is always a fresh copy | Code-derived |
| R13-09 | P3 | Various | Per-read and per-commit allocations that are easy to remove | Code-derived |
| R13-10 | API | Surface | Simplification candidates to decide before 1.0 | Proposal |

Recommended order: R13-01 before the react-compat work is committed. Then R13-02, R13-03 and
R13-05 as one small patch; together they turn the list render from quadratic into linear. Then
R13-04, then R13-06 (fields only), R13-07 and R13-08. The structural cache redesign in R13-02
and the API decisions in R13-10 come after that.

## R13-01 — [P1] Uids collide across library copies, and the shared wave loses a settlement

`getUid` (`Store/Utils/getUid.ts`) is a module-level counter. The react-compat work routes
`updateBatch`, `updateWave`, `CarburetorContext` and `invalidationEdges` through
`sharedSingleton`, but not this counter. A CJS copy and an ESM copy loaded into one process
(the dual-package case that work exists for) therefore both mint `carburetor-uid-1`,
`carburetor-uid-2`, and so on.

Uids are keys in shared structures:

- `UpdateWave.defer(uid, settle)` keeps one settlement per uid. The wave is now shared, so a
  computed from one copy replaces the settlement of a same-uid computed from the other copy,
  and the replaced one never runs.
- `Carburetor.subscribe(cb, {id})` replaces an existing registration with the same id. A
  component from copy A that subscribes to a store alongside a same-uid component from copy B
  silently takes over that component's subscription.

Reproduction (`dist/esm` plus `dist/cjs`, one computed each over its own store):

```
uids carburetor-uid-2 carburetor-uid-2
after one transaction writing both: heardA 0 heardB 1 (expected 1 and 1)
```

Fix: share the counter the same way as the other singletons, for example
`sharedSingleton('uidCounter', () => ({next: 0}))`, and add the case to
`sharedSingleton.dualFormat.test.ts`. `carburetorToken`'s `takenNames` has the same per-copy
shape. There it only weakens a duplicate-name check, so it belongs in the same pass.

## R13-02 — [P1] Proxy-cache retirement makes list render quadratic

Every `createReadProxy`/`createWriteProxy` call creates a proxy cache
(`Store/Tracking/createProxyCache.ts:168`). Construction runs `retire()` (`:246`), and
`retire()` walks every watcher in the invalidation scope of the same raw object (`:199-215`).
Watchers are `WeakRef`s. They leave the set only once they are empty or collected, so between
GCs every render's root proxy stays in the scope of the store root. `useCarburetor` creates one
root proxy per call. A list of N rows reading one store therefore costs O(N²) at render. A
`connect()` view builds one proxy per component, so it is quadratic at mount as well.

Measured, server render of N class rows, each reading `d.items[id].title`:

| rows | `useCarburetor` | `connect` | plain `React.Component` |
|---:|---:|---:|---:|
| 500 | 70 ms | 92 ms | — |
| 1000 | 291 ms | 158 ms | 3.1 ms |
| 2000 | 524 ms | 686 ms | — |
| 4000 | 2 599 ms | 2 526 ms | 6.8 ms |

Proxy creation alone, without React: 500 readers take 31 ms, 1000 take 93 ms, 2000 take 359 ms
and 4000 take 1 824 ms.

Hypothesis test on a patched copy of `dist`: `retire()` returns immediately while
`scope.records` is empty, and `liveViews.note` is disabled in production (R13-05). The 4000-row
render drops from 2.6 s to about 100–360 ms depending on GC, and growth becomes roughly linear.

Fix, in two steps:

1. **Immediate.** Return from `retire()` early when `scope.records.size === 0`: with no pending
   record there is nothing to retire. Prune dead or empty watchers on an amortized schedule
   instead of every time, for example when `watchers.size` doubles since the last prune.
2. **Structural (recommended).** Replace the invalidation ledger with an ephemeron cache: one
   `WeakMap<source, {path, proxy}>` per proxy tree, with a hit only when the path also matches.
   A branch that disappears from the data takes its entry with it, because a WeakMap value
   reachable only through its key does not keep the key alive. That removes the whole point of
   the ledger (not pinning obsolete branches), and with it `scopes`, `records`, `watchers`,
   revisions, `retire`, `invalidate`, `release()` on unmount and the `WeakRef` runtime floor.
   That is roughly 250 lines. Correctness does not change: `cached()` already checks
   `entry.source === source`, so the ledger only ever served memory. The cost is test
   introspection: `owns`, `size` and `pending` would need GC-based assertions instead.

## R13-03 — [P1] A primitive write costs O(live readers)

The write proxy's `set`, `defineProperty` and `deleteProperty` traps call
`cached.invalidate(path)` on every landed write (`createWriteProxy.ts:131,146,163`), and
`invalidate` runs `retire()` over the scope's watchers. A cache holds only object values. When
the previous value at the path was a primitive, no cache anywhere can hold an entry at that path
or below it, so the invalidation has nothing to evict.

Measured, 2000 writes of `d.count = i` at the root:

| live readers | time |
|---:|---:|
| 0 | 6.4 ms |
| 500 | 311 ms |
| 1000 | 533 ms |
| 2000 | 985 ms |

A write inside a row object is unaffected (7–11 ms), because a row object's scope has few
watchers.

Fix: invalidate only when the previous value was an object. This applies to array targets as
well: an index holding a primitive has no entry, and object moves go through object-valued
writes. The structural fix in R13-02 makes this moot.

## R13-04 — [P1] `Computed.get()` is O(subscribers), so a wave is O(S²)

`isStale()` (`Derived/Computed.ts:163`) evaluates `Object.keys(this.subscribers).length` on
every `get()`. The same idiom appears in `subscribe`, `unsubscribe`, `recordDependencyRead` and
`attachDependencies` (`:115,154,255,276`). Each call allocates an array of every subscriber id.
When S components share one computed through `useComputed`, a change re-renders all S of them,
and each one's `get()` walks all S ids. The subscribers live in a dictionary that sees `delete`,
so it also sits in dictionary mode.

Measured, 5 × (one write + S reads):

| subscribers | time |
|---:|---:|
| 500 | 85 ms |
| 1000 | 264 ms |
| 2000 | 2 482 ms |
| 4000 | 9 843 ms |

Fix: keep the subscribers in a `Map<string, TSubscriber>` and test `size`, or keep a counter.
`markStale` and `deliver` iterate the Map directly, and a snapshot of its values keeps the
current "a subscriber may leave mid-delivery" semantics.

## R13-05 — [P2] `liveViews.note` is production dead weight

`createReadProxy.ts:256` and `buildPersistentView.ts:168` insert every proxy and facade into a
`WeakSet`. The only reader is `reportLiveViewEscape`, which runs solely under `IS_DEVELOPMENT`
(`Reads.tsx:174`). WeakSet insertion is expensive: in the CPU profile of the 4000-row render,
`note` accounted for 51 ms of self time, next to 62 ms for `createProxyCache` and 108 ms of GC.

Fix: guard `note` with `IS_DEVELOPMENT`, so the call and the set both fold out of the `-prod`
build.

## R13-06 — [P2] Component construction and every `this.x` access go through traps

`AntiHookComponentFoundation` returns a Proxy from its constructor (`Foundation.tsx:163`).
Every property read on the instance goes through the `get` trap, both in user code and in
React's own reads of `props`, `state`, `updater` and similar. Every class-field initializer,
the engine's own included, goes through the `defineProperty` trap. The engine adds 10
arrow-function fields per instance: `useCarburetor`, `connect`, `connectSelection`,
`declareConnection`, `useComputed`, `useResource`, `useEffect`, `reportTeardownFailure`,
`runTeardownStage` and `onCarburetorUpdate`. Each one is a closure allocated per instance and
defined through the trap.

Measured: a property read through an equivalent forwarding proxy takes about 50 ns, against
1–10 ns for a plain read (2×10⁷ double reads: 1.9–2.3 s against 0.02–0.19 s). In the profile,
the `defineProperty` and `set` traps plus the three field-initializer constructors
(`AntiHookComponentReads`, `AntiHookComponentEffects`, `AntiHookComponentSubscriptions`)
together took 110–180 ms per three 4000-row renders.

Fix:

1. **Cheap and behaviour-preserving.** Turn the nine fields that never escape as callbacks into
   prototype methods, and keep only `onCarburetorUpdate` as a bound field.
2. **Optional, an API decision.** Drop the instance Proxy and install `render` as an own
   accessor in the constructor. That makes every access plain, and the R4-01 receiver
   workaround goes away. The cost: a class-field `render = () => …` either replaces the accessor
   (which a dev check can detect on first commit) or throws if the accessor is
   non-configurable. The repository has 6 class-field renders, all in tests, against 166 method
   renders.

## R13-07 — [P2] `persist` pays for a deep copy on every write

`persist` writes `JSON.stringify(carburetor.snapshot())` on every change (`persist.ts:33`).
`snapshot()` is `deepClone`, which builds each object key through `Object.defineProperty`
(`deepClone.ts:44`) and filters `ownKeys` into a fresh array per object. `JSON.stringify` never
mutates its input and produces its own detached text, so the clone is pure overhead.

Measured, a 1000-row store:

| operation | time |
|---|---:|
| `deepClone` | 4.77 ms |
| assignment-based clone (`defineProperty` only for `__proto__`) | 1.11 ms |
| `JSON.stringify(getData())` | 0.52 ms |
| current `persist` write | 4.62 ms |

Fix: stringify `getData()` directly. Give `deepClone` the assignment fast path, which
`snapshot`, `restore` and `CarburetorHistory` also use. Optionally, coalesce `persist` writes
to one per microtask: a controlled input currently runs a synchronous `localStorage.setItem`
per keystroke.

## R13-08 — [P2] The hooks bridge re-renders on content-equal object selections

`useCarburetorValue` detaches every object selection through `detachOpaque`, which always
builds fresh containers, and then compares it with the default `isEqual = Object.is`
(`useCarburetorValue.ts:58`). For an object result that comparison can never be true. Take
`(d) => ({title: d.todo.title})` and an immutable-style write `draft.todo = {...todo, done: true}`.
The write notifies through the ancestor path, the selector produces equal content, and the
component still re-renders.

Separately, the cache key includes selector identity (`:134`). The usual inline selector is
therefore a miss on every render: a fresh read proxy, a selector run and a full detach, even
when the store version has not moved.

Fix: make the default comparator structural over detached plain data (shallow is enough for
the common one-level projection), and keep `Object.is` as an opt-in. Hold the selector in a
ref, and re-run it on a version change or a new carburetor rather than on every new closure
identity. A new selector still re-runs, but only to compare, keeping the old reference when
equal. This matches how `useSyncExternalStoreWithSelector` treats selectors. This finding is
derived from the code and was not executed. A jsdom regression should pin it before the fix.

## R13-09 — [P3] Small, safe allocation removals

- `declareConnection.ts:47,72,88` builds the string `attemptKeyPrefix + connection.uid` on
  every recorded read and every source resolution. Compute it once per declaration.
  `Reads.track()` concatenates `TRACKED_ATTEMPT_KEY + cuid` twice per call. Keying
  `attempt.entries` by the source object removes both.
- One commit copies a changed read set three times: the description copy
  (`Subscriptions.tsx:96`), the copy inside `Carburetor.subscribe` (`Carburetor.ts:140`) and
  the `installed` copy (`Subscriptions.tsx:175`). The description copy guards against late
  reads through stale views, but the recorder's `renderAttempt === attempt` identity check
  already stops those. The attempt's set is frozen once the attempt closes, so it can be adopted
  as-is, and `installed` can share it.
- `emitUpdate` copies `writes` into a new Set and clears the old one, and `UpdateBatch.add`
  copies again. Swapping in a fresh Set and letting the batch adopt the first one saves a copy
  per emit.
- `ResourceCache.getEntry` returns a new `{...initial, stale: true}` for an absent entry on
  every render (`ResourceCache.ts:86`). A child gated by props re-renders on every parent render
  while the entry is loading. A frozen shared "absent" view keeps its identity.
- `useResource` serializes the arguments twice per render: through `pathOf(args)` and again
  through `getEntry(args)`. The memo covers only the escape, not `JSON.stringify`. Resolve the
  key once and pass it to key-based `pathOfKey`/`getEntryByKey`. `escapeCacheKey` also lacks the
  `includes` fast path that `joinPath` has, so it always makes four `split`/`join` passes.
- `openRenderAttempt` allocates two Maps and an array per render even for a component that reads
  nothing. They can be created lazily on first use.

## R13-10 — API simplification candidates

These are proposals, not defects. They are worth deciding while the package is at 0.1.0.

- **One read primitive.** `connect()` exists because `useCarburetor` allocated a proxy per
  render. Once R13-02 is fixed, `useCarburetor` can keep one persistent root per (component,
  carburetor, data object), with a recorder that consults the current attempt as `connect`'s
  does. It would then allocate nothing per render, and `connect` becomes optional
  field-declaration sugar, not a performance choice. A read through `connect` currently pays
  two trap hops at the root (facade, then read proxy), plus a string concatenation and a Map
  lookup per access.
- **The `ICarburetor` surface has pairs that do one job.** `snapshot`/`restore` duplicate
  `toJSON`/`fromJSON`, one typed and one erased. `watch(reads, cb)` and `subscribe(cb, {reads})`
  take the same arguments in opposite order.
- **The barrel contradicts its own header comment.** `index.ts` says internals are
  "deliberately absent", yet it exports `SubscriberIndex`, `pathsIntersect`, `getUid`,
  `isTrackable` and `SyncUpdateScheduler` (plus its instance). The README labels them
  "building blocks, exported for extensions". Pick one policy. Keeping `getUid` public also
  makes R13-01's fix part of the contract.
- **`useEffect(callback, name, deps)`** puts the required key between the callback and deps.
  `useEffect(name, callback, deps)` reads in declaration order and matches how the name is
  used.
- **`carburetorToken`'s process-wide `takenNames`** throws when a module declaring tokens is
  evaluated a second time (HMR re-execution, `resetModules` in tests). Unverified here. A
  dev-only report, or tolerating a re-declaration with the same factory source, would avoid it.

## Verification and limits

- All numbers come from bounded, single-run probes: each ran in well under a minute, with no
  sustained load. The probes and the CPU profile lived in an untracked scratch directory inside
  the worktree and were deleted after this report was written. The reproduction snippets above
  are enough to recreate them.
- The patched-`dist` experiment tested the R13-02/R13-05 hypothesis only. No engine source was
  changed in this round.
- The cost of dev-only diagnostics was not profiled: the alias ledger, the live-view escape
  walk and the per-call `process.env.NODE_ENV` checks in `Carburetor.ts`. Plain Node server
  rendering without `--conditions=production` loads the development build, so those per-call
  checks apply there.
- R13-08 and R13-09 are derived from the code. R13-01 through R13-07 were measured or
  reproduced.

## Resolution (same day)

Every finding was fixed on branch `react-compat`, one commit per item. The API proposals were
decided by the user and applied as breaking changes, keeping the version at 0.1.0.

| ID | Commit | Result |
|---|---|---|
| R13-01 | `a166c21` | Uid counter and claimed token names shared through `sharedSingleton`; the CJS/ESM lost-settlement regression runs against the built `dist` |
| R13-02/03/05 | `a5cf42c` | Per-tree `WeakMap<source, {path, proxy}>` cache; the ledger, `WeakRef` requirement and unmount release are gone; `liveViews` is dev-only |
| R13-04 | `9386cd9` | Computed subscribers in a `Map` |
| R13-06 | `ac9bc89` | Instance Proxy removed (`render` is a non-configurable own accessor, a class-field `render` throws); nine fields became prototype methods |
| R13-07 | `f19f6f0` | `persist` stringifies `getData()`; `deepClone` assigns keys |
| R13-08 | `759c94d` | Structural default comparator, run live before detaching; a custom `isEqual` still gets detached values |
| R13-09 | `a819e9f` | Key, read-set and write-set copies removed; frozen absent view; one serialization per `useResource` |
| R13-10 | `5875878`, `9318be8` | Persistent `useCarburetor` root; internals unexported, `useEffect(name, cb, deps)`, `watch(cb, reads?)`, duplicate token name reported instead of thrown; lint rules adapted |

The same probes after the fixes (`NODE_ENV=production`, built `dist/esm`, medians of five runs):

| probe | before | after |
|---|---:|---:|
| SSR 1000 rows, `useCarburetor` / `connect` / plain | 291 / 158 / 3.1 ms | 20.8 / 16.2 / 1.4 ms |
| SSR 4000 rows, `useCarburetor` / `connect` / plain | 2 599 / 2 526 / 6.8 ms | 60.9 / 59.5 / 3.4 ms |
| 4000 read proxies over one object | 1 824 ms | 7.4 ms |
| 2000 root writes, 0 / 1000 live readers | 6.4 / 533 ms | 5.9 / 5.9 ms |
| computed, 5 waves, 1000 / 4000 subscribers | 264 / 9 843 ms | 0.8 / 2.2 ms |
| `deepClone` / `persist` write, 1000 rows | 4.77 / 4.62 ms | 1.7 / 0.3 ms |

Verification at `9318be8`:

- full `npm test`: 737 passed;
- `cargo test`: 348 lib tests and 24 CLI tests passed;
- `npm run lint`: no errors;
- `typecheck`, the demo typecheck and `check:layout`: clean;
- `npm run test:consumers`: 13 of 13 passed.
