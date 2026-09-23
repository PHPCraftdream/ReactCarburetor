# JavaScript review, round 7 — 2026-09-23

Reviewed revision: `5fe5543` on `master`. Scope: the JS/TS engine, React interop,
resource cancellation, and cache hot paths. Native/Rust code was not reviewed.
This commit adds only this report; it does not change the implementation.

## Status of round-six repairs

R6-01 through R6-05 have implementation changes and focused regression tests.
The original cases—listener registration on the fallback signal, a directly
selected Map, a directly returned exotic computed value, reload after abort,
and a mutated cache argument—no longer fail in their tested forms. R6-07 is
closed: React 18 CI now runs the full class-component file. R6-06 remains an
explicit correctness-over-render-count tradeoff, not a regression to undo
without application profiling. The new cases below are boundaries *beyond*
those regression tests.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R7-01 | P1 | Hook snapshots still expose live class instances and nested Maps |
| R7-02 | P1 | A stable plain computed envelope can hide a mutated Map |
| R7-03 | P1 | A throwing fallback abort listener leaves a resource Pending |
| R7-04 | P2 | The fallback still does not fulfill the advertised AbortSignal surface |
| R7-05 | P2 | Cache key validation stringifies arguments on every hot-path lookup |

No P0 was established. P1 means reproducible stale UI or a broken cancellation
state transition; P2 means a narrower contract break or repeated hot-path cost.

## R7-01 — [P1] Hook snapshots do not detach all supported opaque values

**Location:** [useCarburetorValue.ts](../lib/src/Interop/useCarburetorValue.ts#L44),
[snapshot/equality path](../lib/src/Interop/useCarburetorValue.ts#L170),
[deepClone.ts](../lib/src/Carburetor/Store/Utils/deepClone.ts#L24).

The R6 fix copies a *top-level* Map, Set, or Date. `snapshotOpaque()` returns a
class instance unchanged, and `deepClone()` carries an exotic value inside a
plain result by reference. Both paths let the old React snapshot mutate in
place and let `isEqual` incorrectly certify it as unchanged.

Two bounded React/JSDOM reproductions on the current build:

- Selecting `data.box`, where `box` is `new Box(1)`, then writing
  `draft.box.value = 2` advanced the store to version 1, but the DOM stayed at
  `1` and the component rendered only once.
- Selecting `{index: data.index}` with a comparator
  `(a, b) => a.index === b.index`, then calling `draft.index.set('a', 2)`, also
  left the DOM at `1`. The *first* returned snapshot's Map now read `2`.

The second case is not merely a comparator mistake: the comparator sees the
same live Map in both snapshots because the earlier snapshot was never
detached. React's [external-store snapshot contract](https://react.dev/reference/react/useSyncExternalStore#im-getting-an-error-the-result-of-getsnapshot-should-be-cached)
requires immutable snapshots for mutable stores.

**Correction:** define and enforce a complete snapshot boundary for selector
results. Recursively detach supported mutable containers, including nested
Map/Set members and Map keys where their visible fields matter. For arbitrary
class instances, require an explicit immutable projection/snapshot function or
emit an actionable diagnostic; silently handing out the live instance is not a
safe default. Test direct class results, nested Maps, earlier snapshot values,
and custom comparators in a rendered component.

## R7-02 — [P1] The computed equality repair stops at the outer prototype

**Location:** [Computed.ts](../lib/src/Carburetor/Derived/Computed.ts#L486),
[isExoticValue.ts](../lib/src/Carburetor/Store/Utils/isExoticValue.ts#L9).

R6-02 now notifies when the computed result *itself* is exotic and a dependency
version moved. A stable plain object containing an exotic member does not pass
that condition. A computed that reads `store.index` and returns the same
`{index: store.index}` envelope across evaluations remained at version 0 with
zero notifications after `draft.index.set('a', 2)`, although `get().index.get('a')`
returned `2`. A subscriber or `useComputedValue` therefore misses the change.

This is a narrower case than a computed directly returning a Map, which is now
covered and working. The public computed result type does not exclude stable
plain envelopes.

**Correction:** avoid treating reference equality of a plain *outer* object as
proof that a tracked mutable member is unchanged. Prefer a coherent immutable
snapshot/equality policy shared with interop, or a conservative notification
when dependencies moved and the result can contain live opaque values. Test a
stable envelope as well as a freshly constructed one.

## R7-03 — [P1] One abort listener exception interrupts cancellation

**Location:** [createAbortHandle.ts](../lib/src/Carburetor/Resource/createAbortHandle.ts#L97),
[ResourceCarburetor.ts](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L171).

On a runtime without global `AbortController`, the new shim invokes abort
listeners directly and does not isolate their exceptions. A loader registered
an `abort` listener that threw; `resource.abort()` then threw that error, and
the resource stayed `Pending` rather than becoming `Idle` (its old request
bookkeeping also remained in place). The same interruption can occur while a
new load supersedes an old one or while a cache restore cancels requests.

**Correction:** make engine cleanup and state transition exception-safe, and
make the shim deliver all registered listeners even if one throws. Match the
observable native cancellation contract as closely as the supported runtime
allows. Add a regression test for a throwing listener followed by another
listener, checking both delivery and final resource/cache state.

## R7-04 — [P2] The fallback is still only a partial AbortSignal

**Location:** [createAbortHandle.ts](../lib/src/Carburetor/Resource/createAbortHandle.ts#L70),
[loader type](../lib/src/Carburetor/Models/Resource.ts#L14).

The loader is typed as receiving `AbortSignal`. With the global removed, the
fallback now has `addEventListener`/`removeEventListener`, but its
`throwIfAborted` is undefined and assigning `signal.onabort = handler` does
not produce a callback when aborted (bounded checks: zero calls after abort).
It also is not a native-branded signal, a limitation the implementation now
documents. A loader using a normal but unimplemented method can still fail
before doing useful work, despite passing TypeScript.

**Correction:** either provide the required surface for the advertised runtime
and verify real client integrations, or narrow the runtime/loader contract so
the type no longer promises what the fallback cannot provide. Do not treat a
successful `addEventListener` test alone as full compatibility.

## R7-05 — [P2] The cache key fix adds repeated serialization to render reads

**Location:** [ResourceCache.ts](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L157),
[encodeCacheKey.ts](../lib/src/Carburetor/Resource/Cache/encodeCacheKey.ts#L20).

The R6-05 correction rightly rejects a stale same-reference key, but it now
`JSON.stringify`s the full arguments on *every* `keyOf` call, including a memo
hit. On a miss, `encodeCacheKey()` stringifies the same object again. A bounded
call-count check for the normal `pathOf(args); getEntry(args)` render pair saw
three serializations on the first pass and two on a warm pass. The previous
same-reference fast path did not serialize again; its speed benefit is gone.
No time benchmark was run, so the measured claim here is repeated work, not a
specific frame-time regression.

**Correction:** encode/escape the already computed JSON string on a miss,
avoiding the second serialization. Decide explicitly whether mutated argument
support justifies one O(argument size) serialization on every render read; if
not, enforce immutable value-key arguments and restore an O(1) same-reference
path. Keep the R6-05 mutation regression test whichever contract is chosen.

## Verification and recommended order

The full current suite passed: **38 files, 618 tests**. The five focused files
passed separately: **103 tests**. Demo, library, and public-type TypeScript
checks passed. Reproductions above were bounded single-request or one-update
checks against the current committed CommonJS build; no stress workload or
implementation change was made. A pre-existing edit to
`.claude/scheduled_tasks.lock` is outside this report.

Fix the three P1 state/snapshot failures first (R7-01 through R7-03), then
settle the fallback signal contract (R7-04). For R7-05, first remove duplicate
serialization, then profile real render-heavy queries before choosing between
mutation detection and the reference-fast path. The accepted exotic-selection
render cost from R6-06 should likewise be revisited only after profiling.
