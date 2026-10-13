# API and engine review — round 40 — 2026-10-08

## Verdict

Base: `ef78d41` (round 39's implementation, its gates and the coverage documents, committed and pushed). The
review build is `worktrees/bench-dist/ef78d4186ba5/esm-prod`, byte-identical to `dist/esm-prod`. Five findings:
one P1, one P2, three P3. None is a regression of round 39. Rounds 36–39 concentrated on selections, the write
log, history and resources; this round covers the subclassing contract, what a consumer pays to subscribe and
unsubscribe, list iteration through read views, the hooks entry point and the cache's write shapes.

| ID | Priority | Area | Confirmed problem |
|---|---|---|---|
| R40-01 | P1 | API / correctness | Engine state lives in subclass-visible instance fields with ordinary names. A store subclass that declares `version` (a server document version) or `uid` (a domain id), or a component that declares `uid = this.props.userId`, compiles under `strict` TypeScript and silently breaks delivery: an unobserved computed keeps returning a stale value, a computed over two such stores misses one store's writes, and the first of two components with the same `uid` stops re-rendering. A store has 23 such names, a `ResourceCache` 17 more, a component 11 fields and 31 methods |
| R40-02 | P2 | Subscriptions / allocations / O | Every read set files the branch markers that its own deeper reads already imply: 2 of 3 paths for a hook row, 3 of 5 for a class row, 1 001 of 2 002 for the README's `activeCount`. They never change a wake decision (0 mismatches in 8 000 000 differential checks) but double the index work: per hook-row subscriber, subscribe 12.5 → 5.4 µs and unsubscribe 6.8 → 2.9 µs; the `exact` map holds 10 001 entries instead of 5 000 for 5 000 rows |
| R40-03 | P3 | Reads / performance | Array methods through a read view (`map`, `filter`, `forEach`) pay a `has` and a `get` trap per element and record every path twice. A parent rendering 5 000 rows spends 0.73 µs per id; a native-iteration fast path with identical read sets measured 0.41 µs, and one append to a 5 000-row class list went from 35.5 to 22.4 ms (medians of 5 alternating processes) |
| R40-04 | P3 | API / hooks | The hooks entry point has no resource reader. A hooks subtree cannot address a `ResourceCache` entry by its arguments (the key encoding is protected), and the field-level subscription and refetch-after-commit of the class `useResource` have no hook equivalent |
| R40-05 | P3 | Resources / allocations | Settling a cache request writes seven fields through `draft.entries[key]`, re-walking the path for each field: 21 proxy traps where 9 suffice. Taking the entry reference once: 22.1 → 14.5 µs per settle publication |

Fix R40-01 first. It is the only finding that produces wrong output, it needs nothing unusual from the
application — ordinary field names in an ordinary subclass — and the same change is the largest
simplification of the API available: it shrinks the protected surface to what the README documents. R40-02 is
the largest constant factor left in mounting and unmounting consumers.

## Method and evidence boundaries

- Read at `ef78d41`:
  - the store: `Carburetor`, `emitStoreUpdate`, `SubscriberIndex`, `WriteLog.matches`;
  - scheduling: `UpdateBatch`, `UpdateWave`, `ComponentUpdateThrottle`, `SyncUpdateScheduler`;
  - `Computed` and its freshness helpers, `computedDependencies`;
  - `createReadProxy`, `createProxyCache`, the write proxy's `get`;
  - `AntiHookComponent` (`Foundation`, `Reads`, `Subscriptions`), `declareConnection`;
  - `useCarburetorValue`, `useComputedValue`;
  - `ResourceCacheLifecycle`, `connectDevTools`, `waitForUpdate`, `bind`;
  - the README sections API, Tooling and Hooks interop, and the built `Carburetor.d.mts`.
- Every finding was reproduced through the built package.
  - Node v24.12.0 with `NODE_ENV=production`.
  - Components were rendered with React/ReactDOM 19.3.0 `createRoot` + `flushSync` in JSDOM 30.0.1.
  - Profiles and prototypes used `dist/esm` from the same build (not minified) for readable frames.
  - A prototype is a copy of that directory with one module changed, under the git-ignored
    `worktrees/r40-probes/`.
- TypeScript claims were checked with the repository's `tsc` (`--strict`, `--skipLibCheck`) against the built
  declarations.
- Counters are exact and agreed across runs: filed paths, index entries, constructor counts, delivered
  values and rendered text.
- Timings are medians. The machine was shared and loaded, and absolute times are inflated: a bare
  `new Set([path])` cost 0.6 µs, roughly ten times a typical desktop.
  - The claims are ratios between builds measured in alternating processes.
  - React-level timings varied by ±30 % between processes.
  - Gates belong on the counters.
- Not run: the project test suite, the full benchmark suite, the packed consumer matrix and CI.
- No product source, test, dependency or version was changed, and no sub-agents were used. The commit
  contains only this report.
- Recorded limits of rounds 30–39 are not re-reported.

## R40-01 — P1 — a subclass field named like an engine member breaks delivery silently

### Repro and behavior

```js
// Plain application code: a store that remembers the server's document version.
class DocumentStore extends Carburetor {
    version = 0;
    save(title, serverVersion) {
        this.update(d => { d.title = title; });
        this.version = serverVersion;
    }
}
const doc = new DocumentStore({title: 'a'});
const upper = computed(read => read(doc).title.toUpperCase());
upper.get();        // 'A'
doc.save('b', 7);   // upper.get() → 'B'
doc.save('c', 7);   // upper.get() → 'B', while getData().title is 'c'
doc.save('d', 7);   // upper.get() → 'B', while getData().title is 'd'
```

| Case | Expected | Observed |
|---|---|---|
| `computed` over a store with a `version` field, three saves with server version 7 | `A`, `B`, `C`, `D` | `A`, `B`, `B`, `B`; `getVersion()` stays 7 |
| observed `computed` over two `Profile` stores that both declare `uid = 'profile'`; only `friend` renames | one delivery, `get()` = `me & friend2` | no delivery, `get()` = `me & friend` |
| two class components that each declare `uid = this.props.userId` for the same user and read through `useCarburetor`; the user is renamed | `GraceGr` | `AdaGr`: the first component keeps the old name |

All three compile with `tsc --strict`. A derived class may redeclare a protected member as public with the
same type, so `version = 0` and `uid = this.props.userId` type-check. Nothing reports them at runtime.

None of the 24 lint rules covers them. The closest, `no-lifecycle-class-property`, covers only lifecycle
methods declared as properties.

### Mechanism

- A store keeps its state in ordinary instance fields. A subclass's field initializer runs after the base
  constructor, overwrites the engine's value, and every later engine write goes to the same slot. Own names
  per instance:

  | Class | Own engine names | Examples |
  |---|---|---|
  | `Carburetor` | 23 | `data`, `version`, `uid`, `scheduler`, `subscribers`, `writes`, `aliases`, `writeLog` |
  | `ResourceCache` | 17 more | `ttl`, `loader`, `maxEntries`, `eviction` |
  | `ResourceCarburetor` | 3 more | `loader`, `runtime`, `operationVersion` |
  | `AntiHookComponent` | 11 fields and 31 prototype methods | `uid`, `effects`, `tracked`, `connections`; `track`, `releaseSlot`, `alignSubscription` |

- **`version`.** Every emit bumps `this.version`, and the subclass resets it.
  - A computed's freshness compares `getVersion()` with the version its leaves were read at
    (`leafVersionsDrifted`).
  - A version that returns to an already-seen value reads as "nothing moved".
- **Store `uid`.** A computed files each source under `':' + getUID()`. Two stores with one uid become one
  dependency: one subscription is kept, and the other store's writes reach nobody.
- **Component `uid`.**
  - The `useCarburetor`, `useComputed` and `useResource` slots subscribe under `this.uid`.
  - `subscribe` with an id that is already registered replaces that registration, so the second component
    takes over the first one's subscription.
  - `connect()` connections subscribe under their own minted id and are not affected.
- **The protected surface.**
  - The built `Carburetor.d.mts` exposes 15 protected fields and four plumbing methods typed with internal
    types: `commitState`, `rememberPublication`, `touchDraft` and `recordWrite`.
  - The README documents `update`, `draft`, `emitSoon`, `preEmit`, `emitUpdate` and `markAllChanged`.
  - The demo store relies on two members the README does not document: `this.data` throughout, and
    `this.writes.size` in `preEmit` (`TodoCarburetor.ts:179`) to skip derivation when nothing changed.

### Direction (simplification)

- Keep engine state where a subclass cannot name it:
  - module-private symbols for the state the transaction ports read;
  - ES `#private` fields everywhere else.

  A subclass then owns every plain name. Symbol-keyed and `#private` fields are ordinary in-object
  properties in V8, so the write path should keep its cost. Confirm with the `writelog39`, `store` and `write`
  gates.
- Publish one small subclass contract:
  - `update`, `draft`, `emitUpdate`, `emitSoon`, `preEmit`, `didSetData`, `markAllChanged`;
  - a read-only `data` (a protected getter);
  - the one fact the demo reads from internals, whether the emit being closed recorded any path. Pass it as an
    argument or expose it as a protected getter: `preEmit(changed: ReadonlySet<string>)` or `changedPaths`.
- Do the same for components:
  - `uid` and the attempt and connection fields go behind symbols;
  - the helper methods (`track`, `releaseSlot`, `alignSubscription`, …) become module functions or
    symbol-named.
- Until then, a lint rule can reject a subclass member that redeclares an engine field.

### Acceptance

- The three repros deliver correctly: `A, B, C, D`; one delivery of `me & friend2`; `GraceGr`.
- `Object.getOwnPropertyNames` of a new `Carburetor`, `ResourceCache` and component instance lists no engine
  name.
- The built `Carburetor.d.mts` lists only the documented protected members.
- The demo's `preEmit` no longer reads `this.writes`.
- Write cost is unchanged within noise: the `writelog39`, `store` and `write` areas stay green.
- The gate is the three repros as exact counters (delivered values, rendered text), validated to fail on
  `ef78d41`.

## R40-02 — P2 — read sets file branch markers their own deeper reads already imply

### Repro and behavior

Paths filed per consumer (one row of a 3-row store; `rN.title` is a leaf):

| Consumer | Filed paths | Implied markers |
|---|---|---|
| class row: `connect()`, reads `items[id].title` and `items[id].owner.name` | `items.~p`, `items.r1.~p`, `items.r1.title`, `items.r1.owner.~p`, `items.r1.owner.name` | 3 of 5 |
| hook row: `useCarburetorValue(s, d => d.items[id].title)` | `items.~p`, `items.r1.~p`, `items.r1.title` | 2 of 3 |
| `watch(d => d.items.r2.done)` | 3 paths | 2 |
| `computed` reading `items.r1.owner.name` and `filter.text` | 6 paths | 4 |
| README `activeCount` over 1 000 items | 2 002 paths | 1 001 |
| README `visibleIds` over 1 000 items | 3 003 paths | 1 002 |

Cost of filing, per subscriber, with 5 000 subscribers through `Carburetor.subscribe`/`unsubscribe` (median of
7):

| Read set | subscribe | unsubscribe | `exact` entries | `branch` entries |
|---|---:|---:|---:|---:|
| hook row, as filed | 12.46 µs | 6.84 µs | 10 001 | 5 001 |
| hook row, implied markers dropped | 5.40 µs | 2.92 µs | 5 000 | 5 001 |
| class row, as filed | 15.15 µs | 10.46 µs | 20 001 | 10 001 |
| class row, implied markers dropped | 10.44 µs | 4.51 µs | 10 000 | 10 001 |

In a mount + unmount profile of 5 000 class rows, subscription filing and release take about a quarter of
the samples (`subscribe` 13.8 %, `releaseSlot` 9.5 %). That is the largest engine share.

A prototype that drops implied markers when a read set is completed, measured over 5 000 rows:

| Rows | Mount + unmount, today | With the prototype | Retained per mounted row, today | With the prototype |
|---|---:|---:|---:|---:|
| hook | 572 ms | 524 ms | 9 316 B | 9 165 B |
| class | 818 ms | 700 ms | 7 335 B | 7 227 B |

The times are medians of 5 alternating processes and are noisy. The counters above are the claim.

### Mechanism

- **Traversal records a marker.** A `get` that returns a plain object or array records `B.~p` before
  returning the child view (`createReadProxy.ts:327`), and a `has` probe does the same (`:385`). Every row
  reads through `items`, so every row files `items.~p` and its own `items.rK.~p` next to the leaf it
  actually reads.
- **What wakes a marker.** A marker `B.~p` wakes only for a write at `B`, at an ancestor of `B`, or a
  wildcard:
  - The write proxy writes `P.~p` only for an opaque leaf `P` (`createWriteProxy.ts:300`), never for a plain
    branch.
  - `SubscriberIndex.match` reaches a reader only through `exact[w]`, `branch[w]` or `exact[ancestor of w]`.
- **Why it is redundant.** Any other path of the same set strictly below `B` (a leaf, a keys marker, a
  deeper branch marker) is reached by exactly those writes through `branch[w]`. `WriteLog.matches` applies
  the same rule. Once a deeper path is in the set, the marker cannot change a wake or a drift answer.
- **Differential check.** 400 random read sets, each filed twice (as recorded and pruned), against 20 000
  random write sets that include keys-marker writes: 0 mismatches in 8 000 000 comparisons.
- **What each redundant marker still costs:**
  - an `exact` registration;
  - one `registerBranch` per ancestor, each with a freshly sliced ancestor string;
  - the same work again on unsubscribe;
  - one more iteration in `sameReads` and `WriteLog.matches`;
  - a shared `exact['items.~p']` bucket that holds every row's id.

### Direction

- Drop an implied marker while the read set is being built:
  - The child view knows its parent's marker, so its first recorded read can retire that marker from the
    attempt's set (a second recorder argument, or a set wrapper that deletes it).
  - Pruning while recording keeps `sameReads`, the computed's `overlap` count and the O(1) identity answers
    consistent, because every comparison sees pruned sets on both sides.
- A completion-time pass also works, but it must be O(paths × depth). A per-marker prefix scan is O(N²) for a
  computed over 10 000 rows.
- Keep a marker that is alone under its branch: `!!data.user`, or a selection that returns the branch
  itself.

### Acceptance

- Filed paths: hook row 1, class row 2, `watch` 1, README `activeCount` 1 001 over 1 000 items.
- Subscribe + unsubscribe of 5 000 hook-row subscribers ≤ 0.6× of today; `exact` holds 5 000 entries.
- The markers' own cases still wake:
  - replacing `items[id]` wakes a reader of `items[id].title`;
  - deleting it wakes an `'a1' in items` reader;
  - replacing `items` wakes every row.
- The gate counts filed paths and index entries (deterministic) and is validated to fail on `ef78d41`.

## R40-03 — P3 — array methods through a read view pay two traps per element

### Behavior

This covers a parent that renders its rows (`this.data.ids.map(...)`), a computed that filters
(`rows.filter(r => r.done)`), and a selector that maps. Each runs the native array method on the read view.
Measured over 5 000 elements on a persistent view with a Set recorder, in µs per element (median of 50):

| Pattern | Raw array | Through the view | Native-iteration prototype | Paths recorded |
|---|---:|---:|---:|---|
| `ids.map(x => x)` | 0.015 | 0.73 | 0.41 | 5 002, both builds |
| `rows.filter(r => r.done)` | 0.016 | 3.43 | 2.77 | 10 002, both builds |
| `rows.map(r => r.title)` | 0.023 | 3.00 | 1.89 | 10 002, both builds |

One append (`d.items[k] = …; d.ids.push(k)`) to a 5 000-row class list re-renders the parent. It took 35.5 ms
today and 22.4 ms with the prototype (medians of 5 alternating processes; ranges 26–63 ms and 19–29 ms).

### Mechanism

- `map`, `filter` and `forEach` are inherited, so `get` returns the native method and records nothing.
- The method then calls `HasProperty` and `Get` on the view for every index: one `has` trap and one `get`
  trap. Each resolves the child path through the memo, tests trackability and calls the recorder.
- Through `connect()`, each record also goes through `ConnectionSource.recordPath`: an attempt lookup, a tag
  check and a Set add.
- Both traps record the same path.
- The prototype returns a wrapper for those three methods on plain arrays. It reads `length` through `get`;
  for each index it checks presence on the raw array and calls the handler's `get` directly. It records the
  same paths and markers and wraps the same elements, with one handler call per element and no Proxy
  dispatch.

### Direction

- Add iteration wrappers for the non-mutating methods that visit every index: `map`, `filter`, `forEach`,
  `some`, `every`, `find`, `findIndex`, `reduce`, `indexOf`/`includes`.
- Apply them on plain arrays only. Leave subclasses and own overrides on the trap path, as the write side
  already does for positional methods.
- A hole records its path, as `has` does today.

### Acceptance

- Read sets are identical for every method, including on sparse arrays, checked by a differential test
  against the trap path.
- `ids.map` through a view costs ≤ 0.6× of today per element, and the append scenario's parent render
  ≤ 0.8×.

## R40-04 — P3 — the hooks entry point has no resource reader

### Evidence

- `react-carburetor/interop` exports `useCarburetorValue` and `useComputedValue` (`lib/src/Interop/index.ts`).
  The resource reader exists only on `AntiHookComponent` (`useResource`, `Reads.tsx:329`).
- A hook cannot select a cache entry through `useCarburetorValue`. Entries are keyed by the encoded argument,
  and `keyOf`/`pathOf` have been protected since R33-08.
- `getEntry(args)` is untracked.
- `resolve(args)` is public and returns the path, the view and the field view, but neither the README nor
  `docs/promise-cache.md` mentions it.
- Every hooks codebase would have to rewrite what the class reader adds:
  - the subscription to the fields actually read (R39-07);
  - the load of a stale entry, queued after commit;
  - the re-arm after an invalidated refresh.

  That boundary is what the interop entry exists for (README "Hooks interop").

### Direction

- Add `useResourceValue(source, args)` to the interop entry, built on `resolve(args).fieldView` and
  `useSyncExternalStore`.
- Start the deferred load in an effect after commit.
- Share the class reader's decision logic: one module that both call.
- `ResourceCache` itself does not change.

### Acceptance

- A hook reader of `data.name` renders exactly as the class reader in the R39-07 fixture: 2 renders on mount
  and 2 for an equal refresh after `invalidateAll()`. It refetches after `invalidate`.
- No load starts during render; development reports it, as the class reader does.

## R40-05 — P3 — a cache settle re-walks `draft.entries[key]` for every field

### Behavior

`settleSuccess` writes seven fields as `draft.entries[key].status = …`, `draft.entries[key].data = …` and so on
(`ResourceCacheLifecycle.ts:220-228`). `settleFailure` (four fields) and the rollback in `fetch` (three)
follow the same pattern.

Each statement costs a `get` trap for `entries`, a `get` trap for the key and the `set` trap: 21 traps where
one entry reference needs 9. Measured on a 10 000-entry store with the cache's entry shape (median of 9 runs of
2 000):

| Write shape | µs per settle publication |
|---|---:|
| as written today | 22.1 |
| `const entry = draft.entries[key]` taken once | 14.5 |

A load publishes twice, Pending and then the answer. The Pending publication is the documented contract and
is not part of this finding.

### Direction

Take the entry reference once in `settleSuccess`, `settleFailure`, `markLoading` and the failure rollback.
Behavior does not change: the same paths are recorded in the same order.

### Acceptance

- Recorded paths and history patches are unchanged (the existing cache suites).
- A settle publication costs ≤ 0.7× of today in the probe.

## Recommended order

1. **R40-01.** Every subclass author can hit it, and it is also the largest API simplification available.
2. **R40-02.** The largest constant factor left in mounting and unmounting consumers, and less index memory.
3. **R40-03.** List parents and list computeds.
4. **R40-05.** A local edit.
5. **R40-04.** New surface; it should follow R40-01, which settles what is internal.

## Not reported as findings

- **One-row writes in React.** Updating one row of an N-row list costs O(N) in React itself:
  `bailoutOnAlreadyFinishedWork` clones the sibling fibers, and `completeWork`/`bubbleProperties` visit them.
  - With plain `useState` rows the write took 3.1 ms at 5 000 rows.
  - In the class-row profile of the same write, the engine's frames were a few percent of the samples.
- **The README's `activeCount` pattern.** `Object.keys(items).filter(id => !items[id].done)` costs 6.5–8.2 µs
  per item per recompute through the read view: 65–82 ms per toggle at 10 000 items, 20–27× the raw loop.
  - A minimal tracking proxy with the same traps costs 4.7 µs per item, so this is the price of Proxy-based
    tracking, not engine overhead.
  - A coarser "branch read" that subscribes to a whole branch and reads it raw would trade that cost for
    recomputes on unrelated writes below the branch. That is a design choice, not a defect.
- **The cost of `SubscriberIndex` itself.** Filing is within 0.8–1.5× of the same maps written by hand
  (9.8–11.3 µs per row-shaped read set on this machine). R40-02 removes work rather than speeding up the
  structure.
- **Memory per mounted row.** The engine retains 3.4 KB (class `connect`) or 5.3 KB (hook) per mounted row, on
  top of React's 4.0 KB in JSDOM.
  - Most of it is a per-consumer proxy tree (3–4 `Proxy` objects and one `WeakMap` for a one-leaf read) plus
    the subscription records.
  - Sharing one proxy tree across consumers would need a global current recorder, which would break the
    guarantee that reads outside a render attempt record nothing. Not proposed.
- **The `subscribers` dictionary.** It is keyed by uid strings.
  - Adding and deleting a fresh key costs 5.9 µs against 2.0 µs for a `Map` in isolation.
  - Notification-time lookups are faster than with a `Map` (0.09 against 0.12 µs per id).
  - The store adds 2–3 µs to the index's work per `subscribe`. Not material.
- **`connectDevTools`.** It copies a store's snapshot whenever the store's version moved: a development tool
  with an O(state) contract.
- **Bulk writes.** `for (const id in d.items) d.items[id].done = flag` over 10 000 rows, with one subscriber
  per row, costs 12.3 µs per row including 10 000 deliveries. That is per-path recording and per-subscriber
  delivery, with no super-linear term.
- **Store-level per-operation costs.** One-leaf writes, writes with N per-row `watch`es or subscribers,
  subscription churn and transactions stayed flat from 1 000 to 50 000 rows.

## Probes

The probes are git-ignored and kept for the implementation round, all in `worktrees/r40-probes/`:

- **R40-01:** `protected-names.mjs`, `uid-collide.mjs`, `component-uid.mjs`, `own-names.mjs`, `tscheck/*.ts`.
- **R40-02:** `row-reads.mjs`, `computed-reads.mjs`, `index-pruned.mjs`, `prune-equivalence.mjs`,
  `row-heap.mjs`, `row-objects.mjs`.
- **R40-03:** `iterate.mjs`, `floor.mjs`, `floor-fast.mjs`.
- **R40-05:** `settle-shape.mjs`.
- **React measurements and profiles:** `react-scale.mjs`, `react-baseline.mjs`, `react-prof.mjs`, `ab.mjs`,
  `prof-lib.mjs`.
- **Context for "Not reported":** `keys-pattern.mjs`, `floor-keys.mjs`, `scale.mjs`, `cache-scale.mjs`,
  `bulk.mjs`, `micro-sub.mjs`, `micro-dict.mjs`, `index-cost.mjs`, `churn-prof.mjs`.

The prototypes for R40-02 and R40-03 are `dist-pruned/esm` and `dist-iter/esm`: copies of `dist/esm` with one
module changed.

Each probe prints one `@@ {json}` line. Run it with `NODE_ENV=production node <probe>`, and set
`DIST_ROOT=<build dir>` to measure another build.

## Resolution

Findings R40-01..05 are implemented. Each has a gate in `perf/`
(`subclass40`, `readset40`, `iterate40`, `resource40`, `cache40`) that fails on the build before round 40
(`ef78d41`: 4 of 5, 3 of 4, 5 of 7, 3 of 3 and 2 of 2 entries fail; the others are controls) and passes on the
current one, plus tests that fail without the change. Numbers are medians of 11 alternating processes of the
probes above against `ef78d41`, unless a row says otherwise; timings come from a shared machine and their
ranges overlap more than the counters, which are exact.

| Finding | Done | Before → after |
|---|---|---|
| R40-01 | Engine state of `Carburetor`, `ResourceCache`, `ResourceCarburetor` and `AntiHookComponent` (fields and plumbing methods) sits under module-private symbol keys. The subclass contract is `update`, `draft`, `emitUpdate`, `emitSoon`, `preEmit`, `didSetData`, `markAllChanged` and a protected read-only `data` getter. `preEmit` receives the recorded paths, so the demo store no longer reads `this.writes`; an override without parameters keeps working. | Store version after four saves `0,1,1,1` → `0,1,2,3`; the two-store pair `me & friend` (stale) → one delivery of `me & friend2`; two components with one `uid` `AdaGr` → `GraceGr`. Own engine names on new instances 23 + 17 + 3 + 11 fields (+ 31 prototype methods on a component) → 0. Built `Carburetor.d.mts` protected members: 15 fields and 4 plumbing methods → the 8 contract members. |
| R40-02 | Branch markers implied by deeper reads are dropped when a read set is completed (O(paths × depth); a set of up to 8 paths takes no Set), in `completeReads` and the paths that adopt or extend a retained set (`readCoverage`). Single markers are kept. | Filed paths: hook row 3 → 1, class row 5 → 2, `watch` 3 → 1, README `activeCount` over 1 000 items 2 002 → 1 001. 5 000 hook rows: `exact` entries 10 001 → 5 000, index map operations 80 000 → 30 000, subscribe + release 28.5 → 21.1 ms. 8 000 000 differential wake comparisons earlier: 0 mismatches (24 000 more in the new suite). |
| R40-03 | `map`, `filter`, `forEach`, `some`, `every`, `find`, `findIndex` and `reduce` on a plain array through a view call the handler's `get` once per element (presence on the raw array first; a hole still records its path). Cached per view, off the path of own keys. | Handler calls per element 2 → 1, identical read sets (`ids.map` 5 002 paths, `rows.filter` 10 002). Per element over 5 000: `ids.map` 0.484 → 0.204 µs, `rows.filter` 0.829 → 0.589 µs, `rows.map(r => r.title)` 0.790 → 0.495 µs. Parent re-render, read-and-map part 3.73 → 2.21 ms; whole append 6.80 → 5.82 ms. |
| R40-04 | `useResourceValue(source, args)` in `react-carburetor/interop`, on `resolve(args).fieldView` and `useSyncExternalStore`; the decision logic (worth fetching, re-arm, fields to subscribe) is one module shared with the class `useResource`. | No hooks reader → 2 renders on mount and 2 for an equal refresh after `invalidateAll()`, as the class reader; reload after `invalidate`; 0 loads in render, 1 after commit; an unread field 0 extra renders. |
| R40-05 | `settleSuccess`, `settleFailure`, `markLoading` and the failure rollback take `draft.entries[key]` once; a patch listener could replace the entry between writes, so the cached reference is used only while the live entry is still the same object. | Write-proxy traps per settle publication 21 → 9 (success), 12 → 6 (failure); same paths in the same order. The isolated update 22.1 → 14.5 µs, but the whole settle publication 59.5 → 57.7 µs (−3 %, inside the noise of 15 runs). |

Found after the first integration and fixed (zero-trust review of each diff and of the merged tree):

- R40-02 first version removed a branch marker from a class selection's read set before it knew whether the
  retained snapshot would be reused; on a fallback the dependency was lost. Markers are now removed only when
  the retained set is adopted; tests pin the fallback and the hook route.
- R40-02 built a prefix set of the whole retained read set on the first related write: +9–12 ms at 10 000 rows
  (11.3 ms in `prefixes`, measured with a CPU profile). Coverage is now an early-exit scan, and the prefix
  set is built only after the accumulated scan work exceeds eight full passes (a test with 1 000 uncovered
  markers keeps that case linear). The first related write is back to the baseline's range (2.5–4.7 ms against
  2.5–4.2).
- R40-03 first checked its method table on every property read of every view; it now sits behind the
  inherited-key branch of arrays, and a gate counts the lookups (0 of 1 000 own-key reads).
- R40-04's hook ignored `view.data = …`, which the class reader honors; fixed, with tests. Its generic type
  fixture was not in any `tsc` project; it is now in `tsconfig.types.json`, and a wrong call fails there.
- After the change of engine fields, 20 existing perf scenarios and 3 test files read engine members by their
  old names (`subscriberIndex`, `writes`, `keyOf`, …) and failed in the full run, not in the agents' scoped
  runs; the scenarios now use `engine`/`call` from the harness (they still run on older builds), the tests
  use the symbol holders.

Deviations and limits:

- **Cost of R40-01.** The acceptance said write cost is unchanged within noise. A bare scalar write without a
  consumer measured 677 → 724–737 ns over 21 alternating processes (+7–9 %; another series +4.6 %), a write
  with a precise subscriber 2011 → 2037–2059 ns (+1–3 %); ranges overlap. An experiment that replaced the
  static holder (`S.writes`) with module-level constants in the four hottest files gave no consistent gain
  (scalar +9.7 %, subscriber +1.7 %) and was reverted. Symbols only, not `#private`: the build targets
  ES2020, which lowers `#private` to WeakMaps.
- **`data` is a reserved name.** It is the contract getter, and the resource classes read the state through
  it; a subclass that redeclares it is outside the contract (TypeScript rejects a field override of an
  accessor). Every other former engine name is free for subclasses.
- **R40-02 time target.** The acceptance asked for subscribe + release ≤ 0.6×; the measured time is 0.74×
  (28.5 → 21.1 ms for 5 000 rows), and the deterministic index work is 0.375×. The gate holds the work ratio
  (≤ 0.5×) and a wide time ceiling (≤ 0.85×). Mount + unmount of 5 000 rows moved 41.7 → 40.2 ms (class) and
  44.8 → 40.7 ms (hook), inside the ranges.
- **R40-03 targets.** `ids.map` reached 0.42× (target ≤ 0.6×). The append scenario's parent render did not
  reach ≤ 0.8×: the read-and-map part is 0.59× but the whole append is 0.86×, because publication, reconciliation
  and DOM work do not change. `indexOf`/`includes` stay on the trap path (they compare against wrapped
  elements). Results of `map`/`filter` are built on a prototype-less array that gets `Array.prototype` back, so
  a numeric setter installed on `Array.prototype` by a callback cannot intercept the stores.
- **R40-05 time.** The target (≤ 0.7× in the probe) holds for the isolated update shape only; the load path
  around it dominates, so the gain is a counter (traps), not a visible time.
- Hook rows: append and remove-middle of 5 000 rows did not change (17.2 → 17.3 ms, 16.3 → 18.1 ms).

Verification of the integrated tree: `rstest` 2 473 tests, 0 failed; `build`, the four `tsc` projects (`tsconfig.json`,
`plugin`, `plugin/internal`, `tsconfig.types.json`), type-aware `oxlint` (0 errors) and `checkLayout` clean; gate lint
241 entries, 0 problems; full `npm run bench -- --runs 3`: 241 entries, 0 failed, 0 violations (220 before this round
plus 21). The packed consumer matrix was not run.

### Prerequisite verification before round 41 — 2026-10-09

The orchestrator repeated the full R40 run in an isolated worktree: 2 473 tests passed;
all 241 benchmark entries passed three samples, with zero violations; build, four typecheck
projects, layout and gate lint passed. Type-aware lint returned zero errors, with existing warnings.

The packed matrix passed 15 of 16 checks and found a native/plain Map-key alias failure in
mixed CJS/ESM history redo. A same-kind branch replacement's scalar diff had been mistaken
for an in-place scalar mutation. Such patches now carry replacement provenance; native
history uses owned graph endpoints rather than replaying that incomplete leaf diff.
A regression with repeated undo/redo failed before the repair and passed after it; the
in-place mutation control continues to preserve the alias.

Three packed-consumer helpers also still called the removed private `cache.keyOf()`.
They now obtain the key from public `cache.resolve(args).key`, without a compatibility shim.
After the repair: 540 history/resource-write-shape/tracking-boundary tests passed, all 25
history-related benchmarks passed three samples, and the corrected packed mixed-format
consumer passed (`sha1 eb85cd3f0dca522f0ee691403e7c72f565250e0f`).
Build, typecheck, layout and lint passed again. The other 15 packed checks were not repeated
after this focused repair; round 41's final verification must run the complete matrix again.

R40's 21 new benchmark entries remain in the common unfiltered suite. This prerequisite
check does not claim fixes or measurements for the four findings in round 41.
