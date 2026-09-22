# JavaScript correction and optimization plan — 2026-09-22

Status: proposed; all implementation steps below are pending.

Baseline: `797fef8`, which includes the `connect()` implementation from `daa9000`.
Scope: the JavaScript/TypeScript runtime, component integration, demo, tests, and documentation.
This planning change adds only this document; it does not implement the fixes.

## Objective and constraints

Keep the ergonomic API already agreed on:

```tsx
private readonly todos = this.connect(() => this.props.carburetor);
```

The data type must continue to come from the store. Consumers must not need field-name arrays,
`as const`, casts, or duplicate data interfaces. A connection is declared once per component
instance; the actual reads may change on each render.

Correct notification, lifecycle replay, and fresh displayed data come before allocation reductions.
Preserve the existing `useCarburetor` API and read-only behavior. Native/Rust rule implementation
is outside this plan; any required changes there must be identified separately.

Implementation must distinguish a permanent connection declaration, a render's tentative reads,
the last committed reads, and the active subscription. These have different lifetimes and must
not share one mutable record without an explicit transition model.

## Evidence carried forward from the review

The library and demo passed their TypeScript checks. The two existing component/demo test files
passed all 38 tests. Compiler inspection confirmed that the demo fields infer deeply read-only
store data, rather than `any`.

Additional bounded checks reproduced:

| Area | Observed result |
| --- | --- |
| Connection no longer read | A hidden branch retained its subscription and repeatedly requested another render after one write. |
| Reads outside render | An event read polluted the next read set; a commit-time read overwrote the version needed to detect an intervening write. |
| Memo child | The store held `Bob` while a child receiving a persistent nested view still displayed `Ann`. |
| Cache paths | Keys containing `.` or `~` received zero notifications because read and write paths differed. |
| Proxy facade | An array-root view failed array detection, and key enumeration/serialization threw on proxy invariants. |
| Computed delivery | A throwing observer prevented an independent computed observer from being notified. |
| Computed work | A four-node chain ran its bodies `4 + 3 + 2 + 1 = 10` times for one source change. |
| Proxy retention | A read cache still held the deleted `items.a` object after that property was removed. |

Basic StrictMode behavior, interop selector/source changes, the earlier computed diamond case,
failed-refresh retry suppression, cache capacity after settlement, and single-slot resource
argument changes passed their targeted rechecks. Keep them as regression controls.

## Execution order

Use the following order for implementation and review. Dependencies indicate which behavior must
already be stable before starting a dependent step; they do not request agent delegation.

| Step | Priority | Deliverable | Depends on |
| --- | --- | --- | --- |
| JS-01 | P1 | Consistent resource-cache paths | — |
| JS-02 | P1 | Correct render collection and subscription lifecycle | — |
| JS-03 | P2 | Lawful proxy facade and explicit root-shape contract | JS-02 |
| JS-04 | P1 | Safe transfer of connected data to children | JS-02, JS-03 |
| JS-05 | P1 | Isolated computed delivery failures | — |
| JS-06 | High | Incremental computed dependency maintenance | JS-05 |
| JS-07 | High | Reclamation of obsolete proxy-cache entries | JS-02, JS-03, JS-04 |
| JS-08 | High | Todo derivation work proportional to the action | — |
| JS-09 | Medium | Less repeated work on connected reads | JS-02, JS-03, JS-04 |
| JS-10 | Medium | Reuse of unchanged DevTools snapshots | JS-05, JS-06 |
| JS-11 | Required | Integrated verification, documentation, and distribution parity | JS-01–JS-10 |

P1 items block relying on the affected behavior. High/Medium items are optimization priorities,
not measured claims about elapsed time. An implementation step closes only after its behavioral
checks pass; writing a patch or updating documentation alone does not close it.

## JS-01 — Make cache read, write, and retention paths agree

- [ ] Pending.

Files: [ResourceCache.ts](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts),
[encodeCacheKey.ts](../lib/src/Carburetor/Resource/Cache/encodeCacheKey.ts),
[joinPath.ts](../lib/src/Carburetor/Store/Paths/joinPath.ts).

The stored dictionary key and its representation as a path segment are different concepts.
Keep the existing storage-key format initially, so persisted/hydrated entries do not silently
become unreachable. Build `pathOf` and retention prefixes through the same path builder used by
the tracking proxies. Remove manual `entries.${key}` construction where it bypasses that builder.

Do not remove escaping from one layer blindly: a stored key that already contains a tilde still
needs the path representation of that literal tilde.

Acceptance:

- A `useResource` component receives loading and completion updates for ordinary keys, `a.b`,
  `a~b`, and object arguments containing those characters.
- Updating one such entry does not notify a reader of another entry.
- Retention recognizes both entry-level subscriptions and nested tracked reads.
- Existing serialized entries remain readable after hydration.
- Cover the component path, not only direct cache reads after awaiting a request.

## JS-02 — Give render tracking an explicit lifecycle

- [ ] Pending.

Primary file: [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx).

First establish a reliable, exception-safe collection boundary around a render attempt. Verify
the approach with both prototype-method and currently supported class-field render definitions.
Do not infer a new render solely from the previous commit counter.

Represent separately:

1. The permanent connection and source resolver.
2. Tentative reads and source/version captured for the current render attempt.
3. The last committed dependency description, needed for lifecycle replay.
4. The active subscription handles.

Record the source and baseline version at the beginning of that attempt's consumption, rather
than replacing the baseline after every property access. Reads from handlers, effects, or child
commit callbacks must not alter a completed render's dependency set or version evidence.

At an ordinary commit, an unused connection must have no active read subscription. Its declaration
remains available for later reuse. A StrictMode remount without a new render must restore the last
committed description instead of interpreting the replay as an empty render. Discard abandoned
render collections; do not publish them or install their subscriptions.

Acceptance:

- Read a connection, hide its branch, then write its former dependency: no extra render and no loop.
- Show the branch again: current data appears and one subscription is restored.
- Initially unused declarations do not install empty active subscriptions.
- Reads from handlers/effects do not add paths to a later render.
- A child mount callback can update a store without suppressing the parent's corrective update.
- Swapping the source removes the old subscription and validates the new source/version.
- StrictMode replay, unmount, render exceptions, abandoned attempts, and Suspense hide/reveal
  preserve the appropriate committed subscriptions without leaks.
- Unchanged committed dependencies do not rebuild the subscriber index.
- Loop regressions use a bounded guard in the test harness, not an unbounded render sequence.

## JS-03 — Make the persistent proxy facade obey JavaScript semantics

- [ ] Pending.

Files: [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx),
[createReadProxy.ts](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts).

Resolve the target-shape decision before implementing forwarding traps. A proxy over `{}`
cannot report array identity, and it cannot expose arbitrary non-configurable descriptors from
another object. A permanently stable proxy also cannot change its underlying object/array kind.

Prefer preserving support for array roots already accepted by the engine. Check whether source
resolution can safely determine the root shape at declaration time, including scoped components.
If that conflicts with deferred source resolution, settle and document the supported contract
before implementation; do not silently return an incompatible view or introduce caller casts.

Forward reads, enumeration, and descriptors consistently with the facade's actual target.
Preserve rejection of writes and descriptor-based mutation escapes. Reject prototype mutation
and extension changes when they would invalidate the facade. Keep existing frozen/non-plain
data restrictions explicit.

Acceptance:

- Supported array-root views behave correctly for `Array.isArray`, iteration, `Object.keys`,
  and `JSON.stringify`.
- Non-configurable descriptors either have a lawful supported representation or produce an
  intentional boundary error before normal operations become inconsistent.
- Assignment, deletion, property definition, prototype mutation, and extension changes cannot
  mutate state through a read view or poison later reads.
- `setData`, `restore`, and source replacement retain documented liveness.
- Scope-backed resolvers work without subscriptions being installed during construction.

## JS-04 — Establish a safe boundary for child props

- [ ] Pending.

Files: [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx),
[createReadProxy.ts](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts),
component tests, README.

Keep the stable root connection for its owning component. Do not equate that live mutable view
with an immutable prop snapshot: the two contracts are incompatible under ordinary shallow
comparison when the object reference stays unchanged.

Recommended contract:

- Carburetor-aware children receive the store and an identity/key and collect their own reads.
  The current Todo row arrangement is an example.
- For an external memoized child that needs an object prop, provide or reuse a typed selection/
  snapshot boundary whose identity changes when the selected data changes and remains stable
  otherwise. Cache that result at the dependency/version boundary; do not clone the whole store
  on every render.
- If direct nested-view props remain advertised as supported, implement and test both their
  notification coverage and reference behavior. Changing identity alone is insufficient when
  no component subscribes to the changed leaves.

Prevent accidental child reads from being attributed to the parent's completed render. Document
unsupported live-view escapes and add appropriate development diagnostics. Documentation alone,
without a working supported transfer path, is not acceptance of this step.

Acceptance:

- The `Ann → Bob` memo-child reproduction displays `Bob` through the supported transfer API.
- Test both `React.memo` and the class component's own props gate.
- An unrelated store write does not redraw the child.
- Replacing a nested object or the store still updates the child.
- A child bail-out does not accidentally remove the dependencies needed for its next update.
- Consumer types remain inferred, with read-only data and no manual field-name lists.

## JS-05 — Isolate errors throughout computed delivery

- [ ] Pending.

Files: [Computed.ts](../lib/src/Carburetor/Derived/Computed.ts),
[UpdateWave.ts](../lib/src/Carburetor/Store/Scheduling/UpdateWave.ts),
the existing diagnostics and scheduler error-handling code.

Use the existing store notification policy consistently: isolate each observer and each
independent queued settlement, complete the remaining work, and report failures afterward.
Always restore wave bookkeeping, even on failures.

Distinguish a failing observer from a failing computation body. Do not announce an old cached
value as a newly successful computation after its body throws. Keep unrelated nodes live and
define how an explicit subsequent read exposes or retries that failed calculation.

Acceptance:

- A throwing subscriber does not skip a later subscriber of the same computed.
- A failure in one queued computation does not suppress an independent computed's delivery.
- Newly queued work during delivery is either completed or retained according to an explicit
  policy; it is never silently lost with the drained batch.
- A subsequent ordinary write still propagates normally.
- Production and development have the same delivery behavior; diagnostics may differ.

## JS-06 — Stop rebuilding retained computed dependencies

- [ ] Pending.

Primary file: [Computed.ts](../lib/src/Carburetor/Derived/Computed.ts).

Replace unconditional `releaseDependencies()` with a comparison between old and newly collected
dependencies. Keep unchanged source/path edges, replace only changed registrations, and remove
only departed edges. Preserve the subscription identity and update version records consistently.

Retain the existing wave ordering and lazy freshness checks. If the simple chain still evaluates
more than once per node after edge diffing, inspect settlement deduplication rather than hiding
the extra work through result equality.

Acceptance:

- After initial subscription, one source change through a four-node chain evaluates each node
  once: `[1, 1, 1, 1]`, instead of the reproduced `[4, 3, 2, 1]`.
- Diamond graphs announce only the settled result.
- Equal derived outputs do not notify downstream consumers unnecessarily.
- Conditional dependencies detach the old branch and attach the new one.
- Removing the final observer releases the graph; unobserved reads remain fresh.
- Multi-store transactions and reads during a wave remain correct.

Use body-call counts on small graphs for this regression. Do not make wall-clock timing a test
oracle or introduce synthetic load.

## JS-07 — Reclaim obsolete proxy-cache entries

- [ ] Pending.

Files: [createProxyCache.ts](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts),
[createReadProxy.ts](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts),
[createWriteProxy.ts](../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts).

Replace the unbounded strong path-to-object cache with an ownership strategy that releases
obsolete targets. Evaluate weak target ownership or explicit invalidation on branch replacement
and deletion. The chosen cache key must still account for path and recorder ownership; caching
only by raw object identity is insufficient.

Apply the lifetime policy to persistent read proxies and write proxies. Coordinate reference
behavior with JS-04. Do not reclaim a committed view merely because an abandoned render happened
not to read it.

Acceptance:

- Reading `items.a`, deleting it, and retaining the live connection does not leave an internal
  strong cache entry holding the removed object.
- Replacing a branch releases the old target without requiring another read at that old path.
- Moved array objects retain correct tracking paths.
- Current branches continue to reuse their wrappers under the agreed identity contract.
- Tests inspect deterministic ownership/eviction behavior. Do not require a WeakRef to clear
  within a deadline or depend on arbitrary garbage-collection timing.

## JS-08 — Avoid whole-list derivation work for title edits

- [ ] Pending.

Primary file: [TodoCarburetor.ts](../lib/src/ToDo/Carburetors/TodoCarburetor.ts).

Classify actions by what they actually change. A title-only edit must skip count derivation and
ordering work. Update counters from the old/new completion state for ordinary single-item actions.
Maintain the existing stable ordering when completion or membership changes.

Use a full derivation pass for initial data replacement, restore, and bulk operations where it is
appropriate. Do not leave a `setData` or hydration path with stale counters merely to optimize
the common edit path.

Acceptance:

- Editing a title does not enumerate all items, invoke the ordering comparator, or publish
  unchanged counters/order.
- Creating, deleting, and toggling items yield the same counts and stable ordering as before.
- Repeated no-op updates do not produce unintended work or notifications.
- Restoring/replacing data yields correct derived fields.
- Existing demo behavior and row-level render precision stay intact.

## JS-09 — Reduce repeated work on connected reads

- [ ] Pending.

Primary file: [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx).

After JS-02, use its render collection context to reuse the resolved source and baseline version.
The current primitive read resolves the source twice, and the recorder requests the version on
every recorded path. Remove that duplication without caching source selection across later
renders or reusing an obsolete root after `setData`.

Consider reuse of collection storage only after ownership of tentative/committed sets is proven.
Do not mutate a set that is still used as a committed comparison baseline.

Acceptance:

- Ordinary reads of multiple fields within one attempt share the source resolution and baseline
  capture, rather than doing that work per field.
- Root replacement and source-prop changes remain visible.
- Event reads still obtain current data but cannot modify render tracking.
- All JS-02 and JS-04 regressions continue to pass.
- Allocation/call-count claims are backed by bounded checks. Any latency improvement needs an
  actual representative interaction measurement, not an assumption based on fewer proxies.

## JS-10 — Reuse unchanged DevTools snapshots

- [ ] Pending.

Primary file: [connectDevTools.ts](../lib/src/Carburetor/Tooling/connectDevTools.ts).

Cache a detached snapshot per connected store and refresh only changed versions when composing
the DevTools payload. Inspect every store's version as needed: a transaction may already have
changed several stores before the first notification, so caching only the callback's named store
could produce a mixed payload.

First preserve the existing action/message behavior. Coalescing messages is a separate semantic
decision and should not be smuggled into snapshot reuse.

Acceptance:

- After initial connection, changing one store copies that store's state and reuses snapshots
  of unchanged stores.
- A transaction affecting multiple stores produces consistent payloads and does not repeatedly
  clone unchanged versions.
- Previous payloads remain detached from later mutation.
- Time travel, rollback, and disconnect preserve behavior.
- Without an attached extension, the adapter remains a no-op.

## JS-11 — Verify the integrated result and update the contract

- [ ] Pending.

Add regressions alongside the affected engine/component/resource tests. At minimum the suite must
include all reproduced failures in the evidence table, plus the controls that already passed.

Before closing the implementation:

- Run the affected tests after each meaningful fix and resolve any failures immediately.
- Run library and demo TypeScript checks. Add type regressions for direct-store and resolver forms,
  nested read-only values, optional properties, and rejection of invalid consumer accesses.
- Run the complete existing JS test suite, lint, layout checks, and library/demo builds.
- Check the supported React 18/19 range where test infrastructure permits; distinguish locally
  verified versions from compatibility still needing CI coverage.
- Validate development/production and ESM/CommonJS outputs, including declarations. Follow the
  repository's existing distribution-artifact policy; do not leave source and shipped output
  describing different APIs.
- Update README and relevant hazard/cache documentation with the render, root-shape, child-prop,
  and data-lifetime contracts selected above.
- Replace broad claims such as “no per-render allocation” with the behavior actually established:
  persistent connection setup, reuse of views, and any collection work that still occurs.

Do not use a synthetic stress workload as routine verification. Bounded behavioral tests and work
counters establish the planned corrections. Profiling a representative real interaction can then
guide further optimization; record its scenario and configuration rather than claiming general
application speed from a proxy-only microbenchmark.

## Completion criteria

The plan is complete when the P1 failures no longer reproduce, the supported object/view contract
is explicit and tested, the work-count and cache-lifetime targets are met, and the integrated
checks pass. Preserve inferred types and the one-declaration consumer API throughout.

The redundant transaction write-set copy remains lower priority and belongs with future transaction
work. Additional features, native rule ports, and unrelated API redesigns are not prerequisites for
closing this plan.
