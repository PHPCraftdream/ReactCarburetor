# Independent public API / engine review — round 28 API — 2026-10-01

## Verdict and provenance

Independently reviewed the assigned isolated `cycle-review-r28-api-xs` checkout of **`64a5d23ad275056b8b306e91e04ae44271c93efe`**. This is a broad API/types/options, store, resource, derived, React and installed-format review, not a verdict inferred from prior rounds or validation gates. Read the actual declarations, implementation, README and resource/React documents, relevant existing behavioral coverage and the R27 API/engine findings. Bounded Bun 1.4.2 TypeScript-source and Node 24.12.0 already-built CJS/ESM development/production consumer probes were executed; none was a test-suite invocation.

**Accepted findings in this independent API review: P0 = 0; P1 = 0; P2 = 0; P3 = 0.** No new supported-path defect was established. This is not a claim of exhaustive correctness, nor the combined verdict: the independent engine reviewer and main integrator must account for their own evidence.

| Severity | Count | Accepted findings |
| --- | ---: | --- |
| P0 | 0 | None. |
| P1 | 0 | None. |
| P2 | 0 | None. |
| P3 | 0 | None. |

## Independent coverage and contract boundaries

- **Public API, types, options and package conditions.** Compared `lib/src/Carburetor/index.ts`, `Models/{Base,Store,Resource,Derived,Tooling}.ts`, `Interop/{index,Models,useCarburetorValue,useComputedValue}.ts`, `package.json` conditional root/interop/lint exports and supplied `dist/esm/Carburetor/index.d.mts` against `README.md:56-101,839-949`, `docs/react-compatibility.md`, `docs/promise-cache.md` and `__tests__/Engine/Store/publicApi.test.ts`. Inspected store and subscription shapes, resource loader/TTL/capacity/scheduler/history/persist/devtools option contracts, `react`/optional `@types/react` peer range, core/interop client boundaries and ESM/CJS normal/production entrypoints. The supplied distribution was not rebuilt; no declaration typecheck or installer/packer was run.
- **Store, subscriptions and history.** Read `Store/Carburetor.ts:39-569`, `Store/Tracking/{createReadProxy,createWriteProxy,watchSelection}.ts`, `Store/Paths/{SubscriberIndex,Diff/diffPaths,Diff/applyDiff}.ts`, `Store/Transaction/{transaction,UpdateBatch,PatchObserverRegistry}.ts`, `Store/Scheduling/{ComponentUpdateThrottle,UpdateWave}.ts`, `Store/Utils/{deepClone,Graph/cloneOwnedGraph}.ts`, `Derived/Computed.ts`, `Tooling/{CarburetorHistory,persist,waitForUpdate,connectDevTools}.ts` and representative snapshot/public API/native history tests. Checked read-set precision/conditional branches, store identity/replacement, draft versus raw writes, transactions, throttled delivery, derived recomputation, baseline ownership and undo/redo, snapshot/restore/serialize/wire hydration, persistence disposal and scoped copies with real consumer paths. Ordinary descriptor-only metadata is not a leaf notification dependency. Public plain snapshots normalize flags and retain opaque leaves by reference; *owned history* preserves readonly/native descriptors and rejects unsupported mutable classes/native accessor endpoints. Direct draft writes to held readonly fields are not promised to succeed.
- **Resources and cache.** Read `Resource/{ResourceCarburetor,prepareSlotRequest,createAbortHandle}.ts`, `Resource/Cache/{ResourceCache,ResourceCacheLifecycle,EvictionLedger,encodeCacheKey}.ts`, `Cache/State/{prepareCacheRequest,buildCacheRestore,normalizeOwnedCacheReplay,abortCacheKey}.ts`, cache removal helpers, `Models/Resource.ts` and representative `ResourceCache/{Regressions/NativeAccessorOperations,History/ReadonlyRequestEviction,ReentrantLoads,ResourceCache}.test.ts` plus `docs/promise-cache.md`. Inspected join/key identity, raw failure ownership, suspend/revalidation and deferred notification, invalidation versus inflight settlement, cancellation/reentry, restore/Pending normalization, locked slot replacement, retention and LRU. R27's operational-only native accessor change was checked independently: an unrelated accessor on ordinary Map payload metadata neither executes nor prevents `load` or removal of a locked key, while attaching history still strictly rejects that graph. The ordinary Map/class runtime boundary must not be confused with strict history admission.
- **Class, scopes and hooks.** Read `Component/AntiHookComponent/{Foundation,Reads,Subscriptions,Effects}.tsx`, connection facade/selection equality/detachment, `Component/Scope/{CarburetorScope,CarburetorProvider,carburetorToken}.ts(x)`, `ScopedAntiHookComponent.tsx`, `Interop/useCarburetorValue.ts`, `Interop/useComputedValue.ts` and representative component lifecycle/effects/selection and hook comparator tests. Inspected render-attempt ownership/abandonment, commit read alignment, stale resource loads, effects and cleanup, persistent connections, scope hydration, hook snapshot detachment, comparator and changing read sets. Mounted a React **19.3.0** class + ESM hook in JSDOM and independently a scoped class with a selection and effect; these are DOM behavior checks, not actual Chromium/browser or React-18 proofs.

## Executed bounded consumer probes — exact commands and observed outputs

Commands below ran at the assigned worktree root. Outputs are controls and boundary checks, **not accepted bugs**. In particular the development mixed-format warning and the strict-history rejection below are expected.

**Operational native metadata / strict history boundary (Bun source):**

```sh
bun -e "import {ResourceCarburetor,ResourceCache,CarburetorHistory,getInitialCacheEntry,diagnostics} from './lib/src/Carburetor/index.ts';diagnostics.setEnabled(false);const map=new Map([['root',3]]);let getters=0;Object.defineProperty(map,'meta',{enumerable:true,get(){getters++;return 10}});const r=new ResourceCarburetor(async x=>'new-'+x);const state={status:'success',data:map,error:undefined,updatedAt:1};Object.defineProperty(state,'status',{value:'success',writable:false,enumerable:true,configurable:false});r.setData(state);await r.load('x');const c=new ResourceCache(async x=>'new-'+x);const a=c.keyOf('a'),b=c.keyOf('b');const entries={};Object.defineProperty(entries,a,{value:{...getInitialCacheEntry(),status:'success',data:1,updatedAt:1},enumerable:true,writable:false,configurable:false});entries[b]={...getInitialCacheEntry(),status:'success',data:map,updatedAt:1};c.setData({entries});c.forget('a');let strict;try{new CarburetorHistory(c)}catch(e){strict=e.message}console.log(JSON.stringify({resource:r.getData().data,cacheKeys:Object.keys(c.getData().entries),survivor:c.getData().entries[b].data.get('root'),getterCalls:getters,strict}));"
# {"resource":"new-x","cacheKeys":["\"b\""],"survivor":3,"getterCalls":0,"strict":"CarburetorHistory: cannot snapshot accessor property meta"}
```

**Cache deduplication, raw failure, explicit retry, refresh and capacity (Bun source):**

```sh
bun -e "import {ResourceCache,EResourceStatus,diagnostics} from './lib/src/Carburetor/index.ts';diagnostics.setEnabled(false);let attempts=0;const failure=new Error('initial');const c=new ResourceCache(async k=>{attempts++;if(attempts===1)throw failure;return k+':'+attempts},{ttl:Infinity,maxEntries:1});const a=c.load('a'),same=c.load('a');await Promise.all([a,same]);let caught;try{c.suspend('a')}catch(e){caught=e===failure}c.invalidate('a');let thrown;try{c.suspend('a')}catch(e){thrown=e}await thrown;const old=c.suspend('a');await c.refresh('a');const refreshed=c.getEntry('a');c.abortAll();await c.load('b');console.log(JSON.stringify({sameRequest:a===same,caught,status:c.getEntry('a').status,old,refreshed:refreshed.data,failed:refreshed.failed,attempts,keys:Object.keys(c.getData().entries)}));"
# {"sameRequest":true,"caught":true,"status":"idle","old":"a:2","refreshed":"a:3","failed":false,"attempts":4,"keys":["\"b\""]}
```

**Snapshot, restoration and resource wire key (Bun source):**

```sh
bun -e "import {Carburetor,ResourceCarburetor,diagnostics} from './lib/src/Carburetor/index.ts';diagnostics.setEnabled(false);const raw=new Map([['k',2]]);class S extends Carburetor{put(n){this.update(d=>{d.row.n=n})}}const s=new S({row:{n:1},raw});const snap=s.snapshot();s.put(4);s.restore(snap);let calls=0;const r=new ResourceCarburetor(async k=>{calls++;return 'loaded:'+k});await r.load('a');const wire=r.serialize();await r.load('b');r.fromJSON(JSON.parse(wire));const replay=r.suspend('a');let pending;try{r.suspend('c')}catch(e){pending=e instanceof Promise}await r.load('c');console.log(JSON.stringify({restored:s.getData().row.n,snapshotRow:snap.row.n,plainDetached:snap.row!==s.getData().row,opaqueShared:snap.raw===raw,wire:JSON.parse(wire),replay,pending,calls}));"
# {"restored":1,"snapshotRow":1,"plainDetached":true,"opaqueShared":true,"wire":{"status":"success","data":"loaded:a","updatedAt":1790816901465,"key":"\"a\""},"replay":"loaded:a","pending":true,"calls":3}
```

`updatedAt` above is the **actual observed** wall-clock value, not a stable assertion.

**Mixed production CJS/ESM public entry and interop contracts (already-built Node distributions):**

```sh
node --conditions=production --input-type=module -e "import * as esm from 'react-carburetor';import * as interop from 'react-carburetor/interop';import {createRequire} from 'node:module';const require=createRequire(import.meta.url),cjs=require('react-carburetor'),hooks=require('react-carburetor/interop');const e=new cjs.ResourceCarburetor(async x=>x+2);await e.load(2);const h=new esm.CarburetorHistory(e);await e.load(4);const changed=e.suspend(4);const one=h.undo(),two=h.undo(),restored=e.suspend(2);console.log(JSON.stringify({esm:typeof esm.Carburetor,cjs:typeof cjs.Carburetor,interopEsm:typeof interop.useCarburetorValue,interopCjs:typeof hooks.useComputedValue,changed,one,two,restored,redo:h.canRedo(),key:esm.encodeCacheKey('a.b')}));h.disconnect();"
# {"esm":"function","cjs":"function","interopEsm":"function","interopCjs":"function","changed":6,"one":true,"two":true,"restored":4,"redo":true,"key":"\"a~1b\""}
```

Additional executed checks: a Bun transaction/conditional `watch`/two-source computed/throttled history/persist/scope hydration probe produced `sums:[9]`, `branches:[4,1,7,1,7]`, `undo:true`, `redo:true`, persisted `{"n":5}` in one storage write and independent hydrated scope `n:8` while wire stayed `n:5`. The operational native-metadata probe above also exercised restart from a readonly resource status and strict history rejection without calling the native metadata getter. In React 19.3.0 JSDOM, the CJS class plus ESM interop hook mounted as `<i>1</i><b>1</b>`, updated to `<i>2</i><b>2</b>`, then unmounted to an empty container; the expected development mixed-copy `liveViews` diagnostic printed once. An independent CJS scoped class with `connectSelection` and an effect mounted `<p>1</p>`, updated to `<p>2</p>`, and recorded `['start','stop']` across mount/unmount. No temporary probe files were created.

## Limits and disposition

No supported defect meeting the public-contract, precise-source-location and reproducible consumer-evidence threshold emerged from these bounded checks. In particular strict *history* rejection of native accessors is intentional, not a request/eviction bug, and metadata introspection on ordinary plain fields is not promised a leaf subscription. A zero slice verdict cannot establish the absence of untested concurrency schedules, every graph topology, alternate storage/devtools hosts, React 18/floor Node execution, browser layout or every package manager resolution. No source, test, dependency, copied `dist`, earlier report or protected file was changed. No suite/scoped test, build, typecheck, lint, formatter, benchmark, pack/install or actual Chromium run occurred in this tree; those integrated checks belong to the parent. Only this report belongs in the reviewer commit.
