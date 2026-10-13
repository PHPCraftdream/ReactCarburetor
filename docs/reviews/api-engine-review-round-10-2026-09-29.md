# API and engine review, round 10 - 2026-09-29

Reviewed revision: `c3204a4`, after all round 7-9 resolutions. Scope: the current JavaScript/TypeScript API, store engine, derived values, React bridge, resource cache, and patch history. The closed round 7-9 findings are excluded. Earlier JS reviews were also checked to distinguish an existing engine repair from an uncovered consumer or write route.

Six new findings are recorded below: three P1 correctness defects and three P2 API, retention, or performance issues. No P0 was established. This review changed only this report.

Evidence boundary: bounded Node probes used the tracked CJS distribution, whose relevant control flow was checked against the current TypeScript source. Those probes establish the explicitly reported state, callback, version, exception, and identity results. No build, test suite, React render probe, benchmark, allocation profile, or throughput measurement was run. React outcomes and proposed performance gains still require the focused verification below.

## Findings

### R10-01 - P1 - A value-preserving property definition corrupts redo

**Mechanism.** For an existing data property, an omitted `value` in `Object.defineProperty` preserves its current value. The draft `defineProperty` trap nevertheless validates and patches `descriptor.value`, then unconditionally records a changed path (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:481-505`). It therefore reports `next: undefined` for an accepted definition that leaves the live value unchanged. History installs that patch into its baseline and retains it for redo (`lib/src/Carburetor/Tooling/CarburetorHistory.ts:197-203,240-246`). This differs from the closed literal-`__proto__` repair: the key is ordinary and the patch's value is wrong.

**Observed bounded probe.** Starting with `{count: 1}`, attach history and run this inside `update`:

```ts
Object.defineProperty(draft, 'count', {
    enumerable: true, writable: true, configurable: true,
});
```

The live value stays `1`, but version becomes `1` and history gains an undo entry. Undo leaves `count === 1`; redo changes it to `undefined`. Thus a no-op definition can become a data-changing history action.

**Action and regression plan.** Attribute the effective installed descriptor, preserving the difference between an omitted `value` and an explicit `value: undefined`. A definition that changes no supported state must record no patch, version, or notification. Add focused write-proxy and history tests for omitted values on primitive and object properties, explicit `undefined`, a full same-value descriptor, and a real value change. Assert state, callback count, history availability, and undo/redo round trips. Existing definitions in `__tests__/Engine/Store/Tracking/WriteProxy.test.ts:302-313` always supply a value and do not cover this route. No speedup is claimed; suppressing these unnecessary publications is a consequence to verify.

### R10-02 - P1 - Defining an array index misses the implicit length change

**Mechanism.** The ordinary draft `set` trap measures array length before and after an index assignment and records both the length path and its history patch (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:408-410,431-440`). The `defineProperty` trap special-cases only an explicit `length` definition (`:465-468`). Defining an index beyond the current end uses its generic path (`:488-505`), which records the new key and index but omits the length that the native array operation also changed.

**Observed bounded probe.** Start with `{items: [1]}` and subscribe using paths collected by reading `view.items.length`. Define index `3` through draft with `{value: 4, enumerable: true, writable: true, configurable: true}`. The array length becomes `4`, but the length subscriber receives zero callbacks. With history attached, undo removes the new element but leaves length `4`, rather than restoring length `1`.

**Action and regression plan.** Apply the same implicit-length attribution to an accepted index definition, including an ordered length patch. Add public store tests for extending by one element and across holes, defining an in-range hole, replacing an existing index, and a rejected definition. Verify tracked length and key-set readers, untouched-index precision, version count, and complete undo/redo restoration. Existing array-definition coverage exercises the explicit `length` key (`__tests__/Engine/Store/Tracking/WriteProxyArrayPrecision.test.ts:390-469`), while the extension coverage uses ordinary assignment/push. No performance improvement is claimed.

### R10-03 - P1 - The computed hook discards a delivered change with a stable result reference

**Mechanism.** The engine intentionally announces a same-reference exotic result after a dependency moves (`lib/src/Carburetor/Derived/announceIsUnchanged.ts:33-39`; `lib/src/Carburetor/Derived/Computed.ts:547-556`). However, `useComputedValue` supplies `computed.get()` itself as the `useSyncExternalStore` snapshot (`lib/src/Interop/useComputedValue.ts:17-19`). A Map mutated in place, or a stable envelope containing it, therefore keeps the same snapshot identity across a legitimate notification. React's snapshot equality check can suppress the render even though the engine has announced a new version. This is a bridge defect, not a reopening of the older computed notification repair.

**Observed bounded probe and remaining inference.** For `computed(read => read(store).index)`, mutating `index.set('a', 2)` through draft produced one computed callback and version `1`, while `Object.is(before, computed.get())` stayed `true`; the current value was `2`. The hook's identical snapshot and missing version wrapper follow directly from its source. Stale DOM output was not measured in this review. The existing exotic render regression uses class `useComputed` (`__tests__/Engine/Derived/Computed/ExoticResults.test.tsx:26-49`); the hook regression uses a primitive string (`__tests__/Engine/Tooling/Interop.test.tsx:267-288`).

**Action and regression plan.** Make the hook's React snapshot represent a computed publication, for example with a cached record carrying the source, publication version, and value. Repeated snapshot checks without a publication must return the same record. Define whether the returned value remains live or is detached; a version record fixes change detection, but does not make a previously returned Map immutable. Add rendered hook regressions for a direct Map, a stable envelope, Set/Date controls, equal primitives, unchanged snapshot checks, and swapping computed sources. Assert visible output, notification/version behavior, and cleanup. Benchmark primitive and object results before/after at 1, 100, and 1,000 hook consumers, recording React commits, snapshot calls, elapsed time, and allocation profiles so the repair does not introduce a fresh record per snapshot check.

### R10-04 - P2 - A structurally valid external computed cannot be a computed dependency

**Mechanism.** Public `IComputed<R>` requires `get` and the subscription surface; the reader explicitly accepts that interface (`lib/src/Carburetor/Models/Derived.ts:5-7,15-17`). Once the body returns, `recordVersions` casts every non-store dependency to the concrete `Computed` class and calls `Object.keys(inner.versions)` (`lib/src/Carburetor/Derived/Computed.ts:401-425`). The protected `versions` field is absent from the public contract. An adapter implementing every declared method therefore fails solely because it lacks an undocumented internal field.

**Observed bounded probe.** An external object implementing `getUID`, `getVersion`, `get`, `subscribe`, and `unsubscribe` returned `7` from `get`. Reading it in `new Computed(read => read(external) * 2).get()` threw `TypeError: Cannot convert undefined or null to object` during version recording.

**Action and regression plan.** Honor the interface by recording an external source's public version, while preserving native computed flattening through explicit internal metadata. Alternatively, deliberately narrow and document the accepted type; do not leave an interface-shaped parameter that fails on an undeclared field. Cover a minimal external implementation while unobserved and observed, changed source versions, nested native/external dependencies, and subscription cleanup. Keep native chain/diamond freshness regressions because flattening is what lets an unobserved native outer computed notice underlying store writes. No performance gain is claimed.

### R10-05 - P2 - A failed first subscription leaves an unreachable callback registered

**Mechanism.** `Computed.subscribe` inserts the callback before evaluating or observing dependencies (`lib/src/Carburetor/Derived/Computed.ts:136-151`). If the body throws, the insertion is not rolled back and the call never returns its generated id. `unsubscribe` releases upstream dependencies only when the subscriber map becomes empty (`:170-180`). The failed caller cannot perform normal cleanup, and a later successful subscription can turn that retained callback into an active observer.

**Observed bounded probe.** A first body evaluation deliberately threw from `subscribe(callback)` with no chosen id. The computed retained one subscriber. After allowing the body to succeed, a second subscription was added and its returned id unsubscribed; one subscriber still remained. A later source write invoked the callback from the failed first call once. This is an actual registration leak, distinct from the existing isolation of exceptions during delivery.

**Action and regression plan.** Make subscription setup exception-safe: restore the prior callback/registration if setup fails, remove a newly created registration, and release any upstream edges acquired solely by that failed setup. Preserve the thrown error and successful retry behavior. Add focused regressions for a throwing first body, a failure while attaching dependencies, and replacement of a known id, with assertions that cleanup leaves no callback or upstream observer. Existing `__tests__/Engine/Derived/Computed/ErrorIsolation.test.ts` concentrates on throws during established delivery/settlement. If measuring memory, repeat real failed setup/cleanup cycles and retain only the intended live sources; use subscriber/edge counts and retained-heap measurements, not a throughput claim.

### R10-06 - P2 - Cache replacement discards every unchanged entry view

**Mechanism.** The round 9 replacement hook correctly reconciles eviction bookkeeping, but it also clears `viewCache` unconditionally on every `setData` (`lib/src/Carburetor/Resource/Cache/ResourceCache.ts:69-79`). The next read of each surviving entry must allocate `{...stored, stale}` (`:147-167`), even when every field used by `isViewCurrent` is unchanged (`lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:291-299`). The cache explicitly describes those records as stable views for unchanged entries (`:38-39`). A no-op state replacement therefore loses identities that the normal read path already knows how to validate.

**Observed bounded probe and cost boundary.** Load one entry with infinite TTL, capture `getEntry('a')`, call `cache.setData(cache.getData())`, and read it again. The version and data value stay the same, but the view reference changes. For N already-cached, unchanged entries subsequently read after a replacement, this code creates N new view objects. Those new references can also invalidate memoized children when their parent next renders and passes the views as props. Clearing the cache does not itself notify those children; that render scenario and its cost are unmeasured.

**Action and regression plan.** Keep the round 9 ledger repair. Preserve surviving view records and use the existing freshness/field comparison to rebuild only views that actually differ; prune records for removed keys so retained memory remains bounded. Test no-op replacement, a new root retaining equal entry fields/data references, one changed entry, removed/re-added keys, and TTL transitions. Verify unchanged view identity and changed view contents independently of notifications. Add a memoized-child render regression driven by an actual parent update.

**Benchmark plan.** Warm 100, 1,000, and 4,000 settled entries with infinite TTL/capacity, then compare same-root replacement, a new root sharing the entries, and one-entry replacement. Re-read the entries after each operation. Record changed view identities, React child renders where applicable, elapsed time, and allocated bytes from an allocation profile. Distinguish mandatory replacement/diff bookkeeping from view recreation. Report retained heap separately; it does not measure allocations. No speedup, render reduction, or lower allocation was measured here.

## Acceptance order

1. Regress and repair R10-01 and R10-02 together at the write-definition boundary, then verify full history round trips and notification precision.
2. Repair R10-03 with a real React hook regression and the snapshot-allocation benchmark. Preserve the engine's already-correct same-reference exotic announcement.
3. Resolve R10-04's extension contract and R10-05's failed-registration cleanup with focused computed tests.
4. Measure and implement R10-06 without undoing round 9's eviction reconciliation, request re-entry, or bulk-operation repairs.

The bounded probes establish five engine/API outcomes and the same-reference computed publication used by R10-03. They are not substitutes for the proposed regression suites or benchmarks. All six findings remain open at the reviewed revision; no source fix or empirical performance improvement is claimed by this report.
