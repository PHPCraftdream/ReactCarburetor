# API and engine review, round 8 — 2026-09-29

Scope: JavaScript/TypeScript API and engine at `a1230ee`, after the round 7 fixes in `c234c5c`. This is a source-only review. No test, build, benchmark, runtime probe, or profiler was run. The mechanisms below follow from current code; effects stated as scenarios need regression tests, and proposed performance gains need measurement. Round 7's subscription ancestor counts, invalid array lengths, sparse-array walks, and subscriber-id dictionary are not reopened here.

## Findings

### R8-01 — P1 — A literal `__proto__` write or history patch can change an object's prototype

**Code evidence.** The draft `set` trap accepts any string key, validates the proposed value, records a path and patch, then executes `Reflect.set(source, key, raw)` (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:354-422`). On an ordinary object without an own `__proto__` key, that operation invokes the inherited prototype setter. It does not add the own enumerable key the write bookkeeping assumed. The history patch installer has the same route: `node[key] = ...` (`lib/src/Carburetor/Store/Paths/Diff/installPatch.ts:18-32`). History installs patches into its baseline and replays them for undo/redo (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:184-200,214-245`). By contrast, `deepClone` and `applyDiff` already use `Object.defineProperty` for a literal `__proto__` data key (`lib/src/Carburetor/Store/Utils/deepClone.ts:44-58`; `lib/src/Carburetor/Store/Paths/Diff/applyDiff.ts:22-37`). This is an uncovered write/replay route, not the previously fixed copy route.

**Expected failure to verify.** Adding an own `__proto__` property via `Object.defineProperty(draft, '__proto__', {value: {x: 1}, writable: true, enumerable: true, configurable: true})` produces a patch. Replaying that patch into history's ordinary-object baseline calls the inherited setter and changes its prototype. Undo then deletes a missing own key, leaving the wrong baseline shape. A direct `draft.__proto__ = {x: 1}` has the same prototype mutation before history is involved. The exact subsequent undo/redo state and notifications have not been run in this review.

**Action.** Choose one explicit API rule for this key: support it as an own data property, using a guarded definition in both write and patch installation, or reject it before recording anything. Regression tests should cover direct assignment, `defineProperty`, nested keys, add/delete/undo/redo, object prototype and own-key checks, and notifications. Compare against `deepClone`/`applyDiff` behavior so all state paths agree.

### R8-02 — P2 — Descriptor-value reads are invisible to read tracking

**Code evidence.** The read proxy's `getOwnPropertyDescriptor` wraps a trackable `descriptor.value` but records no path (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:321-355`). A direct selector such as `Object.getOwnPropertyDescriptor(view, 'count')?.value` therefore registers no `count` read. At a nested object, traversal registers the branch marker through `get` (`lib/src/Carburetor/Store/Tracking/createReadProxy.ts:252-270`), but a later write to its leaf does not itself replace the branch. `watch()` files precisely the paths collected during the selector (`lib/src/Carburetor/Store/Carburetor.ts:341-345,361-385`), so a descriptor-only leaf selection can remain stale. Current engine tests exercise descriptors and enumeration, but the tracking tests do not assert notification for a descriptor-value selector (`__tests__/Engine/Store/Tracking/ReadProxyPrecision.test.ts`).

**Design constraint.** Recording every descriptor lookup as a leaf read would make `Object.keys` and similar enumeration subscribe to all present values, losing the existing key-set precision. Decide whether explicit descriptor values are a supported tracked API and add an intentional way to record them, or document that selectors must use ordinary property access for tracked values. Test root and nested `watch()`/component reads and retain the `Object.keys` precision regression. This is a code-derived subscription gap; no render count was measured.

### R8-03 — P2 — `forgetAll()` publishes one update per entry

**Code evidence.** `forgetAll()` enumerates the initial keys and calls `forgetKey` for each (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:239-269`). Every existing key goes through `update`, which publishes in its `finally` (`lib/src/Carburetor/Store/Carburetor.ts:468-485`). Pending requests may first publish another status update in `abortKey` (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:359-392`). Thus clearing *N* existing entries generates at least *N* store publications in the normal no-request case. With default synchronous `persist`, each publication serializes the current whole cache (`lib/src/Carburetor/Tooling/persist.ts:35-53`), making the total serialization work proportional to the sum of shrinking cache sizes, O(*N*²) for similarly sized entries. The count and complexity follow from these loops; elapsed time and React render behavior are unmeasured.

**Action.** Coalesce a bulk clear into one final publication while preserving the existing same-key request re-entry behavior during abort (`__tests__/Engine/Resource/ResourceCache/ReentrantLoads.test.ts:191-209`). Test final data, per-key and wildcard subscribers, version count, synchronous `persist`, and abort listeners that start a replacement request. Benchmark 100, 1,000, and 4,000 retained entries with no subscriber, a wildcard subscriber, and default/coalesced persistence; record publications, callbacks, CPU time and allocated bytes. Include `abortAll()` separately in the benchmark because it also loops over keys (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:191-194`) but has different final-state semantics.

### R8-04 — P3 — History's numeric limit has surprising edge behavior

**Code evidence.** The public option is just `number` and promises a cap on past states (`lib/src/Carburetor/Models/Tooling.ts:37-39`). The constructor uses `options.limit || 50` (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:76-79`), so `0` silently selects 50. `record()` drops only one oldest entry when `past.length > limit` (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:160-175`); a `NaN` limit never satisfies that comparison and permits unbounded growth. Negative and fractional values have similarly implicit behavior. The existing limit test only uses `2` (`__tests__/Engine/Tooling/Tooling.test.ts:243`).

**Action.** Define whether zero means disabled history, then accept finite nonnegative integers or reject invalid options at construction. Cover zero, negative, fractional, `NaN`, and `Infinity` explicitly in focused tests. This is an API and retention finding, not a measured memory leak.

## Priority and verification plan

1. Repair R8-01 first. It can corrupt store or history state and invalidate tracking assumptions. Test both write entry points and full undo/redo before considering an optimization.
2. Resolve R8-02's contract with a regression that proves descriptor-only selections currently miss leaf changes. Keep enumeration-only readers precise.
3. Measure and then address R8-03 on bulk cache clears. Preserve abort re-entry behavior and synchronous persistence semantics; compare publication count and wall time before/after.
4. Validate R8-04's options at the boundary and document the chosen zero/Infinity policy.

Separately, `diffPaths` constructs `[...]` segment arrays on every descended key even when no patch listener is attached (`lib/src/Carburetor/Store/Paths/Diff/diffPaths.ts:56-82,148-159`). Earlier review already listed lazy path construction as a possible follow-up, so it is **not a new finding here**. A before/after allocation profile on `setData()` for wide, deep, equal, and one-leaf-changed trees should decide whether it is worth implementing. No allocation reduction is claimed.

No P0 was established. R8-01 through R8-04 remain open P1–P3 findings at this source state. Only the cited control flow and API mismatch are established by inspection; runtime outcomes and performance improvements await the focused tests and benchmarks above.

## Resolution (2026-09-29)

- **R8-01, R8-04 — `33d34f0`:** literal `__proto__` writes and history patches install an own data key without changing the prototype; rejected definitions leave no write record. History limits must be positive safe integers. Regression tests cover writes, undo/redo and invalid limits. An isolated history-write benchmark measured 0.00468 → 0.00797 ms/write; this correctness fix claims no speedup.
- **R8-02 — `ac52fa5`, declarations `74ab0b8`:** the selector contract now explicitly requires ordinary property access for tracked primitive values. Descriptor-only introspection remains non-reactive so key enumeration stays precise; read-only descriptor values and React/watch behavior have regressions. No runtime hot-path change or speedup is claimed.
- **R8-03 — `f5d9f6d`:** `forgetAll()` coalesces ordinary bulk removal into one version and one delivery, preserving pending-request cancellation and tested re-entry cases. The integrated benchmark's single 4,000-entry/default-persist run had one storage write and took 10.77 ms, versus 4,000 writes and 5,971 ms in the pre-fix agent run. These are single-machine samples, not a guaranteed ratio.
- **Integration follow-up — `8931895`:** moved descriptor React regressions under the 600-line test-file limit and fixed benchmark TSDoc.

The integrated build, full test suite, typecheck, lint and layout check passed. `abortAll()` intentionally was not changed: in the same integrated benchmark, 4,000 pending entries still produced 4,000 versions, wildcard callbacks or default-persist writes (depending on configuration). That is a distinct bulk-operation candidate for a later review, not a claimed R8-03 fix.
