# JavaScript review, round 12 — 2026-09-24

Reviewed revision: `77420bd` on `master`. Scope: JS/TS selection snapshots,
resource-cache regressions, and performance-sensitive render paths. Native/Rust
lint-rule semantics were not reviewed. This commit adds only this report.

## Status of round-eleven repairs

R11-01 and R11-02 have implementation changes and focused regressions.
`forget()`/`forgetAll()` now preserve a same-key request started by an abort
listener, and a current request whose entry disappeared releases its
bookkeeping on success or failure. `connectSelection()` now copies and
compares own non-enumerable data descriptors, detects hidden live views, and
rejects accessors without invoking them. The now-unused enumerable-key helper
was removed; the built output was regenerated.

The four focused test files passed in this review: **22 tests**. CI for
`77420bd` completed all ten jobs successfully. The new cases below were
checked with bounded copies against the committed CommonJS build, not a load
or timing benchmark.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R12-01 | P2 | `connectSelection()` can return an Array-subclass impostor without its private state |
| R12-02 | P2 | Hook snapshots silently downgrade Map/Set/Date subclasses to base instances |

No P0 or P1 was established in this pass. Both P2 cases are narrower type and
runtime-contract breaks for supported-looking selector results; neither is a
measured performance bottleneck.

## R12-01 — [P2] Array-subclass prototype survives, but its brand does not

**Location:** [detachSelection.ts](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L64),
[array copy](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L76),
[selection return](../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L182).

The R11 copy treats every `Array.isArray(value)` as a plain array and creates
`[]` with the source's prototype installed. For an `Array` subclass, that
produces `instanceof Subclass === true` without running the subclass
constructor or installing its native private fields. A method that accesses
one brand-checks the receiver and throws. The result remains typed as the
selector's original `R` when passed to a child.

Bounded reproduction: copy an `Array` subclass whose `tag()` method reads a
`#tag` field through `detachSelection()`. The source method returned `7`;
the copy was still `instanceof` that subclass, but `copy.tag()` threw
`TypeError` because the field had never been installed. Existing selection
tests cover plain arrays, sparse arrays, and exotic members, not array
subclasses with private state.

**Correction:** define Array subclasses as an explicit snapshot boundary.
Prefer requiring a projection to a plain array (or a user-supplied snapshot)
over forging a subclass instance with `Object.setPrototypeOf`. If copying a
subclass is supported, construct it through its own safe protocol and verify
round trips; a prototype swap alone is insufficient. Add a rendered
`connectSelection()` test where a child calls the subclass method, alongside
plain-array controls.

## R12-02 — [P2] Built-in subclasses bypass the hook's class-instance guard

**Location:** [detachOpaque.ts](../lib/src/Carburetor/Store/Utils/detachOpaque.ts#L57),
[class guard](../lib/src/Carburetor/Store/Utils/detachOpaque.ts#L85),
[hook fail-fast callback](../lib/src/Interop/useCarburetorValue.ts#L152).

`detachOpaque()` handles `instanceof Date`, `Map`, and `Set` before it checks
whether an object is a class instance that cannot be safely copied. It
rebuilds those values with the base constructors. A subclass therefore loses
its prototype, own behavior, and private fields, while the hook returns the
copy as the selector's generic `R`. The `onLiveInstance` callback does not
run, so the R7/R8 fail-fast class boundary gives no actionable error.

Bounded reproduction: copy `TaggedMap extends Map` and `TaggedDate extends
Date`, each with a `#tag`-reading method, while recording the live-instance
callback. The copies were plain `Map`/`Date`, their `tag` methods were
`undefined`, and the callback recorded nothing. Plain built-ins still copy
their contents correctly; the problem is the unadvertised subclass case.

**Correction:** distinguish exact supported built-in prototypes from
subclasses before cloning. Either reject a subclass through the existing
actionable class-instance boundary or require an explicit projection/adapter
that preserves its semantics. Test Map, Set, Date subclasses with private
state in a rendered hook consumer, plus ordinary built-in controls.

## Performance and simplification decision

No additional broad speed change is justified by this review alone. The
known candidates are still cache-key serialization in the
`pathOf(args); getEntry(args)` render pair, deep descriptor comparison for
`connectSelection()`, and recursive hook snapshot detachment. They are
observable repeated work, but their share of a real frame has not been
measured. The R11 descriptor work also broadened traversal to hidden own
properties, so profiling an actual selection shape matters more than a
generic microbenchmark.

Use a representative production-build interaction: one list-item update
and one cache-backed render. Record React commit count/duration, JavaScript
self-time and allocation volume by call site; compare equal behavior after
one change. No representative workload was provided, and no artificial
load or speedup claim was made here.

The recurrence of class-like values at snapshot boundaries suggests a
maintainability improvement: write one tested policy table for plain
objects, plain arrays, exact built-ins, subclasses, accessors, and arbitrary
instances. Apply the same classification deliberately to hook and class
selection APIs, while keeping their different tracking/equality machinery
separate. Fix the two P2 contracts before tuning copy loops.

## Verification and limits

Focused regressions: **22 passed**. The bounded subclass probes demonstrate
gaps outside those tests. This review changed no implementation or tests and
did not touch the pre-existing deleted `.claude/scheduled_tasks.lock` or the
untracked allocation-rule plan. Only this report is to be committed.
