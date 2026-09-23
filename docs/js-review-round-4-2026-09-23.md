# JavaScript review, round 4 — 2026-09-23

Reviewed revision: `7a5e935` on `master`. Scope: the JavaScript/TypeScript state engine,
React integration, selection snapshots, scope serialization, and proxy-cache lifetime.
Native/Rust was outside scope. This review adds only this document.

## Outcome

The round-three fixes address their targeted cases. The render method itself now receives the
proxy carrying native private fields; nested live views are detached for a supported selection;
restoring the resource cache cancels prior requests; symbol-keyed branches are tracked; and the
invalidation journal coalesces repeat writes to one path. These are concrete improvements.

The fourth pass found **10 findings: 4 P1, 4 P2, and 2 P3**. No P0 was established. The highest
priority is loss of ordinary class behavior or state during rendering and serialization.
The most concrete remaining CPU/memory targets are the proxy-cache journal under distinct-key
churn, watcher registration from fresh read views, and selection identity churn.

- **P0:** immediate broad failure.
- **P1:** user-visible incorrect data, lost state, or a supported component that fails.
- **P2:** narrower semantic or reproducible scaling defect.
- **P3:** measurable unnecessary work or an unresolved API/runtime contract.

## Verification

Five affected test files passed: **216 tests** covering components, persistent views, resource
cache, proxy cache, and computed values. The library, demo, and public type-contract checks
passed. The targeted checks used the installed React 19.3.0. This round did not independently
run the full plugin/native suites or React 18.

Additional short checks ran against the current committed CommonJS build using Node, React,
React DOM, JSDOM, and `act`. They used a handful of reads/writes and no stress benchmark.
The examples below report their actual observations. The existing change to
`.claude/scheduled_tasks.lock` is outside this document's commit.

## Priority index

| ID | Priority | Finding |
| --- | --- | --- |
| R4-01 | P1 | Instance proxy invokes getters and setters with the wrong private-field receiver |
| R4-02 | P1 | Snapshot and selection copying lose own `__proto__` data and null prototypes |
| R4-03 | P1 | A valid scope token name disappears from the hydration payload |
| R4-04 | P1 | Selection array properties are copied but ignored by equality; sparse length is lost |
| R4-05 | P2 | StrictMode replay drops view tracking, then real unmount misses a new cache |
| R4-06 | P2 | Nested selection copies defeat memoization with unchanged data |
| R4-07 | P2 | Distinct-key churn still grows pending invalidation records and write-side work |
| R4-08 | P2 | Fresh read views still accumulate watcher handles without a write |
| R4-09 | P3 | Unmount creates a read proxy for an unused connection only to release it |
| R4-10 | P3 | Browser runtime requirements for `WeakRef` remain unspecified |

## R4-01 — [P1] Class getters and setters see the raw instance

**Location:** [instance proxy](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L486),
[ordinary-property traps](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L499),
[render receiver](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L588).

The previous repair passes the returned proxy as `this` to a prototype `render()`, so a
direct `this.#field` read works. But the proxy's ordinary `get` and `set` traps pass the
raw target as the receiver to `Reflect.get` and `Reflect.set`. A subclass getter or setter
that uses its native `#private` field therefore receives an unbranded object.

Reproduced with:

```js
class View extends AntiHookComponent {
    #value = 7;
    get amount() { return this.#value; }
    set amount(value) { this.#value = value; }
    render() { return this.amount; }
}
```

Reading `view.amount`, assigning it, and calling `view.render()` all threw a private-member
TypeError. The same component's direct method `read() { return this.#value; }` returned `7`.

**Correction:** forward ordinary accessors using the public proxy receiver, while preserving
render-attempt state and React updater behavior. Cover a native private getter/setter called
from render and from a handler, inherited accessors, and methods decorated or bound to an
instance. Do not treat the repaired direct render test as coverage of accessors.

## R4-02 — [P1] Copying a data property can change an object's meaning

**Location:** [store snapshot copier](../lib/src/Carburetor/Store/Utils/deepClone.ts#L19),
[selection copier](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L42).

Both copies create `{}` and assign source keys using `target[key] = value`. An own enumerable
property named `__proto__` is not installed as an own data property on that target; the assignment
changes its prototype. This is a correctness and data-shape finding, not a claim that a global
prototype was modified.

A plain object parsed from `{"__proto__":{"n":7},"safe":1}` had its own `__proto__` key.
`new Carburetor(value).snapshot()` lost that own key. Its copied object's prototype instead
held `n: 7`. `detachSelection(value)` showed the same loss. The result serializes without
the field. Separately, copying an `Object.create(null)` dictionary gave the copy
`Object.prototype`; a later `restore()` can therefore change presence checks and inherited
members even when values appear unchanged.

**Correction:** create own data properties without invoking the inherited `__proto__` setter,
and preserve the supported plain-object/null-prototype distinction. Apply the same container
policy to both snapshot paths. Include JSON parse → snapshot → stringify/restore round trips,
nested objects, and a null-prototype dictionary.

## R4-03 — [P1] A scope token can be valid but unsendable

**Location:** [CarburetorScope.dehydrate](../lib/src/Carburetor/Component/Scope/CarburetorScope.ts#L47),
[token names](../lib/src/Carburetor/Component/Scope/carburetorToken.ts#L21).

`carburetorToken(factory, '__proto__')` is accepted as a unique, non-empty name. The scope
stores its instance in a `Map`, where that name works. During dehydration it assigns
`state[id] = instance.toJSON()` into a plain `{}`. The resulting wire object has no own
`__proto__` key and `JSON.stringify(wire)` is `{}`, so the client starts from defaults instead
of the server's value. The receiver's prototype is changed in memory.

The existing `hydrate()` correctly checks own keys; it cannot recover a key `dehydrate()`
never serialized.

**Correction:** construct the wire dictionary without a magic inherited setter, or reject
reserved token names at declaration with a clear error. Check every accepted token name by
round-tripping through JSON between independent scopes, including `__proto__`.

## R4-04 — [P1] Array snapshots copy properties their comparator ignores

**Location:** [deep selection copy](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L42),
[array equality](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L23).

`detachSelection()` now copies all enumerable array keys, including custom string and symbol
properties. `sameSelection()` still compares only array length and indexed elements, following
its old `Array.from` contract. The two operations no longer describe the same value.

In a React reproduction, a selector returned `[id]` with an enumerable `extra` property read
from the store. Changing only `extra` from `first` to `second` left a memoized child displaying
`first`; it rendered once, although the store held `second`.

There is a second shape loss: copying `[1, <two trailing holes>]` by enumerating keys creates
an array of length `1`, rather than preserving length `3`. A child that reads length sees a
different value even before an update.

**Correction:** compare precisely the properties the snapshot preserves, including enumerable
symbols, and preserve array length and intended hole semantics. If custom array properties
are excluded by contract, omit them consistently from both copy and comparison and document
that limit. Cover a memo child, not only a direct comparator call.

## R4-05 — [P2] StrictMode replay breaks explicit cache lifetime management

**Location:** [unmount](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L207),
[releaseConnectionViews](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L1006),
[cache release](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L268).

StrictMode replays `componentWillUnmount` and `componentDidMount` without a fresh render.
`releaseConnectionViews` releases each cache watcher and clears the component's view list.
The subscription description is restored on the second mount, but the view list is not.

Observed while the component was mounted and displaying correct data:

```text
after StrictMode replay: root cache watcher count 0; store subscriptions 1
after a root data replacement: new cache watcher count 1; tracked view list still empty
after real unmount: new cache watcher count 1
```

Thus the explicit cleanup added after round three misses the later cache. The UI's immediate
update still worked in this check; the finding concerns retained bookkeeping and the
lifetime guarantee.

**Correction:** make view ownership replayable along with subscriptions. A real unmount must
release whichever read-proxy cache the persistent facade currently owns, even after root
replacement, while a replayed mount must re-establish ownership without requiring another
render. Verify watcher counts under StrictMode plus `setData`, then real unmount.

## R4-06 — [P2] A stable nested selection still redraws a memo child

**Location:** [deep copy](../lib/src/Carburetor/Component/Connection/detachSelection.ts#L23),
[shallow comparison](../lib/src/Carburetor/Component/Connection/sameSelection.ts#L45).

A selection returned `{n: data.n, nested: stableObject}`. The store did not change. A parent
prop update caused one extra parent render. The memoized child rendered again
(`childRenders: 1 → 2`), although its displayed value and store version stayed unchanged.

`detachSelection` copies `nested`, so the previous snapshot holds a new nested reference;
`sameSelection` compares that copy with the selector's still-stable source object by
`Object.is` and reports a change on every call. This defeats the advertised identity cache
for nested plain results.

**Correction:** compare the same normalized representation that is handed to children, or
provide stable per-branch snapshots keyed by meaningful changes. Preserve the deep live-view
safety added in round three. Test a real `React.memo` child with a parent-only rerender;
do not solve this by shallowly re-exposing live store branches.

## R4-07 — [P2] Different deleted keys still fill the invalidation journal

**Location:** [retirement](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L168),
[record coalescing](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L260).

The round-three fix bounds repeat writes to the *same* path. It does not bound distinct-path
churn while a cache is idle. One view retained `items.a`; three other keys were each inserted
and deleted while that view was not read. The data ended with only `a`, but the cache reported
three pending records and 12 record visits during those six writes.

The write path uses `retire(false)`, which retains records until lagging caches catch up and
visits the entire growing record Map on each new write. None of the idle view's cached entries
were at the touched keys. Thus its unrelated, unique history can still grow and make each
later write more expensive. This is a bounded work-count observation, not an extrapolated
wall-clock measurement.

**Correction:** retire records that no live cache can use without waiting for an unrelated
view's next read, and keep publication work proportional to current cached paths/pending
invalidation needs rather than the number of distinct keys ever touched.

## R4-08 — [P2] The older read API still accumulates watcher handles

**Location:** [cache registration](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L145),
[public read](../lib/src/Carburetor/Store/Carburetor.ts#L84).

A `Carburetor.read()` proxy creates its own cache watcher. Starting with one such view, three
more read calls without writes grew `watcherCount()` from **1 to 4**. The constructor's retirement
pass can remove dead weak references only after the runtime collects their targets. There is
no deterministic release for the per-render `useCarburetor()` views, unlike persistent
`connect()` views.

The weak handles themselves are held in the live root's `Set`; a write later scans them.
This does not prove a specific application-wide memory or latency figure, but the lifetime
is tied to garbage collection instead of the render/commit boundary the component already
knows.

**Correction:** establish ownership/disposal for temporary tracked views where a render
creates them, or use a cache registry whose metadata stays bounded without a later write
or particular GC timing. Preserve the public `read(record)` use outside components.

## R4-09 — [P3] Unmounting an unused connection constructs a proxy

**Location:** [releaseConnectionViews](../lib/src/Carburetor/Component/AntiHookComponent.tsx#L1006),
[persistent view construction](../lib/src/Carburetor/Component/Connection/buildPersistentView.ts#L85).

A component declared a connection and never read it. At mount it had performed zero store
`read()` calls. During unmount, `releaseConnectionViews` accessed the facade's cache symbol;
this resolved the store, created a new read proxy/cache, and immediately released that cache.
The bounded check observed reads `0 → 1` and resolver calls `1 → 2` from unmount alone.

**Recommendation:** expose the already-created cache handle to the owner without forcing a
view read. If no cache was ever built, there is nothing to release. This also simplifies the
StrictMode ownership repair.

## R4-10 — [P3] Browser support for WeakRef has no explicit contract

**Location:** [WeakRef construction](../lib/src/Carburetor/Store/Tracking/createProxyCache.ts#L156),
[package runtime metadata](../package.json#L56).

The package now declares a Node minimum of `14.6.0`. It is also a browser-facing React
library, yet no browser capability floor or fallback is stated. In an environment where
`WeakRef` is unavailable, the first tracked read still throws. Adding a TypeScript library
entry and a Node engine constraint cannot supply a missing browser global.

**Recommendation:** state and test the browser/runtime capability requirement or feature-detect
and use a compatible ownership strategy. This review did not estimate how many client devices
lack `WeakRef`, so it does not assign a performance or adoption figure.

## Recommended order

1. Fix the receiver and both copy/serialization boundaries (R4-01–R4-04).
2. Make connection/cache lifetime survive StrictMode replay (R4-05).
3. Address the measured work and identity churn (R4-06–R4-08).
4. Simplify unused-view cleanup and make platform requirements explicit (R4-09–R4-10).

Keep the earlier improvements: subscription precision, corrected computed delivery, resource
request generations, safe nested live-view handling, and inferred consumer types. The ten
findings above define focused next regression tests; existing green tests do not cover them.
