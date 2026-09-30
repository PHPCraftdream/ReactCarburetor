# Independent public API and engine review — round 25 API — 2026-09-30

## Verdict and provenance

Reviewed the isolated `cycle-review-r25-api-xs` checkout at frozen product revision **`b8d4a6c086829f7af7797e55a6455bbedb09b954`**, including the round-24 resource-status replay correction. This is an independently traced API/engine/React/resource review, with bounded actual Bun 1.4.2 runs of this tree's TypeScript public barrel and Node 24.12.0 runs of its pre-existing copied development and production package distributions. The copied `dist` and dependency junctions were not built or changed. The engine peer and parent determine their own verdicts and the combined result.

**Established findings: P0 = 0; P1 = 0; P2 = 1; P3 = 0. API slice is not zero.** One normalization/replay defect has two resource manifestations, both below. This is a value-changing owned-history endpoint problem, not an ordinary metadata-only descriptor notification claim. Zero in another priority is only “none established in reviewed paths,” not proof of exhaustive correctness.

| Priority | Count | Finding |
| --- | ---: | --- |
| P0 | 0 | None established. |
| P1 | 0 | None established. |
| P2 | 1 | R25-API-01: resource history cannot replay a supported restrictive **transient** field whose value must be normalized. |
| P3 | 0 | None established. |

## R25-API-01 — owned resource replay attempts to assign normalized values into readonly fields (P2)

**Contract and exact mechanism.** `README.md:650-655,662-675,681-688,903-911,924-933` documents resource wire history, Pending → Idle normalization, captured restrictive descriptor replay and the accepted own-enumerable-string data state model; `Models/Resource.ts:5-11,27-62` declares `status` and `refreshing` as ordinary state. These examples change `updatedAt` or add an entry, not *only* descriptor flags. A `ResourceCarburetor` or `ResourceCache` publicly accepts the next data with `setData()` (`Store/Carburetor.ts:154-183`); history captures its restrictions in `Tooling/Graph/ownHistoryGraph.ts:51-76` and owns the fresh replay argument in `Tooling/CarburetorHistory.ts:413-436,450-469`. On redo, `Resource/ResourceCarburetor.ts:170-189` normalizes captured `status:'pending'` to `'idle'` but assigns it to the **non-writable, non-configurable** captured own field at line **188**. Likewise `Resource/Cache/ResourceCacheLifecycle.ts:82-94` assigns a captured readonly `refreshing:true` to `false` at **90**, or a captured readonly Pending `status` to Idle at **93**. The fresh owned graph's descriptor already prohibits the assignment. The prior R24 defect in the settled unchanged status case was fixed by the equality guard at `ResourceCarburetor.ts:188`; these cases require a *different value*, so that guard cannot help. The exception happens before `super.setData`/`this.setData` can publish, after the history cursor tentatively advanced; `CarburetorHistory.ts:203-217` puts the cursor back for a retry. This is not a proxy read of a locked object and does not depend on tracking restricted nested fields.

**Minimal public-source reproduction** (run from this checkout using `bun -e` and importing `./lib/src/Carburetor/index.ts`):

```js
import {ResourceCarburetor, ResourceCache, CarburetorHistory} from './lib/src/Carburetor/index.ts';
const slot = new ResourceCarburetor(async () => 1);
const slotHistory = new CarburetorHistory(slot);
const pending = {...slot.getData(), status: 'pending', updatedAt: 7};
Object.defineProperty(pending, 'status', {
    value: 'pending', enumerable: true, writable: false, configurable: false,
});
slot.setData(pending);                       // accepted, version 1
console.log(slotHistory.undo());             // true, now Idle
try { console.log(slotHistory.redo()); }
catch (error) { console.log(error.name); }  // TypeError, still Idle; canRedo() true

const cache = new ResourceCache(async () => 1);
const cacheHistory = new CarburetorHistory(cache);
const entry = {status: 'success', data: 3, error: undefined,
    updatedAt: 9, refreshing: true, invalidated: false, failed: false};
Object.defineProperty(entry, 'refreshing', {
    value: true, enumerable: true, writable: false, configurable: false,
});
cache.setData({entries: {k: entry}});        // accepted, version 1
console.log(cacheHistory.undo());            // true, entries now empty
try { console.log(cacheHistory.redo()); }
catch (error) { console.log(error.name); }  // TypeError, still empty; canRedo() true
```

**Observed and expected.** Bun source printed `slot undo true`, `slot redo error TypeError Attempted to assign to readonly property`, current `status:'idle', updatedAt:undefined, canRedo:true`; cache printed `undo true`, `redo error TypeError Attempted to assign to readonly property`, current `entries:{}, canRedo:true`. Node using the actual copied public development CJS `require('react-carburetor')` yielded the same two `TypeError` results, versions `2`, undone data and `canRedo:true`; `node --conditions=production` resolved `dist/cjs-prod/Carburetor/index.js` and reproduced both, so this is not a dev-only diagnostic. Expected replay returns `true`, publishes the captured changed `updatedAt:7` or restored entry/data, normalizes Pending to Idle and in-flight `refreshing` to false, leaves undo available and redo consumed, while retaining restrictive descriptors where history promises exact owned endpoints. Independently, restoring a readonly-Pending cache entry through **ordinary** `restore({entries:{k:entry}})` succeeded with Idle and `refreshing:false`, leaving the caller's entry unchanged. Readonly settled `idle`/`success`/`error` slot statuses with a changed timestamp independently passed undo/redo with `status.writable === false`, confirming the latest equality guard works in its intended domain.

**Actual request controls and limit.** An in-flight `slot.load('a')` was observed in Pending, then its public `setData()` introduced the readonly Pending status and a changed timestamp; undo succeeded, redo threw `TypeError` and kept Idle/redo availability, even after resolving the original finite request. In a separate cache control, a real `refresh('k')` made a prior Success entry `refreshing:true`, then a *value-changing* `setData()` installed that entry with readonly refreshing and a new timestamp (`5 → 7`); undo restored timestamp `5`, redo threw `TypeError` and kept `canRedo:true` while the request subsequently settled. Without the timestamp change this last `setData` is intentionally a descriptor-only publication no-op, and undo/redo of the **earlier** refresh succeeded; that no-op is **not** the finding. The minimal snippet is the smallest accepted-public-data repro; the request controls demonstrate the transient states are real rather than invented schema shapes. These runs do not claim to test every reentrant abort graph or subclass override.

**Remedy.** Prepare a *new* normalized, owned replay graph **before** defining its restrictive descriptors, retaining the full alias/native topology and metadata, then install that graph as a single owned history endpoint. A shallow spread or `deepClone` as a replay replacement would normalize descriptors or split native backlinks, violating the existing history contract. The implementation needs both resource normalization sites, and should preserve the already-fixed no-assignment path when a readonly status is unchanged. Do not suppress the error or skip the normalization: Pending/refreshing without a live request would then lie to the consumer. The caller-owned ordinary snapshot remains unmodified.

## Independent source and contract coverage

- **Store, read/write paths and selectors.** Read `lib/src/Carburetor/index.ts:1-51`, `Models/Store.ts:4-159`, `Store/Carburetor.ts:39-569`, `Tracking/{createReadProxy,watchSelection}.ts`, `Tracking/Proxy/clonePatchValue.ts`, `Tracking/Aliases/NativeAliasReads.ts`, `Paths/Diff/{diffPaths,applyDiff}.ts`, `Paths/SubscriberIndex.ts`, `Transaction/PatchObserverRegistry.ts`, `Utils/deepClone.ts` and `Component/Connection/{sameSelection,ConnectionFacadeHandler}.ts`. Traced raw `getData` vs tracked `read`, copied read sets, conditional `watch` re-filing after comparison/detachment, own-key/order and array-length paths, effective draft writes before fallible patch callbacks, opaque/native identity, readonly-object restore preflight before sibling edits, snapshot flag normalization versus descriptor-preserving owned history, and root/source changes. Ordinary descriptor-only no-op is the documented boundary, not a recycled finding.
- **History, computed, scope and tooling.** Followed `Tooling/CarburetorHistory.ts:112-220,244-295,379-509`, `Tooling/Graph/{ownHistoryGraph,canInstallOwnedPatch}.ts`, `Derived/Computed.ts:121-275,420-545`, `Component/Scope/CarburetorScope.ts:23-128`, `Tooling/{persist,connectDevTools}.ts`, `Component/ScopedAntiHookComponent.tsx`, and `Models/Resource.ts`. Checked patch versus complete-graph endpoint admission, independent undo/redo cursors, scalar/native/readonly traits, computed flattened leaf freshness, token and SSR hydration ownership, synchronous/coalesced storage writes and disposal, and DevTools's type-erased `toJSON`/`fromJSON` path. A real Redux extension was not mounted here.
- **Slot, keyed cache and wire state.** Followed `Resource/ResourceCarburetor.ts:74-510`, `Resource/Cache/{ResourceCache,ResourceCacheLifecycle}.ts:1-281,1-600`, `Models/Resource.ts:5-110` and `docs/promise-cache.md:65-127`. Examined public settled keys, Pending and refreshing restoration, `load`/`reload`/`refresh`/`suspend`, `resolve`/`pathOf`/escaping, concurrent joining, immediate cancellation before loader execution, stale-response ownership, raw failure reconciliation on entry/root replacement, TTL/stale Success, explicit invalidation precedence, Error retry guard, retention and LRU eviction, bulk abort/forget, and restoration's in-flight cancellation. The finding is confined to exact owned replay of a field whose value needs normalization; ordinary restore and unchanged readonly settled statuses differ.
- **Class, hook, Suspense, SSR, copied formats.** Read `Component/AntiHookComponent/{Foundation,Reads,Subscriptions}.tsx`, `Component/Connection/{declareConnection,ConnectionFacadeHandler}.ts`, `Component/Scope/{CarburetorScope,CarburetorProvider}.ts*`, `Interop/useCarburetorValue.ts`, `package.json:5-47,73-81`, and `README.md:696-710,826-933`. Traced tentative render → committed read set/drift check, `connect` and `connectSelection` source/root retarget, facades' readonly/introspection invariants, conditional hook re-subscription without changed selected result, render-safe `suspend`, per-request provider scope, and distinct CJS/ESM module identities. No browser visual inspection was performed.

## Additional bounded observed consumer behavior

These are real finite API invocations on this product revision, **not** a scoped suite, project-wide validation, benchmark or synthetic load:

1. Bun public-source subclass `update` + `watch(flag ? left.n : right.n)` recorded `[[1,2],[2,1],[1,4],[4,8],[8,4],[4,8],[8,10]]` across writes, branch switch, edited-snapshot restore, undo/redo and transaction; the abandoned left branch edit did not notify. `computed(read => read(store).right.n * 2).get()` returned `16`. Coalesced `persist` disposed after two writes stored the final JSON with `right.n:10`; two token scopes hydrated independently (`6` in the payload, `7` only in the receiving scope).
2. Bun source native `Map` key/plain sibling test retained the new graph's raw-key identity through undo/redo (`map.has(current.key) === true`, observed map-member values `[4,3,4]`). A sparse array stayed sparse with its `length.writable` changing `false → true → false` across undo/redo. `restore(snapshot)` with an own locked object-valued `row`, changed `row.n` and changed `other` succeeded with `[other,row.n]=[4,2]`, watcher `[4,0]` across restore/undo and `[0,1]` after undo; the R22 partial-write regression is not reproduced.
3. Bun source cache concurrent loads of `a.b` shared their exact promise; invalidation marked the settled answer stale, refetch and LRU `maxEntries:1` left the latest `"bad"` entry, and the raw rejected `Error('r25-raw')` matched `getFailure('bad')` and `suspend('bad')` by identity. A Pending subscriber aborted another key before its loader ran: `AbortError`, loader calls `0`. A slot's restored explicit wire key `JSON.stringify('new')` served the saved answer via `suspend('new')`.
4. Node's copied development CJS store/class and ESM hook mounted with React 19.3.0, ReactDOM and JSDOM: `connect` + `connectSelection` class and `useCarburetorValue` rendered `<i>1/1</i><b>1</b> → <i>2/2</i><b>2</b> → <i>8/8</i><b>8</b>`, ignored an old-source write and then rendered `<i>9/9</i><b>9</b>` from the new source. An actual mounted Suspense boundary changed `<small>wait</small> → <em>ready</em>` after a finite slot promise resolved. SSR provider/scoped class rendered `<strong>7</strong>` and dehydrated `{"r25-ssr":{"n":7}}`; unmount cleared the DOM root. The mixed development module formats emitted their expected duplicate-copy diagnostic, not a runtime exception. A first local mount attempt hit Node's read-only `global.navigator` getter while setting up JSDOM; the corrected actual mount omitted that unnecessary assignment and produced the above observations.
5. Node `--conditions=production` resolved copied `dist/cjs-prod` and `dist/esm-prod` public entries; ESM `computed` read a CJS store and returned `6`, the ESM interop hook was a function, and the CJS and ESM constructors were distinct as documented. Production also reproduced R25-API-01, not just the development distribution.

## Limits and disposition

No product code, existing tests, `dist`, junctions or dependencies were edited. No scoped or project-wide suite, build, typecheck, formatter, lint, benchmark, pack/install, browser visual inspection, push, version change, native binary or synthetic load was run. React 19 was mounted in JSDOM and SSR-rendered, not checked visually in a real browser; React 18, Next.js, npm/pnpm, Webpack/Turbopack, older Node floors, unusual unsupported accessor/class graphs, and arbitrary request interleavings were not independently rerun here. A single bounded review cannot prove absence of all other bugs. Only this report is intended for the isolated commit and parent cherry-pick.
