# API and engine review, round 6 — 2026-09-29

Scope: JavaScript/TypeScript API and engine on `origin/master` at `d8879fc`. This review is read-only with respect to implementation: it proposes fixes but changes no engine code. Prior round-16 resolutions were treated as the baseline, not re-reported as new findings. Priorities below use P-notation; a source-level mechanism is distinguished from a measured result.

## Findings

### R6-01 — P1 — `restore()` loses a sparse array's length-only growth

`applyBranch` in `lib/src/Carburetor/Store/Paths/Diff/applyDiff.ts:73-82` assigns `length` only when the next array is shorter. It then walks `Object.keys` (`:84-108`), which has no new index to assign when the next array is longer only because of holes. `restore()` calls this routine for same-kind trackable branches (`lib/src/Carburetor/Store/Carburetor.ts:212-235`), then emits with an empty write set. A snapshot taken from a sparse array preserves its length (`lib/src/Carburetor/Store/Utils/deepClone.ts:17-29`), so this is within the existing snapshot contract.

Minimal case: start with `{rows: new Array(1)}`, take a snapshot, set `snapshot.rows.length = 3`, then call `restore(snapshot)`. The live array remains length 1 and no update is published. `setData` does not have the same omission: `diffPaths` explicitly records a length-only change (`lib/src/Carburetor/Store/Paths/Diff/diffPaths.ts:51-61`).

Bounded CJS probe: `snapshot.rows.length` was 3 after the edit, but `getData().rows.length` remained 1 after `restore(snapshot)` and `getVersion()` remained 0.

Fix: assign the new `length` when it is greater too, and let the draft proxy record that write. Add a regression test that asserts data, version, and a subscriber reading `rows.length` for both sparse growth and shrinkage; include nested and root arrays.

### R6-02 — P1 — replacement can silently change a tracked non-enumerable property

`diffPaths` and `applyDiff` enumerate string keys with `Object.keys` (`diffPaths.ts:64-96`, `applyDiff.ts:84-109`). A configurable, non-enumerable own data property is nonetheless readable and recorded by the read proxy (`createReadProxy.ts:250-297`). If `setData` replaces a plain object with another whose non-enumerable `hidden` value differs, the state is swapped before diffing (`Carburetor.ts:171-190`) but the diff is empty: the version does not advance and the reader is not notified. `restore` also cannot install that value through `applyDiff`. The same category includes a descriptor change from enumerable to non-enumerable with an otherwise equal value: an `Object.keys` reader can become stale without an announced key-set change.

Bounded CJS probe: a tracked read recorded `["hidden"]`; `setData` changed that property's value from 1 to 2, but `getVersion()` stayed 0 and the subscriber was called 0 times.

The existing `__tests__/Engine/Store/Snapshot.test.ts:237-245` explicitly expects `deepClone` to omit a non-enumerable string key. That expectation makes this a data-model contract decision, not merely a missing clone test: the read proxy currently tracks a value that snapshot and structural replacement do not consistently preserve or announce.

Fix: decide and document whether non-enumerable own data properties are valid store state. If they are, compare own property descriptors (without invoking getters) and announce value and key-set changes appropriately; align `applyDiff` and `deepClone` with that decision. If they are not, reject them at the store boundary and avoid suggesting they are tracked. Test direct property reads, `Object.keys`, `setData`, `restore`, and snapshot round trips.

### R6-03 — P2 — `snapshot()` drops an array's custom own properties

The array branch of `deepClone` copies `length` and indexed elements only (`deepClone.ts:17-29`). The write and read proxies can track custom own string keys on arrays, yet `snapshot()` returns an array without them (`Carburetor.ts:195-197`). This also affects history's baseline and snapshot fallback (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:76-80,184-191`) and any `restore(snapshot())` round trip. For example, `rows.meta = 'keep'` is lost from `snapshot().rows.meta`.

Bounded CJS probe: the original `rows.meta` was `"keep"`, while `Object.hasOwn(snapshot().rows, 'meta')` was `false`. Existing snapshot tests cover holes and enumerable symbol keys on plain objects, but not custom own keys on arrays (`__tests__/Engine/Store/Snapshot.test.ts:139-165,223-235`).

Fix: clone all supported own array properties, preserving holes and `length`, and define a consistent policy for symbols, non-enumerable keys, and descriptors. Add a round-trip test with an indexed hole and an enumerable custom key. Do not claim a deep snapshot of a value whose supported own state was omitted.

### R6-04 — P2 — public `ReadonlySet` subscription contract is not upheld

`ISubscribeOptions.reads` is a `ReadonlySet<string>` and its contract says later caller mutation has no effect (`lib/src/Carburetor/Models/Store.ts:22-39`). But `Carburetor.subscribe` casts that set to a mutable `Set` and adopts it (`Carburetor.ts:264-283`); `SubscriberIndex.addPath` later calls `reads.add(path)` (`SubscriberIndex.ts:124-145`). A structurally valid read-only set can therefore be subscribed but `extend(id, path)` throws. A caller changing a `Set` after subscription can also desynchronize the index and leave stale matches after re-registration. Internal call sites handing over fresh, exclusively owned sets do not have this problem; the mismatch is at the public extension boundary.

Bounded CJS probe: after subscribing to `a`, clearing the caller's set, re-subscribing the same id to `b`, and writing `a`, the callback still ran once. Passing a valid read-only set implementation to `subscribe` succeeded, but `extend(id, 'b')` threw `TypeError: reads.add is not a function`.

Fix: either copy the public `ReadonlySet` into owned storage (and retain a separate explicitly owned fast path internally), or change the public type and documentation to require a transferred mutable `Set` whose caller relinquishes mutation. Add tests for a read-only implementation and for a caller mutating its original set after registration.

## Performance and API follow-up

- No new throughput or memory number is claimed in this review. Do not optimize from source inspection alone. The round-16 review already established tracked computed walks as a remaining measured cost; its persistent-proxy-tree idea remains blocked on the documented escaped-value semantics. Revisit only with the semantic guard in place.
- Profile *real application interactions* before the next optimization pass: a title edit under an active filter, a status toggle, undo/redo, and a resource-backed list mount. Capture React commit/render counts, JS CPU stacks, and allocation stacks in a production build. Distinguish unnecessary renders from time spent recomputing selectors, serializing resource keys, structural diffing, and collecting garbage. Record a before/after trace for any proposed optimization. This is a proposed measurement protocol, not a benchmark run or a performance claim.
- R6-04 is also an API simplification decision: one honest ownership rule for read sets is easier to use than a `ReadonlySet` type coupled to hidden mutation requirements.

## Verification boundaries

The findings above are derived from current source and bounded single-operation probes against the committed CJS build. They are not load tests. No implementation source, tests, dependencies, or generated files were changed by this review. Existing test coverage was searched for these boundary cases; each finding specifies a missing regression to add with its fix.
