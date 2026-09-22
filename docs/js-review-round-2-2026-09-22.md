# JavaScript review, round 2 — 2026-09-22

Reviewed revision: `45cccf8b4d6bd7a3e6907e6cbce207b9b82ba343`.

Scope: JS/TS runtime, React integration, resource lifecycle, demo logic, tests, and public contracts.
Native/Rust implementation was excluded. This review changes only this report.

## Verdict

The previous plan produced real improvements: ordinary connection lifecycle cases now work,
cache paths agree, retained computed edges are preserved, observer exceptions are isolated,
and the demo and DevTools avoid some unnecessary work. Type inference remains intact.

The implementation still has correctness gaps that can leave the UI stale or associate a
resource with the wrong key. The new proxy-cache cleanup also introduces unbounded historical
metadata and repeated scanning. Address those mechanisms before claiming a general performance
improvement or adding more connection variants.

There are **14 findings: 4 P1, 8 P2, and 2 P3**. No P0 issue was established.

- **P0:** stop-the-line failure with broad immediate impact.
- **P1:** high-priority correctness defect; fix before relying on the affected behavior.
- **P2:** narrower correctness, resource-lifetime, or demonstrable scaling problem.
- **P3:** maintainability, simplification, and verification improvements.

P1/P2 findings below were reproduced using bounded local checks. P3 findings are grounded in
source inspection and test output; they are not measured application-speed claims.

## Verification and limits

Executed against the reviewed checkout:

```text
node node_modules/@rstest/core/bin/rstest.js run __tests__/Engine __tests__/Demo --pool.maxWorkers 1 --reporters dot
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p lib/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.types.json
```

Result: **25 test files, 352 tests passed**; all three type checks passed. The runtime checks used
the installed React 19.3.0. React 18 compatibility was not exercised in this round.

Additional checks imported current TypeScript sources through an in-memory loader that removes
types and resolves project aliases. React cases used JSDOM and `act`. Cache-journal checks used
small, temporary in-memory Map instrumentation; no stress workload or timing benchmark ran.
No source, test, build output, or dependency file was changed. The pre-existing change to
`.claude/scheduled_tasks.lock` is outside the report commit.

The full plugin suite, native linter implementation, browser interaction profiling, and rebuilt
distribution outputs were not verified in this round. Passing existing tests does not cover the
new cases below.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R2-01 | P1 | A mid-wave read can consume the first computed notification |
| R2-02 | P1 | Unequal-depth dependency graphs publish inconsistent values |
| R2-03 | P1 | Restoring a resource loses the association between data and arguments |
| R2-04 | P1 | Class-field render loses tracking with modern class lifecycle APIs |
| R2-05 | P2 | Proxy invalidation history grows without a bound and is repeatedly scanned |
| R2-06 | P2 | Ordinary primitive reads do not reclaim deleted cached branches |
| R2-07 | P2 | Selection equality ignores property presence and enumerable symbols |
| R2-08 | P2 | Abandoned renders leave resource requests queued for a later commit |
| R2-09 | P2 | A throwing effect cleanup prevents subscription teardown |
| R2-10 | P2 | The first inline Todo update can initialize counters incorrectly |
| R2-11 | P2 | Draft no-op detection changes JavaScript assignment semantics |
| R2-12 | P2 | Nested read views still permit prototype/extensibility mutations |
| R2-13 | P3 | Connection mechanics are duplicated inside an oversized component module |
| R2-14 | P3 | Test diagnostics and completion records overstate the verified contract |

## R2-01 — [P1] A mid-wave read consumes the first computed notification

**Location:** [Computed.ts:348](../lib/src/Carburetor/Derived/Computed.ts#L348),
[initial subscription](../lib/src/Carburetor/Derived/Computed.ts#L87).

**Reproduction:** start with `n = 1` and an observed computed `n * 2`. Mount a component
displaying that computed. After its subscription exists, register a store subscriber for the
same `n` path whose callback calls `computed.get()`. Change `n` to `2`.

Observed:

```text
store.n = 2
computed.get() = 4
computed notifications = 0
DOM = "2"
```

The computed is invalidated and queued. The second subscriber reads it before settlement and
recomputes the cache to `4`. When settlement runs, `previous` is already `4`; because
`announced` has not been initialized, the comparison baseline is also `4`. The first real
change disappears from delivery even though the UI last consumed `2`.

**Fix direction:** maintain a publication/observation baseline independently of the current
evaluation cache, including initial observation. A read may refresh a value but must not consume
the notification owed to an existing observer. Define the baseline across unsubscribe/resubscribe
as well.

**Acceptance:** assert both the final computed value and the observer/DOM update when another
subscriber reads the computed between invalidation and settlement. The existing mid-wave test
checks values and evaluation counts but does not establish this first-delivery guarantee.

## R2-02 — [P1] Unequal-depth dependency graphs publish inconsistent values

**Location:** [UpdateWave.ts](../lib/src/Carburetor/Store/Scheduling/UpdateWave.ts),
[Computed.isStale](../lib/src/Carburetor/Derived/Computed.ts#L127),
[dependency delivery](../lib/src/Carburetor/Derived/Computed.ts#L322).

**Reproduction:**

```text
a = n * 2
b = a + 1
total = n + b
```

Subscribe to `total`, whose body reads the store before reading `b`. Change `n` from `1`
to `2`. The observer receives **[5, 7]**, although the settled result is `7`.

The queue is insertion-ordered rather than dependency-ordered. `total` can settle before
`a` and `b` have been invalidated/settled, combining the new direct input with an old derived
input. The repaired equal-depth diamond test does not cover this topology.

A related freshness case also reproduced: an observed outer computed returned its previous
value `2` after its inner dependency began throwing. Calling the inner computed directly
threw as expected; calling the outer one still returned a supposedly valid cached result.

**Fix direction:** separate propagation of invalidation from publication, and make reads pull a
coherent dependency graph or settle nodes in dependency order. A dependent must not remain
authoritatively valid merely because an upstream node has not yet announced a successful value.

**Acceptance:** cover direct-plus-derived dependencies, unequal-depth diamonds, subscription-order
changes, and failing dependencies. Observers must not receive mixed-generation values. Preserve
the now-correct one-evaluation-per-node behavior for the ordinary four-node chain.

## R2-03 — [P1] Restoring a resource loses data/key identity

**Location:** [ResourceCarburetor.suspend](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L63),
[inherited restore/serialization](../lib/src/Carburetor/Store/Carburetor.ts#L107).

**Reproduction:**

```text
load("a") -> snapshot A
load("b")
restore(snapshot A)
suspend("b") -> "value:a"
```

The restored state contains A's data, but the private `settledKey` still identifies B.
Consequently the argument check added in the previous round accepts the wrong answer.

The inverse also reproduced: hydrating a successful resource into a new instance leaves
`settledKey` undefined, so `suspend("a")` starts a new loader request instead of serving the
restored successful answer.

**Fix direction:** snapshot/restore must preserve or explicitly re-establish the answer's key,
not just its status and data. Reconcile request/controller/error metadata when replacing state.
Do not repair hydration by treating every restored success as valid for arbitrary arguments.

**Acceptance:** test A→B→restore-A, successful hydration into a fresh instance, error-state
restoration, and restoration while a request is active. Data, status, and argument identity
must agree after each operation.

## R2-04 — [P1] Modern lifecycle APIs bypass class-field render tracking

**Location:** [constructor and mount hook](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L383),
[wrapRender](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L926).

**Reproduction:** a subclass declares `render = () => ...`, reads a connection, and defines
`static getDerivedStateFromProps() { return null; }`. It mounts with zero subscriptions.
After changing the store from `0` to `1`, the DOM remains `0`.

The base constructor runs before the subclass render field exists. The fallback wrapper is
installed by `UNSAFE_componentWillMount`, which React skips when the component implements
`getDerivedStateFromProps` or `getSnapshotBeforeUpdate`. This exclusion is part of the
[documented lifecycle contract](https://react.dev/reference/react/Component#unsafe_componentwillmount).

The suite also emits StrictMode warnings for this inherited lifecycle, contradicting the
source comment describing the spelling as warning-free.

**Fix direction:** use a deterministic supported render boundary, or narrow the supported
render-definition contract explicitly with a clear diagnostic/migration path. Do not silently
advertise class-field support while depending on a lifecycle that may never run.

**Acceptance:** cover the cross-product of method/field render definitions, supported modern
lifecycle APIs, StrictMode, and first-mount tracking. Removing the warning alone does not fix
the lost subscription.

## R2-05 — [P2] Invalidation history is unbounded and repeatedly scanned

**Location:** [createProxyCache.ts:61](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L61),
[sweep](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L73),
[invalidate](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L106).

**Reproduction:** insert, read, and delete three temporary keys under the same live dictionary.
Only one live data key remains, but the invalidation Map still contains all three deleted paths.
Replacing the remaining live entry adds a fourth path, and the next sweep traverses all four.

Nothing removes historical paths from `scope.invalidations`. Whenever the scope revision
changes, `sync()` scans cached entries against that accumulated history, including obsolete
records. For E cached entries and H historical paths, a sweep can perform E×H comparisons.
This is a code-derived bound, not a measured frame-time claim.

**Impact:** a long-lived dictionary can retain arbitrarily many path strings while its actual
data size stays bounded; read cost can grow with lifetime churn rather than current state size.

**Fix direction:** use reclaimable invalidation records, current-path revisions, or a targeted
index with an explicit retirement policy. Account for multiple caches sharing a scope before
discarding revisions; avoid replacing one unbounded log with another.

**Acceptance:** a small bounded churn fixture should leave metadata proportional to live
ownership/pending invalidations, and later reads must not rescan retired history. Check work
counts rather than wall-clock thresholds.

## R2-06 — [P2] Primitive reads do not release obsolete branch objects

**Location:** [createProxyCache.sync](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L73),
[createReadProxy](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts#L83).

**Reproduction:** read `items.old.n`, delete `items.old`, then read `items.count` and enumerate
`Object.keys(items)`. The internal ownership check still reports the deleted object under
`items.old`, with cache size `1`.

Sweeping happens only when a trackable object is fetched through the cache function. Primitive
reads and key enumeration do not consult it. A connection that now reads only a count or an
empty dictionary can retain the removed subtree for its remaining lifetime.

The README's claim that another read through the view releases an obsolete wrapper is broader
than this implementation.

**Fix direction:** ensure obsolete strong ownership ends even if no further object-valued
branch is read. Coordinate that change with R2-05 so a cheap scalar read does not inherit a
scan of unbounded history.

**Acceptance:** test primitive-only reads, enumeration-only reads, empty dictionaries, and no
subsequent branch access. Do not use arbitrary garbage-collection timing as the oracle.

## R2-07 — [P2] Selection equality ignores key presence and symbols

**Location:** [sameSelection](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L186),
[selection cache](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L843).

**Reproduced cases:**

- A selector changes from `{a: undefined}` to `{b: undefined}`. The cached object still has
  key `a`, and a memo child displaying its keys continues to show `a`.
- A selector returns a fresh plain object with an enumerable symbol property whose primitive
  value changes from `0` to `1`. The memo child continues to show `0`.

The object comparison checks equal key counts and values at the previous string keys, without
checking whether those keys exist in the new object. It also ignores symbols, although the
shallow spread used to detach a selection preserves enumerable symbol properties.

**Fix direction:** define one consistent set of copied/compared own properties and verify key
membership as well as values. Align array and object semantics deliberately rather than
describing the comparison as equivalent to React's props gate.

**Acceptance:** test key replacement with undefined values, key removal/addition at equal
cardinality, enumerable symbols, and ordinary unchanged selections retaining identity.

## R2-08 — [P2] Abandoned renders leave network work queued

**Location:** [staleResources](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L373),
[useResource](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L891),
[render-attempt closure](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L980).

**Reproduction:** mount an existing component, attempt an update that reads resource
`"abandoned"` and then suspends, and later commit an update reading `"committed"`.
One component instance was used. The loader received **both** keys after the later commit.

Dependency reads moved into render-attempt storage, but deferred resource loads remain in the
component-wide array. Discarding the abandoned attempt does not discard its queued requests.

**Fix direction:** make deferred loads part of the tentative attempt and consume only the
committed attempt's queue. Preserve deduplication and make replay behavior explicit.

**Acceptance:** an abandoned update must issue no deferred request at a later unrelated commit.
Cover suspension, thrown errors followed by recovery, repeated attempts, and changing arguments.

## R2-09 — [P2] Throwing cleanup prevents complete unmount

**Location:** [componentWillUnmount](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L435),
[releaseEffects](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L1057).

**Reproduction:** mount a connected component with two effect cleanups; make the first throw.
Unmounting surfaces that error, the second cleanup never runs, and the store still has one
subscription to the unmounted component.

Cleanup iteration stops at the first exception, and subscription release is after it without a
`finally`. The same exposure exists if the component-wide `unUseEffects` callback throws.

**Fix direction:** release subscriptions unconditionally, run independent cleanups despite
individual failures, and surface/report errors after teardown according to a defined policy.
Apply the same care to replacing an effect whose old cleanup or new setup throws.

**Acceptance:** no remaining subscription or skipped independent cleanup after a failing
teardown; error visibility must remain intact.

## R2-10 — [P2] Initial inline Todo writes can produce wrong counters

**Location:** [updateTodo](../lib/src/ToDo/Carburetors/TodoCarburetor.ts#L37),
[preEmit](../lib/src/ToDo/Carburetors/TodoCarburetor.ts#L108),
[shiftCounters](../lib/src/ToDo/Carburetors/TodoCarburetor.ts#L175).

**Reproduction:** construct a Todo store with one active item and omitted optional counters.
Change only that item's title. The resulting counts are `activeCount = 0`, `doneCount = 0`,
although one active item exists.

Inline arithmetic replaces missing counters with zero before `preEmit` checks whether they
were initialized. The fallback intended to perform the first full derivation therefore never
runs. This is a demo-store defect, not a generic Carburetor counter feature.

**Fix direction:** establish validity of derived fields before applying deltas, or normalize
initial data once. Capture an initialization flag before the write rather than testing the
already-modified fields.

**Acceptance:** cover the first title edit, create, and toggle with populated initial data and
omitted counters, while preserving the no-whole-list-work path for already-initialized stores.

## R2-11 — [P2] No-op detection changes assignment semantics

**Location:** [createWriteProxy.set](../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts#L96).

**Reproduced cases:**

```text
{}; assign flag = undefined -> flag is not created; version stays 0
{zero: 0}; assign zero = -0 -> value remains positive zero
{nan: NaN}; assign nan = NaN -> a notification is emitted
```

The `previous === raw` check conflates an absent property with an own property containing
undefined, treats signed zero as unchanged, and treats unchanged NaN as a write.

**Fix direction:** compare values using the intended SameValue semantics, and account for own
property creation before skipping an assignment. Do not let value equality bypass a real
structural change.

**Acceptance:** check `Object.hasOwn`, enumeration/`in` subscribers, signed zero, and NaN.
A performance shortcut must preserve the data operation's meaning.

## R2-12 — [P2] Nested read views allow structural mutation

**Location:** [createReadProxy traps](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts#L176),
[outer facade guards](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L713).

**Reproduction:** obtain `view.user` through `connect()`, then call
`Object.setPrototypeOf(view.user, null)` and `Object.preventExtensions(view.user)`.
Both modify the real backing object while the store version remains zero.

The new outer facade rejects those operations, but nested values are ordinary read proxies,
which still omit the corresponding traps. Besides breaking the deep read-only contract, making
a backing object non-extensible can cause later legitimate store writes to fail.

**Fix direction:** apply the structural-mutation policy consistently at every read-proxy level.
Keep proxy invariants and any intentionally unsupported data shapes explicit.

**Acceptance:** repeat the mutation checks on root and nested views from both `read()` and
`connect()`; rejected operations must leave the backing object unchanged.

## R2-13 — [P3] Simplify duplicated connection machinery

**Location:** [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx),
particularly [connect](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L510) and
[connectSelection](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L766).

The component module is now 1,260 lines and combines render interception, connection records,
subscription reconciliation, proxy shape/descriptor forwarding, selection comparison/copying,
resource scheduling, diagnostics, and effect lifecycle. Line count alone is not a defect, but
these responsibilities have different invariants and already require different regression sets.

The per-attempt source resolver and recorder are duplicated in the two connect-family methods.
A future lifecycle fix has to be applied consistently to both copies. The committed description,
installed handle, and render attempt also make several read-set copies, so persistent proxy
identity does not mean allocation-free rendering.

**Recommendation:** extract a shared connection/recorder factory, a focused persistent-view
adapter, and pure selection comparison/detachment helpers. Keep the React class responsible for
lifecycle orchestration. Preserve the consumer API and inferred types; do not make users supply
field lists or duplicate interfaces.

Keep comments focused on invariants and decisions. Repeated implementation narration obscures
the few lines that differ between the two connection paths. Optimize additional allocations
only after measuring the complete real interaction; R2-05 already establishes a concrete
scaling issue worth addressing first.

## R2-14 — [P3] Make verification results and contracts more precise

**Locations:** [test setup](../__tests__/setupTests.ts),
[component tests](../__tests__/Engine/Component/AntiHookComponent.test.tsx),
[previous plan](js-fix-plan-2026-09-22.md), README and CHANGELOG.

The suite passed while emitting repeated UNSAFE lifecycle warnings and several unwrapped-`act`
diagnostics. Some error output is intentional error-boundary coverage; that should remain
distinguished from unexpected React warnings. A green exit status alone does not prove lifecycle
compatibility or asynchronous test isolation.

The new cases show specific gaps in the test matrix: observer delivery as well as computed
values, unequal graph depths, initial data without derived fields, and combinations of render
definition style with modern lifecycles. The cache tests establish cleanup after another
object-valued access but not the broader lifetime guarantee described in the documentation.

**Recommendation:** fail tests on unexpected console diagnostics with narrow, asserted exceptions
for intended error cases. Add the missing behavioral combinations; do not merely increase test
count or assert implementation details. Update the plan's still-pending completion records with
the behavior actually verified, and distinguish React 19.3 local verification from the advertised
React 18/19 compatibility range.

## What improved, and should stay improved

Existing passing coverage now includes the prior hidden-connection loop case, ordinary
render/commit gap correction, StrictMode subscription restoration, dotted cache-key delivery,
basic array-root facade behavior, flat primitive selections for memo children, independent
computed observer error isolation, and one evaluation per node in a four-node chain.
These fixes should not be reverted while addressing the new cases.

The deliberate contract change for child props is also clearer: raw persistent views remain
unsupported as passive memoized props; connected children or selection snapshots are the
supported routes. R2-07 concerns the supported selection route, not that documented restriction.

Likewise, the documented fixed root-shape limitation for a resolver unavailable during
construction is an explicit design tradeoff. It is not counted as a newly discovered defect here.

## Recommended next order

1. Repair computed publication/freshness together: R2-01 and R2-02.
2. Make resource restoration carry identity correctly: R2-03.
3. Remove the lifecycle hole in render tracking: R2-04.
4. Redesign invalidation retention and reclamation together: R2-05 and R2-06.
5. Close the focused boundary and lifecycle bugs: R2-07–R2-12.
6. Consolidate duplicated machinery and tighten verification: R2-13 and R2-14.

The most concrete remaining performance target is the historical invalidation scan. Avoid
starting another round of broad memoization or adding caches without a bounded lifetime and
a precise invalidation contract. The existing improvements are useful, but the reproduced stale
UI and wrong-resource cases mean the correction plan is not yet complete in behavior.
