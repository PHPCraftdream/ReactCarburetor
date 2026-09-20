# React Carburetor

State lives outside the React tree. Class components read it directly, and each component
subscribes to **exactly the fields it read** — so a write wakes only the components that
actually depend on it.

No hooks. No dependency arrays. No memoization to maintain, and nothing for a compiler to
optimize after the fact: the unnecessary re-renders are never created in the first place.

```tsx
export class Counter extends AntiHookComponent {
    handleClick = () => {
        counterCarburetor.inc();
    };

    render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={this.handleClick}>{value}</button>;
    }
}
```

## Why

The usual React model keeps state inside the tree, so changing it re-renders a subtree, and
you spend your time fighting that: dependency arrays, `memo`, `useCallback`, selector
libraries, auto-memoizing compilers. Those are all mitigations for re-renders that the model
generates by design.

React Carburetor removes the generator instead. State sits in a plain class outside React.
A component reads what it needs, that read becomes its subscription, and a write invalidates
only the intersecting paths.

## Install

```bash
npm install react-carburetor
```

React 18 or 19 is a peer dependency. The package ships ESM and CommonJS, each in a normal
build and in a pre-stripped production build that the `production` export condition selects.

## Core ideas

### Read through the carburetor, write through its methods

`useCarburetor` returns **tracked data**, not the carburetor. Every field you touch during
render is recorded as a path (`value`, `items.a1.title`), and those paths become the
component's subscription.

```tsx
const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
```

Data returned from `useCarburetor` is deeply read-only: the compiler rejects a write, and the
proxy throws if you force one past it. Writes belong to the carburetor, through `update`:

```ts
export class TodoCarburetor extends Carburetor<ITodoList> {
    public updateTodo = (todo: ITodo) => {
        this.update((draft) => {
            draft.items[todo.id] = todo;   // records the changed path: items.<id>
        });
    };
}
```

`update` mutates through `draft` and publishes in one step. You can also write to `this.draft`
directly and call `this.emitUpdate()` yourself, but forgetting the second half changes the data
while nobody re-renders — so in development the carburetor reports that mistake rather than
letting it pass silently.

### Precise invalidation

`emitUpdate` compares the written paths against every subscriber's read paths. A write
touches a read when the paths are equal or one is nested in the other:

| read path            | write `items.a1` | write `items.a2` | write `orderIds` |
|----------------------|------------------|------------------|------------------|
| `items.a1.title`     | wakes            | —                | —                |
| `items` (enumerated) | wakes            | wakes            | —                |
| `orderIds.0`         | —                | —                | wakes            |

Two properties keep this honest:

- **Traversal is not a read.** Reaching into `data.items` on the way to `items.a1.title`
  subscribes you to the leaf, not to the whole container. Enumerating (`Object.keys`) or
  probing (`'a1' in items`) *does* subscribe to the structure, because that genuinely reads it.
- **Writing the same value wakes nobody.** Recomputing a counter that ends up unchanged, or
  re-sorting an already sorted array, invalidates nothing.

If a write bypasses `draft` (a direct `this.data.x = y`), the changed paths are unknown, so
the whole store is treated as changed. Coarse, but never a missed update.

Matching is indexed rather than scanned: read paths and their ancestors are kept in maps, so a
write looks up the subscribers it concerns instead of comparing itself against all of them. On
1000 subscribers one changed path costs 0.0009 ms, and a transaction touching 500 paths costs
0.47 ms — the same cases took 0.39 ms and 110 ms before the index
(`benchmarks/pathsIntersect.mjs`).

### A parent re-render does not cascade

Precise invalidation governs updates coming from a carburetor. React itself still re-renders
children whenever a parent renders, which would undo the whole point, so `AntiHookComponent`
compares props and state one level deep and skips a re-render that changes neither — the same
bail-out `React.memo` gives function components.

This is safe because a component does not learn about state from its parent: when its own data
changes it re-renders itself, and that path bypasses the comparison. Two consequences worth
knowing: a prop rebuilt on every parent render (an inline object or arrow function) counts as
changed, and a re-render with identical props is skipped entirely, effects included.

### Handlers that survive the gate: `@bind`

The gate above makes handler identity load-bearing. `onPress={() => this.toggle()}` and
`onPress={this.toggle.bind(this)}` build a new function on every render, so the child's props
always compare as changed and the bail-out never happens — the re-render this engine exists to
avoid comes back through the props.

`@bind` binds a method once, when the instance is constructed:

```tsx
class TodoRow extends AntiHookComponent<IProps> {
    @bind
    protected onToggle(): void {
        todoCarburetor.toggle(this.props.id);
    }

    public render() {
        return <button onClick={this.onToggle}>toggle</button>;
    }
}
```

The reference is then stable for the component's lifetime, and — unlike an arrow class
property — the method stays on the prototype, so a subclass can still override it and call
`super`. That is why the base class's lifecycle methods are methods and not properties: a
property would shadow them for good.

It is a standard (Stage 3) decorator, so no `experimentalDecorators` and no `reflect-metadata`;
TypeScript 5+, SWC, Babel 7.20+ and esbuild 0.21+ compile it as is. One rough edge worth
knowing: `@typescript-eslint/unbound-method` (and oxlint's `typescript/unbound-method`) cannot
see the decorator, so it reports `this.onToggle` passed as a value. Disable that rule where you
use `@bind`, or silence it per line.

### Derived values

`computed` memoizes a derived value and tracks its own dependencies: the paths its body reads.
It is recomputed only when one of them is written, and subscribers are woken only when the
result actually changed.

```ts
export const activeCount = computed<number>((read) => {
    const {items} = read(todoCarburetor);

    return Object.keys(items).filter((id) => !items[id].done).length;
});
```

```tsx
render() {
    return <span>{this.useComputed(activeCount)}</span>;
}
```

Editing a todo's title invalidates `items.<id>`, so the computed recomputes — but the count
comes out the same, so nothing re-renders. A computed stops observing its dependencies once
its last subscriber leaves.

Computeds compose, as long as you read them through `read` as well:

```ts
export const summary = computed<string>((read) => `${read(activeCount)} left`);
```

Calling `activeCount.get()` inside the body instead would register no dependency and leave
`summary` stale — the reader is what records it.

### Transactions

Writes inside `transaction` are delivered as one update per carburetor, however many stores
were touched:

```ts
transaction(() => {
    todoCarburetor.createTodo();
    filterCarburetor.reset();
});
```

### Scheduling is a policy, not a constant

By default updates are delivered immediately and React does the batching — no latency added
to a click or a keystroke. Throttling is opt-in, per carburetor, for streaming sources where
coalescing actually helps:

```ts
// A socket pushing hundreds of messages per second: collapse them into ~25 renders/sec.
export const presenceCarburetor = new PresenceCarburetor(initial, new ComponentUpdateThrottle(40));
```

### Effects without hooks

Override `useEffects`, and declare each effect with a name and its dependencies:

```tsx
export class TodoApp extends AntiHookComponent<ITodoProps> {
    protected useEffects(): void {
        this.useEffect(this.props.carburetor.loadData, 'loadData', []);

        this.useEffect(
            () => {
                const socket = connect(this.props.channel);

                return () => socket.close();
            },
            'channel',
            [this.props.channel]
        );
    }
}
```

`useEffect(callback, name, deps)` runs `callback` when `deps` changed since the last run,
compared element by element with `Object.is`. Whatever the callback returns is its cleanup: it
runs before that same effect runs again, and on unmount. Setup and teardown therefore stay
paired per effect — a changed dependency of one effect does not tear down the others.

An empty `deps` array means "once, on mount". `unUseEffects(prevProps)` is still available as a
component-wide hook that runs before every `useEffects` pass and on unmount, for teardown that
is not tied to one effect.

### Diagnostics

The engine complains about a few kinds of misuse — a write that was never published, a
`transaction` handed an async body. Those complaints are development-only and switchable:

```ts
diagnostics.setEnabled(false);   // silence them anywhere
diagnostics.isEnabled();
```

They are guarded by a literal `process.env.NODE_ENV` comparison with the message inside the
guard, so a bundler drops the whole block — strings included — from a production build. The
package also ships pre-stripped outputs selected by the `production` condition in `exports`,
for toolchains that do not substitute `NODE_ENV` themselves.

## Async resources

`ResourceCarburetor` turns a promise into state with an explicit status, request
deduplication and cancellation:

```ts
export const profile = new ResourceCarburetor<IProfile, {id: string}>(
    ({id}, signal) => fetch(`/api/profile/${id}`, {signal}).then((response) => response.json())
);

await profile.load({id: 'a1'});   // EResourceStatus.Pending -> Success | Error
```

The status is an enum, `EResourceStatus`, not a bare string, so a typo in a comparison is a
compile error rather than a branch that never runs:

```ts
if (profile.getData().status === EResourceStatus.Error) {
    ...
}
```

Concurrent loads with the same arguments share one request; a load with different arguments
aborts the previous one. The state stays serializable — the failure is stored as a message,
with the original rejection available through `getLastError()`.

It also works under Suspense, which class components support by throwing the pending promise:

```tsx
render() {
    this.useCarburetor(profile);

    return <ProfileCard profile={profile.suspend({id: 'a1'})}/>;
}
```

While the request is in flight the nearest `<Suspense>` fallback shows; a failure is rethrown
so the nearest error boundary handles it.

### Cached resources

`ResourceCarburetor` holds one value. An API layer needs many — the same loader called with different
arguments, each answer worth keeping — which is what `ResourceCache` is:

```tsx
export const userCache = new ResourceCache<IUser, string>(
    (id, signal) => fetch(`/api/users/${id}`, {signal}).then(response => response.json()),
    {ttl: 30_000, maxEntries: 200}
);

class UserBadge extends AntiHookComponent<{id: string}> {
    public render() {
        const user = this.useResource(userCache, this.props.id);

        if (user.status === EResourceStatus.Pending) {
            return <Spinner/>;
        }

        return <span>{user.data?.name}{user.refreshing ? <Dot/> : null}</span>;
    }
}
```

`useResource` subscribes the component to that one entry, so another user's answer arriving does not
re-render this badge. A stale entry is refetched **after** the commit, never during render — a write
from render would notify subscribers mid-render.

Three decisions are worth knowing because they differ from the hooks libraries:

- **A failed refresh keeps the good data.** The entry stays `Success` with what it had, and the error
  sits beside it, so the interface can show both. Only an entry that never succeeded becomes `Error`.
- **Refreshing does not flash `Pending`.** An entry with data raises `refreshing` instead, because
  there is nothing to show in place of data the user is reading.
- **`invalidate` does not refetch.** It marks entries stale; the ones on screen refetch themselves on
  the next render. A cache of two hundred entries should not fire two hundred requests because one
  mutation succeeded.

A failed entry is not retried automatically — that would loop, since the failure re-renders the
component that asked. Call `refresh(args)` to try again. And the cache is bounded: the least recently
used entries are dropped past `maxEntries`, never one with a request in flight or one a component is
reading.

`suspend(args)` throws for a Suspense boundary, per entry. Server rendering needs nothing extra: a
scope's `dehydrate()` carries the entries, and a hydrated entry counts as fresh for the rest of its
lifetime rather than being refetched on mount.

Explicit non-goals, so the shape is clear: no retries with backoff, no refetch on window focus or
interval, no pagination, no normalisation, no optimistic updates. See
[docs/promise-cache.md](docs/promise-cache.md) for the reasoning behind the key encoding, the lifetime
semantics and the eviction rules.

## Per-request stores

A module-level singleton is shared by every request on a server, which leaks one user's state
into another's render. A scope creates the instances per request instead, and components
resolve them through context — no hooks involved.

```ts
export const todoToken = carburetorToken(() => new TodoCarburetor(new ToDoClientAPI()));
```

```tsx
class TodoScreen extends ScopedAntiHookComponent {
    render() {
        const carburetor = this.resolve(todoToken);
        const {orderIds} = this.useCarburetor(carburetor);
        ...
    }
}

// one scope per request
render(<CarburetorProvider scope={new CarburetorScope()}><TodoScreen/></CarburetorProvider>);
```

For hydration, the scope serializes and restores itself:

```ts
// server, after rendering
const state = scope.dehydrate();          // plain object keyed by token

// client, before the first render
const scope = new CarburetorScope();
scope.hydrate(state, [todoToken, filterToken]);
```

`dehydrate` covers every carburetor the scope actually created; `hydrate` instantiates the
tokens whose state is present and leaves the rest to be created on demand. A single store can
also be seeded directly with `scope.set(token, carburetor)`.

## Tooling

```ts
// Redux DevTools: state inspection plus time travel back onto the carburetors.
connectDevTools({todos: todoCarburetor, filter: filterCarburetor});

// Mirror a store in a storage; loads what was stored on connect.
persist(settingsCarburetor, {key: 'settings', storage: localStorage});

// Undo/redo built on snapshots.
const history = new CarburetorHistory(todoCarburetor, {limit: 50});
history.undo();
history.redo();

// Await the next update — for throttled stores and async resources in tests.
await waitForUpdate(presenceCarburetor);
```

## Hooks interop

The engine needs no hooks, but the ecosystem around it is hooks-first. An opt-in entry point
bridges the boundary, with the same path precision: the selector is run through the tracking
proxy to learn what it depends on.

```tsx
import {useCarburetorValue, useComputedValue} from 'react-carburetor/interop';

const NameBadge = () => {
    const name = useCarburetorValue(profileCarburetor, (data) => data.name);

    return <span>{name}</span>;
};
```

Built on `useSyncExternalStore`, so it is tearing-safe and SSR-safe. Pass an equality
function as the third argument when the selector builds a new object.

## Lint rules

The engine trades one class of mistake for another. Nothing here forces a re-render you did not ask
for — and nothing tells you when a write reaches no subscriber, when a component reads state it never
subscribed to, or when an effect's cleanup is silently dropped. The package ships 22 rules for
exactly those. [docs/rules.md](docs/rules.md) is the reference by rule name — what each catches, its
options, how to switch one off — and [docs/hazards.md](docs/hazards.md) is the same material by
mistake, with the code that triggers it, why it is silent at runtime, and where the rule can be
wrong.

One plugin serves both hosts, because oxlint's JS plugin API is ESLint's.

**oxlint** — one `extends` line; the plugin travels next to the preset:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"]
}
```

**ESLint v9+** — spread the shareable config into a flat config:

```js
import carburetor from 'react-carburetor/lint';

export default [
    {...carburetor.configs.recommended, files: ['src/**/*.{ts,tsx}']},
];
```

In the recommended preset, `error` marks a hazard that silently loses an update, a subscription or a
re-render; `warn` marks the rules that rest on a heuristic — a method name, a dependency array — where
you have to judge the report. `no-module-level-store` is **off**: a module-level store is the right
pattern in a client-only application, and the rule only makes sense once you render on a server, so
switch it on then.

Every rule takes `componentBases`, `carburetorBases` and `renderMethods`, because detection is
syntactic: a project with its own base class or its own render helpers is invisible to the rules
until it names them.

```json
{
  "rules": {
    "carburetor/no-module-level-store": "error",
    "carburetor/no-get-data-in-render": ["error", {"componentBases": ["AppComponent"]}]
  }
}
```

One rule replaces a built-in: `typescript/unbound-method` (and `@typescript-eslint/unbound-method`)
cannot see `@bind` and reports correct usage as an error, so turn it off and rely on
`carburetor/require-bind-for-passed-method`, which is decorator-aware and also catches the reverse
case.

## API

### `Carburetor<T>`

| member                          | description                                                        |
|---------------------------------|--------------------------------------------------------------------|
| `constructor(data, scheduler?)` | Initial data and delivery policy (defaults to immediate delivery).  |
| `getData(): T`                  | Untracked data, for code outside render.                           |
| `read(record)`                  | Tracked, deeply read-only data; every read path goes to `record`.  |
| `setData(data)`                 | Replaces the data and invalidates everything.                      |
| `snapshot(): T`                 | Detached deep copy, safe to serialize or keep.                     |
| `restore(data)`                 | Replaces the data with a snapshot.                                 |
| `toJSON()` / `fromJSON(value)`  | Type-erased bridge for devtools, persistence and hydration.        |
| `watch(paths, callback)`        | Subscribes outside React; returns a disposer.                      |
| `getVersion(): number`          | Write counter.                                                     |
| `subscribe(cb, options?)`       | Subscribes. `options.reads` narrows it to paths, `options.id` reuses a stable id so re-subscribing replaces the previous registration. |
| `unsubscribe(id)`               | Removes the subscription and cancels a pending update.             |
| `update(mutate)` *(protected)*  | Mutates through `draft` and publishes — the recommended write form. |
| `draft: T` *(protected)*        | Write proxy that records changed paths.                            |
| `emitSoon()` *(protected)*      | Publishes on the next microtask, for writes made where notifying now is unsafe. |
| `preEmit()` *(protected)*       | Runs before notification — derive state here.                      |
| `emitUpdate()` *(protected)*    | Notifies subscribers whose read paths intersect the writes.        |

### `AntiHookComponent<P, S>`

| member                            | description                                                    |
|-----------------------------------|----------------------------------------------------------------|
| `useCarburetor(carburetor)`       | Tracked data for reading in render; establishes the subscription. |
| `useComputed(computed)`           | Reads a derived value and subscribes to it, not to its inputs.  |
| `useEffects()` *(protected)*      | Declares the component's effects; runs on mount and after every committed update. |
| `unUseEffects(prevProps)`         | Component-wide teardown, before every `useEffects` pass and on unmount. |
| `useEffect(cb, name, deps)`       | Runs `cb` when `deps` changed; its return value is that effect's cleanup. |
| `shouldComponentUpdate(…)`        | The props/state gate. Override only with a `super` call.        |
| `@bind` *(decorator)*             | Binds a method once per instance, keeping it on the prototype and its reference stable. |

### Other exports

| export                                        | purpose                                     |
|-----------------------------------------------|---------------------------------------------|
| `computed(body)`                              | Memoized derived value.                     |
| `transaction(body)`                           | One notification pass for a group of writes. |
| `SyncUpdateScheduler` *(default)*             | Immediate delivery; React batches.          |
| `ComponentUpdateThrottle(ms)`                 | Coalescing for streaming sources.           |
| `ResourceCarburetor(loader, scheduler?)`      | Async state with status and cancellation.    |
| `CarburetorScope`, `carburetorToken`, `CarburetorProvider`, `ScopedAntiHookComponent` | Per-request stores. |
| `connectDevTools`, `persist`, `CarburetorHistory`, `waitForUpdate` | Tooling.  |
| `diagnostics`, `Diagnostics`                  | The development-only warning switch.         |
| `EResourceStatus`, `EDevToolsAction`, `EDevToolsMessageType` | Enums for the resource status and the DevTools protocol. |
| `syncUpdateScheduler`, `getInitialResourceData`, `CarburetorContext` | The default scheduler instance, the initial resource state, and the context a scope is provided through. |
| `deepClone`, `pathsIntersect`, `isTrackable`, `shallowEqual`, `SubscriberIndex`, `getUid`, `WILDCARD_PATH` | Building blocks, exported for extensions. |

Internals — the tracking proxies, the proxy cache, path string plumbing and the batch
coordinator — are deliberately not exported: they are implementation details, and a test pins
the exported surface so one does not slip in by accident.

## Caveats

- Don't stash tracked data outside render. Reads happening after commit are not part of the
  subscription, and a proxy kept across renders may point at replaced data.
- Tracking covers plain objects and arrays. `Map`, `Set`, `Date` and class instances are handed
  over as they are: reading one is a leaf read, and mutating it in place is invisible to the
  proxy. No update is lost over it — reaching for such a value through `draft` counts as writing
  the path it came from, so `this.draft.index.set(k, v)` wakes the subscribers of `index` —
  but the granularity stops there, and a mutation of `this.data` bypassing `draft` still
  invalidates the whole store. Replace the value instead of mutating it, and keep plain data in
  stores you want precision on. A store whose root is untrackable has no path to be precise
  about at all: every write to it invalidates everything.
- A write under a symbol key cannot be expressed as a path, so it invalidates the whole store.
- `update(mutate)` publishes when `mutate` returns. An `async` callback is accepted by its
  `void`-returning signature and publishes at the first `await`, leaving everything written
  afterwards unpublished — development warns about it. Do the async work first, then write.
- Render stays pure — nothing subscribes during render — but a write that lands between
  render and commit is only detected afterwards, by comparing the carburetor version, and
  corrected with an extra render. There is no consistency guarantee *within* a single
  concurrent render pass; don't write to stores from render.
- The props gate means a component that relied on its parent re-rendering to pick up data it
  never read will stop updating. Read what you render, through `useCarburetor`.
- Undo/redo costs one deep copy of the state per change — the floor for snapshot-based history,
  since the previous state has to be captured while it still exists. On a large store written
  on every keystroke that is measurable: narrow what history observes, or keep the limit low.
- Overriding a lifecycle method without calling `super` silently disables effects, subscription
  cleanup or the props gate. Override `useEffects` / `unUseEffects` instead.

## Demo

The `lib/` folder contains a Todo app built on the library (React 19, Rsbuild, Tailwind).
Each row shows its own render counter, so you can watch precise invalidation at work: edit
one todo and only that row's counter moves.

```bash
cd lib
npm install
npm start
```

## Development

```bash
npm install
npm run build       # Rslib: ESM + CJS, plus pre-stripped production outputs, dts via tsgo
npm run typecheck   # TypeScript 7
npm run lint        # oxlint with type-aware rules
npm test            # Rstest + @testing-library/react

node benchmarks/pathsIntersect.mjs   # path matching, against the built output
```

Benchmarks live outside the test suite on purpose: the test run has to stay fast enough to
be run on every change.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
