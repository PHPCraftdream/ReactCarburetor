# Bugs and correctness review — 2026-10-16

Branch `master`, HEAD `f124880` (after `b841490` "load/refresh/clear handles, variadic loader arguments,
key option" and `b268e36` "finish the handles migration").

## Scope

- `lib/src/Carburetor`: store core (`Store/Carburetor.ts`, write proxy, install/emit/transaction,
  update wave, throttle), observation (`watchSelection`), `Derived/Computed.ts`, tooling (`persist`,
  `CarburetorHistory`, `connectDevTools`, `waitForUpdate`), resources (`ResourceCarburetor`, answer
  memory, keys, `ResourceCache*`, eviction ledger, readers), components (`AntiHookComponent` fragments,
  `bind`, scope/provider).
- `lib/src/Interop`: `useCarburetorValue`, `useResourceValue`, `createResourceReader`, `useComputedValue`.
- `native/src`: rule registry/locate, `support/bases.rs`, `no_store_write_in_render`,
  `no_module_level_store`, `require_bind_for_passed_method`.
- `plugin/src/Utils/Native`: `nativeBridge.mts`, `nativeRule.mts`, `offsetAt.mts`.

Out of scope: style, naming, performance unless it causes a wrong result; the demo app (`lib/src/ToDo`).

## Method

Read-only static analysis: source reading and tracing, `git show`/`git log` of the two handle commits,
the resource-handles plan (`docs/reviews/resource-handles-plan-2026-10-15.md`), README, `docs/api-reference.md`,
`docs/promise-cache.md`, `docs/hazards.md`, and the tests named in each finding. Nothing was built, run
or edited besides this report.

- **OBSERVED** — the faulty path was traced end-to-end in the code; the reproduction follows directly
  from the lines cited.
- **INFERRED** — the code path is traced, but the outcome also depends on host behaviour (React,
  ESLint/oxlint, React Native) that was not executed here.

---

## Findings

### BUG-01 — `ResourceCarburetor` answer memory is unbounded by default and never prunes stale entries (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Resource/Slot/answerMemory.ts:15-43`, `lib/src/Carburetor/Resource/ResourceCarburetor.ts:93-96`.

`createAnswerMemory(options.ttl, options.maxEntries)` receives `undefined` for both when they are omitted:
`isFresh` returns `true` forever, and `remember` skips eviction (`if (maxEntries === undefined) return;`).
`fresh(key)` returns `undefined` for a stale entry **without deleting it**, so with a `ttl` but no
`maxEntries` the map also keeps every expired answer.

**Reproduction.**

```ts
const search = new ResourceCarburetor<Hit[], [string]>((q, signal) => api.search(q, signal));
for (const q of userTypedQueries) await search.load(q);   // 'a', 'ab', 'abc', ...
// Every Hit[] ever returned stays reachable from search[R.memory] for the life of the store.

const withTtl = new ResourceCarburetor<Hit[], [string]>(load, {ttl: 1_000});
// Same growth: entries go stale but stay in the Map, never read again, never evicted.
```

**Expected.** The plan (§4) says "`ttl`/`maxEntries` validation and defaults match `ResourceCache`"
(30 s / 100 entries), and `docs/promise-cache.md` states "Eviction is not optional: without it the cache
grows by one entry per distinct argument set for the lifetime of the process."
**Actual.** Before `b841490` the slot retained one answer; now an unconfigured slot retains every
distinct answer forever — a memory leak by default, worst on module-level resources and long sessions.

**Why tests miss it.** `__tests__/Engine/Resource/Handles/AnswerMemory.test.ts` exercises LRU only with
an explicit `maxEntries`, and ttl expiry only through the hit path; nothing asserts the map size after
stale entries or with default options. `MemoryOwnership.test.ts` is about ownership, not size.

**Fix.** Default `maxEntries` to the cache's `DEFAULT_MAX_ENTRIES` (or a small number such as 100) and
document it; delete the entry in `fresh()` when it is found stale; optionally sweep from the LRU head in
`remember()` while the oldest entry is stale.

---

### BUG-02 — `await resource.load(args)` resolves while the slot is still `Pending` when a same-key `refresh` supersedes it (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Resource/ResourceCarburetor.ts:100-103` (refresh forces a restart),
`:378-392` (`cancelInFlight` aborts the joined request), `:473-476` (settlement → `resolveRequest`),
`:544-545` / `:568-569` (a non-current request returns early, i.e. **resolves**).

**Reproduction.**

```ts
const user = new ResourceCarburetor<User, [string]>(fetchUser);
const first = user.load('a1');      // request r1
void user.refresh('a1');            // aborts r1, starts r2 for the same key
await first;                        // resolves as soon as r1's loader settles (resolve or AbortError)
user.getData().status;              // EResourceStatus.Pending — data not there yet
```

The same early "success" is reported for a load superseded by `load(otherKey)`, `abort()`, `clear()`
and `restore()`, while a request superseded **before** its loader started rejects with `AbortError`
(`createSupersededError`, README "that load rejects with AbortError instead of reporting a successful
load that never ran"). So the outcome of the same supersession depends on timing.

**Expected.** `load()` "joins the one already in flight for the same arguments" — a caller that awaited
it should observe the answer of the request that owns the key (r2), or at least a rejection.
**Actual.** The promise resolves with stale/Pending state; `await load(); render(getData().data)`
patterns read `undefined`.

**Why tests miss it.** `__tests__/Engine/Resource/Handles/MemoryOwnership.test.ts` ("load of a key being
refreshed joins the refresh…") checks that a *later* `load` joins `r2`; `ResourceLifecycle.test.ts` and
`ReentrantLoads.test.ts` check state, not the resolution of the *earlier* promise.

**Fix.** Keep a per-request "successor" link: when `cancelInFlight` is followed by a new request for the
same key, settle the superseded promise with the successor's promise (`resolveRequest(successor.promise)`);
when the supersession is for another key or a cancel, reject with `AbortError`, matching the
pre-start rule. Document the chosen contract either way.

---

### BUG-03 — `ResourceCache.refresh()` joins an in-flight request instead of "always requesting"; a post-mutation refresh can return pre-mutation data as fresh (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts:54-58` (`runRefresh` → `R.fetch`),
`:94-96` (`R.fetch` returns any known request).

**Reproduction.**

```ts
const users = new ResourceCache<User, [string]>(fetchUser, {ttl: 30_000});
users.suspend('a1');                // stale entry → background revalidation r1 starts (GET at t0)
await api.renameUser('a1', 'Bob');  // server state changes after r1 was sent
await users.refresh('a1');          // joins r1, no new request
users.getEntry('a1').data.name;     // old name; entry is Success, invalidated=false, fresh for 30 s
```

**Expected.** README table: "`refresh(...args)` | Always requests, even when the key already has a
value"; `docs/api-reference.md:16`: "`refresh` always fetches". `ResourceCarburetor.refresh` does
restart (`force = true`), and the README presents both classes as exposing "the same three handles".
**Actual.** The cache refresh silently returns the older answer and stamps it fresh.

**Why tests miss it.** `__tests__/Engine/Resource/ResourceCacheRefresh.test.ts:130` asserts the join
("a refresh next to a load of the same arguments joins it") as intended behaviour, so the documented
contract and the test disagree; no test covers a mutation between the joined request and the refresh.

**Fix.** Either make cache `refresh` restart like the slot (abort the in-flight request for that key and
start a new one), or bump `runtime.invalidationEpoch` when `refresh` joins so the joined answer lands
`invalidated` and the reader re-arms. If the join is kept, change README/api-reference to say so.

---

### BUG-04 — The default key collides for common non-JSON arguments and throws synchronously for others; answer memory now serves the wrong data (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Resource/Keys/defaultResourceKey.ts:4-11`, used by
`ResourceCarburetor[R.keyOf]` (`ResourceCarburetor.ts:481-485`) and `ResourceCache[R.keyOf]/[R.primed]`.

`JSON.stringify` is the whole encoding:

| arguments | key |
|---|---|
| `new Map([['q','a']])`, `new Map()`, `new Set([1])` | `{}` |
| `NaN`, `Infinity`, `null`, `undefined`, no argument | `null` |
| `new Date(0)` and the string `'1970-01-01T00:00:00.000Z'` | same key |
| `[1, undefined, 2]` and `[1, null, 2]` | same key |
| `() => x`, `Symbol()` | `undefined` (not a string) |
| `1n`, a circular object | `TypeError` thrown synchronously by the bound handle |

**Reproduction.**

```ts
const report = new ResourceCarburetor<Rows, [Map<string, string>]>(fetchRows);
await report.load(new Map([['region', 'EU']]));
await report.load(new Map([['region', 'US']])); // same key '{}' → skipped as fresh: EU rows shown for US

const byId = new ResourceCache<User, [number]>(fetchUser);
byId.load(Number(routeParam));                   // NaN shares the entry of load(null)/load()

onClick={() => void big.load(10n)}               // throws TypeError out of the handler, not a rejection
```

**Expected.** Distinct arguments get distinct answers, or the call is rejected with a clear error.
**Actual.** Silent wrong-answer sharing. Before `b841490` a collision mostly caused a skipped/joined
request for the *current* answer; with D1 memory any earlier answer under the colliding key is served.
The documented guard for this, H24 `no-unserializable-cache-args` (`docs/hazards.md:71`), is listed in
the rule index with severity `warn` but is "not implemented yet" (`docs/hazards.md:962`) — there is no
such rule in `native/src` or `plugin/src`.

**Why tests miss it.** `Resource/Keys/VariadicArgs.test.tsx`, `Resource/Keys/CustomKeyEncoding.test.ts`
and `ResourceCache/Core/KeyOption.test.ts` use only strings, finite numbers and plain objects.

**Fix.** Validate default-key inputs: accept primitives except non-finite numbers, plain objects and
arrays; throw a `TypeError` naming the `key` option for Map/Set/Date/class instances/functions/symbols/
bigint (or encode them with a type tag). Convert key-derivation failures inside `load`/`refresh` into a
rejected promise. Mark H24 as "not implemented" in the rule index.

---

### BUG-05 — `@bind` binds the base implementation, so a subclass override without its own `@bind` is silently ignored; `@bind` on a `#private` method is a no-op (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Component/bind.ts:153-162`.

The initializer defines an own property `method.bind(this)` where `method` is the decorated function
captured at decoration time. Initializers of the base class run inside the base constructor, so the
own property shadows any override on a subclass prototype.

**Reproduction.**

```ts
class Base extends AntiHookComponent {
    @bind protected onSave(): void { console.log('base'); }
    render() { return <button onClick={this.onSave}>save</button>; }
}
class Audited extends Base {
    protected onSave(): void { audit(); super.onSave(); }   // no @bind
}
// Clicking in <Audited/> logs 'base' only; audit() never runs. this.onSave() calls Base too.

class Row extends AntiHookComponent {
    @bind #toggle(): void { this.props.onToggle(); }        // context.name === '#toggle'
    render() { return <input onChange={this.#toggle}/>; }   // unbound: `this` is undefined
}
```

For private methods `Object.defineProperty(this, '#toggle', …)` creates a public string key named
`"#toggle"`; `this.#toggle` still resolves to the unbound private method.

**Expected.** The doc comment promises that, unlike an arrow property, "the method stays on the
prototype" so overriding keeps working.
**Actual.** Overriding works only if every override is re-decorated; private methods are not bound.

**Why tests miss it.** `__tests__/Engine/Component/bind.test.tsx` covers an override that also carries
`@bind` and no private method. `require_bind_for_passed_method.rs` keys facts by `(class, method)`, so
a base that passes `this.onSave` is considered bound.

**Fix.** Bind the most-derived method at initialization: `const fn = (this as any)[context.name];`
(or `context.access.get(this)`), then define the own property with `fn.bind(this)`. Throw for
`context.private` (private methods are not writable) with a message pointing to an arrow field or a
public method.

---

### BUG-06 — The lint bridge reports disk-based diagnostics onto in-memory text (unsaved buffers, `--fix` passes, stdin) at the wrong positions (P2, INFERRED)

**Where.** `plugin/src/Utils/Native/nativeRule.mts:76-120`, `plugin/src/Utils/Native/nativeBridge.mts:267-310`,
`plugin/src/Utils/Native/offsetAt.mts:16-25`, `native/src/rules/mod.rs:135-146`.

The binary reads files from disk; `runNativeOnce` re-scans only when the file's **mtime** moved. The
rule then maps `line/column` onto `context.sourceCode.getText()` — the host's in-memory text.

**Reproduction.**

1. ESLint `--fix` with any other fixable rule that inserts a line above a carburetor violation:
   pass 2..10 lint the fixed text in memory, disk is unchanged, so the cached native diagnostics are
   reported one line off (and `offsetAt` can return an offset beyond the text end).
2. Editor integration: type above a reported line without saving — the squiggle stays at the old
   line/column of the saved file. The bridge comment says "Unsaved buffers are never analyzed", but
   their stale diagnostics are still emitted.
3. A line containing an astral character (emoji) before the reported column: native counts Unicode
   scalar values (`chars().count()`), JS strings are UTF-16, so `range` is one unit short per astral char.

**Why tests miss it.** `__tests__/Plugin/host.test.ts` lints saved fixtures once;
`nativeBridgeFreshness.test.ts` covers mtime freshness only; no test lints text that differs from disk.

**Fix.** Have native emit a content hash per file (or let the bridge hash the file it scanned) and skip
(or re-scan from a temp copy of `getText()`) when the host text differs; emit UTF-16 columns or byte
offsets and convert in JS; clamp offsets to `text.length`.

---

### BUG-07 — `no-module-level-store` does not recognise `ResourceCache`; store-class rules ignore `extends ResourceCache` (P2, OBSERVED)

**Where.** `native/src/rules/support/bases.rs:13` (`CARBURETOR_BASES = ["Carburetor", "ResourceCarburetor"]`),
`native/src/rules/boundaries/no_module_level_store.rs:87` (`name.ends_with("Carburetor")`),
`native/src/rules/support/walk.rs:189` (`in_carburetor`).

**Reproduction.**

```ts
// .carburetorrc: "carburetor/no-module-level-store": "error" (an SSR project)
export const users = new ResourceCache<User, [string]>(fetchUser);  // not reported
class Orders extends ResourceCache<Order, [string]> {}
export const orders = new Orders(fetchOrder);                       // not reported
class Users extends ResourceCache<User, [string]> {
    rename(id: string) { this.draft.entries[id].data!.name = 'x'; } // H6 require-emit-after-draft-write: not reported
}
```

**Expected.** H18 exists to catch module-level stores in server-rendered apps; a module-level cache of
per-user API answers is the most damaging case (README's own `UserPage` example declares one).
**Actual.** No diagnostic; likewise H6/H7/H19 never run inside a `ResourceCache` subclass even though the
README documents "a subclass's draft/update action" on caches.

**Why tests miss it.** The tests in `no_module_level_store.rs` use `*Carburetor` names and a local
`extends Carburetor` only.

**Fix.** Add `ResourceCache` to `CARBURETOR_BASES` and to the H18 name heuristic (and keep the JS list in
sync); add fixtures for both.

---

### BUG-08 — `no-store-write-in-render` flags read-only `getFailure()` / `resolve()` as writes (P3, OBSERVED)

**Where.** `native/src/rules/data/writes/no_store_write_in_render.rs:28-42`.

```tsx
render() {
    const view = this.useResource(reports, this.props.period);
    const cause = reports.getFailure(this.props.period);   // reported: "getFailure() changes a store…"
    return <Report view={view} cause={cause}/>;
}
```

`getFailure` and `resolve` are the read half of `IResourceSource`/`ResourceCache`
(`docs/api-reference.md:18`); neither publishes. The rule's `READ_METHODS` lists `getEntry` and
`getLastError` but not these, so the error-severity rule pushes users to move reads out of render.

**Why tests miss it.** The rule's tests cover `getEntry`, `snapshot`, `suspend`, `load`, `clear`.

**Fix.** Add `getFailure` and `resolve` to `READ_METHODS` with a test each.

---

### BUG-09 — A computed whose body throws during settlement is never delivered: components keep showing the last value and, in production, nothing is reported (P2, OBSERVED)

**Where.** `lib/src/Carburetor/Derived/Computed.ts:537-568` (`settle` → `recompute` throws before
delivery), `lib/src/Carburetor/Store/Scheduling/UpdateWave.ts:73-82` (failure collected and reported only
in development), `lib/src/Carburetor/Store/Carburetor.ts:413-447` (store notification always runs
inside a wave, so settlement is always deferred to the drain).

**Reproduction.**

```tsx
const total = new Computed(read => {
    const cart = read(cartStore);
    if (cart.items.some(i => i.price < 0)) throw new Error('bad price');
    return cart.items.reduce((s, i) => s + i.price, 0);
});
class Total extends AntiHookComponent {
    render() { return <b>{this.useComputed(total)}</b>; }
}
cartStore.addItem({price: -1});
// Production: no render, no error boundary, no console output — <Total/> shows the old sum.
// It throws only if something else happens to re-render <Total/> later.
```

**Expected.** A failing derivation reaches the reader: the subscriber is woken so its next `get()` in
render rethrows into the error boundary (Computed keeps `valid = false`, so it would).
**Actual.** The failure is swallowed; UI shows stale data indefinitely.

**Why tests miss it.** `__tests__/Engine/Derived/Computed/ErrorIsolation.test.ts:235` ("a failing body is
not announced as a success…") and `computed41/Dependencies.test.ts:140` assert non-delivery and the
development message, i.e. the engine side; no component-level test checks that the error surfaces.

**Fix.** On a settlement failure, still deliver to value observers (without bumping the announced value),
or deliver a version bump flagged as failed so `useComputed`/`useComputedValue` re-render and rethrow.

---

### BUG-10 — `ResourceCarburetor.suspend()` suspends on a ttl-stale answer instead of serving it; risky at hydration (P3, INFERRED)

**Where.** `lib/src/Carburetor/Resource/ResourceCarburetor.ts:311-332`.

With `ttl`, a Success answer whose `Date.now() - updatedAt >= ttl` falls through to
`throw this[R.start](args, true, …)`: the visible content is replaced by the Suspense fallback on any
re-render after expiry. `ResourceCache.suspend` returns the stale value and revalidates
(`ResourceCacheLifecycle.ts:68-72`). After SSR, `updatedAt` is the **server** clock; a client clock ahead
of the server by more than `ttl` (or a cached HTML page older than `ttl`) makes the first hydration render
start a request from render and suspend, and the hydrated tree can then mismatch the server HTML when
the fresh answer differs.

```tsx
const profile = new ResourceCarburetor<Profile, [string]>(fetchProfile, {ttl: 5_000});
// 6 s later a parent re-renders:
render() { return <Card p={profile.suspend('a1')}/>; }   // fallback flashes although data is present
```

**Why tests miss it.** `__tests__/Engine/Resource/Handles/Stale/StaleRequests.test.ts:24` asserts the
suspension as intended (plan D4 "every read path requests again"); no SSR test uses `ttl`.

**Fix.** Keep D4's request but serve stale data while revalidating (start with deferred publication,
return `state.data`), as the cache does; or document the fallback and the clock-skew hazard.

---

### BUG-11 — Settlement, `abort()` and memory publication write readonly/accessor state through `draft` without preparation (P3, OBSERVED path / INFERRED trigger)

**Where.** `ResourceCarburetor.ts:544-560` (`settleSuccess`), `:568-597` (`settleError`), `:341` (`abort`);
`ResourceCacheLifecycle.ts:255-269`, `:312-323`; `Keys/prepareMemorySuccess.ts:12,25` vs
`Slot/prepareSlotRequest.ts:26-30`.

`start()` prepares an owned writable graph when fields are readonly (`prepareSlotRequest`), but a keyless
`setData` does not cancel the request (README), and settlement then writes straight into `this.draft`.

```ts
const r = new ResourceCarburetor<string, []>(load);
const p = r.load();
const s = {...r.getData()};
Object.defineProperty(s, 'status', {value: s.status, writable: false, enumerable: true, configurable: true});
r.setData(s);          // keyless replacement, request stays in flight
await p;               // rejects: TypeError "'set' on proxy: trap returned falsish for property 'status'"
// runtime.request cleared, memory not written, state stuck in the replaced form.
```

`prepareMemorySuccess` also treats an accessor descriptor (`writable === undefined`) as writable, unlike
`prepareSlotRequest`, which requires `'value' in descriptor`.

**Why tests miss it.** `Resource/StatusFlags/StatusFlagsReadonlyRequest.test.ts` installs the readonly
field **before** `load`; `MemoryOwnership.test.ts` covers owned readonly replays, not readonly
`setData` during a request.

**Fix.** Route settlement/abort through the same `prepare*`/`commitState` path as `start`, and align the
writability predicate (`'value' in descriptor && writable !== false`) across the three helpers.

---

### BUG-12 — `dropEventArgs` passes non-DOM synthetic events (React Native) to the loader and into the key (P3, INFERRED)

**Where.** `lib/src/Carburetor/Resource/Slot/dropEventArgs.ts:5-9`.

Without a global `Event` the helper returns the arguments unchanged, and even with one it only drops
objects whose `nativeEvent instanceof Event`. A React Native `onPress={config.load}` hands a
`GestureResponderEvent` (plain-object `nativeEvent`) as the first argument: the loader receives it in
the signal position (`fetch(url, {signal: event})` throws), and `defaultResourceKey([event])`
JSON-encodes a large, possibly circular object (TypeError) or produces a meaningless key.

**Why tests miss it.** `Handles/EventHandles.test.tsx:71` ("handles work where no global Event exists")
calls `load()`/`refresh()` with **no** arguments.

**Fix.** Duck-type synthetic events (`typeof first.nativeEvent === 'object' && typeof first.isDefaultPrevented === 'function'`)
or document that handles must not be passed directly as handlers outside the DOM.

---

### BUG-13 — Freshness boundary differs between the slot and the cache; `ttl: 0` on a cache is fresh within the same millisecond (P3, OBSERVED)

**Where.** `ResourceCacheState.ts:403-407` (`Date.now() - updatedAt > ttl`) vs `answerMemory.ts:19-23`
(`< ttl`, i.e. stale at `>= ttl`).

```ts
const c = new ResourceCache<number, [string]>(load, {ttl: 0});
await c.load('a');
await c.load('a');   // same millisecond: entry still fresh → no request, although ttl 0 means "always stale"
```

**Why tests miss it.** No test uses `ttl: 0` on `ResourceCache`; `AnswerMemory.test.ts` uses fake time
well past the boundary.

**Fix.** Use one predicate (`>= ttl` is stale) in both places and document it.

---

### BUG-14 — `persist()` silently deletes an unrestorable stored entry when no `onError` is given (P3, OBSERVED)

**Where.** `lib/src/Carburetor/Tooling/persist.ts:37-52`.

A failed **read** throws without `onError` ("rather than pretending storage was empty"), but a failed
`JSON.parse`/`restore` calls `options.onError?.(error)` (a no-op) and then `storage.removeItem(key)`.
A transient restore failure (a throwing `didSetData`/patch observer, a development state-model check
after a library upgrade) permanently erases the user's persisted state with no signal.

**Why tests miss it.** Persistence tests pass `onError` when they exercise malformed entries.

**Fix.** Without `onError`, rethrow before removing (same policy as the read path), or at least report
through `diagnostics` before deleting.

---

### BUG-15 — `connectDevTools` re-publishes time travel as a new action under a deferred scheduler (P3, INFERRED)

**Where.** `lib/src/Carburetor/Tooling/connectDevTools.ts:62-91`.

`applyingTimeTravel` is reset in `finally` right after `fromJSON`; with `ComponentUpdateThrottle`, inside
a `transaction`, or for stores that publish via `emitSoon`, the subscriber runs later, sees the flag
`false` and sends `name/update`. DevTools treats it as a new action and discards the states after the
jump target.

**Why tests miss it.** DevTools tests use the default synchronous scheduler.

**Fix.** Compare the composed state/versions against the jumped-to payload, or record the versions
installed by the jump and skip the next publication whose versions match.

---

### BUG-16 — Handles are own instance properties: a JS subclass `load()`/`refresh()` method is shadowed (P3, OBSERVED)

**Where.** `ResourceCarburetor.ts:99-104`, `ResourceCacheLifecycle.ts:38-39` (vs
`ResourceCacheState.ts:72`, where `clear` is bound dynamically and therefore still overridable).

```js
class Users extends ResourceCache {
    load(id) { track('load', id); return super.load(id); }   // never called: the constructor's own
}                                                            // `this.load` shadows the prototype method
```

TypeScript rejects such an override (TS2425), so typed code fails to compile after the upgrade while
plain-JS subclasses silently lose their override; the CHANGELOG "Breaking" note does not mention it.

**Fix.** Bind dynamically like `clear` (`this.load = this.load.bind(this)` over a prototype method that
drops event args), or note the break in the CHANGELOG.

---

### BUG-17 — `ResourceCache.clear()` does not cancel requests whose entry is already gone (P3, OBSERVED)

**Where.** `lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts:328-356`.

`clear()` iterates `Object.keys(this.data.entries)` and returns early when it is empty. A request whose
entry was removed by `setData` (which does not abort) keeps running: the loader is never aborted, and its
answer is dropped later in `settleSuccess`. The documented contract is "Cancels requests, drops stored
answers".

```ts
void cache.load('a');               // request in flight
cache.setData({entries: {}});       // entry gone, request still owned by runtime
cache.clear();                      // keys = [] → returns; fetch for 'a' is not aborted
```

**Why tests miss it.** `ResourceCacheLifetime/AbortAll.test.ts` and `Handles/CacheD2.test.tsx` clear
caches whose requests still have entries.

**Fix.** Also walk `this[R.runtimeRecords]` and abort every live request (as `abortAll` does) before or
after removing entries.

---

## Summary

| ID | Title | Area | Priority | Status |
|---|---|---|---|---|
| BUG-01 | Slot answer memory unbounded by default, stale entries never pruned | resources | P2 | OBSERVED |
| BUG-02 | `await load()` resolves while Pending when superseded by same-key `refresh` | resources | P2 | OBSERVED |
| BUG-03 | `ResourceCache.refresh` joins in-flight request, contradicts "always requests" | resources | P2 | OBSERVED |
| BUG-04 | Default key collisions (Map/Set/NaN/Date) and sync throws; memory serves wrong data | resources | P2 | OBSERVED |
| BUG-05 | `@bind` ignores subclass overrides; no-op on `#private` | components | P2 | OBSERVED |
| BUG-06 | Lint bridge maps disk diagnostics onto in-memory text | plugin | P2 | INFERRED |
| BUG-07 | `no-module-level-store` and store rules ignore `ResourceCache` | native lint | P2 | OBSERVED |
| BUG-08 | `no-store-write-in-render` false positive on `getFailure`/`resolve` | native lint | P3 | OBSERVED |
| BUG-09 | Computed settlement failure swallowed; UI stale, silent in production | computed | P2 | OBSERVED |
| BUG-10 | Slot `suspend` suspends on stale answer; hydration/clock-skew risk | resources/SSR | P3 | INFERRED |
| BUG-11 | Settle/abort/memory publish write readonly/accessor state unprepared | resources | P3 | OBSERVED / INFERRED |
| BUG-12 | `dropEventArgs` misses React Native synthetic events | resources | P3 | INFERRED |
| BUG-13 | Freshness boundary differs; cache `ttl: 0` fresh within 1 ms | resources | P3 | OBSERVED |
| BUG-14 | `persist` deletes unrestorable entry silently without `onError` | tooling | P3 | OBSERVED |
| BUG-15 | DevTools time travel re-published under deferred delivery | tooling | P3 | INFERRED |
| BUG-16 | Own-property handles shadow subclass `load`/`refresh` | resources | P3 | OBSERVED |
| BUG-17 | `ResourceCache.clear()` leaves orphaned requests running | resources | P3 | OBSERVED |

Counts: P0 — 0, P1 — 0, P2 — 8, P3 — 9.

No P0/P1 defect was found: the store core, write proxy, subscription/commit lifecycle (Strict Mode replay,
Suspense hide/reveal, abandoned attempts), history and the interop hooks held up under the traces made for
this review. The new defects cluster in the resource-handles change (BUG-01…04, 10…13, 16, 17) and in the
lint tooling's coverage of `ResourceCache` and of in-memory text (BUG-06…08).
