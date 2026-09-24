# JavaScript review, round 10 — 2026-09-24

Reviewed revision: `6cd3529` on `master`. Scope: the JS/TS resource state
machines, computed results, hooks interop, and performance-sensitive paths.
Native/Rust lint-rule semantics were not reviewed. This commit adds only this
report; it does not modify implementation or tests.

## Status of round-nine repairs

R9-01 through R9-03 are implemented. Resource cancellation removes an old
request from joinable state before firing its abort event; an abort-listener
retry can start a new request. Computed inspection now includes non-enumerable
own descriptors without invoking getters. A successful `undefined` cache
payload remains successful through `suspend()` and failed refreshes.

The five focused regression files passed in this review: **35 tests**. CI for
`6cd3529` completed all ten jobs successfully. The findings below are new
boundaries beyond those tests, reproduced with bounded single-operation or
short re-entrant sequences against the committed CommonJS build. No stress or
timing benchmark was run.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R10-01 | P1 | An inner cache `restore()` is overwritten by the outer restore that triggered it |
| R10-02 | P2 | A superseded `load(key)` resolves although that key's loader never ran |
| R10-03 | P2 | Hook snapshot copying silently drops non-enumerable selected fields |

No P0 was established. P1 is silent loss of a newer state transition; P2 is
a narrower promise or snapshot contract break. No performance priority is
inferred from source inspection alone.

## R10-01 — [P1] Cache restore has no guard against a nested restore

**Location:** [ResourceCacheLifecycle.restore](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L56),
[single-slot restore contrast](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L79).

The R9 cache repair clears old request bookkeeping before dispatching abort
listeners, then merges requests started by those listeners into the restored
entries. But an abort listener can call `restore()` itself, not only `load()`.
That inner restore completes with its own snapshot; afterward the outer call
resumes and calls `setData()` with its earlier snapshot, silently replacing the
newer state. The single-slot resource has an operation-version guard for this
same re-entry boundary; the cache does not.

Bounded reproduction: with an `a` request in flight, its abort listener calls
`cache.restore(innerSnapshot)` containing `x = 'inner'`; the caller invokes
`cache.restore(outerSnapshot)` containing `x = 'outer'`. After both calls,
`getEntry('x').data` is `'outer'`. The later inner restore was lost without an
error. Existing cache restore tests cover an abort listener starting a *load*,
not another restore.

**Correction:** define which operation owns state when restore re-enters. If
the most recently invoked restore wins, use an operation generation to stop
an older outer call from publishing after a nested one. If the outer restore
is meant to win, explicitly cancel or reject work started by the inner call;
do not silently overwrite it while its effects remain live. Test nested
restore with the same and different keys, active controller ownership, and
the final snapshot, alongside the existing load-during-restore case.

## R10-02 — [P2] A superseded `load` reports completion without loading its key

**Location:** [ResourceCarburetor.start](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L234),
[supersession return](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L246).

If loading `b` aborts an old `a` request and `a`'s abort listener starts `c`,
the operation-version check correctly prevents the outer `b` call from
overwriting `c`. For different keys, however, it returns `Promise.resolve()`.
An `await resource.load('b')` therefore completes successfully even though
the `b` loader was never called and `c` is still Pending. The current R9 test
asserts that `b` was not started, but does not assert what its returned promise
communicates to the caller.

A bounded probe saw loader keys `['a', 'c']`, `outerResolved: true`, and resource
status `Pending` immediately after awaiting the `load('b')` promise. This is
not a claim that `b` must always win a re-entrant race; it is a claim that a
successful completion currently does not identify what completed.

**Correction:** document and test the supersession contract. Options include
returning the winning request's promise, rejecting with an explicit
cancellation result, or making the outer request win while aborting the nested
one cleanly. Avoid a silently fulfilled promise for work never started. Keep
same-key joining and abort-listener re-entry coverage intact.

## R10-03 — [P2] Selected hidden own fields disappear at the hook boundary

**Location:** [detachOpaque.ts](../lib/src/Carburetor/Store/Utils/detachOpaque.ts#L8),
[useCarburetorValue.ts](../lib/src/Interop/useCarburetorValue.ts#L152),
[public interop description](../README.md#L540).

`useCarburetorValue` types a selector result as `R` and passes any object
through `detachOpaque()` for React's immutable snapshot. That copy enumerates
only own enumerable keys. A plain selector result with a readable
non-enumerable own data property loses it, while the returned value is still
typed as the original `R`. A class instance hidden under such a property is
also never encountered by the new fail-fast class-instance check: the field
simply disappears instead.

Bounded copy-level reproduction: define `hidden` with
`Object.defineProperty(source, 'hidden', {value: 42})` and call
`detachOpaque(source)`. The source has the field; the copy does not. The hook
uses that same copy path. This is a narrower boundary than the enumerable
symbol and Map/Set/Date cases already tested.

**Correction:** either preserve readable non-enumerable own data descriptors
in snapshots (without invoking getters or breaking null-prototype objects),
or reject/report unsupported selector results before returning a structurally
incomplete value. Add a rendered hook test for a hidden primitive and a hidden
class instance, not only a direct utility test. Make the documented snapshot
contract and the `R` type agree.

## Profiling and simplification

Profile a representative production-build application action before choosing
the next broad optimization. The known candidates remain `pathOf(args)` plus
`getEntry(args)` serializing cache arguments twice per render, recursive
descriptor inspection of a stable computed result after dependency changes,
and snapshot copying in hooks interop. Source inspection and call-count tests
establish repeated work, not the fraction of a frame it costs.

Capture one real list-item update and one cache-backed render. Record React
commit count/duration, JavaScript self-time, and allocations attributed to
key serialization, result inspection, and snapshot detachment. Compare the
same action and output before and after a single change. No representative
workload was supplied here, so no artificial load or timing claim was made.

The two resource classes need a documented re-entry invariant more than a
mechanical shared base class: detach the old generation before invoking
callbacks, and ensure every returned promise and published state identifies
the operation that owns it. Tests should encode that invariant before a
deduplication refactor.

## Verification and limits

Focused tests: **35 passed**. The new reproductions above are bounded checks
of cases those tests do not cover. This review changed no code, ran no
performance workload, and did not touch the pre-existing deleted
`.claude/scheduled_tasks.lock` or untracked allocation-rule plan.
