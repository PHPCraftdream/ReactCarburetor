# Independent public API / engine review — round 26 API — 2026-10-01

## Verdict and provenance

Reviewed the isolated `cycle-review-r26-api-xs` checkout at frozen product revision **`89ad8f5de16fce7848485bab7027bb548781a845`**. This is an independent public API, engine, resource, React and package-consumer review, not a declaration based on the parent's validation matrix or an assumption that the round-25 normalization fix implies zero. I read the source and public contract and executed bounded Bun 1.4.2 actual-TypeScript-source and Node 24.12.0 copied-distribution consumers. Neither the ignored/copied `dist` nor dependencies were built or modified.

**Established findings in this slice: P0 = 0; P1 = 0; P2 = 1; P3 = 0. The API slice is not zero.** One supported request-restart defect has both single-slot and keyed-cache manifestations. Zero for another priority means no finding established in the paths reviewed, not proof of exhaustive correctness or a combined verdict for the independent engine reviewer and parent.

| Priority | Count | Finding |
| --- | ---: | --- |
| P0 | 0 | None established. |
| P1 | 0 | None established. |
| P2 | 1 | R26-API-01: a resource normalized from a valid readonly transient owned-history endpoint cannot start a new request; the keyed cache additionally retains a never-settling request after the synchronous refusal. |
| P3 | 0 | None established. |

## R26-API-01 — accepted restrictive transient replay becomes an unrequestable Idle entry (P2)

**Supported contract and exact source path.** `README.md:650-655,681-694` documents resource-wire history, Pending → Idle normalization, captured readonly descriptors, and preserved owned native topology. `README.md:907-915` admits own enumerable string-keyed data fields (there is no general prohibition on readonly *scalar* fields). The source explicitly states that after restoring a Pending slot, an explicit `load()/suspend()` with the right arguments fetches normally (`lib/src/Carburetor/Resource/ResourceCarburetor.ts:171-177`). Existing normal-Pending restoration tests make the same observable assertion for the slot (`__tests__/Engine/Resource/Resource/ResourceRestore.test.ts:84-109`) and cache (`__tests__/Engine/Resource/ResourceCache/Restore.test.ts:97-117`). Those tests do not restart a **restricted** normalized history endpoint. The round-26 fix correctly normalizes a captured nonconfigurable non-writable `status:'pending'` to `status:'idle'` while retaining that descriptor (`ResourceCarburetor.ts:178-209`; `Resource/Cache/State/normalizeOwnedCacheReplay.ts:19-57,73-93`), and history restores the owned endpoint (`Tooling/CarburetorHistory.ts:451-470`). A later request, however, takes the ordinary in-place write path: the slot installs request/controller/key bookkeeping before `this.draft.status = Pending` (`ResourceCarburetor.ts:376-423, especially 396-417`); the cache registers controller and promise *before* `markLoading` writes `draft.entries[key].status = Pending` (`ResourceCacheLifecycle.ts:424-450,475-500`). The locked, now-Idle status rejects the changed value via `Tracking/createWriteProxy.ts:227-268`. A similarly captured readonly `refreshing:true` normalized to `false` fails on `refresh()` at `ResourceCacheLifecycle.ts:490-492`. This is a value-changing accepted endpoint, **not** descriptor-only metadata notification or an unsupported accessor/class/symbol state.

**Minimal public reproduction**, executed from this worktree with `bun -e` importing `./lib/src/Carburetor/index.ts`; the same repro using the copied public Node CJS `require('react-carburetor')` gives the two synchronous `TypeError`s:

```js
import {
  ResourceCarburetor, ResourceCache, CarburetorHistory, getInitialCacheEntry,
} from './lib/src/Carburetor/index.ts';
const lock = (object, key) => Object.defineProperty(object, key, {
  value: 'pending', enumerable: true, configurable: false, writable: false,
});
let slotCalls = 0;
const slot = new ResourceCarburetor(async () => ++slotCalls);
const slotHistory = new CarburetorHistory(slot);
const state = {...slot.getData(), updatedAt: 7};
lock(state, 'status');
slot.setData(state);
slotHistory.undo();
slotHistory.redo();                         // true; status idle, still readonly
try { slot.load('new'); } catch (error) { console.log(error.name, slotCalls); } // TypeError 0

let cacheCalls = 0;
const cache = new ResourceCache(async () => ++cacheCalls);
const cacheHistory = new CarburetorHistory(cache);
const key = cache.keyOf('a');
const entry = {...getInitialCacheEntry(), updatedAt: 7};
lock(entry, 'status');
cache.setData({entries: {[key]: entry}});
cacheHistory.undo();
cacheHistory.redo();                        // true; entry status idle, still readonly
try { cache.load('a'); } catch (error) { console.log(error.name, cacheCalls); } // TypeError 0
const pending = cache.load('a');
try { cache.suspend('a'); } catch (error) { console.log(error === pending); } // true
```

**Observed / expected.** The bounded Bun source run logged `su:true,sr:true,slotError:TypeError,slotCalls:0,slotStatus:idle,slotVersion:3,cu:true,cr:true,cacheError:TypeError,cacheCalls:0,cacheStatus:idle,cacheVersion:3`. The copied Node development CJS run reported `TypeError` for both calls and both statuses `idle`; the copied `node --conditions=production` CJS run did too. A copied **mixed** CJS slot + ESM history also undid/redid successfully, preserved `status.writable === false`, then threw `TypeError` on `load` (the expected duplicate-copy development notices were diagnostic). In another Bun control, after the first cache refusal, `cache.load('a')` returned the exact Promise thrown by `cache.suspend('a')`; it remained unsettled after two microtasks, with zero loader calls and Idle state. This bounded observation is not a claim of an infinite timed run; its source cause is the retained `requests` map registration before the failed write. A separate owned Success entry with captured readonly `refreshing:true` normalized to `false` gave the same first-call `TypeError` and retained unstarted promise on `refresh('a')`, with loader calls zero. A writable Pending-restore path should instead genuinely start and settle on explicit request; preserving the existing captured descriptor in *history* must not make normal *later request transitions* impossible. A cache miss/hydrated Idle entry must not produce an indefinitely suspended reader after a failed request start.

**Remedy.** Preflight a requested resource transition against the effective stored descriptor **before** creating/advertising request bookkeeping. For a valid restrictive owned endpoint, prepare a new writable request-state graph/entry for the transitioning fields without losing supported native/plain aliases, current key/failure ownership, unaffected restrictive fields, subscriber paths, or the prior captured history endpoint; only then publish Pending/refreshing and invoke the loader. For cache requests, ensure every post-registration refusal settles/removes its registered promise/controller rather than leaving `suspend` awaiting work that never started. Do not weaken the readonly history capture merely to hide the failure, and do not claim a fetch occurred when its loader did not run.

## Independent review breadth and other bounded actual controls

- **Store/tracking/restore/history.** Traced `lib/src/Carburetor/index.ts:5-51`, `Models/{Base,Store,Paths,Resource}.ts`, `Store/Carburetor.ts:96-569`, `Tracking/{createReadProxy,createWriteProxy,watchSelection}.ts`, `Tracking/Aliases/{AliasLedger,NativeAliasIndex,NativeAliasReads}.ts`, `Paths/{SubscriberIndex,WriteLog,Diff/{diffPaths,applyDiff,installPatch,Order/*}}.ts`, `Transaction/{transaction,PatchObserverRegistry}.ts`, `Tooling/{CarburetorHistory,Graph/{sameHistoryGraph,canInstallOwnedPatch}}.ts`, and `Utils/{deepClone,Graph/cloneOwnedGraph}.ts`. Examined untracked `getData` versus tracked `read`, copied `subscribe` read sets and reentrant generations, conditional `watch` detachment/re-filing, effective draft paths and observer errors, array locks/order, preflighted restore and readonly refusals, patch versus complete-graph replay, multi-history ownership, native alias/root backlinks and serialization bridges. Bun source `watch(flag ? a.n : b.n)` reported `[[1,2],[2,10],[10,11],[11,12],[12,11],[11,12],[12,13]]` through branch switches, current/old-branch writes, edited-snapshot `restore`, undo/redo and a later transaction; old-branch write did not notify. An edited snapshot installed readonly `row.n:2→5` and sibling `other:4→7`, undo restored `row.n:2`, and a later direct draft write to the readonly `n` threw `TypeError`. An ordinary Map-key/Set-member alias survived owned undo/redo, with the Map value `one→two→one→two` and `map.has(current.key) && set.has(current.key)` true. These controls neither prove all interleavings nor excuse R26-API-01.
- **Computed, scopes and persistence.** Followed `Derived/Computed.ts`, its dependency/freshness helpers, `Component/Scope/{CarburetorScope,carburetorToken}.ts`, `Tooling/{persist,connectDevTools,waitForUpdate}.ts` and package type-erased bridge. A two-source subscribed computed emitted `[7,8]` for a transaction followed by one more write; independent hydrated named-token scopes held `7` and `6` while their original dehydration payload remained `6`. Coalesced `persist` disposal stored the latest snapshot after a write. DevTools extension, storage failures and arbitrary scheduler races were traced in code but not mounted as external consumers.
- **Resources and wire failures.** Reviewed `Resource/ResourceCarburetor.ts:75-530`, `Resource/Cache/{ResourceCache,ResourceCacheLifecycle,EvictionLedger,State/normalizeOwnedCacheReplay}.ts`, key escaping, public models, `README.md:470-581,647-695` and `docs/promise-cache.md:97-127`. Traced settle/abort supersession, serialized settled keys, Pending→Idle, only actual cache entries being normalized, reentrant live dictionary capability, TTL/invalidation/failed refresh, LRU retention and raw rejection identity. Bun actual source cache concurrent identical `load('a.b')` shared a promise, escaped the key as `"a~1b"`, explicit invalidation marked Success stale, `maxEntries:1` left only the newest unretained entry; synchronous Pending subscriber abort rejected with `AbortError` and ran zero loaders. Raw loader `Error('raw-r26')` was identical to slot `getLastError`/`suspend` and cache `getFailure`/`suspend`; restoring a slot's serialized Error key recreated a matching message. A complete native-linked replay containing two restrictive transient entries normalized only `status/refreshing`, retained false flags, Map backlinks to the new root, shared payload alias and own native descriptor. The reproduction above isolates what happens on the **next** request, outside that successful normalization itself.
- **Class, hooks, Suspense, SSR and formats.** Read `Component/AntiHookComponent/{Foundation,Reads,Subscriptions,Effects}.tsx`, `Connection/{declareConnection,ConnectionFacadeHandler,buildPersistentView,sameSelection,detachSelection}.ts`, scope/provider/scoped-class files, `Interop/{useCarburetorValue,useComputedValue}.ts`, `package.json:8-47`, and `docs/react-compatibility.md:9-82,115-152`. Inspected render-attempt-to-commit tracking, persistent `connect` source/root retarget and `connectSelection` detachment, readonly facade/refusal, hook selector read-set changes, Suspense request deferral and provider scope. Actual React 19.3/JSDOM mounted a copied CJS class `connect` plus `connectSelection` and copied ESM `useCarburetorValue` hook on one store: DOM frames `<i>1/1</i><b>1</b> → <i>2/2</i><b>2</b> → <i>8/8</i><b>8</b>`, ignored a write to the old source, then `<i>9/9</i><b>9</b>` on the new source; unmount cleared the root. An actual mounted Suspense boundary changed `<em>wait</em> → <span>ready</span>` on finite resolution. `renderToString` of a provider and scoped class produced `<strong>7</strong>` and dehydration `{"r26-ssr":{"n":7}}`. Copied production CJS/ESM resolution selected `dist/cjs-prod`/`dist/esm-prod`; an ESM computed reading a CJS store returned `8`, ESM `/interop` exported the hook, and constructors were distinct as documented. Expected duplicate-development-format diagnostics were observed, not counted as failures.

## Limits and disposition

No product file, pre-existing test, dependency junction or copied `dist` was edited. I ran **no tests (scoped or full)**, project-wide suite, typecheck, layout/build, formatter, lint, benchmark, synthetic load, pack/install, native binary, push or version bump. The checks above were finite public consumer probes, not substitutions for the parent's validation. React 19 was actually mounted in JSDOM and SSR-rendered; I did not check a visual browser, React 18, older Node floors, Next/webpack/turbopack installs or arbitrary async schedules in this reviewer tree. One independent review cannot prove absence of other defects. Only this report is created for the isolated commit; the parent decides the combined P0–P3 result and any product remedy.
