# JavaScript review, round 3 — 2026-09-23

**Status: fully implemented.** R3-01 through R3-09 landed as `66461fc`, `5be1a00`, `3d31f62`,
`bc9119a`/`e51f111`, and `bd8d747` (commit range `87c7385..bd8d747` on `master`). R3-10 and R3-11
(the closing cleanup pass) were assessed and closed in a follow-up change: R3-10 was kept as a
documentation/lint-only outcome (see `docs/hazards.md`, H23) plus a pinning regression test, since
wrapping `getEntry()`'s `data` was judged disruptive for this codebase (see that change's own
summary for the reasoning); R3-11 got an actual fix in `buildPersistentView.ts`, landed as
`5f41f17` (full commit range for the round: `87c7385..5f41f17` on `master`).

Reviewed revision: `7abfd18` on `master`.

Scope: the JS/TS state engine, class component integration, derived values, resources,
the demo's public usage, tests, and package contracts. Native/Rust rules were outside scope.
Only this review document was added.

## Verdict and priority scale

The round-two changes repaired the cases that motivated them. In particular, the old computed
first-notification case now delivers once, the unequal-depth graph emits only its settled value,
and the previous invalid cache paths, selector keys, write equality, and nested read-proxy
mutation gaps have dedicated fixes and tests.

Three newly reproduced correctness defects remain. The most direct is a class component whose
normal `render()` cannot read its own JavaScript private field. A nested live view can also
escape a supposedly safe selection without a diagnostic, and a late cache request can overwrite
a restored snapshot. Memory and CPU behavior of the new cache retirement scheme need another
pass before it can be described as bounded in long-lived components.

This report contains **11 findings: 3 P1, 6 P2, and 2 P3**. No P0 was established.

- **P0:** immediate, broad stop-the-line defect.
- **P1:** incorrect displayed or restored data, or failure of a normal supported component.
- **P2:** narrower correctness, compatibility, or demonstrable scaling defect.
- **P3:** known sharp edge, unnecessary complexity, or diagnostic quality.

Every P1/P2 finding has a bounded reproduction below. P3 items are existing documented behavior
or a narrower API/design assessment.

## Verification

Against the reviewed checkout, five affected test files passed: **184 tests** covering the
component, computed, single-slot resource, proxy cache, and Todo demo. Library, demo, and public
type-contract checks also passed. These checks validate the covered cases; they do not establish
that the reproductions below are safe.

Additional probes imported current TypeScript sources through an in-memory type-stripping
loader. React cases used the installed React 19.3.0, React DOM, JSDOM, and `act`; store and
cache probes used short synchronous sequences and controllable promises. Four normal reads and
three writes were sufficient for the memory observations. No stress benchmark ran. The complete
plugin/native suites, React 18, and browser compatibility were not independently checked in
this round.

The pre-existing change in `.claude/scheduled_tasks.lock` was left outside this review commit.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R3-01 | P1 | Render wrapper calls a prototype method with the wrong private-field receiver |
| R3-02 | P1 | Nested live views escape `connectSelection()` and leave a memo child stale |
| R3-03 | P1 | A late cache request overwrites state restored from a snapshot |
| R3-04 | P2 | Restored in-flight status can persist without a request |
| R3-05 | P2 | Symbol-keyed object reads and nested draft writes bypass tracking |
| R3-06 | P2 | An idle cache retains a growing invalidation worklist |
| R3-07 | P2 | Repeated read views accumulate weak watcher handles until a write |
| R3-08 | P2 | The package now requires `WeakRef` at runtime without an explicit runtime floor |
| R3-09 | P2 | Unequal-depth computed graphs still evaluate nodes more than once per write |
| R3-10 | P3 | Cached resource data remains mutable through public result views |
| R3-11 | P3 | The connection's shape probe swallows unrelated resolver errors |

## R3-01 — [P1] Prototype render methods lose their private-field receiver

**Location:** [AntiHookComponent.tsx](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L144),
[boundary call](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L546).

The base constructor returns a proxy over the component. A subclass's JavaScript `#field` is
initialized on that returned proxy. The render boundary, however, closes over the original
base instance and calls the subclass's prototype `render` with that original as `this`.

Bounded reproduction:

```js
class PrivateView extends AntiHookComponent {
    #value = 7;
    render() { return this.#value; }
    read() { return this.#value; }
}

const view = new PrivateView({});
view.read();   // 7
view.render(); // TypeError: Cannot read private member #value ...
```

React calls the same wrapped render. Ordinary TypeScript `private` may compile to an ordinary
property, but native JavaScript/TypeScript `#private` has an actual receiver check. This is a
class-component feature, not an unsupported store shape.

**Correction:** invoke the raw render with the returned proxy as receiver while retaining the
render-attempt bookkeeping on the same logical component. Check class-field arrow renders,
prototype renders, private fields/methods, refs, inherited methods, and StrictMode. Add a real
React regression as well as the direct construction control. Avoid relying on equality between
the proxy and original instance unless it is explicitly guaranteed.

## R3-02 — [P1] The safe child-selection route can still carry a live view

**Location:** [reportLiveViewEscape.ts](../lib/src/Carburetor/Component/Connection/reportLiveViewEscape.ts#L16),
[detachSelection.ts](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L13),
[connectSelection](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L332).

The escape diagnostic inspects the returned value and only one level of its members.
Detachment also copies only the top-level object. A nested plain container can therefore
carry a store read proxy into a memoized child without any diagnostic.

Reproduction:

```tsx
private readonly selected = this.connectSelection(
    store,
    data => ({wrapper: {user: data.profile}})
);

render() {
    return <MemoChild model={this.selected()} />;
}
```

The child reads `model.wrapper.user.name`. After changing the stored name from `Ann` to
`Bob`, the store held `Bob`, the DOM still showed `Ann`, and no `connectSelection` escape
warning was produced. The owner recorded the branch marker for `profile`, which a leaf write
to `profile.name` does not wake; the child's read happened outside the owner's render attempt.

The same one-level check also misses live views under enumerable symbol keys.

**Correction:** define a bounded, cycle-safe traversal of the selected shape and reject or
detach live views at any supported depth. A shallow copy alone cannot make a nested live view
safe. If deep selection is intentionally unsupported, detect it reliably and offer a typed,
safe extraction path that preserves the one-time declaration ergonomics.

**Acceptance:** nested objects and arrays, symbol-keyed members, cyclic plain containers,
and an ordinary flat selection; a changed nested value must reach the memo child, and a
forbidden shape must fail or report clearly before a silent stale UI.

## R3-03 — [P1] Cache restore does not cancel the old request

**Location:** [inherited restore](../lib/src/Carburetor/Store/Carburetor.ts#L113),
[ResourceCache request settlement](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L565).

A cache inherits `restore` from `Carburetor`, which replaces data but does not reconcile
`ResourceCache`'s request and controller maps.

Reproduction:

```text
load("x") -> "initial"; save snapshot
refresh("x") -> pending
restore(saved snapshot) -> "initial"
old refresh settles -> cache data becomes "late"
```

The old controller is still considered current, so its completion writes into the restored
entry. The caller's restored state is silently superseded.

**Correction:** define cache restore as a request-generation boundary. Cancel or invalidate
all pre-restore requests, clear their bookkeeping, and normalize the restored entries before
notifying subscribers. Ensure a request that ignores abort cannot land late.

**Acceptance:** restore over a pending initial load and over a refresh with retained good
data; late success and late failure must not change the restored state. Cover `fromJSON`,
scope hydration, history/time travel, and a cache containing several independent keys.

## R3-04 — [P2] In-flight flags survive hydration without in-flight work

**Location:** [ResourceCache state](../lib/src/Carburetor/Models/Resource.ts#L23),
[useResource fetch gate](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L368),
[single-slot restore](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L71).

A successful cache entry was invalidated and refreshed; its snapshot had
`refreshing: true` and `invalidated: true`. After hydration into a new cache, the entry
remained stale and refreshing with **zero client requests**. A mounted `useResource` reader
did not start a load because `refreshing` was still true. It displayed the old value and a
refresh indicator indefinitely.

A single-slot resource separately accepted a snapshot with `status: Pending` into a fresh
instance with no pending promise. `suspend()` can initiate a new request, but a plain status
reader sees Pending with no work underway.

**Correction:** serialize the answer, not a claim that a process-local operation is still
running. During hydrate/restore, clear or restart in-flight state with a documented transition.
Preserve last good data, error identity, and per-entry invalidation meaning.

**Acceptance:** hydrate Pending and refreshing snapshots into fresh instances, with and
without a mounted reader. Every visible pending/refreshing state must correspond to live work,
and stale entries must be able to fetch again.

## R3-05 — [P2] Symbol-keyed branches bypass the read and write boundaries

**Location:** [createReadProxy.get](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts#L90),
[descriptor read](../lib/src/Carburetor/Store/Tracking/createReadProxy.ts#L162),
[createWriteProxy.get](../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts#L65).

For a plain object holding `[symbol]: {n: 1}`, reading that branch returns the raw object
and records no read path. The descriptor route also returns its raw value. Mutating either
one changes stored data without a version increment or subscriber notification. A nested
draft write `draft[symbol].n = 4` likewise changes the raw object without recording a write;
`update()` returns without publication.

The documented coarse fallback for writes *to* a symbol property does not cover writes
*under* a symbol-keyed object. The affected root remains a trackable plain object.

**Correction:** conservatively record a wildcard for symbol-keyed reads and writes, wrap or
reject object values consistently with the read-only contract, and ensure mutations under the
key publish. Test both direct property and descriptor access.

## R3-06 — [P2] An idle view retains a growing invalidation worklist

**Location:** [createProxyCache.retire](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L125),
[invalidation](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L203).

Read one object branch, retain that view, and replace the same path three times without
reading through the view again. One data key remains, while the scope reports **three
pending invalidation records**. The old entry's revision is less than every new record and
`needsRecord` considers each same-path record necessary until the cache catches up.

On every write, `invalidate()` invokes `retire(false)`, which iterates watcher handles
and filters all accumulated records. As the idle view stays alive, both metadata and
write-side work grow with the number of writes, despite constant live data size. A future
read can retire the records; an offscreen but still mounted connection may never make it.

**Correction:** coalesce superseded invalidations per path/range or advance/retire idle
watchers without retaining every revision. Preserve correctness for multiple caches that
consult the same raw object at different times. Check record count and visited-record count
under a small repeated-write scenario; do not use a synthetic CPU stress test.

## R3-07 — [P2] Weak watcher handles accumulate during read-only renders

**Location:** [createProxyCache registration](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L105),
[retirement](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L125).

Every fresh `Carburetor.read()` view creates a cache state and inserts a new `WeakRef` into
the raw root's strongly held watcher `Set`. Four ordinary reads with no writes left four
handles in that set. A collected cache state is only removed when retirement later runs.
No writes means no retirement pass.

Weak references avoid keeping the old cache state itself alive, but they do not make their
wrapper objects disappear from a live `Set`. On a later write, the engine scans the
accumulated handles before it can retire records. The older `useCarburetor` path still
constructs a fresh read view on every render, so this is not only a test-only API.

**Correction:** bound watcher registration/lifetime independently of later writes, or
explicitly release watchers when an owning view/connection is done. Do not depend on a
particular garbage-collection deadline for correctness or for the regression oracle.

## R3-08 — [P2] WeakRef is now a hard runtime dependency

**Location:** [createProxyCache.ts](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L114),
[compiler target](../tsconfig.json#L3).

With `globalThis.WeakRef` unavailable, the first store `read()` throws
`WeakRef is not a constructor`. The package has no stated minimum runtime in its metadata,
and the TS output target remains ES2020; adding `ES2021.WeakRef` to compiler libraries
supplies types, not a runtime implementation.

**Correction:** state the supported runtime floor explicitly and test it, or provide a
compatible cache ownership strategy when `WeakRef` is absent. Do not silently fail at the
first tracked read. This is a compatibility finding; this review did not measure the
population of affected browsers or servers.

## R3-09 — [P2] Correct computed graph still performs redundant evaluations

**Location:** [Computed invalidation](../lib/src/Carburetor/Derived/Computed.ts#L347),
[settlement](../lib/src/Carburetor/Derived/Computed.ts#L400).

The previous inconsistent publication is fixed. In a direct-plus-derived three-node graph
(`a = n*2`, `b = a+1`, `total = n+b`), one source change now delivers only the final
result `7`. Yet bounded body counters showed **[2, 2, 2]** evaluations, not one per node.
The pure chain test added last round reaches `[1, 1, 1, 1]`; this graph shape takes a
different path through the wave.

**Correction:** use a wave generation or equivalent settled-value state to avoid repeating
an evaluation after it already read the newest upstream versions. Maintain the single final
notification, correct behavior when a body fails, and conditional dependency changes.
Measure whether this path matters in a representative derived graph before deeper
scheduler redesign.

## R3-10 — [P3] Resource result views remain a documented mutable escape

**Location:** [IResourceView](../lib/src/Carburetor/Models/Resource.ts#L64),
[cache view](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L150),
[documented H23 hazard](hazards.md#L836).

`getEntry()` returns a shallow copy of entry fields and `useResource()` exposes that view.
Its `data` field remains the raw stored object. Changing `entry.data.name` changed the
cache's stored name without a version change or notification. The codebase documents this
as H23 and provides a lint rule; it is recorded here as a **known usability sharp edge**,
not presented as a newly discovered regression.

**Recommendation:** consider a read-only typed return for render-facing resource data,
plus a runtime boundary if the API promises read-only behavior. Keep untracked read/write
escapes explicit and measure wrapper cost before adding another proxy to a hot render path.

## R3-11 — [P3] Connection shape probing masks resolver failures

**Location:** [buildPersistentView.ts](../lib/src/Carburetor/Component/Connection/buildPersistentView.ts#L25).

The constructor calls a source resolver to decide whether the permanent facade is an array,
then catches **every** exception as “source not resolvable yet.” A resolver that throws
for an unrelated reason on its first call has that error swallowed. If its next call
returns an array, reading the connection throws a message blaming a scope-backed resolver
and a fixed object facade. The check called the resolver twice; the original cause was lost.

**Recommendation:** distinguish the expected deferred-source case from arbitrary resolver
errors, or make the fixed root shape explicit through a safe internal contract. Preserve
one-time consumer declaration and type inference. This also avoids doing speculative source
work during construction when no render will commit.

## Recommended order

1. Repair the render receiver and nested selection boundary (R3-01, R3-02).
2. Make cache restore/hydration atomic with request bookkeeping (R3-03, R3-04).
3. Close symbol-keyed boundary gaps (R3-05).
4. Redesign proxy-cache ownership/retirement and clarify runtime support (R3-06–R3-08).
5. Profile the unequal-depth computed path, then remove redundant work if it matters (R3-09).
6. Tighten the known resource-view escape and resolver diagnostics (R3-10, R3-11).

Preserve the previous round's working behavior. Passing tests and type checks are useful
controls; the reproductions above define what the next regression tests must pin down.
