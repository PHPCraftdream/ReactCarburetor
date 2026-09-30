# Independent API and engine review, round 26 — engine — 2026-10-01

**Target and method.** Independently inspected the isolated `cycle-review-r26-engine-xs` tree at frozen product revision `89ad8f5de16fce7848485bab7027bb548781a845`. Followed the documented public engine contract through full tracking/read-set filing, native receiver and raw identity, structural arrays/order/producer copies/preflight, waves/subscribers/Computed, owned history and cursors, resource/cache wire state, and source-versus-copied-module boundaries. Ran bounded actual public-consumer probes with Bun 1.4.2 on `lib/src/Carburetor/index.ts` and Node 24.12.0 on the supplied copied `dist/cjs`, `dist/esm`, `dist/cjs-prod`, and `dist/esm-prod` runtime; `dist` is ignored and was not generated here. No product code, tests, build, typecheck, lint, formatter, benchmark, synthetic load, or push was performed. This report is the sole change.

**Verdict: P0=0, P1=0, P2=2, P3=0. Engine is not at zero.** Both findings use normal public cache operations on a supported, own enumerable readonly data endpoint. Neither depends on arbitrary raw-data mutation, unsupported accessor/non-enumerable state, descriptor-only notifications, or a fabricated cache key. The R25 readonly Pending/refreshing *history replay* defect itself is fixed in both source and supplied copied runtimes; the failures below are different cache lifecycle paths.

## R26-ENG-01 — accepted non-configurable cache slot makes normal eviction throw after publishing a new request (P2)

**Contract and exact sites.** `README.md:564-569` documents `setData` entry replacement and bounded, LRU removal of unretained entries; `:656-694` documents complete owned/restrictive cache replay and transient normalization. An own enumerable readonly cache dictionary slot is accepted by `Carburetor.setData` (`lib/src/Carburetor/Store/Carburetor.ts:157-183`), and the current replay normalization explicitly handles that slot (`lib/src/Carburetor/Resource/Cache/State/normalizeOwnedCacheReplay.ts:19-23,41-68,95-105`). `ResourceCacheLifecycle.fetch` starts and publishes the new request at `:424-470`, then calls `evict` at `:470`; `evict` selects victims and decrements the ledger *before* attempting `delete draft.entries[key]` at `ResourceCacheLifecycle.ts:301-329`. `EvictionLedger.ts:129-149` performs that early count/order change, while `createWriteProxy.ts:431-467` forwards the refused delete to `Reflect.deleteProperty` at line 446. Explicit `forgetKey` likewise removes bookkeeping before its fallible delete at `ResourceCacheLifecycle.ts:258-279`.

**Bounded public repro** (run with `bun -e` in this tree; body imports the actual source entry):

```js
import {ResourceCache, getInitialCacheEntry, diagnostics} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
const cache = new ResourceCache(async key => 'value-' + key, {maxEntries: 1, ttl: Infinity});
const a = cache.keyOf('a');
const entries = {};
Object.defineProperty(entries, a, {
    value: {...getInitialCacheEntry(), status: 'success', data: 'prior', updatedAt: Date.now()},
    writable: false, configurable: false, enumerable: true,
});
cache.setData({entries});
let failure;
try { cache.load('b'); } catch (error) { failure = error.constructor.name + ': ' + error.message; }
await Promise.resolve(); await Promise.resolve();
console.log({failure, keys: Object.keys(cache.getData().entries),
    a: cache.getEntry('a').data, b: cache.getEntry('b').data,
    status: cache.getEntry('b').status, version: cache.getVersion()});
```

**Actual source:** `failure:'TypeError: Unable to delete property.'`, `keys:['"a"','"b"']`, `a:'prior'`, `b:'value-b'`, `status:'success'`, `version:3`. Node on the supplied development CJS public entry independently returned `TypeError: 'deleteProperty' on proxy: trap returned falsish for property '\"a\"'`, with both entries still present and `b:'success'`. The expected public behavior is not a synchronous throw from starting an unrelated request after its Pending notification has already been published; eviction must either safely replace the dictionary/root while preserving supported history and live entries, or treat a non-deletable slot as retained and keep the ledger truthful. It must not claim removal before native deletion succeeds. An independent source `cache.forget('a')` on the same supported slot returned `TypeError` while leaving `a` present and the version unchanged; after that refusal, a successful `load('b')` left both entries despite `maxEntries:1`. This shows the same premature bookkeeping problem for explicit deletion, not a second counted defect. **Cause:** capacity and explicit-removal bookkeeping commits ahead of the draft's legally rejectable delete; `fetch` exposes eviction's throw even though its new request and subsequent answer have landed. **Remedy:** preflight the slot's deletion capability and defer bookkeeping commit until actual deletion, with a deliberate supported strategy for a non-deletable slot (owned root replacement or pinned/capacity exception), including `forget` and bulk paths; preserve effective publications, request ownership and history attribution.

## R26-ENG-02 — refused readonly loading transition leaves an unreachable never-settling cache request (P2)

**Contract and exact sites.** A complete cache entry from exported `getInitialCacheEntry()` with a readonly own enumerable `status` is admitted by `setData` and retained by owned history; consumers may call the documented `ResourceCache.load(args)` (`README.md:520-576,907-915`). A native draft refusal for a non-writable field is legitimate, but failure before starting the loader must not register a joinable request which can never resolve. `ResourceCacheLifecycle.ts:424-445` installs `controllers` and `requests` at **439-440** before calling the fallible `markLoading` at **445**; `markLoading` sets `draft.entries[key].status` at **488**, and the write trap refuses the readonly property (`createWriteProxy.ts:227-268`). `fetch` has no cleanup/rejection on this thrown path; its new request Promise is unreachable to the first caller, while a later call returns it at `ResourceCacheLifecycle.ts:425-429`.

**Bounded public repro** (Bun source; no loader result is needed):

```js
import {ResourceCache, getInitialCacheEntry, diagnostics} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
let calls = 0;
const cache = new ResourceCache(async () => { calls++; return 7; });
const key = cache.keyOf('a');
const entry = {...getInitialCacheEntry(), status: 'idle'};
Object.defineProperty(entry, 'status', {
    value: 'idle', writable: false, configurable: false, enumerable: true,
});
cache.setData({entries: {[key]: entry}});
let error;
try { cache.load('a'); } catch (caught) { error = caught.constructor.name; }
const second = cache.load('a');
const state = await Promise.race([
    second.then(() => 'resolved', () => 'rejected'), Promise.resolve('still-pending'),
]);
console.log({error, state, calls, status: cache.getData().entries[key].status,
    version: cache.getVersion()});
```

**Actual:** Bun source and independently Node copied development CJS both returned `{error:'TypeError', state:'still-pending', calls:0, status:'idle', version:1}`. The second call joins the stored unresolved Promise; no loader was called, and there is no `resolveRequest`/`rejectRequest` path left to run for it. **Expected:** either a correctly handled replacement/loading transition or a refusal that leaves no joinable request and rejects/cleans up its created Promise; later callers must not be stranded indefinitely. **Cause:** request ownership is installed before a fallible draft transition without a failure unwind. **Remedy:** reconcile or reject the newly created request and remove only its own controller/request pair when `markLoading` throws (guard against reentrant replacements); preserve already-applied write publication where applicable. Do not silently swallow the original refusal.

## Independent breadth, bounded controls and fixed R25 regression

- **Tracking, receiver identity and current graph.** Read `Store/Carburetor.ts:79-85,136-183,273-385,398-568`, `Tracking/createReadProxy.ts:240-382`, `createWriteProxy.ts:178-328,338-467`, `Tracking/Proxy/liveViews.ts:23-169,171-223`, `Aliases/NativeAliasIndex.ts:4-32`, `NativeAliasReads.ts:14-56`, `Paths/SubscriberIndex.ts:76-193,246-261,346-448`, and `Tracking/watchSelection.ts:9-43`. Bun public-source controls: conditional selector `pick ? a.x : b.x` ignored a write to the unselected branch and later followed the switched branch (`seen:[4,6]`); own literal `x.y` stayed separate from nested `x.y` (`literal:[11]`); Map `set(draft.key,'two')` retained one raw key and undo/redo recovered `'one'`/`'two'`. A tracked native `map.get('current').x` with an ordinary `item` alias delivered `[2,7,8]` on edit, root retarget and edit; the new Map member was identical to the new plain branch. This is bounded evidence, not an assertion of all proxy or alias topologies.
- **Arrays, order, descriptor and preflight.** Inspected `Tracking/Proxy/writeArrayLength.ts:21-127`, `clonePatchValue.ts:9-27`, `Paths/Diff/diffPaths.ts:38-148,178-207`, `applyDiff.ts:94-151,153-234`, `Tooling/Graph/canInstallOwnedPatch.ts:11-52,67-103`, and `Tooling/CarburetorHistory.ts:245-438`. Public-source order delete/undo/redo produced `[['two'],['one','two'],['two']]`, with enumeration watch `['two','one,two','two']`; a sparse `[1,,3]` retained its hole as its length lock went `[false,true,false]` through undo/redo. A refused native shrink of `[0,1,2,3]` with non-configurable index 1 threw `TypeError` but reported effective length 2, keys `['0','1']`, version 1 and undo availability. Readonly-branch admission, refusal preflight, scalar fast path and plain snapshot normalization were traced; no claim that descriptor-only metadata must notify.
- **Waves, subscribers, Computed, attribution.** Inspected `Transaction/UpdateBatch.ts:27-107`, `PatchObserverRegistry.ts:30-52,62-162`, `Scheduling/UpdateWave.ts:19-95`, `ComponentUpdateThrottle.ts:53-179`, `Derived/Computed.ts:144-229,231-399,415-572`, plus flattened leaf freshness. Two public stores changed from `1+2` to `3+4` inside `transaction`: one computed delivery `[7]`; a later write with two independent histories and a patch-only observer throwing **`undefined`** propagated that value, but the changed raw store reached 5/version 2, computed values became `[7,9]`, and both histories could undo. This checked error identity and applied-write attribution, not just absence of an exception.
- **Ownership, cursor, wire and normalization.** Inspected `Tooling/CarburetorHistory.ts:112-138,157-240,245-510`, `Store/Utils/Graph/cloneOwnedGraph.ts:14-90`, `Graph/sameHistoryGraph.ts:11-62`, `ResourceCarburetor.ts:95-219,323-453`, `ResourceCacheLifecycle.ts:65-108,294-597`, `ResourceCache.ts:75-149,153-236`, and `Cache/State/normalizeOwnedCacheReplay.ts:11-109`. Source controls with *actual* readonly non-configurable Pending resource/cache fields: undo/redo each returned true, resulting status Idle retained `writable:false`; a resource payload Map keyed by its own root stayed a backlink after normalization and no wire `key` leaked into live state. Cache Pending **and** refreshing readonly fields normalized to Idle/false while a Map keyed by its entry still resolved to the same newly owned entry; an ordinary payload `{status:'pending', refreshing:true}` stayed untouched. With a manual coalescing scheduler, clearing one of two histories after a deferred `x=1` left its own `canUndo:false` but the other `canUndo:true`; a later step undid to `x=1` and its redo stayed available. A real pending resource with a synchronous abort-listener `setData` during undo invalidated redo as a fresh branch, rather than stealing replay ownership.
- **Copied module boundary.** Node mixed development CJS-resource/ESM-history readonly Pending replay returned `undo:true, redo:true, status:'idle'`, retained its native root backlink and omitted live `key`; mixed CJS-store/ESM-history kept raw Map size 1 and values `'two' -> 'one' -> 'two'` across undo/redo. Mixed *production* ESM-cache/CJS-history normalized readonly Pending + refreshing to Idle/false, retained both readonly flags and a Map entry backlink, and returned `undo:true, redo:true`. Development's expected duplicate-copy warnings were diagnostic, not the observed eviction/request exceptions. These are the supplied copied artifacts, not a build from this review.

**Limits.** Two reproducible, distinct supported-path lifecycle defects, not a claim that every cache shape, native subclass, accessor, UI render, scheduler permutation, or browser environment has been proven. The tracked state-model exclusions, raw `getData()` mutation, ordinary descriptor-only publication, and deliberate native readonly draft refusal were not counted as findings on their own. No parent-owned suite, build, typecheck, lint, formatter, benchmark, or performance measurement was run in this worktree.
