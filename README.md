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

React 19 is a peer dependency.

## Core ideas

### Read through the carburetor, write through its methods

`useCarburetor` returns **tracked data**, not the carburetor. Every field you touch during
render is recorded as a path (`value`, `items.a1.title`), and those paths become the
component's subscription.

```tsx
const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
```

Data returned from `useCarburetor` is read-only — mutating it throws. Writes belong to the
carburetor, through `draft`:

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

### Scheduling is a policy, not a constant

By default updates are delivered immediately and React does the batching — no latency added
to a click or a keystroke. Throttling is opt-in, per carburetor, for streaming sources where
coalescing actually helps:

```ts
import {Carburetor, ComponentUpdateThrottle} from 'react-carburetor';

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

`useEffect(callback, name, dep)` runs `callback` when `dep` changes since the last run,
compared with `===`.

## Lifecycle contract

The React lifecycle belongs to `AntiHookComponent`: it subscribes in the commit phase,
prunes subscriptions that are no longer read, and releases everything on unmount.

Override `useEffects` / `unUseEffects`. If you must override
`componentDidMount` / `componentDidUpdate` / `componentWillUnmount`, call the `super`
implementation — otherwise effects and subscription cleanup will not run.

Render stays pure: nothing subscribes during render, so an abandoned concurrent render
leaves nothing behind. The window between render and commit is closed by comparing the
carburetor's version and re-rendering if data changed in between.

## API

### `Carburetor<T>`

| member                            | description                                                          |
|-----------------------------------|----------------------------------------------------------------------|
| `constructor(data, scheduler?)`   | Initial data and delivery policy (defaults to immediate delivery).   |
| `getData(): T`                    | Untracked data, for code outside render.                             |
| `read(record): T`                 | Tracked data; every read path goes to `record`. Used by components.   |
| `setData(data): T`                | Replaces the data and invalidates everything.                        |
| `getVersion(): number`            | Write counter.                                                       |
| `subscribe(cb, id?, reads?)`      | Subscribes; without `reads` the subscriber receives every update.    |
| `unsubscribe(id)`                 | Removes the subscription and cancels a pending update.               |
| `draft: T` *(protected)*          | Write proxy that records changed paths.                              |
| `preEmit()` *(protected)*         | Hook that runs before notification — derive state here.              |
| `emitUpdate()` *(protected)*      | Notifies the subscribers whose read paths intersect the writes.      |

### `AntiHookComponent<P, S>`

| member                          | description                                                       |
|---------------------------------|-------------------------------------------------------------------|
| `useCarburetor(carburetor): T`  | Tracked data for reading in render; establishes the subscription.  |
| `useEffects()` *(protected)*    | Runs on mount and after every update.                             |
| `unUseEffects(prevProps)`       | Runs before `useEffects` on update, and on unmount.                |
| `useEffect(cb, name, dep)`      | Runs `cb` when `dep` changed since last time.                      |

### Schedulers

| class                            | behaviour                                                        |
|----------------------------------|------------------------------------------------------------------|
| `SyncUpdateScheduler` *(default)*| Delivers immediately; React batches.                             |
| `ComponentUpdateThrottle(ms)`    | Coalesces updates per component within an `ms` window (default 40). |

## Caveats

- Don't stash tracked data outside render. Reads happening after commit are not part of the
  subscription, and a proxy kept across renders may point at replaced data.
- Tracking covers plain objects and arrays. `Map`, `Set`, `Date` and class instances are
  returned as-is and are not tracked field by field.
- Path matching is a nested loop over read and write paths. That is fine for realistic sets;
  a store with thousands of tracked paths per component would want a smarter index.
- Store instances are usually module singletons, which is not safe for server-side rendering
  across requests. Create per-request carburetors if you render on a server.

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
npm run build       # Rslib bundleless CJS + declarations via tsgo
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
