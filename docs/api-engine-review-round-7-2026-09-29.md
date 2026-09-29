# API and engine review, round 7 — 2026-09-29

Scope: the JavaScript/TypeScript API and engine at `6718c14`, including the current uncommitted source edit in `createWriteProxy.ts`. This was an independent source review. Prior review reports were checked for already resolved or previously recorded findings. All findings below are **code-derived**: no test, benchmark, runtime probe, build, or profiler was run, and no throughput or allocation improvement is claimed.

## Findings

### R7-01 — P1 — Removing one read path drops a still-needed ancestor subscription

`SubscriberIndex` stores a branch bucket as an id or a set of ids, without a per-id count (`lib/src/Carburetor/Store/Paths/SubscriberIndex.ts:11-16,40-54`). Filing both `a.b` and `a.c` registers the same id under ancestor `a` twice, but the bucket represents it once (`:245-248,291-313`). On re-registration from `{a.b, a.c}` to `{a.c}`, `add()` unfiles `a.b` (`:75-103`), and `unfile()` removes the id from `branch[a]` (`:258-261,321-348`). It does not check that `a.c` still needs that ancestor. A subsequent write to `a` consults `branch[a]` and misses the subscriber (`:168-193`). The remaining direct leaf read `a.c` still matches a write to `a.c`, which masks the fault in narrow tests.

This can leave a conditionally re-registered component or `watch()` selector stale when an entire parent branch is replaced. It can also make `hasReaderAt('a')` report false for an actual descendant reader (`:203-205`), which matters to cache retention. The existing one-path-removal test asserts an unchanged leaf match but not an ancestor match (`__tests__/Engine/Store/Paths/subscriberIndex.test.ts:319-340`).

Fix: track whether each `(ancestor, id)` is still used by another read path when applying a delta. Preserve the inexpensive single-id bucket where possible. Add direct index and public `subscribe()`/`watch()` regressions for removing one sibling, then replacing their parent; include `hasReaderAt` and a cache-retention case. Benchmark repeated re-registration with many sibling reads before choosing the bookkeeping representation.

### R7-02 — P1 — An invalid negative-infinity array length hangs before JavaScript can reject it

The write proxy enters its truncation loop for any numeric `raw < previous`, before calling `Reflect.set` (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:279-323`). For `draft.items.length = -Infinity`, `removed` starts at `-Infinity`; `removed++` remains `-Infinity`, so the loop never terminates. JavaScript array assignment would reject this length with a `RangeError`, but that operation is never reached. A finite negative or fractional length also records paths and patches before the underlying assignment rejects it. `update()` publishes the recorded writes in its `finally` block after a mutation throws (`lib/src/Carburetor/Store/Carburetor.ts:468-485`).

Fix: validate or normalize the proposed array length before attribution, and ensure a rejected write records nothing. Preserve native behavior for valid lengths and document the treatment of non-number JavaScript callers. Add regressions for `-Infinity`, negative, fractional, and valid sparse truncation; assert exception, unchanged state/version, and no notification for invalid values. The nonterminating case must be guarded in a bounded test runner, not exercised without a timeout.

### R7-03 — P2 — Sparse array work scales with logical length rather than stored elements

Three paths iterate holes: `deepClone()` loops from zero to `length` (`lib/src/Carburetor/Store/Utils/deepClone.ts:20-29`), the development state validator does the same (`lib/src/Carburetor/Store/Tracking/AliasLedger.ts:75-103`), and direct length shrink enumerates every removed *position* and records it even when no property existed (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:272-294`). Thus a sparse array with a very large `length` and a few own indices can make `snapshot()`, validation, or one truncation perform work proportional to the hole count. The truncation also allocates paths and can wake readers of absent indices that did not change. Existing sparse-array tests use only short arrays (`__tests__/Engine/Store/Snapshot.test.ts:150-159`); length-write tests cover populated arrays (`__tests__/Engine/Store/Tracking/WriteProxyArrayPrecision.test.ts:161-209`).

Fix: consider enumerating own numeric keys for sparse arrays, preserving holes, `length`, key-set notifications, and the established array state model. Measure dense and sparse arrays separately before adopting a representation or an adaptive threshold. Regressions should cover a long sparse tail, a present index removed by truncation, absent-index readers, snapshots, and restore; a benchmark should report time and allocations for both shapes against this baseline.

### R7-04 — P3 — A valid caller-chosen subscription id can become the object prototype

`ISubscribeOptions.id` accepts a caller-chosen string without a restricted alphabet (`lib/src/Carburetor/Models/Store.ts:22-28`). The store keeps subscriber records in `{}` (`lib/src/Carburetor/Store/Carburetor.ts:73-75`) and writes them by `this.subscribers[id] = ...` (`:274-288`). For `id: '__proto__'`, assignment changes that dictionary's prototype to the record. `unsubscribe()` uses `id in this.subscribers` and `delete this.subscribers[id]` (`:312-318`), neither of which removes the inherited record, so the callback remains retained after unsubscription. Prototype names also make the membership test claim an unsubscribed id exists.

Fix: use a null-prototype subscriber dictionary (or a `Map`) and own-key membership checks. Add a public API regression for `__proto__` and `constructor` ids, including cleanup and subsequent delivery. This is a contract and retention issue; no performance gain is claimed.

## Priority and measurement plan

1. Fix R7-01 and R7-02 first: both can violate update delivery or terminate progress. Run focused regressions for their public entry points as well as the internal index/proxy.
2. Fix R7-03 with a before/after benchmark on sparse and dense arrays, including allocation and elapsed-time measurements. Keep the dense path if enumeration regresses it; report both results even if the optimization is rejected.
3. Fix R7-04 and verify subscriber cleanup. For R7-01's bookkeeping change, benchmark registration, re-registration, removal, and retained bytes per subscriber so the correctness repair does not silently erase the index's gains.

No P0 finding was established by this source review. R7-01 through R7-04 remain open P1–P3 findings at the reviewed state. This report is not an empirical performance result; every complexity statement follows from the cited loops or data structures, and every proposed benchmark is future verification work.
