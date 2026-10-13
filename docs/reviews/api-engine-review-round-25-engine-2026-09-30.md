# Independent API and engine review, round 25 — engine — 2026-09-30

**Target and method.** Independently reviewed the isolated `cycle-review-r25-engine-xs` tree at frozen product revision `b8d4a6c086829f7af7797e55a6455bbedb09b954`. Traced the public contract and implementation across tracking and ownership, native receiver/alias reads, path indexing, structural writes and restore, observer/wave/computed delivery, privately owned history, resource and cache replay, and copied-module boundaries. Exercised bounded actual public consumers with Bun 1.4.2 against this tree's TypeScript source and Node 24.12.0 against its supplied copied `dist/cjs` and `dist/esm` artifacts. The distributed `dist` is ignored and was not generated here. No product file, test, build, lint, formatter, benchmark or synthetic load was changed or run; this report is the only change.

**Verdict: P0=0, P1=0, P2=1, P3=0. Engine is not at zero.** The R24 already-correct readonly-status assignment is guarded in `ResourceCarburetor.restore`; this review did not rerun the user's passing R24 control. The independent remaining failure is an assignment that **really must change** a readonly status or refreshing flag while normalizing a newly owned resource/cache replay endpoint. The two concrete manifestations below are one underlying graph-installation defect, counted once.

## R25-ENG-01 — pending/refreshing normalization throws on a supported readonly owned replay endpoint (P2)

**Contract and source locations.** `README.md:647-655,656-688,924-934` promises Pending-to-Idle restore, complete resource-wire history, and privately owned replay retaining enumerable readonly descriptors, including value-changing admitted replacements; `README.md:903-911` accepts own enumerable data fields rather than rejecting them just because they are readonly. `README.md:564-568` explicitly permits cache `setData` replacement. `lib/src/Carburetor/Resource/ResourceCarburetor.ts:170-189` normalizes Pending and assigns `data.status = status` at line **188** when it differs. `lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:82-110` assigns `entry.refreshing = false` at line **90** and `entry.status = status` at line **93** on an owned replay. The parent `Carburetor.setData` admits and publishes the replacement (`Store/Carburetor.ts:157-182`); `Tooling/Graph/ownHistoryGraph.ts:51-76` retains supported readonly data descriptors on the privately owned capture; `Tooling/CarburetorHistory.ts:413-436,450-491` makes this an owned snapshot replay through `restore`, whose failed pre-installation cursor is kept retryable by `:169-185,203-217`. None of these paths is an unsupported symbol, accessor, nonenumerable field, raw `getData()` mutation, or metadata-only notification.

**Resource source repro** — run with `bun -e` from this tree (the entry is an actual `.ts` public source import):

```ts
import {ResourceCarburetor, CarburetorHistory, diagnostics} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
const resource = new ResourceCarburetor(async () => 7);
const history = new CarburetorHistory(resource);
const pending = {status: 'pending', data: undefined, error: undefined, updatedAt: 1};
Object.defineProperty(pending, 'status', {
    value: 'pending', writable: false, enumerable: true, configurable: false,
});
resource.setData(pending);
const undo = history.undo();
let redo;
try { redo = history.redo(); } catch (error) { redo = (error as Error).constructor.name; }
console.log({undo, redo, status: resource.getData().status,
    canUndo: history.canUndo(), canRedo: history.canRedo()});
```

Observed Bun source: `undo:true, redo:'TypeError', status:'idle', canUndo:false, canRedo:true`; the first accepted Pending replacement was published at version `1`, then undo moved to Idle at version `2`, but redo could not install its new owned endpoint. Independently confirmed with Node using the supplied packed CJS public `ResourceCarburetor` and `CarburetorHistory`: `redo-throw TypeError`, final `status:'idle', canUndo:false, canRedo:true`. **Expected:** `redo:true`, restored `updatedAt:1`, normalized `status:'idle'` with captured `writable:false, configurable:false` flags, and `canUndo:true, canRedo:false`. A canceled Pending state must not be resurrected as a nonexistent live request; normalizing to Idle is correct, but writing through the readonly captured descriptor is not.

**Cache manifestation, encoded key and complete public entry.** This uses `cache.keyOf('a')`, not a forged internal cache key, and the exported `getInitialCacheEntry()` shape. On Bun source, `new ResourceCache(async () => 7)` plus an attached `CarburetorHistory`, then `entry = {...getInitialCacheEntry(), status:'pending', updatedAt:1}` with readonly, non-configurable enumerable `status:'pending'`, then `cache.setData({entries:{[cache.keyOf('a')]:entry}})`, `undo()`, `redo()` yielded `undo:true`, `redo:'TypeError'`, no restored entry, `canUndo:false, canRedo:true`. Node's **mixed** supplied CJS-cache/ESM-history consumer yielded the same outputs (`key:'"a"'`); its expected duplicate-copy development warnings were not the exception. A second, independent source control used an accepted `Success` cache entry with `refreshing:true` defined readonly/non-configurable: redo again threw `TypeError` at the first normalization assignment while the entry remained absent. This proves the issue is not limited to Pending or to status. These are bounded `setData` consumers, not simulated requests or fake loader executions.

```ts
import {
    ResourceCache, CarburetorHistory, getInitialCacheEntry, diagnostics,
} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
const cache = new ResourceCache(async () => 7);
const history = new CarburetorHistory(cache);
const key = cache.keyOf('a');
const entry = {...getInitialCacheEntry(), status: 'pending', updatedAt: 1};
Object.defineProperty(entry, 'status', {
    value: 'pending', writable: false, configurable: false, enumerable: true,
});
cache.setData({entries: {[key]: entry}});
const undo = history.undo();
let redo;
try { redo = history.redo(); } catch (error) { redo = (error as Error).constructor.name; }
console.log({undo, redo, keys: Object.keys(cache.getData().entries),
    canUndo: history.canUndo(), canRedo: history.canRedo()});
```

**Mechanism and remedy.** History rightly copies both ends and requests owned replay so restrictions/native backlinks survive. Resource and cache restore then normalize by *mutating that already completed owned graph*. When the normalized value differs, JavaScript rejects assignment to its retained readonly descriptor before the parent `setData` can publish. The cursor remains positioned for retry, rather than lying about successful redo, but a valid operation cannot be redone. Construct the normalized **fresh owned endpoint** with its final status/refreshing values while preserving descriptor flags, native/plain aliases and backlinks, before installing immutable descriptors; do not mutate the held snapshot or fall back to ordinary `deepClone` that erases the owned topology. Keep the cheap already-equal skip and ordinary public-snapshot normalization. This report does not claim restoration of a running request or change the contract that Pending restores as Idle.

## Independent breadth and bounded controls

- **Full tracking/read sets/native identity.** Inspected `Store/Carburetor.ts:79-85,136-183,273-351,353-385,397-568`, `Tracking/createReadProxy.ts:240-382`, `createWriteProxy.ts:178-328,338-467`, proxy cache/live views, `Aliases/NativeAliasIndex.ts:4-32`, `NativeAliasReads.ts:14-56`, escaped path markers, `SubscriberIndex.ts:76-193,246-261,346-448`, `WriteLog`, and the selection detach/refile runner. Source controls: conditional `flag ? a.x : b.x` ignored an unrelated initial `b` edit, then followed the switched `b` path (`[4,6,8]` on subsequent edits); literal `'x.y'` was independent of nested `x.y` (`[11]` only on its own write); a reentrant subscriber replacing another subscriber's stable id skipped its stale generation, then delivered to the new registration (`['a','a','new']`). A native Map exposing the same raw member through `left` woke a Map-result watch on `left.x=2`, not on unrelated `right.x`, and a later root replacement refetched its member (`[2,6]`). These controls use public `watch`/`subscribe`, not direct index APIs.
- **Structural arrays, order, producer clones, preflight.** Traced `Tracking/Proxy/writeArrayLength.ts:21-127`, `clonePatchValue.ts:9-27`, `deliverPatches`, `Paths/Diff/diffPaths.ts:38-148,178-207`, `applyDiff.ts:94-151,153-234`, `installPatch.ts:18-42`, `Tooling/Graph/canInstallOwnedPatch.ts:11-52,67-103`, and key-order replay logic. An ordinary object deletion/undo/redo reported `['second'] → ['first','second'] → ['second']` and three matching enumeration-watch changes; a sparse `[1,,3]` survived writable-length lock/undo/redo (`false → true → false`, hole at index 1 intact). A genuine refused `length=0` on `[0,1,2,3]` with nonconfigurable index 1 still removed indices 2 and 3, published effective length 2/version 1 with watch notification, and remained undoable to length 4. This is the actual native partial mutation, not a fabricated error.
- **Wave, patch observers, computeds.** Reviewed `Transaction/PatchObserverRegistry.ts:30-52,62-162`, `UpdateBatch.ts:27-107`, `Scheduling/UpdateWave.ts:19-95`, `ComponentUpdateThrottle.ts:53-179`, `Derived/Computed.ts:144-229,231-399,415-572` and flattened leaf-version/drift helpers. Two stores moved from 1+2 to 3+4 inside a public `transaction`; a subscribed `computed` sum delivered exactly `[7]`, with computed version 1. A later scalar update with two independent histories and an attached patch-only observer throwing **`undefined`** propagated the thrown value yet advanced store version, delivered the computed's next result `[7,9]`, and left both histories undoable. Observer failure was not misclassified as a no-op; these controls do not stand in for concurrent React/browser proof.
- **Ownership, pending/cursors, replay and mixed formats.** Inspected `CarburetorHistory.ts:112-138,157-240,244-510`, `Graph/ownHistoryGraph.ts:10-80`, `sameHistoryGraph.ts:11-62`, resource request cancellation/key restoration (`ResourceCarburetor.ts:95-198,256-509`), cache restore/eviction/failure reconciliation (`ResourceCacheLifecycle.ts:64-110`, `ResourceCache.ts:75-149,153-236`), and epoch/native shared-singleton paths. A Node copied-runtime CJS store paired with an ESM history used `draft.map.set(draft.key,'two')`: raw Map size stayed 1, `map.has(getData().key)===true`, undo yielded `'one'`, redo yielded `'two'`, while development duplicate-module warnings were diagnostic only. The readonly Pending and refreshing controls above isolate the one uncured path from the already-correct-status fix, without repeating the withdrawn R22/R23 findings.

**Limits.** One reproducible supported-path finding; not a claim of exhaustive graph permutations, native subclasses/accessors, synthetic request pressure, UI render behavior or all browser environments. No tests/suites, build, typecheck, lint, formatter, benchmark or performance measurement were run here; parent owns those gates. Ordinary metadata-only plain-field descriptor changes, unsupported state shapes, and user raw-data mutation were not counted as defects.
