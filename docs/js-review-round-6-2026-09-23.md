# JavaScript review, round 6 — 2026-09-23

Reviewed revision: `6761e9e` on `master`. Scope: JS/TS state engine, resource APIs,
derived values, React interop, cache keying, and the published compatibility contract.
Native/Rust implementation was outside scope. This change adds only this review document.

## Status

**R6-06: closed as an accepted tradeoff, no code change.** The conservative exotic check in
`sameSelection.ts` (R5-02, commit `3259154`) deliberately treats any Map/Set/Date or class
instance inside a selection as changed, so an in-place mutation can never serve a stale
memoized child — at the cost of redrawing that child on an unrelated parent-prop update.
That is an intentional correctness-over-performance tradeoff, not a regression; the report's
recommendation stands: profile a real interface before optimizing, and revisit only if such
profiling shows a measurable cost.

**R6-07: implemented.** The three `AntiHookComponent` assertions that observe React's own
behavior — the uncaught-render-throw console logging (18 logs the error and a component
stack where 19 is silent) and the errored-mount render count (18's development replay
doubles the retried attempts, 2 → 4) — now branch on the installed React major at runtime,
and the React 18 CI job runs the file instead of excluding it. The job installs 18.3.1
while the advertised peer floor is 18.0.0; that coverage gap is recorded in the CI
configuration and README. The file was verified locally under both React 19.3.0 and 18.3.1.

## Assessment and priorities

The round-five work repaired its targeted controls: selection comparison now preserves object
topology, local snapshots keep symbol keys, late reads of computed results amend the store
subscription, resource loads no longer throw merely because `AbortController` is missing,
and cache eviction scans the subscriber set once per pass. A React 18 CI leg now exists.

This pass found **7 findings: 3 P1, 2 P2, and 2 P3**. No P0 was established. The three P1s
share a boundary problem: returning a stable *reference* does not guarantee that a mutable
value stayed the same, and a value typed as `AbortSignal` must support the interface ordinary
loaders use.

- **P0:** immediate broad failure.
- **P1:** silent stale UI or failure of a documented resource loader.
- **P2:** narrower but reproducible lifecycle or value-key defect.
- **P3:** avoidable work or an incomplete verification gate.

## Verification

Five affected test files passed (**91 tests**) for abort fallback, computed values, resource
lifetime, and hooks interop. Two further files passed (**33 tests**) for selection equality
and snapshots. The library, demo, and public API TypeScript checks passed. The local runtime
used React 19.3.0; the React 18 CI configuration was inspected, not independently executed.

Additional bounded checks used the current committed CommonJS build, React/JSDOM with
`act`, and one or two resource loads each. Missing `AbortController` was simulated by
removing that global temporarily. No stress benchmark was run and no implementation file was
changed. The pre-existing change to `.claude/scheduled_tasks.lock` is outside the report commit.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R6-01 | P1 | Fallback resource signal is not an AbortSignal and can fail before a request starts |
| R6-02 | P1 | A computed returning an in-place-mutated Map suppresses its notification |
| R6-03 | P1 | Hooks interop returns a mutable Map as a stable external-store snapshot |
| R6-04 | P2 | reload() cannot repeat a request after abort() |
| R6-05 | P2 | Reusing a mutated argument object returns the old cache entry |
| R6-06 | P3 | Conservative exotic selection equality redraws a memo child on unrelated parent updates |
| R6-07 | P3 | React 18 CI omits the main class-component behavior file |

## R6-01 — [P1] The fallback does not satisfy the loader's signal type

**Location:** [createAbortHandle.ts](../lib/src/Carburetor/Resource/createAbortHandle.ts#L25),
[loader type](../lib/src/Carburetor/Models/Resource.ts#L14),
[documented degradation](../README.md#L58).

The loader contract provides a standard `AbortSignal`. If the runtime has no global
`AbortController`, `createAbortHandle()` instead returns
`{signal: {aborted: false}, abort() {...}}` cast to `AbortController`. The signal lacks
`addEventListener`, `removeEventListener`, and other ordinary signal behavior. The engine
itself only reads `aborted`, but user loaders receive and use the same object.

Under the missing-global condition, an ordinary loader calling
`signal.addEventListener('abort', callback)` failed with
`signal.addEventListener is not a function` before starting its work. Both
`ResourceCarburetor` and `ResourceCache` stored an Error result. The earlier fallback
tests cover a loader that only reads `signal.aborted`.

The README explicitly documents that cancellation degrades on older Node. Failure to start
a loader that accepts the *typed* signal is a separate break in that advertised behavior.
The same constraint matters for a loader that passes the argument to an API expecting a
real AbortSignal.

**Correction:** either provide a compatible cancellation signal for supported runtimes or
narrow the advertised runtime/loader contract so consumers cannot assume a full AbortSignal
where none exists. A synthetic object may still fail an API that checks native signal
identity; test the actual supported fetch/client integration, not only an `aborted` flag.

**Acceptance:** with the global unavailable, loaders using standard signal listener methods
must start and settle successfully under both resource classes; abort and replacement must
follow the documented degradation. Keep native-controller cancellation working.

## R6-02 — [P1] Computed values can hide a published Map mutation

**Location:** [Computed.settle](../lib/src/Carburetor/Derived/Computed.ts#L448),
[store draft boundary](../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts#L65).

A store holds `index: Map`; the computed body returns `read(store).index`. Mutation through
`draft.index.set('a', 2)` records the coarse `index` path, and the store version advances.
The computed recalculates, but both old and new results are the same Map object. Its
`Object.is` check suppresses delivery.

Observed: `computed.get().get('a')` returned `2`, but there were **zero computed
notifications** and the computed version stayed at zero. A component using
`useComputed(computedMap)` can therefore continue showing the old value.

Map/Set/Date/class instances deliberately have coarse path tracking; this reproduction
uses that supported coarse write path. The result type `R` is unconstrained, and no API
boundary warns that returning such an object defeats computed notifications.

**Correction:** define the equality contract for mutable object results. Conservative
notification for a changed dependency feeding an opaque mutable result is safer than
treating identity as proof of equality; a value comparator or immutable projection can
restore precision when the consumer needs it. Cover the component, not only `get()`.

## R6-03 — [P1] Hooks interop does not produce an immutable Map snapshot

**Location:** [useCarburetorValue.ts](../lib/src/Interop/useCarburetorValue.ts#L120),
[selection equality](../lib/src/Interop/useCarburetorValue.ts#L145).

A function component selects `data.index`, a Map. The store publishes
`draft.index.set('a', 2)`. The interop selector reruns at the new store version and gets
the same Map reference. The default `Object.is` comparator returns true, so
`useSyncExternalStore` receives its previous object and React does not rerender.

Observed: the store's Map returned `2`, but the DOM still showed `1` and the component
rendered only once. Unlike a plain object, the Map is not cloned by `isTrackable`.

React's [external-store contract](https://react.dev/reference/react/useSyncExternalStore#im-getting-an-error-the-result-of-getsnapshot-should-be-cached)
requires an immutable snapshot when the backing store is mutable. An object that changes
through the previous snapshot reference while React sees the same identity does not meet
that contract.

**Correction:** handle opaque mutable selector results explicitly, consistently with
`connectSelection`'s conservative treatment, or restrict interop selectors to immutable
values with an actionable diagnostic. A comparator supplied by the caller must not
silently certify a live mutable reference as an immutable React snapshot. Cover Map and
an ordinary plain-object control.

## R6-04 — [P2] abort() erases reload()'s only key

**Location:** [ResourceCarburetor.reload](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L150),
[cancellation bookkeeping](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L182).

`reload()` is documented to repeat the last load. It currently returns immediately when
`pendingKey` is undefined. `abort()` clears that pending key even though `lastArgs`
still holds the arguments.

Start `load('a')`, abort before it settles, then await `reload()`. The loader was called
once, and the resource remained Idle. An explicit `load('a')` works; the convenience
retry method does not.

**Correction:** keep the last requested arguments separate from the in-flight key. Define
whether restore and abort preserve the ability to reload, then test the chosen
contract. An initial `reload()` before any load should remain an intentional no-op.

## R6-05 — [P2] Value-key memoization accepts changed values under one reference

**Location:** [ResourceCache.keyOf](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L151).

`keyOf(args)` memoizes JSON encoding by the argument object's identity. A caller that
reuses one mutable query object can change its contents while the cache continues to use
the previous key:

```text
query.id = "a"; load(query) -> "a"
query.id = "b"; load(query) -> no second loader call
getEntry(query).data -> "a"
```

The source comment says keys are expected to stay immutable, but the public generic
`TArgs` and `load/getEntry` signatures do not enforce or validate that expectation. A
value-key cache silently serving A after B was requested is a difficult failure to
diagnose.

**Correction:** either calculate from current argument values or make immutable arguments
an enforceable public contract, including a development diagnostic for same-reference
mutation. Preserve the single-render `pathOf/getEntry` de-duplication benefit when values
are actually unchanged.

## R6-06 — [P3] Exotic selections always break the memo child bailout

**Location:** [sameSelection.ts](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L81).

The round-five repair treats any Map/Set/Date/class instance inside a selection as changed,
even if the store has not changed. That prevents a stale child after an in-place mutation.
It also causes an unrelated parent-prop update to create a new outer snapshot and redraw
a memoized child.

A bounded case with an unchanged Map and store version `0` rendered the parent twice
and the child twice. This is an intentional correctness tradeoff in current code, not a
claim that the old stale-UI behavior should return.

**Recommendation:** profile this path in a real interface before optimizing. A future
cache could use recorded store versions and selected paths to distinguish a tracked
mutation from a parent-only update, while still accounting for selectors that capture
changing props. Selecting immutable primitives remains the predictable low-cost option.

## R6-07 — [P3] React 18 tests exclude most class-component edge cases

**Location:** [React 18 CI job](../.github/workflows/ci.yml#L83),
[exclusion](../.github/workflows/ci.yml#L118).

A React 18.3 job was added, but it excludes the entire
`AntiHookComponent.test.tsx` file. That file contains the most detailed tests of the
persistent connection, selection, StrictMode replay, Suspense, and render-boundary
behavior. The reason for exclusion is documented: a few expectations in that file
depend on React 19's development logging and render counts. The remaining React 18 job
does not verify those core paths at the same depth as the React 19 job.

**Recommendation:** isolate only the version-sensitive assertions or parameterize their
expected diagnostics, then run the core behavior tests on both majors. Also record
which 18.x releases are covered: the advertised peer range begins at 18.0, while the
current job installs 18.3.1. This is a coverage gap, not evidence that React 18 fails.

## Recommended order

1. Repair the fallback signal contract and the two stale-result paths: R6-01–R6-03.
2. Decide and enforce resource retry/key semantics: R6-04–R6-05.
3. Profile the documented exotic-selection cost and complete the React 18 behavior
   matrix: R6-06–R6-07.

The preceding fixes remain valuable. These seven cases supply the next regression
scenarios; existing passing tests and type checks do not establish their behavior.
