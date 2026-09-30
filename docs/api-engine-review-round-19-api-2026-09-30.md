# Independent API / React / resources review — round 19 — 2026-09-30

## Verdict and provenance

Reviewed the frozen `D:/dev/ReactCarburetor/worktrees/cycle-review-r19-api-xs` product at **`f1f1f06e7a07725ae977697e9a5d6cc94d8734f9`**. This is an independent public-API review; earlier reports and the parent's validation results are context, not evidence of this round's outcome. No product file was edited.

**API-slice findings: P0 = 0; P1 = 0; P2 = 2; P3 = 0. The round is not zero.** The findings below occur with documented, supported inputs through the public package/classes. Neither is the repaired native-alias/history defect from round 18. Counts concern this API slice only; the independent engine review has its own verdict.

## R19-API-01 — An array-root `connect()` descriptor query throws after a supported length lock (P2)

**Location and mechanism.** `lib/src/Carburetor/Component/Connection/buildPersistentView.ts:17-18,32-43,56-62` installs every array-root facade over one shared empty `[]`, whose non-configurable `length` descriptor is **writable**. `lib/src/Carburetor/Component/Connection/ConnectionFacadeHandler.ts:149-175` forwards the current array's non-configurable `length` descriptor unchanged because the facade target also has a non-configurable property. The supported `Object.defineProperty(draft, 'length', {writable:false})` transition is explicitly recorded at `lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:238-290`. A proxy may not report a non-configurable **non-writable** descriptor for a property whose target descriptor is non-configurable **writable**. Thus the facade's advertised descriptor/introspection contract fails even without changing the array's content.

**Bounded reproduction (copied built CJS, Node 24.12.0, from this worktree):**

```js
const {Carburetor, AntiHookComponent} = require('react-carburetor');
class S extends Carburetor {
  lock() { this.update(d => Object.defineProperty(d, 'length', {writable: false})); }
}
const s = new S([1, 2]);
class C extends AntiHookComponent {
  view = this.connect(s);
  render() { return null; }
}
const c = new C({});
console.log(Object.getOwnPropertyDescriptor(c.view, 'length'));
s.lock();
console.log(Object.getOwnPropertyDescriptor(c.view, 'length'));
```

First query returned `{value:2,writable:true,enumerable:false,configurable:false}`; the second threw `TypeError: 'getOwnPropertyDescriptor' on proxy: trap reported non-configurable and non-writable for property 'length' which is non-configurable, writable in the proxy target`. The raw array then had `{value:2,writable:false,enumerable:false,configurable:false}`. Independent actual-source `bun -e` reproduced the same `TypeError` (Bun's message: `Result from 'getOwnPropertyDescriptor' can't be non-configurable and non-writable when the target's property is writable`). **Expected:** introspection of a documented persistent array view must be lawful both before and after this supported draft descriptor change; the consumer must not crash for querying `length`. **Remedy:** make the reported `length` descriptor legal relative to the fixed proxy target on *every* source swap/lock state, e.g. retain the target's `writable:true` flag in the facade's descriptor answer when the underlying live length is locked (facade mutations already throw), and explicitly describe the representational concession; test the initially locked, lock-after-declaration and source-retargeted array paths. Do not make the shared target itself permanently non-writable, since a later view can resolve to an unlocked array.

## R19-API-02 — Cache `load()` reports success when its loader never started (P2)

**Location and mechanism.** `lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:426-474` registers a pending request, and `markLoading()` at `:484-504` publishes Pending synchronously. A normal subscriber may synchronously cancel it with the public `abort(key)` (`:349-381`). Upon returning, `fetch()` sees `!isCurrent()` at `:449-454` and **resolves** the request even though it never called the loader at `:458-460`. `docs/promise-cache.md:97-110` describes `load` as resolving from fresh cache or fetching; the public `ResourceCarburetor` explicitly rejects its corresponding pre-loader supersession with an `AbortError` (`ResourceCarburetor.ts:20-27,365-373,404-410`). This is not the already-repaired *single-slot* R10-02 defect: this path is the multi-entry cache.

**Bounded reproduction (copied built CJS, Node 24.12.0):**

```js
const {ResourceCache} = require('react-carburetor');
let calls = 0;
const cache = new ResourceCache(async () => { calls++; return 'ready'; }, {ttl: Infinity});
cache.subscribe(() => {
  if (cache.getEntry('k').status === 'pending') cache.abort('k');
});
cache.load('k').then(
  () => console.log('fulfilled', calls, cache.getEntry('k').status),
  e => console.log('rejected', e.name, calls)
);
```

Actual stdout: `fulfilled 0 idle`; independently running the actual source with `bun -e` returned `{"outcome":"fulfilled","calls":0,"entry":{"status":"idle","refreshing":false,"invalidated":false,"failed":false,"stale":true}}`. In a side-by-side bounded public-API probe with the same Pending subscriber cancellation, the single-slot resource returned `{"settled":"AbortError","calls":0,"state":"idle"}`, while cache returned `{"settled":"fulfilled","calls":0,"state":"idle"}`. **Expected:** a `load()` whose only possible answer was cancelled before the loader ran must not fulfill as though the requested answer was available; reject with a cancellation error, consistently with the slot (while preserving correct new-request ownership for re-entrant abort listeners). A consumer awaiting `load('k')` to proceed with the loaded entry otherwise runs its success path with no value. **Remedy:** settle the pre-loader superseded cache promise as cancelled, not resolved; cover synchronous Pending-subscriber abort/forget/restore and reentrant replacement without losing the newer request. This does not assert that an already-started, later-aborted request must have any particular rejection policy.

## Surfaces independently examined and exercised

- **Package/API boundaries:** `package.json` conditional root/interop/lint exports, peer ranges, declaration paths, public `Carburetor/index.ts` barrel, Store/Resource/Tooling models, CJS and ESM loaded together, and production condition. `node --conditions=production` loaded both root module formats and ESM interop; CJS resolved through `cjs-prod`, and three checked root/interop declaration files existed. Mixed CJS store with ESM `Computed`/history produced computed values `2→6→2`, two notifications, and cache entry `a!`; mixed-format shared-registry development diagnostics were printed as expected. This checks runtime/export existence, not TypeScript compilation or packed installation.
- **Stores and native shapes:** inspected read/write tracking, native facades/alias-read discovery, diff/restore, snapshot/serialization, watch and subscription delivery, descriptor transition, history ownership/replay. A bounded public-API Node run had a root plain `row` also in a Map and Set: a `watch` through `map.get('r').n` received `[2]` after a draft write; the `Computed` through the Set changed `1→2`. History lock/undo/redo for an array `[1,2]` gave `(length,writable) = (1,false)→(2,true)→(1,false)`, with root/Map alias preserved. Separate store `watch` transitions were `1→2→1→3→4`; `snapshot()` shared its native Map by reference as documented, `serialize()` emitted native Map as `{}`, and coalesced `persist` stored the latest `n:4` on disposal while storage was still empty beforehand. The class-facade lock finding is **outside** the repaired history replay: it concerns proxy introspection over a separate shared target.
- **Resources/cache:** examined slot request/restore/raw failure ownership, cache `resolve`/key/path, TTL/eviction/retention, stale refresh/invalidation/abort/reentrancy, raw failure reconciliation and pending cancellation. An actual Node slot request was aborted, its late answer ignored, a new keyed load settled, and snapshot/restore served its matching key `"new"`; a different key threw a new pending promise. A rejected cache loader's raw object was identical through `getFailure('x')` and `suspend('x')`. Cache cancellation finding above was reproduced in both built output and actual source; no failure is asserted for ordinary non-reentrant cancellation after the loader runs.
- **React/SSR/scopes:** examined `AntiHookComponent` connection/attempt/subscription/resource scheduling, persistent facade, `useCarburetorValue`, `useComputedValue`, scope/provider/token hydration and persistence code. Mounted actual React 19.3.0/JSDOM class `connect` plus ESM hook on a CJS store showed `<i>1</i><b>1</b>→2/2→9/9` across a source swap, remained `9/9` after an old-store write, and became `10/10` on the new-store write; the root unmounted. Mounted class `useResource` read `<span>pending:</span>→<span>success:resolved</span>` after the deferred load settled and unmounted cleanly. Mounted React Suspense showed `<em>wait</em>→<span>ready</span>` when a slot request resolved and unmounted cleanly. SSR of a scoped class and hook emitted `<i>7</i><b>7</b>`, scope dehydration included the named token, and JSON-hydrating a cache into a second scope returned `q` without sharing the first scope's live state object.
- **Computed hook transition:** mounted ESM `useComputedValue` on CJS `Computed`/stores showed `<strong>2</strong>→4→16` after replacing the computed source, remained `16` after the old source changed, then showed `18` on the new source's write; it unmounted. This is a React 19.3.0 runtime control, not a React 18 assertion.

## Validation boundaries

The bounded commands above ran from this frozen worktree using its pre-copied `dist` and, where stated, Bun actual source. Two preliminary **fixture** errors were corrected before drawing conclusions: Node 24's global `navigator` cannot be reassigned, and the scoped class method is `resolve(token)`, not `getCarburetor(token)`. A package self-reference intentionally does not export `./package.json`; the production probe read the local package file instead. No product edit, build, formatter, linter, test suite, benchmark, package pack, version bump or push was performed. React 18, a browser visual surface, a real package install and exhaustive permutations were not independently exercised; the observed React runtime was 19.3.0. Passing bounded controls are not a universal zero claim, and these two reproduced P2 findings prevent an API-slice zero verdict.
