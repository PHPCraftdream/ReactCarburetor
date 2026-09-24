# JavaScript review, round 9 — 2026-09-24

Reviewed revision: `b0b6466` on `master`. Scope: the JS/TS resource state
machines, computed results, React interop, and their performance boundaries.
Native/Rust lint-rule semantics were not reviewed. This commit adds only this
report; it does not change implementation or tests.

## Status of round-eight repairs

R8-01 through R8-05 have focused code changes and regression tests. Computed
settlement no longer invokes an enumerable getter just to inspect a result;
enumerable symbol-keyed members are inspected; a changed result reference avoids
the deep scan. A synchronous **store subscriber** can now join a request before
its loader starts. Both resource classes preserve falsy rejection values,
including `undefined`. The R7-01 class-instance hook selector now fails fast
instead of silently handing React a live, stale snapshot.

The six focused test files passed in this review: **43 tests**. The full CI for
`b0b6466` had previously completed all ten jobs successfully. The findings
below are boundaries outside those tests, reproduced with bounded abort,
write, and load sequences against the committed CommonJS build. No stress or timing benchmark
was run.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R9-01 | P1 | Abort listeners re-enter while the cancelled request is still registered |
| R9-02 | P1 | A non-enumerable exotic member hides a computed change |
| R9-03 | P1 | A successful `undefined` cache value is treated as missing by `suspend()` |

No P0 was established. P1 here means a supported call can silently lose a
request, leave work uncancelled, or withhold an update. Performance candidates
are deliberately not assigned a defect priority without application timings.

## R9-01 — [P1] Abort callback re-entry joins a cancelled request

**Location:** [ResourceCarburetor.cancelInFlight](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L191),
[ResourceCacheLifecycle.abortKey](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L265),
[cache restore](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L56).

`AbortController.abort()` dispatches registered listeners synchronously. Both
cancellation paths invoke it **before** removing the controller and promise
from their in-flight bookkeeping. If an abort listener calls `load(sameKey)`,
that call sees the old promise and incorrectly joins the request being
cancelled. The outer cancellation then deletes the bookkeeping and publishes
Idle, so the apparent retry never starts.

Bounded probes on both classes registered an abort listener that called
`load('a')`, then called `abort`. Both returned the **same cancelled promise**
from the listener's load, called the loader only once, and ended at `Idle`.
The R8-03 tests cover store-subscriber re-entry on the Pending notification,
not re-entry from the signal's abort event.

The single-slot class has a second ordering hazard: while starting key `b`,
the abort listener of old key `a` can start key `c`. A bounded probe ran
loaders in order `a, c, b`; the `c` controller remained *not aborted* while
the outer cancellation cleared its registration. Its work can continue even
though its result will be ignored. The cache's `restore()` also aborts every
controller before clearing maps, so it needs the same re-entry audit.

**Correction:** remove/mark the old request as unjoinable before dispatching
its abort event. After that event, an outer `abort`, replacement, or `restore`
must not erase state installed by a nested new request or overwrite its
Pending state with Idle. Use request identity/generation checks around the
publication phase, not only on final settlement. Test same-key retry,
different-key replacement, and restore re-entry for both classes; assert
loader counts, promise identity, final state, and signal cancellation.

## R9-02 — [P1] Non-enumerable members are still invisible to computed inspection

**Location:** [containsExoticValue.ts](../lib/src/Carburetor/Store/Utils/containsExoticValue.ts#L34),
[Computed.settle](../lib/src/Carburetor/Derived/Computed.ts#L492).

R8-02 switched from `Object.values()` to descriptors and now sees enumerable
symbols. It still explicitly skips every non-enumerable descriptor. A normal
plain object can expose a non-enumerable `Map` through direct property access;
the computed result type does not exclude such properties. If the same object
is reused and that Map mutates in place, the scan calls the result non-exotic
and reference equality suppresses publication.

Bounded reproduction: define a writable, non-enumerable `hidden` data property
on a stable plain envelope, assign `read(store).index` to it in the computed
body, and mutate that Map from `1` to `2` through the store draft. The returned
`computed.get().hidden.get('a')` was `2`, but the notification count and
computed version both remained `0`. Existing R8-02 tests cover an enumerable
symbol member, not this case.

**Correction:** decide the public result contract explicitly. If readable
own data properties count, inspect them regardless of enumerability; descriptors
still avoid invoking accessors, which can be conservatively treated as opaque.
If non-enumerable result members are unsupported, reject/report that shape
rather than silently certifying a mutable value unchanged. Test a hidden Map
and a hidden accessor separately, including subscriber and version behavior.

## R9-03 — [P1] `undefined` is a valid success value but not a cache hit for `suspend()`

**Location:** [ResourceCacheLifecycle.suspend](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L294),
[markLoading](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L373),
[settleFailure](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L435).

The generic loader is allowed to resolve with `undefined`; `T` is not
constrained to non-undefined values, and `ResourceCarburetor.suspend()` already
returns a successful `undefined` result based on status alone. The cache uses
`entry.data !== undefined` as an additional success condition. After a
successful `undefined` load, `suspend(key)` therefore starts another request
and throws its promise instead of returning the settled result. Loading treats
the same entry as Pending again; repeated suspension can keep re-fetching.

Bounded reproduction: a cache loader resolved `undefined`, `load('a')`
completed, then `suspend('a')` threw a Promise, invoked the loader a second
time, and moved the entry from `Success` to `Pending`. That is not a rejected
load or an absent entry: the first answer settled successfully.

**Correction:** use the entry's status (and, where needed, its settled timestamp)
to distinguish a successful answer from an absent one. Do not use payload
`undefined` as a presence sentinel. Audit refresh/failure transitions with a
successful undefined payload too; the `hasData` test currently uses the same
sentinel. Add a regression for `load`, `suspend`, `refresh`, and a failed
refresh when `T` includes `undefined`.

## Performance and simplification decision

Profile before any broader optimization. The R8 short-circuit removed a
provably unnecessary traversal, but a stable large plain computed result still
requires descriptor inspection after a dependency moves. Cache rendering also
still serializes arguments on both `pathOf(args)` and `getEntry(args)`; tests
establish the call count, **not** a frame-time bottleneck. The extra deferred
promise used to make R8-03 re-entry safe is another allocation, normally small
beside an actual request; do not rewrite the request lifecycle for that cost
without evidence.

Capture a production-build trace from a representative application action:
one list-item update and one cache-backed render. Record React commit count and
duration, JavaScript self-time and allocations in key serialization, computed
inspection, and proxy reads. Compare the same behavior before and after a
single change. No representative workload was supplied for this review, and
the repository must not generate artificial load merely to produce a number.
Fix the three correctness findings first; a microbenchmark cannot validate
their state-transition guarantees.

The cancellation logic in the two resource classes has different storage
shapes, but it needs one shared *invariant*: remove the old generation from
joinable state before invoking user-visible abort callbacks, then preserve any
generation created re-entrantly. Encode that invariant in tests before trying
to deduplicate code mechanically.

## Verification and limits

The focused regressions passed (**43 tests**); the three new probes above
demonstrate gaps those tests do not cover. This review made no implementation
change and did not run a performance workload. The pre-existing deleted
`.claude/scheduled_tasks.lock` and untracked allocation-rule plan were left
untouched and are not part of the report commit.
