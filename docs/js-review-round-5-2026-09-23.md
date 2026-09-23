# JavaScript review, round 5 — 2026-09-23

Reviewed revision: `e803847` on `master`. Scope: the JS/TS state engine, derived values,
selection snapshots, resource cache, local snapshots, and the published runtime contract.
Native/Rust implementation was outside scope. This change adds only this review document.

## Assessment and priorities

The round-four repairs passed their targeted controls: instance accessors work with native
private fields, special string keys survive ordinary snapshots and scope dehydration,
selection arrays preserve their copied properties, and StrictMode cache ownership is
restored on a real unmount. Proxy-cache retirement now drops records irrelevant to live
entries. These improvements are substantive.

The fifth pass found **8 findings: 4 P1, 2 P2, and 2 P3**. No P0 was established. The main
correctness theme is object identity: the library tracks store paths precisely, yet a
selection or computed value can return an object whose reference does not tell the whole
story about what a child renders.

- **P0:** broad immediate failure.
- **P1:** silent stale UI or a published runtime contract that fails.
- **P2:** narrower data-loss or demonstrated scaling issue.
- **P3:** performance/design decision or verification gap without a proven production failure.

## Verification

The affected component, scope, snapshot, proxy-cache, computed, and resource-cache tests
passed: **7 test files, 271 tests**. Library, demo, and public API TypeScript checks passed.
The installed React for runtime probes was 19.3.0; React 18 was not exercised.

Additional bounded checks used the current committed CommonJS output, React/JSDOM with
`act`, and a few small store/cache updates. They are direct reproductions, not a synthetic
load or latency benchmark. No source file or test was changed. The pre-existing modification
to `.claude/scheduled_tasks.lock` is outside this report commit.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R5-01 | P1 | Structural equality ignores whether selected objects share references |
| R5-02 | P1 | A mutable Map selection reaches its owner but not its memoized child |
| R5-03 | P1 | Shared computed object results gain late reads without updating their subscription |
| R5-04 | P1 | Advertised Node 14.6 runtime lacks the AbortController required by resources |
| R5-05 | P2 | Local snapshot/restore drops symbol-keyed state |
| R5-06 | P2 | Cache eviction repeatedly scans every subscriber for candidate entries |
| R5-07 | P3 | Deep selection comparison walks unchanged structured values on parent renders |
| R5-08 | P3 | The advertised React 18 peer range still lacks independent test coverage |

## R5-01 — [P1] Equal fields can conceal a changed object graph

**Location:** [sameSelection.ts](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L49),
[detachment](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L36).

`detachSelection` deliberately preserves shared references and cycles. `sameSelection`
compares values recursively but remembers only a forward pair in a `WeakMap`. If the old
snapshot has `left === right` and the new selection has two separate but field-equal objects,
the old object is mapped to the first new object and then overwritten with the second. The
comparison returns `true`, although the child's identity test has changed.

Bounded React reproduction:

```text
store.share = true  -> memo child shows "same"
store.share = false -> selected objects are separate
DOM remains "same"; child rendered only once
```

The comparator also reports a null-prototype dictionary and an ordinary object with the
same own fields as equal, although the detached snapshot preserves their different
prototypes. A child testing `Object.getPrototypeOf` can therefore retain the wrong one.

**Correction:** make cycle-safe equality preserve graph topology in both directions and
compare supported plain-object prototypes. A prior mapping of one old node to a different
new node, or of two old nodes to the same new node, must count as a change. Keep the
existing handling of cycles, special own keys, symbols, arrays, and equal flat selections.
Assert what a memo child displays, not just the comparator's return value.

## R5-02 — [P1] A mutable exotic value can strand a memo child

**Location:** [sameSelection.ts](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L49),
[exotic-value pass-through](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L45).

A `Map` in store data is an untrackable leaf: touching it through `draft` records the
leaf path and wakes its subscriber. `connectSelection(store, data => ({map: data.map}))`
then hands the same Map reference to a memo child. Deep detachment intentionally passes
exotic objects through unchanged; the equality check sees `Object.is(oldMap, newMap)` and
reuses the old outer selection.

Reproduction: mutate `draft.map.set('a', 2)` and publish. The owner rendered twice and
the store version advanced, but the memo child rendered once and still showed `1`;
`store.getData().map.get('a')` returned `2`.

**Correction:** decide and enforce a safe contract for mutable exotic selection members.
Options include a conservative new outer snapshot identity on relevant writes or an
explicitly unsupported shape with an actionable diagnostic and a primitive projection
route. Arbitrary Map/Date/class instances cannot be treated as immutable just because
their reference is stable. Keep ordinary primitive and plain-data memoization precise.

## R5-03 — [P1] Late consumer reads do not amend a computed subscription

**Location:** [Computed.recompute](../lib/src/Carburetor/Derived/Computed.ts#L171),
[dependency observation](../lib/src/Carburetor/Derived/Computed.ts#L330),
[store read-set copy](../lib/src/Carburetor/Store/Carburetor.ts#L135).

A computed body returns the live `read(store).user` proxy. The body's first read records a
branch marker. A consumer reading `.name` later records the leaf into the computed's
in-memory read set. The store's `subscribe` already copied that set for its subscriber
index, though; changing the original Set does not update the registration.

One component first mounted and rendered `computedUser.name`. A second component later
mounted and rendered `computedUser.age`. After changing only `user.age` from `30` to
`31`, the second DOM node remained `30`; the store held `31` and the computed version
did not move. Mounting order determines which leaves happened to be registered before the
first subscription was established.

**Correction:** do not let a computed result carry an open recorder whose later consumer
reads silently mutate already-published dependency metadata. Either make the returned
value a detached value with an appropriately broad dependency, or reconcile a newly
observed leaf with the active subscriber index. Cover a shared computed with two consumers
reading different fields, in both mount orders, plus the first-consumer control.

## R5-04 — [P1] Resource APIs exceed the declared Node minimum

**Location:** [package engine constraint](../package.json#L56),
[ResourceCache request construction](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L520),
[single-slot construction](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L215).

The package advertises `node >=14.6.0`. Both resource implementations call
`new AbortController()` on load. Node's [official API history](https://nodejs.org/docs/latest/api/globals.html#class-abortcontroller)
records this global as introduced in 14.17.0 on the Node 14 line; archived Node 14
[documentation](https://nodejs.org/download/release/v14.19.1/docs/api/globals.html#class-abortcontroller)
also describes its experimental flag. Node 14.6 therefore cannot supply the advertised
global by default.

A bounded probe removing the global from the current runtime made both
`ResourceCache.load()` and `ResourceCarburetor.load()` throw
`AbortController is not a constructor` before they could start a request.

**Correction:** align the runtime contract with every used global, or provide/detect an
appropriate cancellation implementation. Test the oldest claimed runtime for store,
resource, and packaged entry points. This review does not propose a dependency/version
change; it identifies a mismatch between the current metadata and implementation.

## R5-05 — [P2] Symbols survive tracking but disappear from snapshots

**Location:** [deepClone.ts](../lib/src/Carburetor/Store/Utils/deepClone.ts#L19),
[read tracking](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts),
[write tracking](../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts).

Recent fixes permit conservative tracking of symbol-keyed branches and publication of
nested writes beneath them. The generic local snapshot still enumerates only
`Object.keys(source)`, which excludes symbol keys.

Reproduction: a store had one symbol-keyed plain-object field and one string field.
`snapshot()` retained the string field but omitted the symbol field; `restore(snapshot)`
left that field absent. This is a local snapshot round trip, independent of JSON:
ordinary JSON serialization itself does not preserve symbol-keyed fields.

**Correction:** preserve own enumerable symbol properties in the local detached copy and
history/restore paths, or explicitly exclude symbol-keyed state from the supported snapshot
contract while warning before irreversible loss. Keep the wire serialization limitation
separate and documented.

## R5-06 — [P2] Cache eviction repeats subscriber scans per candidate

**Location:** [ResourceCache.isRetained](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L373),
[evict](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L400).

When the cache exceeds `maxEntries`, `evict()` tests each non-pending key for retention.
Each `isRetained(key)` enumerates all subscribers and materializes each subscriber's read
paths to check a string prefix. Then candidates are sorted.

In a bounded check with three pinned entries and three subscribers at `maxEntries: 1`,
loading a fourth key invoked `isRetained` **seven times** across request start and
settlement. Each invocation could scan the same three subscribers. The current work shape
can approach entries × subscribers × read paths per eviction pass, repeated as requests
arrive while many entries are retained. This is a work-count finding, not a measured
frame-time claim.

**Correction:** if representative request/reader patterns make this visible, maintain
per-key retention counts or query an index that excludes wildcard tooling subscribers.
Keep the current rule that an active reader and a pending request protect their entry.
Do not add a second index without profiling its subscription-update cost.

## R5-07 — [P3] Deep selections cost work even when their snapshot is reused

**Location:** [sameSelection.ts](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L9),
[connectSelection](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L342).

`connectSelection` reruns the selector for every render to renew tracked dependencies.
With structured output, comparison then walks its enumerable graph even when the
store version and child-visible content have not changed. The old snapshot's detached
objects cannot short-circuit by reference against the current source objects.
The child may correctly skip its render while the owner still performs a full comparison
of the selected structure.

This cost is a consequence of the safe deep-detachment contract, not an automatically
actionable bug. Prefer small projections for frequently rerendered parents; profile a
representative nested selection before redesigning the tracking/cache API. If caching
by store version is explored, account for selectors that depend on changing props as
well as store data.

## R5-08 — [P3] React 18 remains an unverified advertised peer

**Location:** [README compatibility note](../README.md#L43),
[package peer range](../package.json#L71).

The package advertises React 18 and 19, while the README explicitly states only React
19.3 has been exercised in local checks and CI. The proxy-backed class lifecycle,
StrictMode replay, Suspense, and external-store interop have version-sensitive behavior.

**Recommendation:** add a separate compatibility job against the declared React 18 range,
covering the core class, resource and interop scenarios. Keep the current 19.3 job.
Treat an unverified advertised peer as a release-coverage gap, not as proof that React 18
is broken.

## Recommended order

1. Close the stale UI paths: R5-01–R5-03.
2. Resolve the Node runtime contract: R5-04.
3. Preserve local snapshot data and measure cache eviction under realistic retention:
   R5-05–R5-06.
4. Document and profile deep selection cost and complete the React peer matrix:
   R5-07–R5-08.

The fixes from prior rounds are worth keeping. These focused reproductions and runtime
contracts are the next acceptance cases; the passing existing tests do not cover them.
