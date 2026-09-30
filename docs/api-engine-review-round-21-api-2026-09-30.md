# Independent public API / React / resources review — round 21 — 2026-09-30

## Verdict and provenance

Reviewed the frozen `D:/dev/ReactCarburetor/worktrees/cycle-review-r21-api-xs` product at **`9008b8f749bb63b25d335c6ba4dab5bb213a4def`**. This is an independent API-slice verdict, not a rerun of the parent's suites or an adoption of the round-20 findings. I changed no product source, existing tests, generated distribution or dependencies.

**Established API findings: P0 = 0; P1 = 0; P2 = 1; P3 = 0. This slice is not zero.** The finding changes an actual enumerable data value in an accepted state object; it does not depend on unsupported accessor state, symbol-keyed state, array subclasses or direct raw mutation. A separate metadata-only observation below is **not** counted as a finding. The independent engine slice must supply its own verdict.

| Priority | Count | Findings |
| --- | ---: | --- |
| P0 | 0 | None established. |
| P1 | 0 | None established. |
| P2 | 1 | R21-API-02 below. |
| P3 | 0 | None established. |

## Contract disposition — descriptor-metadata-only replacement is not a finding

An executed Node 24.12.0 built-CJS control and Bun 1.4.2 actual-source control replaced `{row:{n:1}}` with an otherwise equal object whose own enumerable `row.n` had `writable:false`. Both observed a raw non-writable property, version `0`, no `watch(d => d.row)` callback, and no history step. An actual mounted React 19.3.0 `connectSelection(s, d => d.row)` class remained `<span>writable</span>` after that metadata-only replacement; explicitly reselecting produced a snapshot with the new flag. The mechanism is `Store/Paths/Diff/diffPaths.ts:65-110,114-143` comparing enumerable key order/values rather than ordinary descriptor flags, then `Store/Carburetor.ts:169-183,564-580` treating its empty diff as a no-op.

**Why this is not a supported-contract discrepancy:** `README.md:893-901` defines a plain container's *state* by its `Object.keys` enumerable data and an array's elements/length; `Store/Utils/deepClone.ts:8-10,48-65` explicitly copies those values into ordinary, normalized descriptors. `Models/Store.ts:5-11,101-110` says descriptor introspection itself does **not** register a value dependency. `sameSelection` and selection detachment preserve/compare descriptors **when a selection is evaluated**, but do not promise a store publication on metadata-only ordinary-object changes. The repro proves an observable metadata difference, not a promised state-value update; requiring descriptor-diff publication would expand the public state model rather than repair R21-API-02. Do not count it or change product behavior on this basis.

## R21-API-02 — `restore` and history undo cannot replace an accepted non-writable field's value (P2)

**Supported input and mechanism.** A plain state object whose `row.n` is own, enumerable, configurable and non-writable passes the development state validation above and can be installed through the constructor or `setData`. `Carburetor.snapshot()` intentionally creates a detached *writable* plain copy (`Store/Utils/deepClone.ts:48-65`), so editing a snapshot and restoring it is an ordinary public flow. `Store/Carburetor.ts:211-241` invokes `applyDiff(this.draft, current, data)`, and `Store/Paths/Diff/applyDiff.ts:40-64,92-132,153-170` assigns a changed scalar through the draft without a preflight for a non-writable current descriptor. `Tracking/createWriteProxy.ts:355-440` returns a failed `Reflect.set` for that field, which becomes a `TypeError` instead of falling back to a detached root replacement. The draft was touched, so the development unpublished-draft warning also fires. History owns all endpoint descriptors (`Tooling/CarburetorHistory.ts:45-118`) but `:477-484,518-530` selects whole-graph replay for exotic/key-order/locked-array cases, **not** this ordinary scalar descriptor transition, and consequently tries that same failing public `restore` path.

**Actual bounded evidence, Node 24.12.0, this worktree's built CJS:**

```js
const {Carburetor, CarburetorHistory} = require('react-carburetor');
const state = {row: {}};
Object.defineProperty(state.row, 'n', {
  value: 2, writable: false, enumerable: true, configurable: true
});
const s = new Carburetor(state);
const saved = s.snapshot();
saved.row.n = 1;
try { s.restore(saved); } catch (e) { console.log(e.name); }
console.log(s.getData().row.n, s.getVersion());
```

Observed `TypeError`, then `2 0` (and the development warning). Independently, with `new Carburetor({row:{n:1}})`, attach `CarburetorHistory`, then `setData({row: {n:2}})` with that new `n` defined enumerable/non-writable: `undo()` threw `TypeError: 'set' on proxy: trap returned falsish for property 'n'`; the live value stayed `2`, `canUndo()` remained `true`, and `canRedo()` stayed `false`. The same history failure reproduced against **actual Bun source** (the error wording differs by runtime). No accessor, frozen container, foreign subclass or manual mutation is involved.

**Expected / remedy.** A restore of a valid edited snapshot must install its value and notify; undo must replay the prior owned endpoint and retain its descriptor fidelity, not fail on an assignment the present root refuses. Before *any* draft mutation, preflight descriptor transitions and assignment feasibility throughout the affected tree, then use an owned root replacement where in-place draft writes cannot implement the request; do not silently drop history's descriptor flags by running an ordinary `deepClone` on its already-owned replay graph. Preserve a retryable history cursor if a genuinely unsupported operation throws.

## Independently examined public contracts and causal paths

- **Stores, state model, tracking and selection:** Public barrel and model surfaces (`lib/src/Carburetor/index.ts:5-51`, `Models/{Base,Store,Paths}.ts`); `Store/Carburetor.ts:41-600`, `Tracking/{createReadProxy,createWriteProxy,liveViews,isTrackable}.ts`, `Tracking/Aliases/{AliasLedger,NativeAliasIndex,NativeAliasReads}.ts`, `Paths/{SubscriberIndex,WriteLog,Markers/*,Diff/{diffPaths,applyDiff,installPatch,sameKind,Order/*}}.ts`, `Utils/{deepClone,Selection/detachOpaque}.ts`, and `Component/Connection/{sameSelection,detachSelection,buildPersistentView,ConnectionFacadeHandler}.ts`. Followed raw `getData`, tracked `read`/`watch`/`subscribe` and conditional reads, draft publication, `setData`, snapshot/toJSON/serialize/fromJSON, restore diff/fallback, native aliases, root retarget, descriptor fidelity, key order and persistent facade introspection. The remaining finding concerns value-changing restore into a supported readonly *object property*, not the already repaired string-key ordering or array-length facade cases.
- **History, computed, scheduling and tooling:** `Tooling/{CarburetorHistory,sameHistoryGraph,persist,connectDevTools}.ts`, `Store/Transaction/{transaction,PatchObserverRegistry}.ts`, store scheduler/update-wave components, `Derived/{Computed,computedDependencies,Freshness/*}.ts`. Inspected independent observer publication, owned native/plain replay, cursor failure, clear, root ownership, computed dependency reattachment/leaf versions and conditional subscribers, coalesced persistence/disposal, and Redux DevTools composition/time travel. The value-changing readonly restore/undo failure above is independently observed; the metadata-only no-entry control is explicitly a non-finding. No claim of exhaustive interleavings is made.
- **Resources:** `Resource/ResourceCarburetor.ts:38-510`, `Resource/Cache/{ResourceCache,ResourceCacheLifecycle,EvictionLedger}.ts`, `Models/Resource.ts:5-110`, `docs/promise-cache.md:65-127`. Examined request keying and settled wire key, `load`/`reload`/`suspend`, abort and late result suppression, `snapshot`/`restore` of Pending, cache `keyOf`/`pathOf`/`resolve`, TTL, LRU retention, refresh/invalidation, per-key/bulk cancellation/forget, synchronous Pending subscriber cancellation and raw failure ownership.
- **React and package:** `Component/AntiHookComponent/{Foundation,Reads,Subscriptions,Effects}.tsx`, `Connection/{declareConnection,ConnectionFacadeHandler,sameSelection}.ts`, `Component/{ScopedAntiHookComponent,Scope/*}.tsx`, `Interop/{useCarburetorValue,useComputedValue}.ts`, root/interop conditional exports and declarations in `package.json:5-47`, `docs/react-compatibility.md:9-82,115-122`. Followed render attempt → commit subscription, selectors/order/descriptors, source and root retarget, postcommit resource loads, hook selector/comparator and read-set reconciliation, actual Suspense, SSR scoped class/provider, and CJS–ESM shared state.

## Other bounded actual observations

These are individual executed controls, not project-wide tests:

1. Bun **actual source**, a conditional `watch` (`flag ? a : b`) followed writes `a:1→2`, switch to `b:3`, irrelevant old-branch write and `b:3→4`: callbacks `[[1,2],[2,3],[3,4]]`. A computed sum under a transaction and later writes reported `5,10,11`; a plain history `setData` step undid `unused:11→10` and redid `10→11`; a snapshot retained its earlier `unused:0`. Disposing coalesced persistence flushed the latest JSON with `unused:10`. Two scopes hydrated the same named-token payload independently (`42` versus a later write to `1`, payload still `42`).
2. Bun source native Map-member alias of plain `row` observed `[2]` on the ordinary draft path. A single-slot load settled `a!` under its serialized key; snapshot/restore served `a!` with one loader call. A keyed cache with `ttl:Infinity,maxEntries:1` loaded and invalidated `a`, loaded again, then loaded `b`; loader calls `3`, only `b` remained. Raw rejected `Error` identity survived `getFailure` and `suspend`. Synchronous Pending subscriber `abort('stop')` rejected with `AbortError` and **zero** loader calls. Another pending slot's old answer was ignored after abort/restore; a hydrated Pending cache entry normalized to Idle, and invalidating a failed cache entry cleared `failed`.
3. Bun source ordered-key control: delete first key from `a,b,c`, undo, redo; `watch(Object.keys)` observed `b,c → a,b,c → b,c`. An array-root connection's facade `length.writable` lawfully remained `true` when the raw array was locked; its selection snapshot retained the actual `false` descriptor. These are controls, **not** claims that R20 fixes need another repair.
4. Built root **CJS** plus built interop **ESM**, actual React **19.3.0/JSDOM** mounted class `connect` and hook on the same store: rendered `<i>1</i><b>1</b> → 2/2 → 8/8` after source swap; writing the old store left `8/8`, writing the new one yielded `9/9`; unmount emptied the root. A separate actual mounted Suspense slot went `<em>wait</em> → <span>ready</span>`. Node SSR of `ScopedAntiHookComponent` inside `CarburetorProvider` yielded `<strong>7</strong>` and dehydrated `{n:7}`. Separate Node mixed CJS store + ESM `Computed` observed `4→8`, the ESM interop hook existed, and the expected duplicate-format development notices appeared. `node --conditions=production` resolved root CJS to `dist/cjs-prod` and loaded root ESM and interop imports successfully.

## Limits

No suite, lint, formatter, project-wide build, benchmark, npm pack/install, push, version bump, native binary run or browser visual check was run in this reviewer worktree. The bundled `dist` was pre-existing and was **loaded**, not built or repacked here; direct source controls use Bun separately. The failed first attempt at a source React mount used two physically distinct React installations (`lib/node_modules/react` versus root React), hence an invalid-hook-call fixture; the corrected built-format mount used the **same** React installation as the renderer and produced the frames recorded above. A preliminary scope control reversed `carburetorToken(create,name)` arguments, was corrected before recording its result and is not a product failure. React 18 is in the declared peer range but was **not independently mounted** by this reviewer; the actual mount was React 19.3.0. No exhaustive consumer, reentrancy, native graph or browser compatibility claim follows from these finite observations. The parent's parallel suite and packed-matrix results are context only, not independent proof in this report.
