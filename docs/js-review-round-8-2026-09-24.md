# JavaScript review, round 8 — 2026-09-24

Reviewed state: `master` at `f2c5390` plus the current uncommitted JS/TS refactor and
round-seven repairs. Scope: the JS/TS engine, React interop, resource state machines,
cache hot paths, and their tests. Native/Rust rule semantics were not reviewed. This
report changes no implementation.

## Round-seven repair status

- **R7-01 — partial.** Nested Map/Set/Date snapshots are now detached, and the
  regression tests pass. A selected class instance is still handed to React live;
  the new development diagnostic describes the resulting stale UI, but does not
  prevent it. The test explicitly expects the DOM to remain stale after a write.
- **R7-02 — partial.** Stable envelopes containing exotic values under ordinary
  string keys now notify. The new traversal misses symbol-keyed members and can
  execute user getters during settlement (R8-01 and R8-02 below).
- **R7-03/R7-04 — repaired for the shim's stated surface.** Throwing abort
  listeners no longer interrupt delivery, and `onabort`/`throwIfAborted` have
  focused tests. Native `AbortSignal` identity remains explicitly unsupported
  without a platform controller.
- **R7-05 — partially optimized.** A cache-key miss now escapes the JSON already
  computed instead of serializing twice. The normal `pathOf(args); getEntry(args)`
  pair still serializes arguments twice, including on a warm render. That is a
  deliberate mutation-detection cost, not evidence by itself of a frame-time issue.

The four focused regression files passed in this review: **40 tests**. The new
cases below were reproduced with one write or request each against the locally
built CommonJS package. No load/stress benchmark was run.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R8-01 | P1 | Exotic-value detection executes a getter and suppresses a computed notification |
| R8-02 | P1 | A symbol-keyed exotic member remains invisible to computed change detection |
| R8-03 | P1 | Synchronous subscriber re-entry starts a second resource request before the first is registered |
| R8-04 | P2 | `suspend()` replaces a valid falsy rejection with a new Error |
| R8-05 | P3 | Computed deeply scans results even when a reference change already proves a change |

No P0 was established. The still-live class-instance boundary from R7-01 is an
**open P1 contract decision**, not counted as a newly discovered issue here.

## R8-01 — [P1] Result inspection can throw after a successful computation

**Location:** [containsExoticValue.ts](../lib/src/Carburetor/Store/Utils/containsExoticValue.ts#L33),
[Computed.ts](../lib/src/Carburetor/Derived/Computed.ts#L496).

`containsExoticValue()` calls `Object.values()` on every plain result container.
That invokes enumerable getters. The computed body may validly return an object
without reading those properties itself; settlement now reads them anyway. A
throwing getter escapes through the update-wave error isolation after `recompute()`
has already made the new value valid, but before `announced`, `version`, and
subscribers are advanced.

Bounded reproduction: a computed returns `{n: read(store).n, get danger() {
throw Error('getter touched') }}`. After changing `n` from 1 to 2, the wave
reports the getter error, the computed's `get().n` is 2, but its notification
count and version both remain 0. A subscriber therefore keeps stale UI. This
case is absent from the R7-02 tests, which use only data properties.

**Correction:** inspect own property descriptors rather than reading property
values implicitly. Define whether accessors are outside the supported result
contract; if they are, reject/report them explicitly without converting a
successful value update into a silent missed announcement. Test a throwing and
a side-effecting getter, with subscriber delivery and version assertions.

## R8-02 — [P1] Symbol-keyed exotic members hide mutations

**Location:** [containsExoticValue.ts](../lib/src/Carburetor/Store/Utils/containsExoticValue.ts#L33),
[Computed.ts](../lib/src/Carburetor/Derived/Computed.ts#L497).

`Object.values()` sees enumerable string keys, not symbols. A stable plain
envelope whose enumerable symbol property holds a Map is considered non-exotic
even when that Map was mutated in place and its store dependency moved.

Bounded reproduction: a computed reuses `const envelope = {[symbol]: map}` and
sets `envelope[symbol] = read(store).index` on each evaluation. After
`draft.index.set('a', 2)`, `computed.get()[symbol].get('a')` is 2, but the
notification count and version are both 0. The ordinary string-key version
is covered by the R7-02 tests and does notify.

**Correction:** traverse own enumerable string **and symbol** data properties,
with the existing cycle guard. Share the key-selection rule with the snapshot
and equality helpers where possible, so two representations of the same plain
result do not acquire different change semantics. Add a symbol-keyed regression.

## R8-03 — [P1] Request bookkeeping is installed after synchronous publication

**Location:** [ResourceCarburetor.start](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L212),
[ResourceCacheLifecycle.fetch](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L318).

Both paths publish `Pending`/loading synchronously before storing the promise
used to join an in-flight request. The default store scheduler calls subscribers
synchronously. If one subscriber reacts to that publication by calling
`load(sameArgs)`, it sees no joinable promise and starts a second loader call.
The outer call subsequently overwrites request bookkeeping established by the
nested call.

A one-re-entry probe on each resource type called the loader **twice** for the
same key. With a loader returning sequential values 1 then 2, both probes ended
with stored value 1: the outer request's value 2 was discarded. This violates
the documented same-argument request-sharing guarantee and can double network
work or publish the wrong answer. Existing concurrency tests start their second
load only *after* the first `load()` returns, so they miss this window.

**Correction:** establish a stable in-flight slot/promise before any synchronous
notification, then call the loader and settle that slot. Preserve the exception
path for a synchronously throwing loader and the render-safe deferred publication
used by `suspend()`. Add re-entrant subscriber tests for both classes, including
promise identity, loader count, settlement order, abort, and a distinct-key
replacement case.

## R8-04 — [P2] Falsy rejection values are not rethrown intact

**Location:** [ResourceCarburetor.ts](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L137),
[ResourceCacheLifecycle.ts](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L305).

Both `suspend()` methods use `storedFailure || new Error(...)`. JavaScript permits
`Promise.reject(0)`, `Promise.reject('')`, or `Promise.reject(false)`; their raw
failure accessors retain the value, but `suspend()` throws a newly constructed
Error instead. A bounded `Promise.reject(0)` probe returned `0` from
`getLastError()`/`getFailure()` and threw an Error from `suspend()` in both classes.

**Correction:** distinguish “no stored failure” from a stored falsy failure with
an explicit presence flag or a Map `has(key)` check. Test the same rejection
round trip for 0, false, empty string, and undefined, and specify whether an
explicit `undefined` rejection is meant to be preserved or normalized.

## R8-05 — [P3] Avoidable deep traversal in every computed settlement

**Location:** [Computed.ts](../lib/src/Carburetor/Derived/Computed.ts#L496),
[containsExoticValue.ts](../lib/src/Carburetor/Store/Utils/containsExoticValue.ts#L17).

`containsExoticValue(this.value)` runs before the result identity is tested.
It walks the entire reachable plain-object/array graph and allocates an
`Object.values()` array at each level even when `baseline !== this.value` already
guarantees a notification. This is a definite extra O(result size) scan, but no
wall-time or allocation cost has been measured on a real application. It should
not be described as a proven bottleneck yet.

**Correction:** short-circuit on a changed reference; inspect for nested exotic
values only when the identity is stable **and** dependency versions moved.
Combine this with the descriptor-based traversal required by R8-01/R8-02. Keep
the stable-envelope and plain-result control tests. Measure before considering
more invasive caching or invalidation strategies.

## Profiling decision and suggested experiment

Yes: profile before choosing further performance work. The present evidence is
strong enough to fix R8-05's redundant scan and R8-03's duplicate requests,
but not to rank broad optimization projects. Existing microbenchmarks cover
proxy reads and path matching, not real React commits, cache keying, or computed
result inspection.

First capture a production-build trace of a representative application action:
one item update in a long list, a render using `pathOf/getEntry`, and a computed
whose result size resembles real data. Record React commit count/duration,
JavaScript self-time, allocation volume, `JSON.stringify` calls, and subscriber
callbacks. Keep a same-behavior baseline and compare medians/distributions after
one change at a time. Use small isolated benchmarks only to explain a hotspot
seen in that trace; do not manufacture load or turn benchmarks into tests.

## Recommended order and verification limits

1. Fix R8-01 and R8-02 together in the result traversal; retain cycle safety.
2. Make request start re-entrancy safe in both resource classes (R8-03).
3. Resolve the still-live class-instance selector contract from R7-01: an
   actionable development warning is not a stale-UI fix.
4. Preserve falsy resource failures (R8-04).
5. Short-circuit the deep scan (R8-05), then profile real render paths before
   deciding whether warm cache-key validation or proxy work merits more changes.

This was a review, not a code repair: no implementation or test was changed to
address these findings. The repository had extensive unrelated uncommitted
implementation and generated-output changes before this report; they are
outside the report commit. The pre-existing `.claude/scheduled_tasks.lock`
state was not modified by this review.
