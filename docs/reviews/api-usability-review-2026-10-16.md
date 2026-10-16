# API simplicity and usability review — 2026-10-16

Revision reviewed: `master` at `f124880` (package version `0.1.0`, not yet published on npm).

## Scope

The public surface as a user meets it:

- package entry points: `react-carburetor` (`lib/src/Carburetor/index.ts`), `react-carburetor/interop`
  (`lib/src/Interop/index.ts`), `react-carburetor/lint` and the two oxlint presets;
- stores: `Carburetor`, `draft`, `update`, `emitUpdate`, `setData`, `watch`, `transaction`, schedulers;
- components: `AntiHookComponent` (`useCarburetor`, `connect`, `connectSelection`, `useComputed`,
  `useResource`, `useEffects`/`useEffect`/`unUseEffects`), `@bind`, `ScopedAntiHookComponent`;
- resources: `ResourceCarburetor`, `ResourceCache` (`load`/`refresh`/`clear` handles, `key` option,
  variadic loader arguments), `computed`;
- scopes and tokens, history/persist/devtools tooling, hooks interop, lint plugin configuration;
- `README.md`, `docs/*.md` and `examples/` as the user-facing contract.

Out of scope: engine internals, performance and correctness of the tracking engine, except where
they leak into what a user has to learn.

## Method

Read-only review. Sources read: the public entry points and every class or function they
re-export, the TSDoc on public members, the README, `docs/api-reference.md`, `docs/promise-cache.md`,
`docs/rules.md`, `docs/hazards.md` (sections H6, H12, H15, H30, H32, "Not hazards"),
`docs/adopting.md`, `docs/faq.md`, `docs/troubleshooting.md`, `docs/examples/README.md`, the plugin
presets (`plugin/src/recommended.mts`, `plugin/recommended.oxlintrc.json`, `plugin/src/index.mts`),
`rslib.config.ts`, and usage counts across `examples/` and the demo in `lib/src/ToDo`. No tests,
builds or programs were run.

Each finding is marked:

- **OBSERVED** — read directly in code or docs at the cited lines;
- **INFERRED** — follows from the code but was not executed or reproduced.

Priorities: **P1** — a newcomer is likely to hit it and the result is silent or contradicts the
project's own guidance; **P2** — real friction or an inconsistency that costs learning time;
**P3** — polish.

Migration cost is judged against the fact that `0.1.0` has never been published: renames and
signature changes are cheapest now and become semver-major after the first release.

---

## Findings

### API-01 — `update()` cannot take arguments, so the "recommended" write form is linted against and rarely used

**P1 · OBSERVED**

Locations:
- `lib/src/Carburetor/Store/Carburetor.ts:493` — `protected update(mutate: (draft: T) => void): void`
- `lib/src/Carburetor/Store/Carburetor.ts:561-563` — the dev diagnostic says
  *"Prefer this.update(draft => ...), which does both."*
- `README.md:129-131`, `README.md:175-178`, `README.md:1397` — `update` is "the recommended write form".
- `docs/adopting.md:12-13` — "Methods that write go through `this.update((draft) => {...})`".
- `docs/faq.md:33` — "mutate a draft inside `update()`".
- `docs/rules.md:112`, `docs/rules.md:134`; `docs/hazards.md:1158`, `docs/hazards.md:1203-1241` —
  `no-closure-in-update` (H32) warns on any capturing inline callback, and
  `require-module-function` (H30) warns on the non-capturing inline one too
  ("`this.update(draft => { draft.count += 1; })` is an H30 finding under both `all` and `classes`").

Problem. Almost every real write is parameterised, and `update` has no way to pass the parameters
except a closure, which the recommended lint preset reports. The hazard catalogue's "Right" answer
is to go back to the two-step form that `update` exists to replace, plus a hand-written
`try/finally`:

```ts
// What the docs and the dev diagnostic recommend — reported by the recommended preset:
public rename(id: string, title: string): void {
    this.update((draft) => { draft.items[id].title = title; });   // H32 warning
}

// What hazards.md H32 tells the user to write instead:
public rename(id: string, title: string): void {
    try {
        this.draft.items[id].title = title;
    } finally {
        this.emitUpdate();                                         // forget it -> H6
    }
}
```

The repository itself votes with its feet: `examples/` and `lib/src/ToDo` contain 33
`this.emitUpdate()` calls and 14 `this.update(...)` calls, and every `update` call passes an
argument-less module function (`increment`, `incrementValue`). The README's headline `Counter`
example (`README.md:28-34`) uses `draft` + `emitUpdate`, not `update`. A whole rule
(`require-emit-after-draft-write`) and a dev-time microtask check exist only to catch the forgotten
second half of the form users are pushed back to.

Proposal. Make `update` variadic so the mutator can stay a module-level function:

```ts
// before
protected update(mutate: (draft: T) => void): void

// after
protected update<A extends readonly unknown[]>(mutate: (draft: T, ...args: A) => void, ...args: A): void
```

```ts
const renameTodo = (draft: ITodoList, id: string, title: string): void => {
    draft.items[id].title = title;
};

export class TodoCarburetor extends Carburetor<ITodoList> {
    public rename(id: string, title: string): void {
        this.update(renameTodo, id, title);   // no closure, no try/finally, publication guaranteed
    }
}
```

Then make docs, the dev diagnostic (`Carburetor.ts:561-563`) and `adopting.md` show this form,
and narrow H32's "Right" section to it. `draft` + `emitUpdate()` stays available for the rare
multi-phase write.

Migration cost: low. Additive, source-compatible signature; doc and example rewrite.

---

### API-02 — `ResourceCache.clear(...args: unknown[])` accepts an id and silently clears the whole cache

**P1 · OBSERVED**

Locations:
- `lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts:328` —
  `public clear(...args: unknown[]): void` (args dropped, every entry removed, every request aborted).
- Siblings take a key: `forget(...args: TArgs)` (`:316`), `invalidate(...args: TArgs)` (`:272`),
  `abort(...args: TArgs)` (`:248`).
- `ResourceCarburetor.clear` is typed `() => void` (`lib/src/Carburetor/Resource/ResourceCarburetor.ts:120`).
- Naming: `invalidate`/`invalidateAll`, `abort`/`abortAll`, but `forget`/`clear`;
  `docs/promise-cache.md:123-125` argues the `...All` split is needed to avoid exactly this ambiguity.

Problem. The untyped rest parameter exists so the bound handle can sit in `onClick`, but it also
makes this compile:

```ts
users.invalidate(id);   // one entry
users.forget(id);       // one entry
users.clear(id);        // compiles; drops EVERY entry and aborts EVERY request
```

Proposal. Type the handle as `() => void`. A zero-parameter function is already assignable to
`MouseEventHandler`, so `onClick={users.clear}` keeps compiling; the runtime event-dropping stays.

```ts
// before
public clear(...args: unknown[]): void

// after (bound in the constructor, as today)
public clear: () => void;
```

Optionally add `forgetAll` as the documented name in the cache table (keeping `clear` as the
cross-class handle), so the `x`/`xAll` pattern is unbroken.

Migration cost: low. Type-only tightening; only call sites that were already wrong stop compiling.

---

### API-03 — The oxlint preset and the ESLint preset ship different rule sets

**P2 · OBSERVED**

Locations:
- `plugin/src/recommended.mts:18` — `'carburetor/no-closure-in-update': 'warn'` is in the ESLint map.
- `plugin/recommended.oxlintrc.json` — 26 rule lines, `no-closure-in-update` absent.
- `rslib.config.ts:48` copies that JSON verbatim to `dist/lint/recommended.oxlintrc.json`.
- `plugin/src/recommended.mts:12-13` claims "a test pins `recommended.oxlintrc.json` against it";
  no test in `__tests__/Plugin` compares the two (the only uses of the shipped JSON are in
  `packaging.test.ts:65`, a no-hooks smoke check).

Problem. The README calls the oxlint `extends` line the one-line setup. Users on that path silently
get one rule fewer than ESLint users and than `docs/rules.md:112` documents.

Proposal. Generate `recommended.oxlintrc.json` (and `no-hooks.oxlintrc.json`) from `RECOMMENDED` /
`NO_HOOKS` at build time instead of copying a hand-maintained file, or add the pinning test the
comment describes.

```ts
// rslib.config.ts — before
{from: './plugin/recommended.oxlintrc.json', to: './recommended.oxlintrc.json'},
// after: emit {jsPlugins: ['./index.mjs'], rules: RECOMMENDED} from the same module the ESLint config reads
```

Migration cost: none for users.

---

### API-04 — Contradictory guidance on the most basic operation: how to read a store

**P2 · OBSERVED**

Locations:
- `README.md:182` — "`connect()` is the default way to read a store".
- `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:51` — `useCarburetor` TSDoc:
  "The only way to read state in render".
- `docs/examples/README.md:19` — "Read store state in a class component → `this.useCarburetor(store)`".
- `README.md:24-45` (headline example), `docs/faq.md`, `docs/adopting.md` step 3 — all use `useCarburetor`.
- `README.md:213-218` — `connect` fixes object/array kind at declaration; a scoped store (resolver not
  resolvable at construction) or array root needs `useCarburetor` instead.

Problem. A newcomer gets three different answers for "how do I read state", and the one the README
calls the default has documented cases where it must not be used:

```tsx
class Rows extends ScopedAntiHookComponent {
    // README says connect() is the default...
    private readonly rows = this.connect(() => this.resolve(rowsToken)); // array root -> boundary error later
}
```

Proposal. Pick one default and say it everywhere. `useCarburetor` works in every case (`connect`'s
limitations are a subset of it), so the simplest contract is: "read with `this.useCarburetor(store)`;
`connect()` is an optimisation for a fixed store read many times". Fix the TSDoc on `useCarburetor`
("the only way") at the same time.

Migration cost: docs only.

---

### API-05 — The two resource classes share handle names but not semantics, defaults or accessor names

**P2 · OBSERVED**

Locations:
- `README.md:636-643` — "Both resource classes expose the same three handles".
- Refresh: `ResourceCarburetor` moves to `Pending` (`ResourceCarburetor.ts:420`,
  `Slot/prepareSlotRequest.ts:34-40`); `ResourceCache` keeps `Success` and raises `refreshing`
  (`Cache/ResourceCacheLifecycle.ts:216`).
- Failed refresh: slot goes to `Error` and the data becomes unreachable; cache keeps data
  (`docs/promise-cache.md:83-90`).
- Defaults: cache `ttl = 30_000`, `maxEntries = 100` (`Cache/State/Runtime/Models.ts:5-7`); slot
  `ttl` undefined = never stale, `maxEntries` undefined = unbounded (`Slot/answerMemory.ts:12-13`).
  Same option names, documented with different meanings for `maxEntries: 0`
  (`ResourceOptions.ts:12` vs `Models/Resource.ts:94`).
- Raw error: `getLastError()` (`ResourceCarburetor.ts:298`) vs `getFailure(...args)` (`ResourceCache.ts:434`).
- Abort: `abort()` (`ResourceCarburetor.ts:335`) vs `abort(...args)` + `abortAll()`.
- Reading: `this.useCarburetor(slot)` vs `this.useResource(cache, ...args)`; hooks
  `useCarburetorValue(slot, select)` vs `useResourceValue(cache, [args], select)`.

Problem. Moving from "one profile" to "many users" changes visible behaviour (spinner flash on
refresh, data lost on a failed refresh), the meaning of the same option, and the name of the error
accessor:

```ts
const profile = new ResourceCarburetor(loadProfile, {ttl: 30_000});
await profile.refresh();        // UI flashes Pending; a failure discards the shown data
profile.getLastError();

const users = new ResourceCache(loadUser, {ttl: 30_000});
await users.refresh('a1');      // stays Success + refreshing; a failure keeps the data
users.getFailure('a1');
```

Proposal, in order of ambition:

1. Align names: `getFailure()` on both (keep `getLastError` as a deprecated alias), same option
   defaults (`ttl: 30_000`, a finite `maxEntries`), same documented meaning for `0`.
2. Align refresh semantics: give the slot `refreshing` and keep `Success` + data on a failed refresh,
   exactly like a cache entry (`IResourceData` gains `refreshing`, as `IResourceEntry` already has).
3. Longer term, consider expressing the slot as a cache plus a "current key" view, so there is one
   resource concept with one set of rules.

Migration cost: 1 low; 2 medium (behavioural change for slot users); 3 high.

---

### API-06 — `ResourceCarburetor` defaults: answers never go stale and the per-key memory is unbounded

**P2 · OBSERVED** (leak/staleness consequence INFERRED)

Locations:
- `lib/src/Carburetor/Resource/Slot/answerMemory.ts:12-13, 20, 36` — `ttl` omitted ⇒ always fresh;
  `maxEntries` omitted ⇒ no eviction; `remember()` is called on every success
  (`ResourceCarburetor.ts:556`).
- `docs/examples/README.md:32-41` — the "Defaults" table lists only `ResourceCache` values.

Problem. The click-to-switch pattern the README recommends (`README.md:662-727`) keeps every
answer ever loaded, forever, and `load(id)` for a previously seen id never refetches:

```ts
const user = new ResourceCarburetor<User, [string]>(fetchUser);
for (const id of thousandsOfIds) await user.load(id);   // every answer retained for the process lifetime
await user.load(firstId);                               // served from memory, however old
```

Proposal. Give the slot the cache's defaults (`ttl: 30_000`) and a small finite memory
(`maxEntries` default, for example `1` or `100`), and add the slot's defaults to the Defaults table.

```ts
// before: createAnswerMemory<T>(options.ttl, options.maxEntries)
// after:  createAnswerMemory<T>(options.ttl ?? 30_000, options.maxEntries ?? DEFAULT_SLOT_MEMORY)
```

Migration cost: low (behavioural default change, pre-release).

---

### API-07 — `load()` / `refresh()` resolve when the loader fails, but reject when superseded

**P2 · OBSERVED**

Locations:
- `ResourceCarburetor.ts:473-476` and `Cache/ResourceCacheLifecycle.ts:175-178` — the loader
  rejection goes to `settleError`/`settleFailure`, which returns normally, so the request promise
  resolves.
- Supersession rejects with `AbortError` (`ResourceCarburetor.ts:391`, `docs/promise-cache.md:120-121`).
- `docs/api-reference.md:11-16` documents the return type as `Promise<void>` without saying either.
- `README.md:960` — the SSR example `await scope.get(userToken).load('a1')` before rendering.

Problem. The natural code does not work and nothing says so:

```ts
try {
    await profile.load({id});          // resolves even if fetch failed
    navigate('/profile');              // runs on failure too
} catch {
    showToast('failed');               // only reached for AbortError, the case nobody wants a toast for
}
```

Proposal. Resolve with the settled view, so callers can branch without a second read and without
turning every `void users.refresh()` in an event handler into an unhandled rejection:

```ts
// before
load(...args: TArgs): Promise<void>
// after
load(...args: TArgs): Promise<IResourceView<T>>   // (IResourceData<T> for the slot)

const result = await users.load(id);
if (result.isError) showToast(result.error);
```

At minimum, document in `api-reference.md` that the promise resolves on loader failure.

Migration cost: low (return type widens from `void`).

---

### API-08 — Suspense reads need two calls and a dummy field read

**P2 · OBSERVED**

Locations:
- `README.md:617-629` — `this.useCarburetor(profile)` must be called and a field read
  (`view.isPending`) only so that the component subscribes; "a call whose result is never read
  registers no field reads and would not wake".
- `README.md:825-831`, `README.md:871` — `SuspendingUser` calls `useResource` for the subscription
  and `suspend` for the value, discards `suspend`'s return value and reads `data?.name` (still
  `T | undefined`).

Problem.

```tsx
public render() {
    const {data} = this.useResource(users, this.props.id);  // subscribe
    users.suspend(this.props.id);                           // throw while pending; result ignored
    return <span>{data?.name}</span>;                       // '?.' although Suspense guarantees data
}
```

Proposal. One component method that subscribes to the entry's `data` and returns `T`:

```tsx
public render() {
    const user = this.suspendResource(users, this.props.id);   // T, subscribed, suspends/throws
    return <span>{user.name}</span>;
}
```

and the slot equivalent `this.suspendResource(profile, {id})`. `suspend()` on the classes can stay
for non-component use.

Migration cost: low (additive).

---

### API-09 — Class `useResource` returns a writable, coarse-grained facade unlike every other reader

**P2 · OBSERVED**

Locations:
- `Component/AntiHookComponent/Reads.tsx:381-384` — returns `IResourceView<T>` (not `TReadonly`).
- `Resource/Cache/Reader/createResourceFieldView.ts:15-34` — assignments, definitions and deletes
  succeed as local overrides.
- `README.md:1276-1278`, `docs/promise-cache.md:191-193`, `CHANGELOG.md` "Public contract" — class
  `useResource` "retains local-field behavior and coarser data precision": `data` is one dependency.

Problem. Three sibling readers, three contracts:

```tsx
const todos = this.useCarburetor(todoStore);
todos.count = 1;                         // compile error, and the proxy throws

const user = this.useResource(users, id);
user.data = undefined;                   // compiles and "works" locally
user.data?.name;                         // subscribes to the whole `data`, not to `data.name`

const name = useResourceValue(users, [id], v => v.data?.name);   // detached, readonly, precise
```

Proposal. Return `TReadonly<IResourceView<T>>` and serve `data` through the same tracked read proxy
`useCarburetor` uses, so `user.data.name` subscribes to `entries.<key>.data.name`. Drop the local
override handler.

Migration cost: medium (type tightening; behaviour of the field facade changes).

---

### API-10 — Loader signature: the trailing `AbortSignal` forces documented workarounds

**P2 · OBSERVED**

Locations:
- `Models/Resource.ts:21-23`, `Resource/Keys/TSignalLoader.ts:3-14`, three constructor overloads in
  `ResourceCarburetor.ts:76-92` and `ResourceCache.ts:108-123`.
- `README.md:645-655`, `docs/promise-cache.md:135-141`, `docs/api-reference.md:64` — a first
  parameter typed `unknown`/`any` is "taken for the signal"; optional, default and rest parameters
  are forbidden but only partly enforced; "prefer the explicit `id: string | undefined` form" and
  call `load(undefined)`.
- `examples/api/resources/resource-carburetor/click-switch.tsx:677-679` repeats the edge as a
  comment next to the user code.

Problem. Appending the signal after variadic arguments makes the argument tuple ambiguous, and the
docs spend a paragraph teaching around it:

```ts
new ResourceCache((filter?: string, signal?: AbortSignal) => ...)   // load() hands the signal to `filter`
new ResourceCarburetor((payload: unknown) => ...)                    // `payload` inferred as the signal
```

Proposal. Put the request context first, so the user arguments are an ordinary unconstrained tail:

```ts
// before
new ResourceCache<User, [string]>(async (id, signal) => fetchUser(id, {signal}));
// after
new ResourceCache(async ({signal}, id: string) => fetchUser(id, {signal}));   // TArgs inferred as [id: string]
```

With a context object first, optional/rest arguments become legal, the `unknown` edge disappears,
one constructor signature replaces three overloads, and the context can later carry more
(`key`, `previous`) without another breaking change.

Migration cost: high in principle (every loader), but the variadic form landed one commit ago
(`b841490`) and is unpublished — this is the cheapest moment it will ever be.

---

### API-11 — Bound handles sniff DOM events at runtime; React Native and event-shaped arguments are mishandled

**P2 · INFERRED**

Location: `lib/src/Carburetor/Resource/Slot/dropEventArgs.ts:3-12`, used by every `load`/`refresh`/`clear`.

Problem. `dropEventArgs` drops the first argument if it is a DOM `Event` or has a `nativeEvent`
that is one, and returns early when `Event` is undefined:

```tsx
// React Native: no global Event, so the press event is passed through as loader argument 0.
<Pressable onPress={config.load} />          // TArgs = []: the loader `(signal) => ...` receives the event as `signal`
// Browser: a legitimate argument object that happens to carry `nativeEvent` is silently dropped.
users.load({nativeEvent: domEvent, id: 'a1'});
```

Proposal. Prefer typing over sniffing: with API-02's `() => void` typing for zero-argument
handles, document `onClick={config.load}` only for `TArgs = []`, and make the zero-argument case
robust by arity instead of by event detection (the loader's declared arity is fixed by the
fixed-length rule, or explicit after API-10's context-first form). At minimum, treat any first
argument with a `nativeEvent` object as an event when `Event` is undefined.

Migration cost: low.

---

### API-12 — `scope.hydrate(payload, tokens)` silently drops state for any token the caller forgets to list

**P2 · OBSERVED**

Locations: `Component/Scope/CarburetorScope.ts:110-143`; `README.md:965-969`.

Problem. Hydration requires the caller to enumerate every token in the payload; an omitted token's
state is ignored (development-only warning), and the list must be maintained next to every new
token:

```ts
scope.hydrate(payload, [userToken]);   // added cartToken last week? its server state is dropped
```

Proposal. Hydrate lazily: keep the payload on the scope and apply `state[token.id]` the first time
`get(token)` creates the instance.

```ts
// before
const scope = new CarburetorScope();
scope.hydrate(JSON.parse(payload), [userToken, cartToken]);
// after
const scope = new CarburetorScope({initialState: JSON.parse(payload)});
```

Keep `hydrate(state, tokens)` for eager instantiation. The unclaimed-key diagnostic can then fire
on scope disposal or never, instead of guarding a list.

Migration cost: low (additive).

---

### API-13 — Overriding a lifecycle method without `super` silently disables the component; only lint protects it

**P2 · OBSERVED** (absence of runtime check) / proposal INFERRED feasible

Locations:
- `Component/AntiHookComponent/Foundation.tsx:204-233` — subscriptions, deferred loads and effects
  run from public `componentDidMount`/`componentDidUpdate`/`componentWillUnmount`/`shouldComponentUpdate`.
- No runtime detection of a missing `super` call in `lib/src/Carburetor/Component`.
- `README.md:1538-1539`, `docs/hazards.md` H12 — the guard is lint rule `require-super-in-lifecycle`.

Problem. The most familiar React class API is the one that breaks this base class:

```tsx
class Clock extends AntiHookComponent {
    componentDidMount() { this.timer = setInterval(...); }   // no super: never subscribes, never re-renders
}
```

Proposal. The base already installs `render` as a non-configurable own accessor at construction
(`Foundation.tsx:129-136`) so a subclass cannot bypass the render boundary. Apply the same idea to the
commit hooks — wrap the subclass's method so the base work always runs — or, more cheaply, add a
development check (a committed render attempt never consumed by `commitSubscriptions` means a
lifecycle override skipped `super`) that reports once with the hazard id.

Migration cost: low (no API change).

---

### API-14 — Lint recognition is syntactic and not configurable, so common class layouts lose coverage silently

**P2 · OBSERVED**

Locations: `docs/rules.md:138-153`, `README.md:1317-1320`, `docs/faq.md` ("How do I configure lint
rule scope?").

Problem. Only direct subclasses of `AntiHookComponent`/`ScopedAntiHookComponent` and
`Carburetor`/`ResourceCarburetor` are recognised; recognition "is not generally transitive" and
"names cannot be configured". `ResourceCache` is not a recognised store base at all:

```tsx
abstract class AppComponent<P> extends AntiHookComponent<P> { /* shared helpers */ }
class TodoRow extends AppComponent<IProps> {
    render() { const {count} = store.getData(); ... }   // H1 — not reported
}
class UsersCache extends ResourceCache<User, [string]> { ... }   // store rules — not applied
```

Proposal. Add `settings.carburetor.componentBases` / `storeBases` (and the `.carburetorrc.json`
equivalent), add `ResourceCache` to the default store bases, and document that unrecognised bases are
skipped — or warn once per file where a class extends an imported `react-carburetor` class
indirectly.

Migration cost: none for users.

---

### API-15 — Hook vocabulary on a "no hooks" class API

**P3 · OBSERVED**

Locations: `AntiHookComponent` members `useCarburetor`, `useComputed`, `useResource`, `useEffects`,
`useEffect`, `unUseEffects`; `docs/rules.md:95` ("Instance methods such as `this.useCarburetor()`
are not React hooks"); `docs/hazards.md:1266-1279` ("Not hazards" — conditional reads, loops, early
returns are fine).

Problem. The README sells "the core API needs no hooks", yet every class API is named like a hook,
and the docs must spend a section unteaching the rules of hooks that the names imply. The base
class is named by what it is not (`AntiHookComponent`), and `unUseEffects` is hard to guess.

```tsx
if (this.props.expanded) { const d = this.useCarburetor(store); }   // looks like a rules-of-hooks violation; is fine
```

Proposal (pre-release only). Neutral names: `this.read(store)`, `this.readComputed(c)`,
`this.readResource(cache, ...args)`, `effects()`/`effect(...)`, base `CarburetorComponent` (keep
the old names as deprecated aliases for one release if desired).

Migration cost: high in volume (code, docs, 27 lint rules that match on names), zero for external
users today. Only worth doing before the first publish.

---

### API-16 — Effects are keyed by a string name, and `unUseEffects` is a second teardown concept

**P3 · OBSERVED**

Locations: `Component/AntiHookComponent/Effects.tsx:23-29, 67-105`; `Foundation.tsx:216-221`
(`unUseEffects(prevProps)` before every `useEffects` pass); `docs/hazards.md` H15
(`no-duplicate-effect-name`, error).

Problem. A typo or copy-paste in the name overwrites another effect's cleanup (a whole error-level
rule exists for it), and per-effect cleanups already cover what `unUseEffects` does:

```tsx
this.useEffect('socket', openSocket, [url]);
this.useEffect('socket', openPresence, [room]);   // replaces the first effect's record; H15
```

Proposal. Accept the effect function itself as the key when it is stable (a module function or an
`@bind` method), keeping the string form for inline cases:

```tsx
// before
this.useEffect('channel', () => subscribe(this.props.channel), [this.props.channel]);
// after
this.useEffect(this.subscribeChannel, [this.props.channel]);   // keyed by method identity
```

Deprecate `unUseEffects` in favour of returned cleanups.

Migration cost: low (overload); deprecation is optional.

---

### API-17 — The README is not a usable contract: engine internals crowd out the API

**P2 · OBSERVED**

Locations: `README.md` is 1580 lines. Examples of internal mechanics in user-facing sections:
`README.md:261-296` (selection detachment descriptor rules), `README.md:603-613` (raw-rejection
ownership on `setData`), `README.md:1025-1098` (history "owned graphs", descriptor locks, replay
endpoints, "Producer patch copies retain restrictions…"), `README.md:1202-1229`, `README.md:1256-1278`.

Problem. The "Tooling" section introduces `persist`, `watch`, `CarburetorHistory`, `waitForUpdate`
in 25 lines and then spends 75 lines on history internals that no user decision depends on. A
newcomer cannot tell which sentences are promises they may rely on and which are implementation
notes. Several of the same paragraphs are repeated in `docs/promise-cache.md` and `CHANGELOG.md`.

Proposal. Keep the README to install, the core loop (store → read → write → effects), resources,
scopes and links; move descriptor/ownership/replay details to a `docs/internals.md` or the relevant
design note, and make `docs/api-reference.md` the authoritative contract table.

Migration cost: docs only.

---

### API-18 — Store objects expose engine protocol next to domain methods; protected signatures leak unexported types

**P3 · OBSERVED**

Locations:
- `Store/Carburetor.ts:238` `captureHistory`, `:396` `attachPatchListener` — public, documented as
  "the engine's internal protocol … not part of the stable public contract" (`README.md:1535-1537`).
- `Store/Carburetor.ts:510, 589` — protected `emitSoon(installation?: IStateInstallation, deferredContinuation?)`
  and `emitUpdate(installation?: IStateInstallation, deferredContinuation?)`; `IStateInstallation`
  comes from `Models/Paths`, which `index.ts:10-15` deliberately does not export.
- `Store/Carburetor.ts:493` — `update` is a reserved protected name.

Problem. Autocomplete on `todoCarburetor.` lists `attachPatchListener`, `captureHistory`, `fromJSON`,
`restore`, `read`, `getUID`… beside `renameTodo`. A subclass author hovering `this.emitUpdate` sees
internal parameters they must never pass. A domain method named `update(todo)` — a very common name —
conflicts with the protected base signature.

Proposal. Move `attachPatchListener`/`captureHistory` behind module symbols (as the rest of the
internal protocol already is), split the internal overload of `emitUpdate`/`emitSoon` into a
symbol-keyed method so the protected surface is `emitUpdate(): void` / `emitSoon(): void`, and
document `update` as reserved (or rename it `commit`, if API-01 is done anyway).

Migration cost: low for users (internal callers move to symbols).

---

### API-19 — Scope access: separate base class, `contextType` monopoly, and a `resolve` name clash

**P3 · OBSERVED**

Locations: `Component/ScopedAntiHookComponent.tsx:14, 32`; `Component/Scope/CarburetorScope.ts:25`;
`Resource/Cache/ResourceCache.ts:411`; `Foundation.tsx:184-185` (constructor forwards only `props`).

Problem.
- A second base class exists only to set `static contextType`; a component that needs its own
  `contextType` (theme, router) cannot also be scoped.
- The same verb means three things: `this.resolve(token)` (component), `scope.get(token)` (scope),
  `cache.resolve(...args)` (key/path/view triple, a reader protocol now shown in the user API table
  `docs/api-reference.md:17`).
- `this.connect(() => this.resolve(token))` cannot resolve during construction, which is what
  forces the object-kind lock described in `README.md:213-218`.

```tsx
class Header extends ScopedAntiHookComponent {
    static contextType = ThemeContext;     // silently breaks this.resolve()
}
```

Proposal. Rename the component accessor to match the scope (`this.get(token)` or
`this.scoped(token)`), demote `ResourceCache.resolve` to the documented extension contract
(`docs/promise-cache.md` already names `getEntry(...args)` as the user read), and document the
`contextType` restriction or read the scope through a symbol-keyed static context so subclasses
keep their own `contextType`.

Migration cost: low to medium.

---

### API-20 — Three disposal styles

**P3 · OBSERVED**

Locations: `watch`, `persist`, `connectDevTools` return a `TDisposer`; `CarburetorHistory.disconnect()`
(`Tooling/CarburetorHistory.ts:261`); `subscribe()` returns an id for `unsubscribe(id)`
(`Store/Carburetor.ts:333, 387`). `README.md:1016-1020` shows all three side by side.

```ts
stop(); stopPersist(); stopDevTools(); history.disconnect(); store.unsubscribe(id);
```

Proposal. Give every long-lived handle one shape: `CarburetorHistory` gets a `dispose()` (keep
`disconnect` as an alias) and all disposers/handles implement `[Symbol.dispose]` so `using` works.
`subscribe`/`unsubscribe` can stay as the low-level protocol.

Migration cost: low (additive).

---

### API-21 — Lint setup friction and inconsistent setup docs

**P3 · OBSERVED**

Locations:
- `docs/rules.md:22-23` — "this config includes TS/TSX parsing", while `plugin/src/index.mts:76-85`
  has no `languageOptions` and the snippet below it adds the parser itself; `README.md:1299-1309`
  says the parser must already be configured.
- `README.md:1331-1334`, `docs/rules.md:179-184` — users must turn off `typescript/unbound-method` by
  hand; the oxlint preset could do it for them.
- `docs/faq.md:53` — recommends `// carburetor-disable-next-line`, the standalone CLI syntax, while
  `docs/rules.md:51-53` gives host comments for the oxlint/ESLint bridge.
- `README.md:1295`, `docs/rules.md:18` — the preset is referenced by a `./node_modules/...` path.

Proposal. Fix the `rules.md` sentence; add `"typescript/unbound-method": "off"` to the generated
oxlint preset (API-03); make the FAQ list host comments first; document the package-export form
`react-carburetor/lint/recommended.oxlintrc.json` where the host supports it.

Migration cost: docs/preset only.

---

### API-22 — Scheduler is positional on `Carburetor` but an option on resources; the class name says "Component"

**P3 · OBSERVED**

Locations: `Store/Carburetor.ts:120` `constructor(data, scheduler?)`; `Resource/ResourceOptions.ts:16`
and `Models/Resource.ts:98` `{scheduler}`; `Store/Scheduling/ComponentUpdateThrottle.ts:26` (a store
delivery policy, not a component one).

```ts
new PresenceCarburetor(initial, new ComponentUpdateThrottle(40));
new ResourceCache(loader, {scheduler: new ComponentUpdateThrottle(40)});
```

Proposal. Accept `new Carburetor(data, {scheduler})` (keep the positional form as an overload) and
export `UpdateThrottle` as the primary name with `ComponentUpdateThrottle` as an alias.

Migration cost: low (additive).

---

### API-23 — Resource state flags: users assemble "loading" and "failed refresh" from many fields

**P3 · OBSERVED**

Locations: `Models/Resource.ts:5-16, 49-85` (13 fields on `IResourceView`); `README.md:803-820`;
`docs/faq.md` last entry (hand-built state must set `status` plus four consistent flags).

Problem. Because `useResource` loads after commit, an absent entry first renders as `Idle`, so every
reader writes `isIdle || isPending`; a failed refresh is `isSuccess && error !== undefined`:

```tsx
if (user.isIdle || user.isPending) return <Spinner/>;
...
{user.error ? <Retry/> : null}      // inside the Success branch
```

Proposal. Add two derived, serializable-free getters on the view returned by readers —
`isLoading` (no data yet and a load is expected or running) and `refreshFailed` — and a
`resourceState(status, data?, error?)` helper so hand-built fixtures cannot get the flags wrong.

Migration cost: low (additive).

---

### API-24 — Examples teach unnecessary boilerplate

**P3 · OBSERVED**

Locations: `examples/api/resources/resource-carburetor/click-load.tsx:15`, `click-switch.tsx:15`,
`load.tsx:14` (rendered in `README.md:679-686, 745-752`).

Problem. Each loader re-checks `if (signal.aborted) throw new Error('aborted')`, although a
superseded request's answer is already discarded by the engine (`ResourceCarburetor.ts:535-536`,
`README.md:107`). The same examples spell both generics and annotate every parameter. Readers copy
this into every loader.

Proposal. Show the minimal loader (`(id: string, signal) => fetchUser(id, {signal})`) and mention
once that the signal is for cancelling the network call, not for guarding the result.

Migration cost: docs only.

---

### API-25 — Error and diagnostic messages use inconsistent prefixes and rarely point to the fix

**P3 · OBSERVED**

Locations (thrown messages): `'Carburetor: …'`, `'CarburetorHistory: …'`,
`'ResourceCache ttl must be …'` (no colon), `'resource key must return …'` (lowercase, no owner),
`'Resource request was superseded before it started'` (no prefix) — across
`lib/src/Carburetor/**`. Development diagnostics do not name the hazard id that `docs/hazards.md`
and the lint rules use.

Proposal. One prefix (`[react-carburetor] Class.method: …`) and, for misuse diagnostics, a trailing
`(see H6)` style reference matching the hazard catalogue.

Migration cost: low.

---

### API-26 — Internal review identifiers ship in public TSDoc

**P3 · OBSERVED**

Locations: 52 source files under `lib/src/Carburetor` contain `R<nn>-<nn>` references; public ones
include `Models/Store.ts:37` ("the markers R16-01 added"), `Models/Resource.ts:103` ("R16-10(4)"),
`Store/Carburetor.ts:314-316` ("R16-02", "R16-09"). They survive into `dist/esm/Carburetor/Models/Store.d.mts` and
`Resource.d.mts`, so they appear in IDE hovers.

Proposal. Strip review ids from TSDoc on exported symbols (keep them in internal comments or commit
messages), or add a TSDoc lint check for exported declarations.

Migration cost: none for users.

---

## Summary table

| ID | Priority | Status | Area | Finding | Migration cost |
|---|---|---|---|---|---|
| API-01 | P1 | OBSERVED | Stores | `update()` takes no arguments; recommended form is flagged by own lint, users fall back to `draft` + `emitUpdate` + `try/finally` | Low (additive) |
| API-02 | P1 | OBSERVED | Resources | `ResourceCache.clear(...args: unknown[])` — `clear(id)` compiles and wipes the cache | Low (type only) |
| API-03 | P2 | OBSERVED | Lint config | oxlint preset lacks `no-closure-in-update`; claimed pinning test does not exist | None |
| API-04 | P2 | OBSERVED | Components/docs | `connect()` vs `useCarburetor` — three contradictory "default" answers | Docs |
| API-05 | P2 | OBSERVED | Resources | Slot and cache share handle names, not refresh/failure semantics, defaults or accessor names | Low → high |
| API-06 | P2 | OBSERVED | Resources | Slot answers never stale, per-key memory unbounded by default | Low |
| API-07 | P2 | OBSERVED | Resources | `load()`/`refresh()` resolve on loader failure, reject on supersession | Low |
| API-08 | P2 | OBSERVED | Resources/Suspense | Suspense needs `useResource` + `suspend` + a dummy field read | Low (additive) |
| API-09 | P2 | OBSERVED | Components | Class `useResource` facade is writable and coarse, unlike sibling readers | Medium |
| API-10 | P2 | OBSERVED | Resources | Trailing `AbortSignal` causes `unknown`/optional-arg edges and three overloads | High, cheapest now |
| API-11 | P2 | INFERRED | Resources | Event sniffing in bound handles: React Native passes the event to the loader | Low |
| API-12 | P2 | OBSERVED | Scopes/SSR | `hydrate(payload, tokens)` drops state for unlisted tokens | Low (additive) |
| API-13 | P2 | OBSERVED | Components | Lifecycle override without `super` silently disables the component | Low |
| API-14 | P2 | OBSERVED | Lint config | Non-transitive, non-configurable recognition; `ResourceCache` subclasses unlinted | None |
| API-15 | P3 | OBSERVED | Naming | Hook names (`use*`, `AntiHookComponent`) on a no-hooks API | High volume, pre-release only |
| API-16 | P3 | OBSERVED | Effects | String-keyed effects (H15) and redundant `unUseEffects` | Low |
| API-17 | P2 | OBSERVED | Docs | README buries the contract under engine internals | Docs |
| API-18 | P3 | OBSERVED | Stores | Engine protocol on the public store surface; protected signatures leak unexported types | Low |
| API-19 | P3 | OBSERVED | Scopes | Separate scoped base, `contextType` monopoly, overloaded `resolve` | Low–medium |
| API-20 | P3 | OBSERVED | Tooling | Three disposal styles | Low |
| API-21 | P3 | OBSERVED | Lint docs | Setup docs disagree on parser, suppression comments, `unbound-method` | Docs/preset |
| API-22 | P3 | OBSERVED | Stores | Scheduler positional vs option; `ComponentUpdateThrottle` misnamed | Low |
| API-23 | P3 | OBSERVED | Resources | Loading/failed-refresh must be assembled from many flags | Low |
| API-24 | P3 | OBSERVED | Examples | Loaders copy an unnecessary `signal.aborted` guard | Docs |
| API-25 | P3 | OBSERVED | Errors | Inconsistent error prefixes; no hazard references | Low |
| API-26 | P3 | OBSERVED | Types | Review ids (`R16-10`) in shipped TSDoc | None |

Counts: **P1 — 2**, **P2 — 13**, **P3 — 11** (26 findings; 25 OBSERVED, 1 INFERRED).

Suggested order: API-01 and API-02 first (small, high-leverage); then API-03/API-04/API-17 (cheap
consistency); then decide API-10 and API-15 before the first npm publish, because both are breaking
and only free while the package is unpublished.
