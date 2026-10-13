# API and engine review, round 11 - 2026-09-30

Reviewed revision: `f8853b5`, including the six round 10 repairs and the native-computed bookkeeping
optimization in `b740de2`. Scope: public store/derived/resource APIs, read and write proxies,
replacement and restore, scheduling and transactions, React subscriptions and selectors, resource
lifecycles and views, scopes, persistence, DevTools, and history. Earlier reports were checked to
exclude resolved mechanisms and already-recorded performance proposals.

This is a source-only review. No tests, builds, runtime probes, benchmarks, profilers, or installs
were run. Every failure scenario below is a prediction from the cited control flow, not a newly
executed reproduction. Round 10 has code repairs and focused acceptance in the parent workflow;
the final integrated suite was still running when this review started. This report does not certify
its completion. Only this report is changed.

Seven findings: three P1 correctness defects and four P2 correctness, API, or avoidable-work issues.
No P0 or P3 finding was established.

| ID | Priority | Finding |
| --- | --- | --- |
| R11-01 | P1 | A same-reference computed change before first subscription remains invisible |
| R11-02 | P1 | An observed computed returns stale data while invalidation delivery is deferred |
| R11-03 | P1 | Omitted definition flags create locked state and permit phantom history writes |
| R11-04 | P2 | Persistence omits the resource snapshot key required to reuse a restored answer |
| R11-05 | P2 | Detaching a repeated Date breaks identity and lookups inside the detached graph |
| R11-06 | P2 | Unsubscribing during a throttle flush does not cancel a later captured callback |
| R11-07 | P2 | Cache view equality hides signed-zero changes and reallocates unchanged NaN views |

## Findings

### R11-01 - P1 - A same-reference change before first subscription remains invisible

**Evidence and mechanism.** The repaired hook caches a record using the computed's public version
and `Object.is` of its result (`lib/src/Interop/useComputedValue.ts:14-28`). Native `get()` can refresh
an unobserved value after leaf versions move, but `recompute()` does not advance the public version
(`lib/src/Carburetor/Derived/Computed.ts:125-131,192-211,268-271`). First subscription also refreshes
drifted inputs and sets the announcement baseline to the refreshed value without announcing a
change (`Computed.ts:142-157`). Only settlement increments the publication version (`:535-537`).

**Concrete scenario to regress.** Render a hook consumer of
`computed(read => read(store).index)` at `index.get('a') === 1`, with no existing computed observer.
A sibling's mount layout effect updates that Map through draft to `2` before the hook's first
subscription. The write is tracked, but no computed edge existed to receive it. Subscription or
React's snapshot recheck refreshes the computation; the result is the same Map and the public
version is still zero. `readSnapshot()` returns its original record, so the recheck cannot detect
that the text already rendered from the Map is obsolete. A stable envelope has the same route.
The live Map itself now contains `2`; the missing signal concerns the already-produced output.

This differs from closed R10-03: that repair correctly detects a *delivered publication* with a
stable result reference. Here there was no publication. The new initial-commit regression uses a
primitive whose identity changes (`__tests__/Engine/Tooling/core/ComputedPublication.test.tsx:264-277`);
the Map regression updates only after subscription (`:62-93`). Neither proves this boundary.

**Action and acceptance.** Establish an observable revision or equivalent drift check covering a
value read before observation, including refresh during first subscription. Do not allocate a new
React snapshot on every check or make unrelated/equal primitive writes publish. Add the sibling
layout-effect scenario with Map, stable envelope, Set and Date results, plus equal-primitive and
source-switch controls. Assert DOM, observer cleanup, versions and snapshot identity. Check the
class bridge too: `useComputed()` captures a version and first commit compares only that version
(`lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:189-193,301-323`;
`Subscriptions.tsx:273-283`), so it needs its own render-to-first-subscription acceptance case.

**Measurement boundary.** Count initial/final commits and unchanged snapshot checks before measuring
time or allocation. No stale-DOM reproduction, render reduction, or performance improvement was
measured here.

### R11-02 - P1 - An observed computed trusts its cache before deferred invalidation arrives

**Evidence and mechanism.** Once a computed has subscribers, `isStale()` consults only `valid` and
skips leaf-version drift (`lib/src/Carburetor/Derived/Computed.ts:192-198`). A store increments its
version before adding its writes to an open transaction (`lib/src/Carburetor/Store/Carburetor.ts:588-595`),
and the transaction delivers those invalidations only on close
(`lib/src/Carburetor/Store/Transaction/UpdateBatch.ts:35-46,77-117`). With a throttle, notification
instead queues the dependency callback for a later timer
(`Carburetor.ts:410-416`; `lib/src/Carburetor/Store/Scheduling/ComponentUpdateThrottle.ts:40-54`).
In both cases the raw input already changed while the observed computed remains `valid`.

**Concrete scenario to regress.** Subscribe to `computed(read => read(store).n * 2)` at `n === 1`.
Inside `transaction`, write `n = 2`, then call `get()` before the transaction closes. The early
return serves `2`, although the store already holds `2` and the derived expression should produce
`4`. The same stale read occurs after a write to a throttled store and before its timer flush.
An unobserved computed uses `hasDrifted()` and does not share this behavior. Current transaction
tests assert the result after closing, not a pull inside the open batch
(`__tests__/Engine/Derived/Computed/Core.test.tsx:86-107,307-334`).

**Action and acceptance.** Separate cache freshness from deferred observer delivery, or validate
dependency drift before trusting an observed cache. Preserve the independent announcement
baseline: an eager fresh read must not consume the notification owed on close/flush. Regress
observed and unobserved direct reads, a native chain, and direct-plus-derived inputs inside a
transaction and before a controlled throttle flush. Verify current pulled values, one final
announcement, error propagation, and precision for writes outside the dependency's read set.

**Measurement boundary.** A repair that checks all dependency versions on every `get()` may add
work to the recently optimized path. Measure body evaluations and version/drift checks for stable
reads, matching writes, and unrelated writes before choosing the mechanism. No speedup is claimed.

### R11-03 - P1 - Omitted definition flags create locked state and phantom history writes

**Evidence and mechanism.** `isOpaqueDescriptor()` rejects flags explicitly set to `false`, but on
a new property requires only `enumerable: true`
(`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:42-46`). The definition trap then installs
the caller's descriptor unchanged apart from its value (`:459-479`). Native definition defaults
omitted `writable` and `configurable` to `false` for a new key. Consequently this route accepts a
property the same trap's error describes as forbidden locked state.

```ts
store.edit(draft => {
    Object.defineProperty(draft, 'created', {value: 1, enumerable: true});
});
```

Here `edit` is a test subclass's public wrapper around protected `update`. The new own key is
non-writable and non-configurable. A later `Reflect.set(draft, 'created', 2)` returns `false`, but
the ordinary set trap reports the patch and path *before* its native write (`:390-426`), and
`update()` publishes in `finally` (`lib/src/Carburetor/Store/Carburetor.ts:482-488`). The recorded
next value is `2` while the live value is still `1`. History applies that patch to its open
baseline (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:197-203`), making the baseline disagree
with the store. Delete has the same record-before-refusal ordering (`createWriteProxy.ts:533-549`).
For a trackable object value, the locked property also reaches the read proxy's wrapping refusal
or production raw-value fallback (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:254-268`).

This is distinct from closed R10-01/R10-02: effective values and implicit array lengths are now
attributed correctly. The remaining error is the *effective descriptor flags*. New-key acceptance
uses all open flags (`__tests__/Engine/Store/Paths/DefinitionHistory.test.ts:75-87`), and rejection
tests use explicit `writable: false` or omit `enumerable` (`:227-253`).

**Action and acceptance.** Validate effective flags before native installation, accounting for
existing descriptors and the defaults for a new property. Preserve R10's valid omitted-value and
omitted-flag definitions on existing open keys. Do not record unsuccessful ordinary writes or
deletions as accepted changes. Cover missing writable/configurable flags separately and together,
new object keys and array indices, primitive and branch values, boolean refusal and throwing
assignment, and full undo/redo. Assert raw descriptors, state, paths, versions and history
availability in development and production. No performance gain is claimed for this repair.

### R11-04 - P2 - Persistence omits the key required to reuse a restored resource answer

**Evidence and mechanism.** `persist()` promises to store a snapshot but serializes `getData()`
(`lib/src/Carburetor/Tooling/persist.ts:5-15,35-39`). For ordinary stores these have equivalent JSON
content. `ResourceCarburetor.snapshot()` deliberately adds `key`, which is absent from live state
(`lib/src/Carburetor/Resource/ResourceCarburetor.ts:72-78,125-132`). Restore requires that key to
re-establish a settled answer, and `suspend(args)` serves Success/Error only when it matches
(`:103-114,159-177`). Persistence restores the parsed payload through this override (`persist.ts:23`).

**Concrete scenario to regress.** Attach persistence, finish `resource.load('a')`, disconnect, then
connect a fresh resource to that storage. The persisted successful data survives, but its key was
never written. Restore sets `settledKey` to `undefined`; `suspend('a')` starts a new request instead
of returning the restored answer. A restored Error likewise cannot be recognized for its arguments.
The ordinary-counter persistence tests do not exercise this serialization override
(`__tests__/Engine/Tooling/core/Tooling.test.ts:56-73`).

This is an uncovered consumer of the resource snapshot contract and the older raw-serialization
optimization, not a reopening of the already-fixed resource restore/key implementation. It also
exposes an API inconsistency: generic persistence cannot assume every `ICarburetor` has identical
live and persisted representations.

**Action and acceptance.** Make persisted content honor the supported snapshot/serialization
contract, retaining a raw-data fast path where equivalence is guaranteed. Prefer an explicit
serialization seam or codec over undocumented subtype assumptions. Regress successful and failed
single-slot resources, same-key and other-key suspension, Pending normalization, default and
coalesced persistence, and a custom serialization override. Assert the saved key and whether a
loader was called, with scope/DevTools resource round trips as controls. Measure ordinary-store
serialization time and allocations separately; restoring a full clone to every write would undo
the reason for the earlier optimization. No allocation or latency result is claimed here.

### R11-05 - P2 - Date detachment breaks lookups within the detached graph

**Evidence and mechanism.** `detachOpaque` consults a shared `seen` map, but the Date branch returns
a fresh Date without registering it (`lib/src/Carburetor/Store/Utils/detachOpaque.ts:51-59`). Map and
Set copies do register, and a Map recursively detaches keys and values through the same map
(`:62-80`). Hooks and `watch()` use this helper to produce their handed-out values
(`lib/src/Interop/useCarburetorValue.ts:90,234-241`;
`lib/src/Carburetor/Store/Carburetor.ts:38-49,369-385`).

**Concrete scenario to regress.** Start with a store containing one Map whose key is a Date. A
selector returns both that Map and a key obtained from its own iterator. Equivalently, the detach
input is `{key: date, index: new Map([[date, 'answer']])}`. The copied `key` and copied Map key are
two different Dates; `copy.index.get(copy.key)` is `undefined`, although the equivalent lookup in
the original selection returns `'answer'`. The mismatch occurs in either property order.
The consumer is using a key from the detached graph, so the documented caveat about looking up a
copied Map with an *original* key does not explain it. No aliased plain store branch is required.

**Action and acceptance.** Register the Date copy before returning it, as with the other copied
objects. Add repeated-Date identity tests, a Date used as both Map key and value, a Date shared
between a Set and an envelope, and both traversal orders. Verify lookup and sharing through the
public hook and `watch()` as well as the helper, while source Date mutations remain isolated and
Date subclasses retain their existing rejection/live-instance policy. Current Date tests assert
time and detachment for one occurrence; the Map-key test uses a plain object
(`__tests__/Engine/Store/Utils/detachOpaque.test.ts:61-75,88-99`). For K references to one Date, the
current route creates K Date copies; acceptance should establish one copy per distinct Date.
That is a source-derived allocation opportunity, not a measured memory reduction.

### R11-06 - P2 - Unsubscription cannot cancel a callback already captured by the throttle

**Evidence and mechanism.** Store unsubscription cancels the scheduled id and removes its record
(`lib/src/Carburetor/Store/Carburetor.ts:316-321`). The throttle's `cancel()` deletes only from its
pending map (`lib/src/Carburetor/Store/Scheduling/ComponentUpdateThrottle.ts:45-47`). Flush snapshots
only callback values, clears that map, and invokes every captured callback without an id or
registration check (`:93-102`). The store originally queued the raw subscriber callback
(`Carburetor.ts:410-416`), so later removal of its subscriber record cannot protect this route.

**Concrete scenario to regress.** Two subscribers `a` and `b` are queued by one store write. During
flush, `a` calls `store.unsubscribe('b')`. Cancellation sees an empty pending map; `b` still runs
from the captured array after its registration has ended. The same route can perform stale work
after one callback tears down another consumer. Existing cancellation coverage cancels before
the timer runs (`__tests__/Engine/Store/ComponentUpdateThrottle.test.ts:38-48`).

**Action and acceptance.** Preserve cancellable identity for not-yet-run callbacks during flush,
or resolve delivery against the current registration. Define same-id replacement during a flush
so cancellation does not accidentally cancel a new registration or run an obsolete one. Cover
direct throttle cancellation, public store unsubscribe, unmount driven by another callback,
cancel-and-resubscribe, and reentrant scheduling. Keep exception isolation and the depth guard.
Use controlled flushing; assert callback order/count and cleanup. Skipping cancelled work is a
consequence to verify, not a measured React render reduction or throughput claim.

### R11-07 - P2 - Cache view equality disagrees with the engine's numeric equality

**Evidence and mechanism.** `isViewCurrent()` compares `view.data === entry.data`
(`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:291-299`), and a successful comparison
returns the cached view (`lib/src/Carburetor/Resource/Cache/ResourceCache.ts:160-169`). Store diffing
uses `Object.is` (`lib/src/Carburetor/Store/Paths/Diff/diffPaths.ts:98-99`); draft's ordinary no-op
guard explicitly distinguishes signed zeros and equates NaN (`createWriteProxy.ts:362-366`).

**Concrete scenarios to regress.** Prepare a settled numeric entry with `data: -0`, read its view,
then `setData()` with an equal entry record except `data: +0`. Keep `updatedAt` and all flags
unchanged. Diffing publishes the changed data, but view validation considers it equal and returns
the old view containing `-0`. Thus `getData().entries[key].data` and `getEntry(args).data` disagree.
Conversely, a settled `data: NaN` fails the view check on every unchanged read and allocates a new
spread view each time. A numeric loader is admitted by the generic API; no special numeric
restriction exists here.

This differs from closed R10-06's unconditional clearing on replacement. Surviving views are now
kept and checked lazily; the remaining comparator has these two incorrect outcomes. The replacement
regressions use object-valued data (`__tests__/Engine/Resource/ResourceCacheLifetime/ViewReplacement.test.tsx:11-25,62-81`).

**Action and acceptance.** Use SameValue semantics for the generic data field. Test signed-zero
replacement in both directions, repeated unchanged NaN reads, ordinary primitive equality, and
object identity controls through `getEntry` and `resolve`. Include loader/refresh paths with a
controlled timestamp. Assert correct data, view identity and publications independently. Count
view identities for repeated NaN reads before profiling allocation; each current miss visibly
constructs a new object, but no allocated-byte or elapsed-time measurement was made.

## Acceptance and measurement order

1. Regress R11-01 and R11-02 before modifying freshness/publication semantics. Keep the already-fixed
   delivered-publication, equal-value, chain/diamond, error-isolation and dependency-retention cases.
2. Repair R11-03 at definition/write acceptance and verify full history round trips. Incorrect
   accepted state must not be traded for a faster write path.
3. Regress R11-04/R11-05 through their public consumers, then repair serialization and graph copying.
4. Repair R11-06/R11-07 locally, preserving throttle reentry and the lazy cache-view optimization.
5. After correctness acceptance, compare real title edits, filtered/status updates, resource-backed
   renders and undo/redo. Record React commits, body/selector evaluations, snapshot/view creations,
   subscriber deliveries, serialization work, CPU time and allocation stacks in production.
   Report retained heap separately from allocated bytes and retain both distributions and controls.

The remaining tracked-walk/proxy-tree and lazy `diffPaths` path-building proposals were already
recorded in earlier rounds and are not new findings here. Native-computed bookkeeping has already
been optimized in `b740de2`; the parent workflow's paired measurements indicated reductions but
were noisy and do not guarantee native/external parity. This source review adds no performance
measurement and does not promote that old overhead into an eighth finding. All seven R11 items
await the focused reproductions and acceptance above at this revision.
