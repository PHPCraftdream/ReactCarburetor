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

React 18 or 19 is a peer dependency. The package ships both ESM and CommonJS.

## Core ideas

### Read through the carburetor, write through its methods

`useCarburetor` returns **tracked data**, not the carburetor. Every field you touch during
render is recorded as a path (`value`, `items.a1.title`), and those paths become the
component's subscription.

```tsx
const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
```

Data returned from `useCarburetor` is deeply read-only: the compiler rejects a write, and the
proxy throws if you force one past it. Writes belong to the carburetor, through `draft`:

```ts
export class TodoCarburetor extends Carburetor<ITodoList> {
    public updateTodo = (todo: ITodo) => {
        this.draft.items[todo.id] = todo;   // records the changed path: items.<id>

        this.emitUpdate();
    };
}
```

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

Override `useEffects` / `unUseEffects`, and gate individual effects on a dependency value:

```tsx
export class TodoApp extends AntiHookComponent<ITodoProps> {
    protected useEffects(): void {
        this.useEffect(this.props.carburetor.loadData, 'loadData', 1);
    }

    protected unUseEffects(prevProps: ITodoProps): void {
        // cleanup
    }
}
```

`useEffect(callback, name, dep)` runs `callback` when `dep` changed since the last run,
compared with `===`.

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

For hydration, take `snapshot()` on the server, serialize it, and seed the client scope with
a prepared store through `scope.set(token, carburetor)`.

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
| `subscribe(cb, id?, reads?)`    | Subscribes; without `reads` the subscriber receives every update.  |
| `unsubscribe(id)`               | Removes the subscription and cancels a pending update.             |
| `draft: T` *(protected)*        | Write proxy that records changed paths.                            |
| `preEmit()` *(protected)*       | Runs before notification — derive state here.                      |
| `emitUpdate()` *(protected)*    | Notifies subscribers whose read paths intersect the writes.        |

### `AntiHookComponent<P, S>`

| member                         | description                                                       |
|--------------------------------|-------------------------------------------------------------------|
| `useCarburetor(carburetor)`    | Tracked data for reading in render; establishes the subscription.  |
| `useComputed(computed)`        | Reads a derived value and subscribes to it, not to its inputs.     |
| `useEffects()` *(protected)*   | Runs on mount and after every update.                             |
| `unUseEffects(prevProps)`      | Runs before `useEffects` on update, and on unmount.                |
| `useEffect(cb, name, dep)`     | Runs `cb` when `dep` changed since last time.                      |

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
| `deepClone`, `pathsIntersect`, `isTrackable`  | Building blocks, exported for extensions.    |

## Caveats

- Don't stash tracked data outside render. Reads happening after commit are not part of the
  subscription, and a proxy kept across renders may point at replaced data.
- Tracking covers plain objects and arrays. `Map`, `Set`, `Date` and class instances are
  handed over as they are: reading one is a leaf read, but mutating it in place is invisible,
  so such a write falls back to invalidating the whole store. Replace the value instead of
  mutating it, and keep plain data in stores you want precision on.
- Path matching is a nested loop over read and write paths. That is fine for realistic sets;
  a store with thousands of tracked paths per component would want a smarter index.
- Render stays pure — nothing subscribes during render — but a write that lands between
  render and commit is only detected afterwards, by comparing the carburetor version, and
  corrected with an extra render. There is no consistency guarantee *within* a single
  concurrent render pass; don't write to stores from render.

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
npm run build       # Rslib: ESM + CJS, declarations via tsgo
npm run typecheck   # TypeScript 7
npm run lint        # oxlint with type-aware rules
npm test            # Rstest + @testing-library/react
```

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
