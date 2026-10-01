# React Carburetor

[![CI](https://github.com/PHPCraftdream/ReactCarburetor/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/PHPCraftdream/ReactCarburetor/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](LICENSE)
[![React 18 and 19](https://img.shields.io/badge/React-18%20%7C%2019-61dafb.svg?logo=react)](#install)
[![Status: pre-release](https://img.shields.io/badge/status-pre--release-orange.svg)](#install)

State lives outside the React tree. Class components read it directly, and each component
subscribes to **exactly the fields it read** — so a write wakes only the components that
actually depend on it.

The core API needs no hooks. Path-precise subscriptions avoid unnecessary re-renders
without dependency arrays. Effects still take one, to control when the effect itself reruns,
the same as React's `useEffect`. No memoization to maintain, and nothing for a compiler to
optimize after the fact: the unnecessary re-renders are never created in the first place.

[Install and try it](#install) · [Core ideas](#core-ideas) · [API](#api) ·
[Lint rules](docs/rules.md) · [Async cache](docs/promise-cache.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md)

```tsx
import {AntiHookComponent, Carburetor} from 'react-carburetor';

class CounterCarburetor extends Carburetor<{value: number}> {
    inc(): void {
        this.update((draft) => {
            draft.value += 1;
        });
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});
const increment = () => counterCarburetor.inc();

export class Counter extends AntiHookComponent {
    render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={increment}>{value}</button>;
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

The first public npm release is still being prepared: `react-carburetor` and
`carburetor-lint` are not published on npm yet. To try the current source and demo:

```bash
git clone https://github.com/PHPCraftdream/ReactCarburetor.git
cd ReactCarburetor
npm ci
npm run build
cd lib
npm ci
npm start
```

After the npm release, install the library in a React project with:

```bash
npm install react-carburetor
```

React 18 or 19 is a peer dependency. The package ships ESM and CommonJS, each in a normal
build and in a pre-stripped production build that the `production` export condition selects.
The advertised range is `^18.0.0 || ^19.0.0`; the test suite and the demo app are exercised
locally and in CI against React 19.3, and CI also runs the full suite against React 18.3.1 in
a dedicated compatibility job — the handful of `AntiHookComponent` assertions that observe
React's own uncaught-error logging (18 reports the throw where 19 is silent) and error-replay
render counts branch on the installed major at runtime, so nothing is excluded. 18.3.1 is the
newest of the 18.x line; the range's `18.0.0` floor and the point releases between are not
separately exercised — a coverage gap, not a report that they fail.

`@types/react` is an optional peer, `^18.0.0 || ^19.0.0`: a TypeScript project sees a warning
only on a real version mismatch, and a plain-JS project needs nothing. See
[`docs/react-compatibility.md`](docs/react-compatibility.md) for how the library binds to the
consumer's own React, what a duplicate-React install looks like, and how compatibility is tested.

With React Server Components (Next.js App Router), components and hooks ship as `"use client"`
modules while stores, caches and scopes stay importable on the server; your own components that
extend `AntiHookComponent` still live in a `"use client"` file. Details are in the same document.

Async resources use a global `AbortController`, which Node added in 14.17.0 while the
`engines.node` floor in `package.json` is older. Where it is missing, a stand-in signal
supports abort listeners, `onabort` and `throwIfAborted`; late answers are still discarded.
The stand-in is not a native `AbortSignal`, so APIs that require native signal identity
(including `fetch`) may reject it. Provide a compatible `AbortController` in that runtime
when passing the signal to such APIs; development reports the limitation once.

## Core ideas

### Read through the carburetor, write through its methods

`useCarburetor` returns **tracked data**, not the carburetor. Every field you touch during
render is recorded as a path (`value`, `items.a1.title`), and those paths become the
component's subscription.

```tsx
const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
```

Data returned from `useCarburetor` is deeply read-only where it is plain data: the compiler
rejects a write, and the proxy throws if you force one past it. A `Map`, `Date`, `Set` or class
instance passes through unwrapped, so its own mutating methods sit outside that guard. Writes
belong to the carburetor, through `update`:

```ts
export class TodoCarburetor extends Carburetor<ITodoList> {
    public renameTodo = (id: string, title: string) => {
        this.update((draft) => {
            draft.items[id].title = title;   // records the changed path: items.<id>.title
        });
    };
}
```

Write the fields that change, or `Object.assign(draft.items[id], patch)`: the no-op check skips
fields that already hold the value, so only real changes are recorded. Replacing a whole object
(`draft.items[id] = next`) is precise too — it is diffed against the object it replaces and
records only the fields that differ — but pays a walk over the replaced object to find them.

`update` mutates through `draft` and publishes in one step. You can also write to `this.draft`
directly and call `this.emitUpdate()` yourself, but forgetting the second half changes the data
while nobody re-renders — so in development the carburetor reports that mistake rather than
letting it pass silently.

### A persistent connection: `connect()`

`connect()` is the default way to read a store: declared once — a field initializer is the
intended call site — it hands back the same object for the component's whole lifetime.
`useCarburetor` reads the same way but is called in render, which suits a store chosen per
render (a prop, a scope lookup) or an array-rooted scoped store:

```tsx
class TodoApp extends AntiHookComponent<ITodoProps> {
    private readonly todos = this.connect(() => this.props.carburetor);

    render() {
        return (
            <>
                <span>Active: {this.todos.activeCount}</span>
                {this.todos.orderIds.map((id) => <TodoItem key={id} id={id} />)}
            </>
        );
    }
}
```

The declaration itself subscribes to nothing — React can construct an instance and never commit
it, so any side effect there would leak. What each render actually reads is still tracked field
by field, exactly as `useCarburetor` does, so a conditional branch reading a different field next
render still narrows or widens the subscription correctly; only the object identity and the proxy
underneath it are reused across renders. `source` can be a carburetor directly, or a function
resolving one (as above) so a prop swap re-points the connection at the new store. `setData` and
`restore` keep working: the same returned view stays live across a whole-data replacement.

The view's object/array kind is decided once, at declaration, from the source's current root: an
array root gives a view that answers `Array.isArray`, iteration, `Object.keys` and
`JSON.stringify` as an array. A proxy cannot change kind afterwards, so the kind never changes:
a source that is not resolvable at declaration time (a scope-backed resolver resolves only after
React fills context) fixes the view as an object view, and a later root of the other kind fails
with an explicit boundary error instead of serving a silently wrong view — read an array-rooted
scoped store through `useCarburetor` in render instead. Descriptor introspection is forwarded
through the live view; a non-configurable descriptor is reported configurable, which grants
nothing, because every mutation trap — assignment, deletion, `defineProperty`, prototype and
extension changes — is rejected.

Views stay live across writes. Branch wrappers are cached per proxy tree in a `WeakMap` keyed by
the raw branch object, so a branch that a write replaces or deletes takes its wrapper with it: once
nothing references the old object, both are collectable, with no sweep and no bookkeeping.

### Passing connected data to children

A `connect()` view is one live, persistent object — exactly what its owner wants, and exactly
wrong for a child gated by shallow props comparison: the reference never changes, so a
`React.memo` child (or a child whose `shouldComponentUpdate` compares props, which includes
every `AntiHookComponent`) bails out and keeps showing whatever it first rendered. Handing the
view — or a branch of it — to such a child is not supported, and it fails silently: the child's
reads happen outside the owner's render attempt, record nothing, and no subscription covers
what the child sees.

Two supported arrangements instead.

**A Carburetor-aware child reads the store itself.** Pass the carburetor and an identity (an
id, a key) as props — this is how `TodoItem` works. The child declares its own `connect()` or
`useCarburetor` and collects its own reads, so it subscribes to exactly what it renders.

**An external child gets a selection snapshot.** `connectSelection(source, select)` is declared
once like `connect`, and what it returns is called in render:

```tsx
class TodoList extends AntiHookComponent<ITodoProps> {
    private readonly row = this.connectSelection(
        () => this.props.carburetor,
        (data) => ({title: data.items[this.props.id].title, done: data.items[this.props.id].done})
    );

    render() {
        return <MemoRow todo={this.row()} />;
    }
}
```

`select` reads the same tracked view `connect` hands out, so the owner subscribes to exactly
the paths the selection touches. What the call returns is detached data in the state-model
sense: a plain object is its own enumerable string keys, an array is its elements and
`length` (holes stay holes), and an own key literally named `__proto__` lands as data.
Symbol keys, non-enumerable properties and descriptor flags are not part of a selection and
are not copied. Ordinary Maps, Sets and Dates are detached into plain copies (a Date is its
time); repeated references and Map-key aliases stay shared within the copy, including a key
selected through a tracked view. Custom instances remain live. An accessor's getter runs
once, like any plain read, and its value is what the copy keeps. An `Array` subclass is
rejected — its copy would lack its private state — so select `Array.from(value)` or the
fields the child needs instead. The snapshot keeps its identity while the selected plain
content and reference-sharing topology stay the same; a detached `Date`, `Map` or `Set`
compares by content against the live value, so an unchanged one no longer forces a new
snapshot. A class instance — including a `Map`, `Set` or `Date` subclass — remains the one
conservative always-changed boundary.

The selector runs on every render — that is what keeps the owner's subscription fresh — while
the snapshot object itself is reused until the content actually changes. Tracked plain-object
and array branches are copied safely. An opaque live facade that cannot be detached is reported
once in development; project its plain fields instead of handing the facade to a gated child.

### Precise invalidation

`emitUpdate` compares the written paths against every subscriber's read paths. A write
touches a read when the paths are equal or one is nested in the other:

| read path            | write `items.a1.title` | add or delete `items.a3` | write `orderIds` |
|----------------------|------------------------|--------------------------|------------------|
| `items.a1.title`     | wakes                  | —                        | —                |
| `items` (enumerated) | —                      | wakes                    | —                |
| `orderIds.0`         | —                      | —                        | wakes            |

Two properties keep this honest:

- **Traversal is not a read.** Reaching into `data.items` on the way to `items.a1.title`
  subscribes you to the leaf, not to the whole container. Enumerating (`Object.keys`,
  `Object.values`, `for…in`, spread) subscribes to the key set — woken when a key is added or
  removed, not by an edit under a key it listed; probing (`'a1' in items`) subscribes to that
  key's presence — woken when it is added or removed, not by edits inside it. That is also what `items.map(...)` does per index, so a parent laying out rows is
  not re-rendered by an edit inside one. Inherited members (`map`, `Symbol.iterator`) are not
  data and record nothing, so `for…of` and spread track only the elements they visit.
- **Array writes are per index.** `push` wakes readers of `length` and the new index, not the
  existing rows; replacing `items[5]` wakes the readers of `items[5]`; `sort` wakes the indices
  it moved.
- **Writing the same value wakes nobody.** Recomputing a counter that ends up unchanged, or
  re-sorting an already sorted array, invalidates nothing.
- **Replacements are diffed.** Replacing an object or array with another of the same kind —
  through `draft`, `setData`, `restore`, `fromJSON`, or an undo — records only the leaves that
  differ, plus the key set where keys were added or removed. A kind change (array ↔ object, plain
  ↔ `Map`/class instance), or a supported object/array prototype change, records the replaced
  path itself, and so does a replacement that changes more than 2000 leaves. Snapshots and
  history preserve supported null-prototype containers. A branch that is the same object
  on both sides is skipped without a look, so never mutate what `getData()` returns and hand it
  back: those edits are invisible to the diff.

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

`get()` reads current dependencies even while a transaction or throttle has deferred delivery.
That eager read does not consume a subscriber's pending notification: settlement still publishes
the changed result once. Unchanged primitive results stay unpublished.

A computed's result is live, not a copy: when it returns store data (`read(store).items`), a
consumer reading deeper fields off it subscribes the computed to those fields too, so an edit
inside the list wakes the computed and, through it, the consumer. Each newly read field is added
to the existing subscription in O(path depth). Return plain values when you only need a count or
a flag — the unchanged-result check then saves the re-render.

A body that has to build a new array or object on every recompute — `filter`, `map`, `slice`, an
object literal — cannot rely on that check: a new reference looks like a change even when its
content is identical. Pass `equals` to judge the result by content instead:

```ts
export const visibleIds = computed<string[]>((read) => {
    const {orderIds, items} = read(todoCarburetor);

    return orderIds.filter((id) => !items[id].done);
}, {equals: shallowEqual});
```

`shallowEqual` (also exported) compares an array element-wise, or an object key-by-key, with
`Object.is`, so a recompute that lands on the same ids re-renders nobody. `equals` is consulted
only when the reference actually changed — an in-place mutation of an exotic result (a `Map` or
`Set` the computed hands back live) still announces regardless of `equals`, because `previous`
and `next` would alias the same mutated object and there would be nothing new for `equals` to
compare.

### Derived lists

A computed feeding a list should return ids or plain values, with each row reading the store
itself — the way the demo's `TodoViews.visibleIds` and `TodoItem` do — rather than receiving the
computed's live elements as props. A computed's result is live, and its elements may keep their
identity across recomputes: a memo row holding a live element as a prop can keep the very same
object after an edit recomputes the computed, so the stale prop still compares equal and the row
never re-renders. That is why returning ids or plain values is the only supported pattern:
reading the store per row lets a title edit wake exactly
the one row that shows it, and adding `{equals}` (above) stops even the parent from re-rendering
when the visible ids themselves do not change. In development, rendering through a computed's
live result without being one of its subscribers — the value having reached a component through
props — is reported once per computed.

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

Cancelling or replacing a subscription id also removes its not-yet-run callback from an
in-progress throttle flush. A callback already running is not interrupted.

### Effects without hooks

Override `useEffects`, and declare each effect with a name and its dependencies:

```tsx
export class TodoApp extends AntiHookComponent<ITodoProps> {
    protected useEffects(): void {
        this.useEffect('loadData', this.props.carburetor.loadData, []);

        this.useEffect(
            'channel',
            () => {
                const socket = connect(this.props.channel);

                return () => socket.close();
            },
            [this.props.channel]
        );
    }
}
```

`useEffect(name, callback, deps)` runs `callback` when `deps` changed since the last run,
compared element by element with `Object.is`. Whatever the callback returns is its cleanup: it
runs before that same effect runs again, and on unmount. Setup and teardown therefore stay
paired per effect — a changed dependency of one effect does not tear down the others.

An empty `deps` array means "once, on mount". `unUseEffects(prevProps)` is still available as a
component-wide hook that runs before every `useEffects` pass and on unmount, for teardown that
is not tied to one effect.

### Diagnostics

The engine complains about a few kinds of misuse — a write that was never published, a
`transaction` handed an async body, a `connectSelection()` snapshot that hands an opaque live
facade to a child, reported once per selection. Safely copied plain/array views are supported;
project plain fields from opaque live instances. Those complaints are development-only and switchable:

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
Public `setData` replacement reconciles the raw rejection before subscribers run: a distinct
Error-state object gets an Error with its wire message even when that message is unchanged;
a non-Error state clears the raw cause. Passing the exact current object, or changing unrelated
fields through a subclass's draft/update action, retains the current Error's original rejection.
A distinct keyless `setData` replacement also drops the old settled argument key before
publication, even when its visible fields are equal. It cannot satisfy `suspend(oldArgs)`:
that read starts the loader again. Exact-object no-ops retain the key; `restore` and
`fromJSON` retain only the explicit key carried by their wire snapshot.
Keyless replacement neither invents an argument key nor cancels a current request.
If a synchronous subscriber or abort listener supersedes a load before its loader starts,
that load rejects with `AbortError` instead of reporting a successful load that never ran.

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
  An answer from a request started before the invalidation does not consume it: the answer stays
  stale, or a failure keeps the explicit retry armed, until a later request settles.

A failed entry is not retried automatically — that would loop, since the failure re-renders the
component that asked. Call `refresh(args)` to try again, or explicitly `invalidate(args)` /
`invalidateAll()` to re-arm mounted readers: their retry starts after commit, not during render.
Aborting a re-armed failed request disarms it again until another explicit invalidation.
Replacing an entry through `setData` or a subclass's draft/update action drops its old raw rejection
before subscribers run, even when the new Error has the same wire message. Failure ownership
belongs to the entry object: a distinct identical-shaped entry cannot inherit it, while unrelated
writes to the same entry preserve its original rejection. Unchanged entries and in-flight requests
retain their ownership. The cache is bounded: the least recently used entries are dropped past
`maxEntries`, never one with a request in flight or one a component is reading.

`suspend(args)` reads per entry: a miss or explicitly re-armed Error throws the current request,
and a failed, non-invalidated Error throws its rejection without retrying. A stale Success starts
revalidation with deferred publication and returns its previous value; a Suspense-only consumer
needs a subsequent parent render to display the refreshed answer unless it also subscribes.
Server rendering needs nothing extra: a scope's `dehydrate()` carries the entries, and a hydrated
entry counts as fresh for the rest of its lifetime rather than being refetched on mount.

Explicit non-goals, so the shape is clear: no retries with backoff, no refetch on window focus or
interval, no pagination, no normalisation, no optimistic updates. See
[docs/promise-cache.md](docs/promise-cache.md) for the reasoning behind the key encoding, the lifetime
semantics and the eviction rules.

## Per-request stores

A module-level singleton is shared by every request on a server, which leaks one user's state
into another's render. A scope creates the instances per request instead, and components
resolve them through context — no hooks involved.

```ts
export const todoToken = carburetorToken(() => new TodoCarburetor(new ToDoClientAPI()), 'todos');
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
tokens whose state is present and leaves the rest to be created on demand. The token's name is
what the two sides match on, so the same token must be declared with the same name in the server
and client bundles — the two module graphs can otherwise run in any order, and a counter-based
id would not survive the trip. Two tokens in one process may not share a name, and a payload key
no token claims is reported in development. A single store can also be seeded directly with
`scope.set(token, carburetor)`.

## Tooling

```ts
// Redux DevTools: state inspection plus time travel back onto the carburetors.
connectDevTools({todos: todoCarburetor, filter: filterCarburetor});

// Mirror a store in a storage; loads what was stored on connect. Writes are synchronous;
// `coalesce: true` stringifies once per microtask instead of once per write.
persist(settingsCarburetor, {key: 'settings', storage: localStorage});

// React to a selection outside React; onChange runs only when it changes.
const stop = todoCarburetor.watch((data) => data.activeCount, (next, previous) => log(next, previous));

// Undo/redo built on patches.
const history = new CarburetorHistory(todoCarburetor, {limit: 50});
history.undo();
history.redo();

// Await the next update — for throttled stores and async resources in tests.
await waitForUpdate(presenceCarburetor);
```

`persist` writes `JSON.stringify(store)` — the store's wire form via `toJSON()` — and restores
parsed JSON through `restore()`. Ordinary stores stringify live data without first cloning a
snapshot. A subclass with a different wire form overrides `toJSON()` to produce JSON that its
`restore()` accepts. `ResourceCarburetor` includes its settled argument key, so a restored
successful or failed answer is reused only for matching arguments; Pending restores as Idle.
`snapshot()` copies plain containers (wire `toJSON()` does not copy); opaque values remain
shared by reference.
Changing only a resource's settled key is still a published change, even when its visible
status/data/error/timestamp are equal. Resource history records complete wire graphs so
undo/redo restores the answer's key too; pure plain-tree store history stays patch-based.
Resource `load`/`suspend` and cache `load`/`refresh` can restart after readonly history replay.
They reserve mutable lifecycle fields on a detached operational graph before publishing a request;
held history endpoints keep their descriptors and direct draft writes still respect readonly fields.
A failed pre-loader publication removes its own request rather than leaving a joinable pending promise.
Cache eviction and `forget` also remove non-configurable dictionary slots by owned replacement,
and update capacity bookkeeping only after the key is actually gone.
Operational copies preserve native `Map`/`Set`/`Date` accessor descriptors without evaluating them;
unrelated native metadata does not block requests or removals. Actual history capture remains strict
and rejects native accessors rather than claiming it owns values returned by arbitrary getters.
Cache `invalidate` and `invalidateAll` reserve readonly invalidation fields before changing live state.
Bulk invalidation prepares all affected entries before the first write, publishes the complete stale
state once, and does not fetch. Held replay endpoints stay restricted; already-targeted flags are no-ops.
History records each published operation before ordinary subscribers run, so a subscriber's
nested write remains a separate undo step regardless of registration order. Writes caused by
undo/redo subscribers or superseding abort listeners are fresh branches and invalidate redo;
only history's own restore installation is suppressed. Transactions and throttles still coalesce
their writes into one published step. Multiple histories keep independent limits and disposers;
attaching or replacing a patch-only observer does not disconnect those histories.
Native producers carry explicit installation origin/owner and graph representation through a shared
commit boundary. A deferred replay followed by a fresh write branches from the installed replay
state; coalescing cannot turn that fresh write into the recorder's own replay.
Watch, class selections and hook snapshots transfer completed read sets only after selection,
comparison and required detachment finish. Live computed dependencies remain deliberately extendable.
History owns ordinary `Map`, `Set` and `Date` endpoints independently of `snapshot()`.
Native-containing state uses complete detached graphs, preserving Map-key aliases, native
descriptors and backlinks through repeated undo/redo and branching. Unsupported mutable
instances and accessor-bearing native values are rejected instead of promising a false undo.
`history.clear()` captures the current baseline and discards pre-clear deferred writes;
later coalesced writes remain undoable from that baseline, and other histories stay independent.
Undo and redo first reconcile collected writes awaiting a coalesced publication, so time travel
reverses the latest coherent step and a later flush cannot manufacture a new branch.
A conservative native read or equal-content operation creates no history step when its owned
intrinsics, descriptors and alias topology are unchanged; it does not erase valid redo.
Mixed plain/native history graphs share one copy ledger, without discarding a copied plain prefix.
Supported array length definitions also record descriptor-only locks. Undo/redo restores the
length's writable flag and sparse elements; a refused restore before installation preserves
the cursor for retry.
Persistent array connections report a writable length descriptor to satisfy their proxy target
invariants across locks and root replacement. Detached selections retain the raw writable flag.
Own string-key order is observable: replacement/reinsertion updates enumeration and detached
selections, and history restores the original order. Positional string-key changes use owned
graph endpoints; scalar writes, numeric keys and ordinary array operations retain patches.
Restore checks readonly assignments, deletions and changed locked object references before any
sibling write, replacing the root when the draft cannot install valid snapshot values. Ordinary
snapshots remain writable plain copies; owned history replay retains captured restricted descriptors.
History admits patches only when they can advance its owned baseline; restrictive targets use
complete owned endpoints before any held snapshot can be mutated.
Producer patch copies retain restrictions for history classification. A value-changing branch
that introduces readonly or non-configurable fields uses an owned endpoint, including additions;
ordinary snapshot normalization and metadata-only no-op publication semantics are unchanged.
Effective draft paths are attributed before fallible patch delivery. An observer error still
reaches the caller, but cannot hide an already-applied change from readers or other histories.
Resource replay normalizes Pending/refreshing fields on its fresh owned graph. Writable and
configurable fields stay in place; locked changes use one descriptor-aware graph copy before
restrictions are installed, retaining native aliases and readonly flags. Reentrant request
entries retain their newer dictionary capabilities and are not overwritten by captured work.

Failed storage reads reach `onError` without deleting unread data; when the handler returns,
later writes remain subscribed. Without a handler, a read failure throws. Malformed stored
data is reported before removal, and a removal failure is reported separately.

## Hooks interop

The engine needs no hooks, but the ecosystem around it is hooks-first. An opt-in entry point
bridges the boundary, with the same path precision: the selector is run through the tracking
proxy to learn what it depends on.

For reactive selectors, read a primitive with `data.key` or `Reflect.get(data, 'key')`.
`Object.getOwnPropertyDescriptor(data, 'key')?.value` and
`Object.prototype.hasOwnProperty.call(data, 'key')` inspect structure, but do not register a
dependency on that primitive value. Descriptor lookup is also part of `Object.keys` and
`for…in`; those operations track the key set without subscribing to every listed value.
Descriptor values that are plain objects or arrays remain read-only wrapped views, so later
ordinary property reads through them are tracked. A frozen or otherwise locked property whose
object value cannot legally be wrapped is refused in development; production may return the raw
value at that boundary. Keep store data unfrozen if those read guarantees matter.

```tsx
import {useCarburetorValue, useComputedValue} from 'react-carburetor/interop';

const NameBadge = () => {
    const name = useCarburetorValue(profileCarburetor, (data) => data.name);

    return <span>{name}</span>;
};
```

Built on `useSyncExternalStore`, so it is tearing-safe and SSR-safe.
Selected plain objects, arrays, `Map`, `Set` and `Date` values are detached for a stable
React snapshot. A class instance cannot be copied safely, so selecting one directly or
inside another value throws an actionable error; select the fields you render instead. A
`Map`, `Set` or `Date` subclass counts as a class instance here, not as the built-in.
A selection is plain data in the state-model sense: own enumerable string keys, array
elements and `length`; symbol keys, non-enumerable properties and descriptor flags are not
part of a selection and are not copied. An accessor's getter runs once and its value is the
snapshot. Repeated references and cycles stay connected within one detached selection,
including a `Date` used both as a `Map` key and elsewhere in the selected graph.

The third argument is the equality check that decides whether a recomputed selection
counts as changed. It defaults to a structural comparison — own enumerable string keys and
`Object.is` values, recursively through plain objects and arrays, a detached `Date` by its
time, and a detached `Map`/`Set` by size and entries over primitive keys (object keys
count as changed) — because every selected object is detached into a fresh container, so
`Object.is` itself could never call two of them equal: a selector rebuilt on every render,
or a write that replaces an ancestor of the selected data without changing its content,
would otherwise re-render every time. A class instance still always compares as changed,
since its fields can mutate in place. Pass `Object.is` explicitly for the old,
reference-only behavior.
A different comparator re-evaluates the current selection even if the previous comparator
suppressed the latest write. Values truly equal under the new policy keep their snapshot identity.

## Lint rules

The engine trades one class of mistake for another. Nothing here forces a re-render you did not ask
for — and nothing tells you when a write reaches no subscriber, when a component reads state it never
subscribed to, or when an effect's cleanup is silently dropped. The package ships 24 rules for
exactly those, and for the allocations a class rebuilds for nothing. [docs/rules.md](docs/rules.md)
is the reference by rule name — what each catches, its options, how to switch one off — and
[docs/hazards.md](docs/hazards.md) is the same material by mistake, with the code that triggers it,
why it is silent at runtime, and where the rule can be wrong.

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

### The binary and the bridge

The rules are implemented once, in Rust (`native/src/rules/`). What `react-carburetor/lint`
ships is a bridge: it runs that binary once per lint run and reports through the host's own
`context.report`. Two ways to run them, good at different things.

**Standalone (`carburetor-lint`)** — after its first npm release,
`npm i -D carburetor-lint` fetches the one binary matching your machine, and
the rules run without starting a linter: `npx carburetor-lint
--fix-dry-run src` to see what would change, `--fix` to change it. This is the fast path —
about 20 ms over this repository against 585 ms for the same rules through oxlint — and the
only one that rewrites code. It reads its own `.carburetorrc.json` (or `--rule`/`--config`),
not your oxlint or ESLint config; it honours its own `carburetor-disable` comments; it has no
editor integration. It is a command, not a plugin.

**The bridge (`react-carburetor/lint`)** — the `extends` line or flat-config snippet above.
Everything the host already does keeps working for these rules: one config file, one
suppression-comment syntax, editor diagnostics, per-project severity. What it cannot do is
apply fixes: diagnostics arrive through `context.report`, and no host exposes a plugin API that
could hand a native fix back. It also needs the binary on disk — install `carburetor-lint`
next to `react-carburetor`, point `CARBURETOR_LINT_BIN` at a built binary, or run
`cargo build --release` inside `native/` in a checkout of this repository. With none of those,
the run fails loudly and names the missing platform package; a missing binary never looks like
a clean run.

The measurements are this repository's, taken the way [native/README.md](native/README.md)
describes.

## API

### `Carburetor<T>`

| member                          | description                                                        |
|---------------------------------|--------------------------------------------------------------------|
| `constructor(data, scheduler?)` | Initial data and delivery policy (defaults to immediate delivery).  |
| `getData(): T`                  | Untracked data, for code outside render.                           |
| `read(record)`                  | Tracked, read-only plain data; every read path goes to `record`.   |
| `setData(data)`                 | Replaces the data (`getData() === data` afterwards) and wakes the readers of what changed; the protected `markAllChanged()` wakes everyone. |
| `snapshot(): T`                 | Copies plain objects/arrays; opaque values stay by reference.      |
| `restore(data)`                 | Installs a snapshot by diffing/copying plain fields; opaque values stay by reference. Owned native history replay preserves its complete graph. |
| `toJSON()` / `fromJSON(value)`  | Type-erased bridge for DevTools and hydration: `toJSON()` is the wire form — live data, no copy (resource stores add the settled key); `fromJSON(value)` installs freshly parsed wire state. A detached copy is `snapshot()`. |
| `watch(select, onChange)`       | Subscribes outside React to a selection: `onChange(next, previous)` runs only when it changes. Returns a disposer. |
| `getVersion(): number`          | Write counter.                                                     |
| `subscribe(cb, options?)`       | Subscribes to every write, for tooling. `options.id` reuses a stable id so re-subscribing replaces the previous registration; `options.reads` (with `read(record)`) is the engine's extension contract — its path strings are not a stable user-facing API; the set is copied, so changing it afterwards has no effect. |
| `unsubscribe(id)`               | Removes the subscription and cancels a pending update.             |
| `update(mutate)` *(protected)*  | Mutates through `draft` and publishes — the recommended write form. |
| `draft: T` *(protected)*        | Write proxy that records changed paths.                            |
| `emitSoon()` *(protected)*      | Publishes on the next microtask, for writes made where notifying now is unsafe. |
| `preEmit()` *(protected)*       | Runs before notification — derive state here.                      |
| `emitUpdate()` *(protected)*    | Notifies subscribers whose read paths intersect the writes.        |

Members are prototype methods — here and on `ComponentUpdateThrottle`, `CarburetorScope`,
`CarburetorHistory` and `Diagnostics`: override them with method syntax and reach the base through
`super`. Bind one before handing it out as a callback (`onClick={() => history.undo()}`).

### `AntiHookComponent<P, S>`

| member                            | description                                                    |
|-----------------------------------|----------------------------------------------------------------|
| `useCarburetor(carburetor)`       | Tracked data for reading in render; establishes the subscription. |
| `connect(source)`                 | A persistent view, built once (a field initializer is the intended call site) and read directly in render — the view object is reused across renders, while each render opens a fresh record of the paths read: the source resolver runs at most once per render, shared by all reads of that render, and every access still dispatches through the proxy and records its path. `source` is a carburetor or a function resolving one, so a prop swap re-points it. |
| `connectSelection(source, select)` | A typed selection of connected data, safe to hand to a child gated by shallow props comparison. Call what it returns in render: the selector's reads subscribe the owner, the returned snapshot is detached plain data whose identity changes only when the selected content changes. |
| `useComputed(computed)`           | Reads a derived value and subscribes to it, not to its inputs.  |
| `useEffects()` *(protected)*      | Declares the component's effects; runs on mount and after every committed update. |
| `unUseEffects(prevProps)`         | Component-wide teardown, before every `useEffects` pass and on unmount. |
| `useEffect(name, cb, deps)`       | Runs `cb` when `deps` changed; its return value is that effect's cleanup. |
| `shouldComponentUpdate(…)`        | The props/state gate. Override only with a `super` call.        |
| `@bind` *(decorator)*             | Binds a method once per instance, keeping it on the prototype and its reference stable. |

### Other exports

| export                                        | purpose                                     |
|-----------------------------------------------|---------------------------------------------|
| `computed(body, options?)`                    | Memoized derived value; `options.equals` judges the result by content instead of by reference. |
| `transaction(body)`                           | One notification pass for a group of writes. |
| `ComponentUpdateThrottle(ms)`                 | Coalescing for streaming sources.           |
| `ResourceCarburetor(loader, scheduler?)`      | Async state with status and cancellation.    |
| `CarburetorScope`, `carburetorToken`, `CarburetorProvider`, `ScopedAntiHookComponent` | Per-request stores. |
| `connectDevTools`, `persist`, `CarburetorHistory`, `waitForUpdate` | Tooling.  |
| `diagnostics`, `Diagnostics`                  | The development-only warning switch.         |
| `EResourceStatus`, `EDevToolsAction`, `EDevToolsMessageType` | Enums for the resource status and the DevTools protocol. |
| `getInitialResourceData`, `CarburetorContext` | The initial resource state and the context a scope is provided through. |
| `deepClone`, `shallowEqual`                   | Building blocks, exported for extensions.    |

Internals — the tracking proxies, the proxy cache, path string plumbing, the update scheduler
and the batch coordinator — are deliberately not exported: they are implementation details, and
a test pins the exported surface so one does not slip in by accident.

## Caveats

- Don't stash tracked data outside render. A read there records nothing — outside a render attempt
  it can never alter what any render established — so it buys no subscription coverage, and a
  proxy kept across renders may point at replaced data.
- Tracking covers plain objects and arrays. Ordinary unlocked `Map`/`Set` leaves expose cached
  native facades: intrinsic arguments from tracked read/draft views resolve to their original
  raw keys, members and roots, so `draft.map.set(draft.key, value)` updates the existing key.
  Method chaining and `forEach` callback collections retain that facade's receiver semantics.
  Exposed plain members, keys and own data links also subscribe to their ordinary writable
  aliases; writes through those plain paths wake readers without changing raw entry identity.
  A native backlink to the store root necessarily subscribes to the whole store.
  `Date`, custom instances and unsupported native subclasses remain raw. Native reads are coarse
  leaf reads; reaching one through `draft` conservatively marks its path, not fields inside it.
  Alias answers for such a value are cached and refreshed only by a topological write, so an
  in-place mutation of the value — or of a `Map` behind the facade — keeps its stale alias set
  until then; that is the same invisibility an opaque leaf's contents already have.
  A publication after bypassing `draft` invalidates the whole store. Replace values or use plain
  data for finer precision; an untrackable root has no narrower path to invalidate.
- **What counts as state.** A container's state is its own enumerable string-keyed data — what
  `Object.keys` lists — and an array's is its elements and `length`. Symbol keys, getters and
  setters, non-enumerable properties and non-index keys on an array are not state: they have no
  path, so diffing, `snapshot()` and `restore()` could not carry them. Development throws on them
  at the constructor, `setData`, `restore` and every `draft` write; a symbol key or a
  non-data `defineProperty` through `draft` throws in every build, including new properties with
  omitted writable/configurable flags, which JavaScript defaults to false; production does not check the
  rest and leaves their behaviour unspecified. Keep a derived value in a `computed`, and a value
  with its own identity in a `Map` or a class instance, which are leaves.
- `update(mutate)` publishes when `mutate` returns. An `async` callback is accepted by its
  `void`-returning signature and publishes at the first `await`, leaving everything written
  afterwards unpublished — development warns about it. Do the async work first, then write.
- Render stays pure — nothing subscribes during render — but a write that lands between
  render and commit is only detected afterwards and corrected with an extra render. The check
  compares the store's recent writes with the paths the render read, so a write elsewhere in the
  store costs nothing; once the store has indexed more than 8192 distinct written paths since the render, or a write the store
  cannot name (`markAllChanged`, a write that bypassed `draft`) landed there, it falls back to
  re-rendering. There is no consistency guarantee *within* a single
  concurrent render pass; don't write to stores from render.
- The props gate means a component that relied on its parent re-rendering to pick up data it
  never read will stop updating. Read what you render, through `useCarburetor`.
- Ordinary plain-tree undo/redo records patches — O(changed values), not O(state). Native-containing
  state, opaque writes, positional string-key changes and resource wire identity use owned graphs.
  Undo and redo install through `restore`, waking changed-path readers; key-only resource restores
  invalidate the slot. `CarburetorHistory` requires the full `IPatchSource` contract:
  `attachPatchListener({patch, publication?, restoreClaim?})` and `captureHistory(own)`.
  The default `captureHistory` owns the live graph, so a subclass that overrides `snapshot()`
  for its own view still attaches a history; only classes whose wire form differs from their
  live data override it, passing their authoritative raw graph to `own` and including private
  wire metadata without splitting that graph.
  Publication runs before ordinary subscribers after transaction/throttle coalescing.
  `restoreClaim(state)` runs with the exact argument after cancellation listeners can supersede
  it, returning `{owner, representation, adopt}`; `adopt` is true only for a fresh replay-owned
  graph the producer may adopt as-is. Patch-only observers use `{patch}`.
  History needs `getData`, `getVersion`, `restore` and `IPatchSource`, not unrelated store read APIs.
  Native sources may also deliver closed publication facts; custom producers must not replace the
  exact handoff with a broad replay flag that suppresses subscriber actions.
- Overriding a lifecycle method without calling `super` silently disables effects, subscription
  cleanup or the props gate. Override `useEffects` / `unUseEffects` instead.

## Demo

The `lib/` folder contains a Todo app built on the library (React 19, Rsbuild, Tailwind).
Each row shows its own render counter, so you can watch precise invalidation at work: edit
one todo and only that row's counter moves. It uses the library's features where an app would
need them — scoped stores, async resources and a cache, computeds, selections, transactions,
undo/redo, persistence, throttling and the hooks interop; [lib/README.md](lib/README.md) maps
each feature to the file that uses it.

```bash
cd lib
npm ci
npm start
```

## Development

```bash
npm ci
npm run build       # Rslib: ESM + CJS, plus pre-stripped production outputs, dts via tsgo
npm run typecheck   # TypeScript 7
npm run lint        # oxlint with type-aware rules
npm test            # Rstest + @testing-library/react

node benchmarks/pathsIntersect.mjs   # path matching, against the built output
```

Benchmarks live outside the test suite on purpose: the test run has to stay fast enough to
be run on every change.

## License

Dual-licensed as `MIT OR Apache-2.0`: choose either license (see [LICENSE](LICENSE)):

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
