# JavaScript review, round 11 — 2026-09-24

Reviewed revision: `6ab15f3` on `master`. Scope: the JS/TS resource cache,
selection snapshots, React interop, and their performance-sensitive paths.
Native/Rust lint-rule semantics were not reviewed. This commit adds only this
report, not implementation changes.

## Status of round-ten repairs

R10-01 through R10-03 have implementation changes and focused regressions.
The cache's nested restore now has a generation guard, so the inner restore
keeps its state. A single-slot resource request superseded before its loader
starts rejects with a named `AbortError` instead of silently fulfilling.
`useCarburetorValue` now preserves non-enumerable own data descriptors and
rejects accessors without running their getters; hidden class instances reach
the existing fail-fast boundary.

Four affected test files passed in this review: **27 tests**. CI for
`6ab15f3` completed all ten jobs successfully. The cases below are boundaries
those tests do not exercise; the reproductions used the committed CommonJS
build and a bounded request or one copy. No timing or stress benchmark was
run.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R11-01 | P1 | A retry started by an abort listener is orphaned by `forget()` |
| R11-02 | P2 | `connectSelection()` returns a typed snapshot missing non-enumerable fields |

No P0 was established. P1 here is a request that can no longer settle into
state or be retried; P2 is a narrower returned-value contract mismatch.
Performance candidates are not assigned a defect priority without profiling.

## R11-01 — [P1] `forgetKey()` deletes a re-entrant replacement request's entry

**Location:** [forgetKey](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L179),
[abortKey](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L286),
[settlement guard](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L436).

The R9 repair made `abortKey()` safe when an abort listener calls
`load(sameKey)`: it unregisters the old request before dispatching the abort,
then leaves the new request and its Pending state alone. `forgetKey()` calls
that method but unconditionally continues to delete the entry afterward.
The new controller and promise remain registered, while their entry is gone.
When the new request resolves, `settleSuccess()` returns before clearing the
request bookkeeping because the entry is missing. Later `load(key)` calls
join the already-settled promise instead of starting a loader, so the key is
stranded. `forgetAll()` reaches the same code for every key it started with.

Bounded reproduction: load `a`, register an abort listener that loads `a`
again, then call `forget('a')`. The loader ran twice and `getEntry('a')` was
Idle immediately after forget. Resolve both answers, await both promises,
then call `load('a')` once more: the loader count was still **two** and the
entry was still Idle. A normal load after forget must not be suppressed by
stale in-flight bookkeeping. Existing re-entry tests call `abort()` or
`restore()`, not `forget()`/`forgetAll()`.

**Correction:** define whether a request started by a forget-time abort
listener should survive or be cancelled. Either policy needs one coherent
generation check across entry deletion, controller/promise maps, and the
notification. Do not preserve a request while deleting the only entry it can
settle into. Also ensure a current controller with a missing entry releases
its bookkeeping rather than leaving future loads attached to a dead promise.
Add same-key re-entry tests for `forget()` and `forgetAll()`, including the
next `load(key)` and loader-call count.

## R11-02 — [P2] The class-component selector has a different snapshot boundary

**Location:** [detachSelection.ts](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L65),
[sameSelection.ts](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L24),
[public return cast](../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L182),
[hook snapshot contrast](../lib/src/Carburetor/Store/Utils/detachOpaque.ts#L6).

R10 fixed the hook snapshot to preserve own non-enumerable data descriptors.
`connectSelection()` still copies and compares only own **enumerable** keys.
That boundary is documented internally, but the public selection returns the
unrestricted generic `R` through a cast. A selector may return a plain object
with a readable non-enumerable own field and an `R` type that includes it; the
child receives a copy without that field, with no error. The live-view escape
diagnostic also searches only enumerable keys, so a hidden live view is lost
instead of being diagnosed.

Bounded copy-level reproduction: define `hidden` with
`Object.defineProperty(source, 'hidden', {value: 42})` and pass `source` to
`detachSelection()`. The source has `hidden`; the copy does not. The public
`connectSelection()` path uses that copy and casts it back to the selector's
`R`. The hook now preserves the same field, so the two selector APIs disagree.

**Correction:** choose one explicit snapshot contract. If hidden own data
fields are supported, align copying, equality, and live-view detection with
the descriptor-aware hook policy while avoiding getter evaluation during
inspection. If they are excluded, reject/report that selector result and
narrow the public documentation/type story; a silently incomplete `R` is not
a safe boundary. Add a rendered class-component test for a hidden primitive
and a hidden live view, not only a utility copy test.

## Profiling and simplification

Yes, profile before choosing any broad speed work. Known repeated operations
remain cache-argument serialization in the `pathOf(args); getEntry(args)`
render pair, descriptor traversal of stable computed results after dependency
updates, hook snapshot detachment, and `connectSelection()`'s deep equality
plus detachment on render. Source and call-count evidence establish that the
work occurs; they do not establish which one is visible in a frame.

Use a production build and a representative real application action, such
as one item update and one cache-backed render. Collect React commits and
durations, JavaScript self-time, and allocations by call site; compare the
same output before and after one change. No real workload was supplied for
this review, so no artificial load or claimed speedup was produced. Fix
R11-01's request-state invariant before performance experiments.

The three plain-value snapshot paths (`detachOpaque`, `detachSelection`, and
their equality/escape checks) currently encode different key policies.
Consolidating the *contract and tests* would simplify future maintenance;
mechanically merging implementations first could change render tracking or
prototype behavior and is not recommended without those tests.

## Verification and limits

Focused regressions: **27 passed**. The new probes are bounded checks outside
that coverage. This review changed no implementation or test code and did not
touch the pre-existing deleted `.claude/scheduled_tasks.lock` or the
untracked allocation-rule plan. Only this report is to be committed.
