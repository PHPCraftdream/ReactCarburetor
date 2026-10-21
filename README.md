# React Carburetor

[![CI](https://github.com/PHPCraftdream/ReactCarburetor/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/PHPCraftdream/ReactCarburetor/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](LICENSE)
[![React 18 and 19](https://img.shields.io/badge/React-18%20%7C%2019-61dafb.svg?logo=react)](#install)
[![Status: pre-release](https://img.shields.io/badge/status-pre--release-orange.svg)](#install)

State lives outside the React tree. Class components read it directly, and each component
subscribes to **exactly the fields it read** — so a write wakes only the components that
actually depend on it. The core API needs no hooks and no memoization: path-precise
subscriptions avoid unnecessary re-renders without dependency arrays, so the unnecessary
re-renders are never created in the first place.

[Install and try it](#install) · [Core ideas](#core-ideas) · [API](#api) ·
[Examples](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/examples/README.md) ·
[FAQ](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/faq.md) ·
[Lint rules](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/rules.md) · [Async cache](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md) ·
[Contributing](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/CONTRIBUTING.md) · [Security](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/SECURITY.md) ·
[Code of Conduct](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/CODE_OF_CONDUCT.md)

Development diagnostics are removed when your bundler (or its define configuration) substitutes the
literal `process.env.NODE_ENV` expression with `"production"`. Without a bundler, set
`globalThis.process = {env: {NODE_ENV: 'production'}}` before importing the library; use a dynamic
`import()` after setting it, since static imports run before the assignment.

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

React 18 or 19 is a peer dependency. The package ships ESM and CommonJS, each in a normal build
and in a pre-stripped production build that the `production` export condition selects. See
[docs/troubleshooting.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/troubleshooting.md) for common issues and diagnostic guidance.

The advertised range is `^18.0.0 || ^19.0.0`; the test suite and the demo app are exercised
locally and in CI against React 19.3. CI also runs the Engine and Demo suites against React
18.3.1; no tests are excluded within those suites, but Plugin, Native and Tooling suites are not
run in that compatibility job. 18.3.1 is the newest of the 18.x line; the range's `18.0.0` floor
and the point releases between are not separately exercised — a coverage gap, not a report that
they fail.

### Requirements

Node.js 14.6 or newer is required (the package engines floor). `WeakRef` is required: Chrome 84+,
Firefox 79+, or Safari 14.1+. Node 14 does not provide `fetch`; the `AbortController` fallback
described below does not polyfill `WeakRef`.

`@types/react` is an optional peer, `^18.0.0 || ^19.0.0`: a TypeScript project sees a warning
only on a real version mismatch, and a plain-JS project needs nothing. See
[`docs/react-compatibility.md`](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/react-compatibility.md) for how the library binds to the
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

<!-- example:file examples/readme/Counter.tsx -->
```tsx
import {AntiHookComponent, Carburetor, bind} from 'react-carburetor';

const incrementBy = (draft: {value: number}, step: number): void => {
    draft.value += step;
};

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementBy, 1);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});

export class Counter extends AntiHookComponent {
    public render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={counterCarburetor.inc}>{value}</button>;
    }
}
```

## Testing your code

Runner fake clocks control scheduled work such as `ComponentUpdateThrottle` and `after()` timers.
Use the runner's clock APIs (for example, `rstest.useFakeTimers()` and
`rstest.advanceTimersByTimeAsync()`); do not wrap or replace the clock APIs.

For work that does not involve clocks, import `flush` and `createTestScope` from
`react-carburetor/testing`. `flush(target)` delivers recorded notifications synchronously; it does
not advance `after()` timers or promises. When stores share a scheduler, flushing one drains that
scheduler queue. Active update waves and transactions still determine atomic delivery.
`createTestScope(overrides?)` creates an isolated scope with optional token overrides; dispose it
when the test finishes. Use `using` when the runtime supports `Symbol.dispose`, or `try/finally` to
dispose explicitly as shown below.

<!-- example:file examples/readme/App/StoreTesting.ts#scope-test -->
```ts
export const scopeTest = (): void => {
    const scope = createTestScope([[
        scopeToken,
        new ScopeStore({count: 7})
    ]]);
    try {
        const store = scope.get(scopeToken);
        const observed: number[] = [];
        const stop = store.watch(data => data.count, next => { observed.push(next); });
        try {
            store.increment();
            flush(store);
            expect(observed).toEqual([8]);
        } finally {
            stop();
        }
    } finally {
        scope.dispose();
    }
};
```

The [store testing recipe](docs/examples/testing.md) also exercises runner fake timers for throttled
watch delivery and `after()` cleanup.

## One-off events

<!-- example:file examples/readme/Interop/OneOffEvents.tsx -->
```tsx
import {bind} from 'react-carburetor';
import {AntiHookComponent, Carburetor} from 'react-carburetor';
import type {ICarburetorEvents} from 'react-carburetor';

interface IStatus {online: boolean}
interface IEvents {connected: {at: number}}

/** Sets the status online before its connected event is emitted. */
const setOnline = (draft: IStatus): void => {
    draft.online = true;
};

class StatusCarburetor extends Carburetor<IStatus, IEvents> {
    @bind
    connect(): void {
        this.update(setOnline);
        this.emit('connected', {at: Date.now()});
    }
}

const statusCarburetor = new StatusCarburetor({online: false});

/** Logs one connection event. */
const logConnected = (event: IEvents['connected']): void => {
    console.info('Connected at', event.at);
};

/** Any store emitting `connected` fits, not only StatusCarburetor. */
export const watchConnections = (source: ICarburetorEvents<IEvents>): (() => void) =>
    source.on('connected', logConnected);

export class StatusView extends AntiHookComponent {
    protected useEffects(): void {
        this.useEvent(statusCarburetor, 'connected', this.receiveConnected);
    }

    /** @param event - the connection event payload */
    @bind
    protected receiveConnected(event: IEvents['connected']): void {
        console.info('Connected at', event.at);
    }

    public render() {
        const {online} = this.useCarburetor(statusCarburetor);
        return <button onClick={statusCarburetor.connect}>{online ? 'Online' : 'Connect'}</button>;
    }
}
```

Events notify listeners but do not change state or versions. Call `emit()` after publishing the state
it describes. Outside transactions, delivery occurs synchronously inside `emit()`; within transactions,
delivery waits until the outer transaction closes. A throwing transaction does not roll back state
and still drains captured events. Events have no replay and do not participate in history, persistence,
DevTools, or dehydration. Listener errors are isolated, and `dispose()` cancels pending delivery and
prevents future registrations.

`AntiHookComponent` subscribes from `useEffects()` using `this.useEvent(store, name, handler)`.
Use a stable `@bind` method; each handler owns one registration, replaced when store or name changes.
`useCarburetorEvent(store, name, handler)` is the hooks alternative, with dependencies
`[store, name, handler]`. See the [class example](examples/readme/Interop/OneOffEvents.tsx) and
[hooks example](examples/readme/Interop/HookOneOffEvents.tsx).

<!-- example:file examples/readme/Interop/HookOneOffEvents.tsx -->
```tsx
import {Carburetor} from 'react-carburetor';
import {useCarburetorEvent} from 'react-carburetor/interop';

interface IEvents {connected: {at: number}}

class StatusCarburetor extends Carburetor<{online: boolean}, IEvents> {}
const statusCarburetor = new StatusCarburetor({online: false});
/** @param event - the connection event payload */
const receiveConnected = (event: IEvents['connected']): void => {
    console.info('Connected at', event.at);
};

export const HookStatus = () => {
    useCarburetorEvent(statusCarburetor, 'connected', receiveConnected);
    return null;
};
```

## Public contract at a glance

- **Reading:** `this.useCarburetor(store)` in render — see
  [A persistent connection](#a-persistent-connection-connect) and
  [docs/examples/components.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/examples/components.md);
  `connect()` is for a store fixed for the component's lifetime.
- **Scopes:** `CarburetorScope` owns token-created stores; create and dispose one per request or screen.
  React providers only expose a scope—they do not create or dispose it automatically. See [Scopes](#scopes-and-lifetimes).
- **Writing:** use `this.update(mutate, ...args)` for a synchronous one-step write.
  Decorated `@action` methods batch synchronous draft writes and publish once; they must not await
  (thenable returns warn in development). See [Writing actions](#writing-actions).
- **Subscriptions:** per-path, established by what the render reads; `watch(select, onChange)`
  works outside React — see [Precise invalidation](#precise-invalidation) and the
  [Tooling section](#tooling).
- **Async resources:** `ResourceCarburetor` (one slot) and `ResourceCache` (many entries;
  `ttl: 30_000` / `maxEntries: 100` defaults) — see [Async resources](#async-resources) and
  [docs/promise-cache.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md).
- **Lint:** 26 core rules plus the optional `no-react-hooks-in-components` — see
  [Lint rules](#lint-rules) and
  [docs/rules.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/rules.md).

## Why

The usual React model keeps state inside the tree, so changing it re-renders a subtree, and
you spend your time fighting that: dependency arrays, `memo`, `useCallback`, selector
libraries, auto-memoizing compilers. Those are all mitigations for re-renders that the model
generates by design.

React Carburetor removes the generator instead. State sits in a plain class outside React.
A component reads what it needs, that read becomes its subscription, and a write invalidates
only the intersecting paths.

## Core ideas

### Writing actions

Use `@action` for a synchronous store method that performs multiple draft writes. Nested decorated
actions join the outer publication. Do not return a promise/thenable or await inside an action:
only synchronous writes are included in its publication; asynchronous work should complete before
calling a synchronous action.

<!-- example:file examples/readme/Interop/CounterAction.ts -->
```ts
import {Carburetor, action} from '@/Carburetor';

export class Counter extends Carburetor<{value: number}> {
    constructor() { super({value: 0}); }

    /** Increments the counter twice in one published action. */
    @action addTwice(): void {
        this.draft.value++;
        this.draft.value++;
    }
}
```


### Read through the carburetor, write through its methods

`useCarburetor` returns **tracked data**, not the carburetor. Every field you touch during
render is recorded as a path (`value`, `items.a1.title`), and those paths become the
component's subscription.

<!-- example:file examples/readme/Core/TodoStore.ts#read -->
```ts
const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
```

Data returned from `useCarburetor` is deeply read-only where it is plain data: the compiler
rejects a write, and the proxy throws if you force one past it. Standard native Map/Set mutators
and Date setters are excluded from the TypeScript view, but native objects are not frozen; writes
through JavaScript or unsafe casts remain possible. Writes
belong to the carburetor: hand a module-level mutator and its arguments to `this.update`, which
writes to `this.draft` and publishes in one step (a multi-phase write may use `this.draft` and
`emitUpdate()` by hand):

<!-- example:file examples/readme/Core/TodoStore.ts#renameTodo -->
```ts
const renameTodoItem = (draft: ITodoList, id: string, title: string): void => {
    draft.items[id].title = title;   // records the changed path: items.<id>.title
};

export class TodoCarburetor extends Carburetor<ITodoList> {
    public renameTodo(id: string, title: string): void {
        this.update(renameTodoItem, id, title);   // publishes it to the readers of that path
    }
}
```

For helpers consuming tracked data, accept `readonly T[]` or `TReadonly<T>` instead of
requiring mutable inputs. The optional rule
[`carburetor/prefer-readonly-array-param`](docs/rules.md) encourages readonly array parameters.

<!-- example:file examples/readme/App/RoundStore.ts#readonly-array-helper -->
```ts
/** Returns how many round kinds are available.
 *
 * @param kinds - accepted round kinds
 */
export const countKinds = (kinds: readonly string[]): number => kinds.length;
```

The mutator object's `markWrong` property declares `index: number`, so
`this.update(mutators.markWrong, index)` infers the argument type. TypeScript rejects other
argument types.

Group small mutators in one module-level object:

<!-- example:file examples/readme/App/RoundStore.ts#module-mutators -->
```ts
const mutators = {
    /**
     * Locks the round after a winning answer.
     *
     * @param draft - state to change
     */
    lockWin(draft: IRound): void {
        draft.round.locked = true;
    },
    /**
     * Marks an answer wrong at its position.
     *
     * @param draft - state to change
     * @param index - position to mark
     */
    markWrong(draft: IRound, index: number): void {
        draft.round.wrong[index] = 1;
    },
};
```

Methods inside `RoundStore` pass their arguments to these mutators:

<!-- example:file examples/readme/App/RoundStore.ts#store-methods -->
```ts
/** Marks an answer wrong.
 *
 * @param index - position to mark
 */
public markWrong(index: number): void {
    this.update(mutators.markWrong, index);
}

public lockWin(): void {
    this.update(mutators.lockWin);
}

public finishRound(): void {
    transaction(() => {
        this.update(mutators.markWrong, 0);
        this.update(mutators.lockWin);
    });
}
```

### Selection results and ownership

`watch`, `useCarburetorValue`, and `connectSelection` return **borrowed readonly selections**.
Plain object and array projections are detached for comparison and cached internally; mutating
one can corrupt that comparison baseline. TypeScript marks plain fields and tuple/array elements
readonly, but JavaScript callers and unsafe casts are not protected by a runtime mutation guard.

Standard `Map`/`Set` mutators and `Date` setters are excluded from the readonly type surface;
read methods remain available. This is compile-time only: the underlying native values are not
frozen and JavaScript callers or unsafe casts can still mutate them. `watch` and the hook reject
unsupported live class instances; class connection selections retain their existing live-reference
policy and development diagnostics. Readonly typing does not promise runtime isolation.

When an editable projection is needed, copy the plain branch to edit, for example
`const editable = {...selected}` (nested branches too, before editing them).
`store.snapshot()` remains an editable plain-data copy for tooling; native Map/Set/Date values
and class instances still have its existing shared-reference limits. See the
[API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md).

Write the fields that change, or `Object.assign(draft.items[id], patch)`: the no-op check skips
fields that already hold the value, so only real changes are recorded. Replacing a whole object
(`draft.items[id] = next`) is precise too — it is diffed against the object it replaces and
records only the fields that differ. Containers built from draft branches are fine to assign back
(`draft.rows = draft.rows.filter(...)` stores raw rows, never proxies), and the array methods
`sort`, `reverse`, `splice`, `shift`, `unshift`, `copyWithin` and `fill` are recorded per changed
index, so reordering 10 000 rows costs milliseconds; a `sort` comparator and a `fill` value see
raw elements, and `splice`/`shift` return raw removed ones (see the
[API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md)
for the details).

`update` mutates through `draft` and publishes in one step. Arguments after the mutator are
forwarded to it, so the mutator stays a module-level function free of closures. You can also write to `this.draft`
directly and call `this.emitUpdate()` yourself, but forgetting the second half changes the data
while nobody re-renders — so in development the carburetor reports that mistake rather than
letting it pass silently.

### A persistent connection: `connect()`

Read a store in render with `this.useCarburetor(store)` — it works for every store and every
source shape. `connect()` is an optimization for a store fixed for the component's lifetime that
a component reads many times: declared once — a field initializer is the intended call site —
it hands back the same live view object across renders. Its limitations: the view's object/array
kind is fixed at declaration, and a source not resolvable at declaration fixes the object kind
(a later array root fails with a boundary error) — read such stores through `useCarburetor`
instead. A store chosen per render (a prop, a scope lookup) or an array-rooted scoped store is
the usual `useCarburetor` case:

<!-- example:file examples/readme/Core/Connect.tsx#connect -->
```tsx
const renderTodoItem = (id: string): JSX.Element => <TodoItem key={id} id={id} />;

class TodoApp extends AntiHookComponent<ITodoProps> {
    private readonly todos = this.connect(() => this.props.carburetor);

    render() {
        return (
            <>
                <span>Active: {this.todos.activeCount}</span>
                {this.todos.orderIds.map(renderTodoItem)}
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

The view's object/array kind is decided once, at declaration, from the source's current root, and a
proxy cannot change kind afterwards: a source that is not resolvable at declaration time (a
scope-backed resolver resolves only after React fills context) fixes the view as an object view,
and a later root of the other kind fails with an explicit boundary error — read an array-rooted
scoped store through `useCarburetor` in render instead. Views stay live across writes, including
across a whole-data replacement by `setData` or `restore`.

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

<!-- example:file examples/readme/Core/Connect.tsx#connectSelection -->
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
the paths the selection touches, and what the call returns is detached plain data: a snapshot
the child can hold across renders. The snapshot keeps its identity while the selected content
stays the same, and when it does change only the changed spine is re-copied — so a `React.memo`
row handed one of its members re-renders only if that member's own content changed. A class
instance cannot be copied safely: project the plain fields the child needs instead. The full
detachment rules are in the [API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md).

### Precise invalidation

A render subscribes only to the fields it reads. No selector is needed for `round.kind`;
it does not subscribe to sibling `round.wrong`.

<!-- example:file examples/readme/Computed/ScopedRound.tsx#kind-read -->
```tsx
const store = this.resolve(scopedRoundToken);
const {round} = this.useCarburetor(store);
return <span className="kind">{round.kind}</span>;
```

For a detached slice handed to a memo child, classes use `connectSelection(source, select)`: the
snapshot keeps its identity while the selected content is unchanged. Hooks use
`useCarburetorValue(store, select, isEqual?)` with an optional comparison. A `computed` shares a
derived value across components.

`emitUpdate` compares the written paths against every subscriber's read paths. A write
touches a read when the paths are equal or one is nested in the other:

| read path            | write `items.a1.title` | add or delete `items.a3` | write `orderIds` |
|----------------------|------------------------|--------------------------|------------------|
| `items.a1.title`     | wakes                  | —                        | —                |
| `items` (enumerated) | —                      | wakes                    | —                |
| `orderIds.0`         | —                      | —                        | wakes            |

Two properties keep this honest:

- **Traversal is not a read.** Reaching into `data.items` on the way to `items.a1.title`
  subscribes you to the leaf, not to the whole container. `Object.keys` and `for…in` read the key
  set — woken when a key is added or removed, not by an edit under a key they listed. Value
  enumeration — `Object.values`, `Object.entries`, object spread — also reads every primitive
  value it returns, so it subscribes to those leaf paths too: an edit under an unchanged key set
  still wakes the reader. Probing (`'a1' in items`) subscribes to that key's presence — woken
  when it is added or removed, not by edits inside it. That is also what `items.map(...)` does per index, so a parent laying out rows is
  not re-rendered by an edit inside one. Inherited members (`map`, `Symbol.iterator`) are not
  data and record nothing, so `for…of` and spread track only the elements they visit.
- **Array writes are per index.** `push` wakes readers of `length` and the new index, not the
  existing rows; replacing `items[5]` wakes the readers of `items[5]`; `sort` wakes the indices
  it moved.
- **Writing the same value wakes nobody.** Recomputing a counter that ends up unchanged, or
  re-sorting an already sorted array, invalidates nothing.
- **Replacements are diffed.** Replacing an object or array with another of the same kind —
  through `draft`, `setData`, `restore`, `fromJSON`, or an undo — records only the leaves that
  differ, plus the key set where keys were added or removed; a kind change records the replaced
  path itself, so unrelated subscribers stay asleep. A branch that is the same object on both
  sides is skipped without a look — never mutate what `getData()` returns and hand it back:
  those edits are invisible to the diff. Thresholds and edge cases are in the API reference.

A direct write to `this.data` followed by publication invalidates the whole store only when no
recorded draft paths are available and the draft was not touched (a no-op draft access suppresses
the emission). If draft writes and direct writes are mixed, recorded paths can miss the direct
write; call `markAllChanged()` to deliberately invalidate the whole store. Prefer `update()` or
`setData()` when possible for precise, reliable notifications.

Matching is indexed rather than scanned: read paths and their ancestors are kept in maps, so a
write looks up the subscribers it concerns instead of comparing itself against all of them
(`perf/scenarios/subscribe/match-precision.mjs`, `npm run bench -- --only match-precision`).

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

<!-- example:file examples/readme/Core/Bind.tsx#bind -->
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

A computed memoizes a derived value and tracks paths read by its body. A store instance can own a computed field:

<!-- example:file examples/readme/Computed/ScopedRound.tsx#scoped-round-class -->
```tsx
export class RoundViews extends RoundStore {
    public readonly visible = computed((read) => {
        const {round} = read(this);
        return round.wrong.flatMap(unmarkedIndex);
    });
}
```

A token factory creates an independent store and computed for each scope:

<!-- example:file examples/readme/Computed/ScopedRound.tsx#scoped-token -->
```tsx
export const scopedRoundToken = carburetorToken<RoundViews>(
    () => new RoundViews({round: {kind: 'quiz', wrong: [0, 0], locked: false}}),
    'readme/scoped-round'
);
```

A scoped component can resolve the store and subscribe to its computed:

<!-- example:file examples/readme/Computed/ScopedRound.tsx#computed-render -->
```tsx
public render() {
    const store = this.resolve(scopedRoundToken);
    return <span className="visible">{this.useComputed(store.visible).join(',')}</span>;
}
```

`computed` memoizes a derived value and tracks its own dependencies: the paths its body reads.
It is recomputed only when one of them is written, and subscribers are woken only when the
result actually changed.

<!-- example:file examples/readme/Computed/ActiveCount.tsx#activeCount -->
```tsx
const isNotDone = (item: {done: boolean}): boolean => !item.done;

export const activeCount = computed<number>((read) => {
    const {items} = read(todoCarburetor);
    return Object.values(items).filter(isNotDone).length;
});
```

<!-- example:file examples/readme/Computed/ActiveCount.tsx#useComputed -->
```tsx
render() {
    return <span>{this.useComputed(activeCount)}</span>;
}
```

Editing a todo's title invalidates nothing `activeCount` read, so it does not recompute. Toggling
`done` does recompute it, and if the count comes out the same, nothing re-renders. A computed
stops observing its dependencies once its last subscriber leaves.

Computeds compose, as long as you read them through `read` as well:

<!-- example:file examples/readme/Computed/Summary.ts#summary -->
```ts
export const summary = computed<string>((read) => `${read(activeCount)} left`);
```

Calling `activeCount.get()` inside the body instead would register no dependency and leave
`summary` stale — the reader is what records it.

`get()` reads current dependencies even while a transaction or throttle has deferred delivery.

A computed's result is live, not a copy: when it returns store data (`read(store).items`), a
consumer reading deeper fields off it subscribes the computed to those fields too, so an edit
inside the list wakes the computed and, through it, the consumer. Each newly read field is added
to the existing subscription in O(path depth). Return plain values when you only need a count or
a flag — the unchanged-result check then saves the re-render.

A body that has to build a new array or object on every recompute — `filter`, `map`, `slice`, an
object literal — cannot rely on that check: a new reference looks like a change even when its
content is identical. Pass `equals` to judge the result by content instead:

<!-- example:file examples/readme/Computed/VisibleIds.ts#visibleIds -->
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

<!-- example:file examples/readme/Core/Transaction.ts#transaction -->
```ts
transaction(() => {
    todoCarburetor.createTodo();
    filterCarburetor.reset();
});
```

A store method can group several updates in one transaction:

<!-- example:file examples/readme/App/RoundStore.ts#finish-round -->
```ts
public finishRound(): void {
    transaction(() => {
        this.update(mutators.markWrong, 0);
        this.update(mutators.lockWin);
    });
}
```

Use a transaction when `watch`, computed subscribers, or other immediate observers must receive
one publication per store. React may already batch component renders, but that does not combine
separate store notifications.

### Scheduling is a policy, not a constant

By default updates are delivered immediately and React does the batching — no latency added
to a click or a keystroke. Throttling is opt-in, per carburetor, for streaming sources where
coalescing actually helps:

<!-- example:file examples/readme/Core/Throttle.ts#presence -->
```ts
// A socket pushing hundreds of messages per second: collapse them into ~25 renders/sec.
export const presenceCarburetor = new PresenceCarburetor(initial, new ComponentUpdateThrottle(40));
```

Cancelling or replacing a subscription id also removes its not-yet-run callback from an
in-progress throttle flush. A callback already running is not interrupted.

### Effects without hooks

Override `useEffects`, and declare each effect with a name and its dependencies:

<!-- example:file examples/readme/Core/UseEffects.tsx#useEffects -->
```tsx
export class TodoApp extends AntiHookComponent<ITodoProps> {
    protected useEffects(): void {
        this.useEffect('loadData', () => { void this.props.carburetor.loadData(); }, [this.props.carburetor]);

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

<!-- example:file examples/readme/Core/Diagnostics.ts#diagnostics -->
```ts
diagnostics.setEnabled(false);   // silence them anywhere
diagnostics.isEnabled();
```

They are guarded by a literal `process.env.NODE_ENV` comparison with the message inside the
guard, so a bundler drops the whole block — strings included — from a production build. The
package also ships pre-stripped outputs selected by the `production` condition in `exports`,
for toolchains that do not substitute `NODE_ENV` themselves.

`diagnostics.traceUpdates(listener)` observes delivered subscriber callbacks, not React renders.

<!-- example:file examples/readme/Core/Diagnostics.ts#trace -->
```ts
/** Logs which subscriber woke and which written paths it had read. */
const logTrace = (trace: IUpdateTrace): void => {
    console.debug(trace.subscriber, trace.store, trace.paths);
};

const stopTrace = diagnostics.traceUpdates(logTrace);
stopTrace();
```

`diagnostics.setWideReadThreshold(n)` turns on a development warning for a component that reads
more than `n` paths of one store in a render (off by default; for example `100`; `Infinity` turns
it off again). Large read sets often come from enumerating values or spreading an
object; use `computed` for derived work, `connectSelection` for child projections, or row components
that read only their own data.

## Async resources

`ResourceCarburetor` turns a promise into state with an explicit status, request
deduplication and cancellation:

<!-- example:file examples/readme/Resources/Resource.ts#profile -->
```ts
const parseProfile = (response: Response): Promise<IProfile> => response.json();

export const profile = new ResourceCarburetor<IProfile, [{id: string}]>(
    ({id}, signal) => fetch(`/api/profile/${id}`, {signal}).then(parseProfile)
);

await profile.load({id: 'a1'});   // EResourceStatus.Pending -> Success | Error
```

The status is an enum, `EResourceStatus`, not a bare string, so a typo in a comparison is a
compile error rather than a branch that never runs. Four derived boolean flags — `isIdle`,
`isPending`, `isSuccess`, `isError` — mirror it: exactly one is true and matches `status`, and
they live in the data itself, so they are serializable and readable through `getData()`,
selectors and copies:

<!-- example:file examples/readme/Resources/Resource.ts#isError -->
```ts
if (profile.getData().isError) {
    // handle the error state
}
```

The flags are always derived from the authoritative `status`: `restore()`, `fromJSON()`, cache
hydration and `persist` recompute them and ignore stored values, and a restored `Pending` without a
live request is normalized to `Idle`. Subscriptions track them per field — a component that
reads only `isError` is not re-rendered by a `Pending` → `Success` transition.

Concurrent loads with the same arguments share one request; a load with different arguments
aborts the previous one. The state stays serializable — the failure is stored as a message,
with the original rejection available through `getLastError()`. A `setData` replacement that
swaps in a distinct state object reconciles the raw rejection before subscribers run; it cannot
satisfy `suspend(oldArgs)` — that read starts the loader again.

It also works under Suspense, which class components support by throwing the pending promise:

<!-- example:file examples/readme/Resources/Suspend.tsx#suspend -->
```tsx
render() {
    const view = this.useCarburetor(profile);

    return <ProfileCard profile={profile.suspend({id: 'a1'})} refreshing={view.isPending}/>;
}
```

The subscription covers exactly the fields the render reads off the `useCarburetor`
result — here `isPending` — so a later `refresh()` that publishes a new answer wakes
the component again. A call whose result is never read registers no field reads
and would not wake.

While the request is in flight the nearest `<Suspense>` fallback shows; a failure is rethrown
so the nearest error boundary handles it. In a class component, `this.suspendResource(cache, ...args)`
is the one-call Suspense read: it subscribes and returns the entry's data, suspending while it loads
and rethrowing on failure; `suspend()` stays for non-component use.

A stale-but-present answer is not a miss for `suspend()`: it serves the stored answer and
revalidates in the background instead of suspending again.

### Cached resources

Both resource classes expose the same three handles, usable directly from an event handler
(they are bound to their instance and drop an incoming event argument):

| handle | meaning |
|---|---|
| `load(...args)` | Loads only when nothing usable is stored for the key of `args`. |
| `refresh(...args)` | Always requests, even when the key already has a value. An in-flight request for the key is restarted; the earlier handle promise settles with the new request's outcome. |
| `clear()` | Cancels requests, drops stored answers, status back to `Idle`. |

Loader arguments are variadic `(...args, signal)` and the second generic is the argument tuple:
`new ResourceCarburetor<User, [id: string]>(...)`; a loader without a signal parameter is accepted
by the second overload. Known edge: a first parameter typed `unknown`/`any` is taken for the
signal, so such a resource needs the explicit form `new ResourceCarburetor<T, [unknown]>(...)`.
Loader arguments must be fixed-length and required (no optional, default-value or variable rest
members): the runtime appends the signal right after the arguments, so a bare `load()` would hand
the signal to an optional argument. When the argument tuple is inferred, TypeScript rejects
default-value parameters; optional and rest members are a rule rather than a compile error, and with
explicit generics even an optional member is accepted — the runtime still appends the signal after
the arguments, so prefer the explicit `id: string | undefined` form. Call `load(undefined)` in that
case; trailing `undefined` arguments still do not split keys.

The `key` option — `(...args) => string | number` at construction — decides which calls share an
answer; without it the default key matches 0- and 1-argument resources as before. `ResourceCarburetor`
also accepts `ttl` and `maxEntries`: past `ttl` a stored answer is stale and the next handle call
requests again, and `maxEntries` bounds the total number of stored answers across keys — the least
recently used answers are dropped past it. The defaults: answers stay fresh for 30 s and the memory
keeps at most 100 answers unless configured otherwise.

Click-to-switch needs one store and one call: a `@bind` method calls `load(id)` and the component
reads the store in `render()` — no selection carburetor in between. The full component is
[examples/api/resources/resource-carburetor/click-switch.tsx](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/examples/api/resources/resource-carburetor/click-switch.tsx);
for a resource without parameters the bound handle itself sits in `onClick`.

`ResourceCarburetor` holds one value. An API layer needs many — the same loader called with different
arguments, each answer worth keeping — which is what `ResourceCache` is:

<!-- example:file examples/readme/Resources/UserPage.tsx -->
```tsx
import React, {Suspense} from 'react';
import {
    AntiHookComponent,
    ResourceCache,
    bind,
} from 'react-carburetor';

interface User {
    id: string;
    name: string;
}

const users = new ResourceCache<User, [string]>(async (id, signal) => {
    const response = await fetch(`/api/users/${id}`, {signal});
    if (!response.ok) throw new Error(`User request failed: ${response.status}`);
    return response.json() as Promise<User>;
}, {ttl: 30_000, maxEntries: 200});

export class UserBadge extends AntiHookComponent<{id: string}> {
    @bind
    private retry(): void {
        void users.refresh(this.props.id);
    }

    public render() {
        const user = this.useResource(users, this.props.id);
        if (user.isIdle || user.isPending) {
            return <span>Loading…</span>;
        }
        if (user.isError) {
            return (
                <span role="alert">
                    {user.error}{' '}
                    <button onClick={this.retry}>Retry</button>
                </span>
            );
        }
        return (
            <span>
                {user.data?.name}
                {user.refreshing ? ' (refreshing)' : ''}
                {user.error ? <button onClick={this.retry}>Retry</button> : null}
            </span>
        );
    }
}

class SuspendingUser extends AntiHookComponent<{id: string}> {
    public render() {
        const {data} = this.useResource(users, this.props.id);
        users.suspend(this.props.id);
        return <span>{data?.name}</span>;
    }
}

class UserBoundary extends React.Component<
    {children?: React.ReactNode},
    {message: string | undefined}
> {
    state = {message: undefined as string | undefined};

    static getDerivedStateFromError(error: unknown) {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    @bind
    private retry(): void {
        users.invalidate('a1');
        this.setState({message: undefined});
    }

    render() {
        if (this.state.message !== undefined) {
            return (
                <div role="alert">
                    {this.state.message}
                    <button onClick={this.retry}>Retry</button>
                </div>
            );
        }
        return this.props.children;
    }
}

export const UserPage = () => (
    <UserBoundary>
        <Suspense fallback={<span>Loading…</span>}>
            <SuspendingUser id="a1" />
        </Suspense>
    </UserBoundary>
);
```

`suspend()` itself does not subscribe to later updates: reading `data` off the `useResource` result is what keeps `SuspendingUser` re-rendering when a background `refresh()` lands a new answer for the entry.

To use explicit status handling instead, export `UserBadge` or render it in its own tree.

Primitive argument keys and paths use a bounded LRU memo (`keyCacheSize`, default 4096 records),
separate from the data-entry limit — see [docs/promise-cache.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md)
for the details and tradeoffs.

`clear()` drops every entry and cancels every in-flight request in one publication (it replaces
the removed `forgetAll()`); `forget(args)` still removes a single entry.

`useResource` subscribes the component to the fields of that one entry it actually reads — `data`,
`status`, `refreshing` and so on — so another user's answer arriving does not re-render this badge, and
a reader that shows only `data` is not re-rendered for every bookkeeping field the cache updates beside
it. A stale entry is refetched **after** the commit, never during render — a write from render would
notify subscribers mid-render.

`resourceState(status, data?, error?)` derives the flag view from the raw state fields: the four
status flags plus `isLoading` (true while the state is Idle or Pending and no data has landed yet)
and `refreshFailed` (a Success whose error is set — a failed refresh). Reading `view.status`,
`view.data` and `view.error` through `useCarburetor` is what subscribes the component.

<!-- example:file examples/api/resources/resource-carburetor/click-load.tsx -->
```tsx
import {AntiHookComponent, ResourceCarburetor, resourceState} from 'react-carburetor';
import {type JSX} from 'react';

interface Config {
    theme: string;
}

declare function fetchConfig(init?: {signal?: AbortSignal}): Promise<Config>;

// A resource without parameters: TArgs is the empty tuple, and the bound handles
// drop an incoming DOM/React event argument before the loader sees it, so the
// handle itself can sit in `onClick`.
const config = new ResourceCarburetor<Config, []>(
    (signal) => fetchConfig({signal})
);

export class ConfigBadge extends AntiHookComponent {
    render(): JSX.Element {
        const view = this.useCarburetor(config);

        // resourceState derives the flag view from the raw state fields: loading before the
        // first answer lands, refreshFailed after a failed refresh.
        const state = resourceState(view.status, view.data, view.error);

        if (state.isIdle) {
            return <button type="button" onClick={config.load}>Load</button>;
        }
        if (state.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (state.isError) {
            // refresh is bound the same way: the event it receives is dropped.
            return <button type="button" onClick={config.refresh}>Retry</button>;
        }
        return <span className="theme">{view.data?.theme}</span>;
    }
}
```

Three decisions are worth knowing because they differ from the hooks libraries:

- **A failed refresh keeps the good data.** The entry stays `Success` with what it had, and the error
  sits beside it, so the interface can show both. Only an entry that never succeeded becomes `Error`.
- **Refreshing does not flash `Pending`.** An entry with data raises `refreshing` instead, because
  there is nothing to show in place of data the user is reading.
- **`invalidate` does not refetch.** It marks entries stale; the ones on screen refetch themselves on
  the next render. A cache of two hundred entries should not fire two hundred requests because one
  mutation succeeded.

A failed entry is not retried automatically — that would loop. Call `refresh(args)` to try again,
or `invalidate(args)` / `invalidateAll()` to re-arm mounted readers; their retry starts after
commit, never during render. `suspend(args)` reads per entry: a miss throws the current request,
a failed, non-invalidated Error throws its rejection, and a stale-but-present Success returns its
previous value and starts revalidation in the background. The cache is bounded: entries are dropped
past `maxEntries`, never one with a request in flight or one a component is reading.
`scope.dehydrate()` preserves each entry's `updatedAt` and invalidated state; standalone
serialization uses the cache's own `toJSON()`/`fromJSON()` (wire form) or `snapshot()`/`restore()`
(detached copy). Failure-ownership details and the lifetime semantics are in
[docs/promise-cache.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md).

Explicit non-goals, so the shape is clear: no retries with backoff, no refetch on window focus or
interval, no pagination, no normalisation, no optimistic updates. See
[docs/promise-cache.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md) for the reasoning behind the key encoding, the lifetime
semantics and the eviction rules.

## Per-request stores

A module-level singleton is shared by every request on a server, which leaks one user's state
into another's render. A scope creates the instances per request instead, and components
resolve them through context — no hooks involved.

<!-- example:file examples/readme/App/Ssr.tsx -->
```tsx
import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {
    CarburetorProvider,
    CarburetorScope,
    ScopedAntiHookComponent,
    ResourceCache,
    carburetorToken,
} from 'react-carburetor';
const loadUser = async (id: string): Promise<{name: string}> => ({name: `User ${id}`});
const userToken = carburetorToken(
    () => new ResourceCache(loadUser, {ttl: 30_000}),
    'ssr-example-users',
);
class UserScreen extends ScopedAntiHookComponent {
    render() {
        const cache = this.resolve(userToken);
        const user = this.useResource(cache, 'a1');
        return <span>{user.data?.name ?? 'Loading…'}</span>;
    }
}
const tree = (scope: CarburetorScope) => <CarburetorProvider scope={scope}><UserScreen/></CarburetorProvider>;
export async function renderRequest() {
    const scope = new CarburetorScope();
    await scope.get(userToken).load('a1');
    const markup = renderToString(tree(scope));
    const payload = JSON.stringify(scope.dehydrate()).replace(/</g, '\\u003c');
    return {markup, payload};
}
export function hydratePage(container: HTMLElement, payload: string) {
    const scope = new CarburetorScope();
    scope.hydrate(JSON.parse(payload) as Record<string, unknown>);
    return hydrateRoot(container, tree(scope));
}
```

The server calls `renderRequest` per request, inserts `markup` in the root, and sends `payload` as a JSON data script (already escapes `<`). The client calls `hydratePage(root, payloadScript.textContent)`. Both bundles use the same module token; preloading is explicit because `renderToString` does not await. `scope.hydrate` uses `fromJSON`/`restore`.

`dehydrate` covers every carburetor the scope actually created; `hydrate` without a token list
applies the payload lazily — each token's state is installed on its first `get`, and tokens without
payload state are simply created on demand. The `hydrate(state, tokens)` form stays for eager
installation of the listed tokens. The token's name is
what the two sides match on, so the same token must be declared with the same name in the server
and client bundles — the two module graphs can otherwise run in any order, and a counter-based
id would not survive the trip. Two tokens in one process may not share a name, and in the token-list form a payload key
no token claims is reported in development; in the form without a list such keys are simply
left unused. A single store can also be seeded directly with
`scope.set(token, carburetor)`.

A `ScopedAntiHookComponent` resolves a token with `this.scoped(token)` — `this.resolve(token)`
delegates to it — so a subclass can override `scoped` to reroute every resolution.

`scope.dehydrate()` returns a detached copy for plain-tree data: plain objects and arrays are
copied, while native `Map`/`Set`/`Date` leaves and class instances are carried by reference — the
same shared-reference limits `store.snapshot()` documents. When the payload is serialized right
away — the usual server case — `scope.toJSON()` produces the same JSON in one pass without the
copy, at about half the cost.

## Tooling

<!-- example:file examples/readme/Tooling/DevTools.ts#tooling -->
```ts
// Redux DevTools: state inspection plus time travel back onto the carburetors.
const stopDevTools = connectDevTools({todos: todoCarburetor, filter: filterCarburetor});

// Mirror a store in a storage; loads what was stored on connect. Writes are coalesced into one
// stringify per microtask; `coalesce: false` writes on every notification instead, so with the
// default immediate delivery each write lands before the writing call returns (a throttle or a
// transaction delays the notification, and the write with it).
const stopPersist = persist(settingsCarburetor, {key: 'settings', storage: localStorage});

// React to a selection outside React; onChange runs only when it changes.
const stop = todoCarburetor.watch((data) => data.activeCount, (next, previous) => log(next, previous));

// Undo/redo built on patches.
const history = new CarburetorHistory(todoCarburetor, {limit: 50});
history.undo();
history.redo();

// Await the next update — for throttled stores and async resources in tests.
await waitForUpdate(presenceCarburetor);

// Stop subscriptions and tooling when their owner is done.
stop();
stopPersist();
stopDevTools();
history.disconnect();
```

Call the returned disposers and `history.disconnect()` when the owner is done; see the [consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md).

`persist` writes the store's wire form (`toJSON()`) and restores parsed JSON through `restore()`;
a subclass with a different wire form overrides `toJSON()` to produce JSON its `restore()`
accepts. `ResourceCarburetor` includes its settled argument key in the wire form, so a restored
successful or failed answer is reused only for matching arguments; Pending restores as Idle.
`ResourceCache` exposes its own `toJSON()`/`fromJSON()` (wire form) and `snapshot()`/`restore()`
(detached copy) for the same purpose. See
[docs/promise-cache.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/promise-cache.md)
for the resource and cache serialization details.

Failed storage reads reach `persist`'s `onError` handler without deleting unread data; without a
handler, a read failure throws. `previousKeys` optionally lists old whole-storage keys in priority
order: when the current key is absent, the first present old key is restored, written immediately
under the current key in normalized form, then removed. Failed restores leave old data untouched.
Current data takes precedence. Partitioned persistence checks old whole keys only when the current
key and its partition entries are absent.

`version` wraps writes as `{__carburetorVersion, data}` and treats raw legacy JSON as version 0. `migrate[n]`
converts n-1 to n; the complete chain is validated synchronously. `prune: true` removes unknown
keys from populated plain-object schemas while preserving defaults; empty objects remain open
dictionaries. For populated dynamic dictionaries use the `prune` callback instead of `prune: true`.
Future versions and migration failures preserve stored bytes and block later writes until reconnect.
Schema options cannot be combined with `partitions`; versionless persistence keeps its existing
wire format.

<!-- example:file examples/readme/Tooling/Persist.ts -->
```ts
import {Carburetor, IStorageLike, persist} from 'react-carburetor';

interface IProfile {
    name: string;
    skills: Record<string, number>;
}

const storage: IStorageLike = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
};

// v1 renamed `nick` to `name`; v2 added `skills`, which the current defaults fill in.
const renameNick = (state: unknown): unknown => {
    const {nick, ...rest} = state as {nick?: string};
    return {...rest, name: nick ?? ''};
};
const keepAsIs = (state: unknown): unknown => state;

const profile = new Carburetor<IProfile>({name: '', skills: {letters: 0, numbers: 0}});
const stop = persist(profile, {
    key: 'app.profile',
    storage,
    version: 2,
    migrate: {1: renameNick, 2: keepAsIs},
    // Drops keys the current shape no longer has, such as a retired `logic` field.
    prune: true,
});

stop();
```

`CarburetorHistory` records undo/redo steps for plain-tree stores as patches — O(changed values),
not O(state) — while steps that replace, mutate or read a native value through `draft` use
complete detached graphs instead of patches, so undo/redo stays faithful for native `Map`/`Set`/`Date`
values too. History works with the `Carburetor` family — `Carburetor`, `ResourceCarburetor`,
`ResourceCache` and their subclasses. `history.clear()` captures the current baseline and discards
pre-clear deferred writes; other histories stay independent. See the
[consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md)
for the options and the replay semantics.

## Testing your code

### Testing a store without React

A store is an ordinary class: construct `new RoundStore(...)` or resolve a token with
`new CarburetorScope().get(token)`, call its methods, and assert the results. Store logic
does not need React rendering or jsdom. Timers a store starts with `this.after(ms, task)` are
cancelled by `dispose()`, so a fake clock advanced past a disposed store's deadline runs nothing.

<!-- example:file examples/readme/App/StoreTesting.ts#test-body -->
```ts
export const registerStoreTest = (): void => {
    test('a throttled store can be tested without React', async () => {
        rstest.useFakeTimers();
        const store = new RoundStore(
            {round: {kind: 'quiz', wrong: [0], locked: false}},
            new ComponentUpdateThrottle(40)
        );
        const observed: number[] = [];
        const stopWatch = store.watch(selectFirstWrong, (next) => { observed.push(next); });

        try {
            const delivered = waitForUpdate(store);
            store.markWrong(0);
            expect(store.getData().round.wrong[0]).toBe(1);
            expect(observed).toEqual([]);
            await rstest.advanceTimersByTimeAsync(40);
            await delivered;
            expect(observed).toEqual([1]);
        } finally {
            stopWatch();
            rstest.useRealTimers();
        }
    });

    test('a timer started with after() never fires once the store is disposed', () => {
        rstest.useFakeTimers();
        try {
            const store = new HintStore({hint: false});
            store.arm();
            store.dispose();
            rstest.advanceTimersByTime(10_000);
            expect(store.getData().hint).toBe(false);
        } finally {
            rstest.useRealTimers();
        }
    });
};
```

The repository wrapper calls `registerStoreTest()` and `scopeTest()` to register these examples; see
[RoundStore.test.tsx](__tests__/Tooling/examples/readme/RoundStore.test.tsx).

### Component tests with jsdom

Install jsdom and the React testing dependencies (`@testing-library/react` and `react-dom`). Configure the test runner's jsdom environment with React's act environment enabled in runner setup. Import `act` from `@testing-library/react`: it re-exports the right implementation for the installed React (React's own `act` is unavailable at the React 18.0 floor, and `react-dom/test-utils` is deprecated in React 19).

<!-- example:file examples/readme/App/Testing.tsx -->
```tsx
import {act, render, fireEvent} from '@testing-library/react';
import {test, expect} from '@rstest/core';
import {
    Carburetor,
    CarburetorScope,
    CarburetorProvider,
    ScopedAntiHookComponent,
    carburetorToken,
    CarburetorHistory,
    ComponentUpdateThrottle,
    bind,
    persist,
    waitForUpdate,
} from 'react-carburetor';
const selectCount = (data: {count: number}) => data.count;

class CounterStore extends Carburetor<{count: number}> {
    increment() { this.draft.count += 1; this.emitUpdate(); }
}
const counterToken = carburetorToken(() => new CounterStore({count: 0}, new ComponentUpdateThrottle(1)), 'readme-test-counter');
class CounterView extends ScopedAntiHookComponent {
    @bind
    private increment(): void {
        this.resolve(counterToken).increment();
    }

    render() {
        const store = this.resolve(counterToken);
        const {count} = this.useCarburetor(store);
        return <button onClick={this.increment}>{count}</button>;
    }
}
test('publishes a counter update', async () => {
    const scope = new CarburetorScope();
    const store = scope.get(counterToken);
    const saved = new Map<string, string>();
    const stopPersist = persist(store, {key: 'counter', storage: {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => { saved.set(key, value); },
        removeItem: key => { saved.delete(key); },
    }});
    const history = new CarburetorHistory(store);
    const observed: number[] = [];
    const stopWatch = store.watch(selectCount, next => { observed.push(next); });
    const mounted = render(<CarburetorProvider scope={scope}><CounterView/></CarburetorProvider>);
    try {
        const delivered = waitForUpdate(store);
        await act(async () => {
            fireEvent.click(mounted.getByRole('button'));
            await delivered;
        });
        expect(mounted.getByRole('button').textContent).toBe('1');
        expect(observed).toEqual([1]);
    } finally {
        mounted.unmount();
        stopWatch();
        stopPersist();
        history.disconnect();
    }
});
```

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

<!-- example:file examples/readme/Interop/NameBadge.tsx#nameBadge -->
```tsx
import {useCarburetorValue, useComputedValue} from 'react-carburetor/interop';

const selectProfileName = (data: {name: string}) => data.name;

const NameBadge = () => {
    const name = useCarburetorValue(profileCarburetor, selectProfileName);

    return <span>{name}</span>;
};
```

Built on `useSyncExternalStore`, so it is tearing-safe and SSR-safe. Selected plain objects,
arrays, `Map`, `Set` and `Date` values are detached for a stable React snapshot; a class instance
cannot be copied safely, so selecting one directly or inside another value throws an actionable
error — select the fields you render instead. The optional third argument is the equality check
that decides whether a recomputed selection counts as changed. It defaults to a structural
comparison — own enumerable string keys and `Object.is` values, recursively through plain objects
and arrays, a detached Date by its timestamp, and detached Map/Set size, iteration order and
entries — because detached containers would never compare equal by reference: a selector rebuilt
on every render, or a write that replaces an ancestor without changing its content, would
otherwise re-render every time. Pass `Object.is` explicitly for the old, reference-only behavior.
With the default comparison a changed selection keeps the previous references of its unchanged
nested objects and arrays, so rows of a selected list can be `React.memo` children.

A resource cache has a hooks reader too:
`useResourceValue<T, TArgs, R>(source, args, select, isEqual?)` returns `TReadonly<R>`.
The selector is **required**; there is no two-argument overload or implicit whole-resource selection.
A stale entry is loaded **after** committed publication and subscription attachment, never during
render (development reports a load started in render). Server rendering selects without loading,
subscribing or acquiring write proofs.

Using the `User` and `users` declarations from the cached-resource example above:

<!-- example:file examples/readme/Interop/HookUserBadge.tsx#hookUserBadge -->
```tsx
import type {IResourceView, TReadonly} from 'react-carburetor';
import {useResourceValue} from 'react-carburetor/interop';

const selectUserBadge = (view: TReadonly<IResourceView<User>>) =>
    view.data === undefined ? undefined : {name: view.data.name};

const HookUserBadge = ({id}: {id: string}) => {
    const user = useResourceValue(users, [id], selectUserBadge);

    return <span>{user?.name ?? '…'}</span>;
};
```

The selector must be pure and synchronous; returning an input branch is supported — the engine
detaches it before returning the result — but do not retain the input or close deferred callbacks
over it. **Child and effect reads of returned selections do not collect dependencies**: explicitly
project everything the child consumes. `view => view.data` observes the whole data graph; a narrow
projection ignores excluded leaves. Hoisted or correctly memoized selectors reuse completed results
on unchanged parent renders; a fresh inline selector remains correct but executes again.

Selector functions should be capture-free where possible. The linter warns about selectors that
capture render bindings (H34) and `useMemo`/`useCallback` over values already read by these hooks
(H33); prefer selecting the whole record and picking during render, or deriving in the selector or
a `Computed`. For capturing handlers, use a child `AntiHookComponent` with props and an `@bind`
method, or convert the component. The class `useResource` view is readonly (writes throw for the
built-in resource sources; a custom `IResourceSource` without a `fieldView` hands out its plain
view — readonly by type and contract, without runtime protection) and
subscribes to the fields it reads; presentation overrides belong to the caller via
`{...view, name: 'local'}`. `connectSelection` remains the tool for detached memo-child
projections.

## Lint rules

The engine trades one class of mistake for another. Nothing here forces a re-render you did not ask
for — and nothing tells you when a write reaches no subscriber, when a component reads state it never
subscribed to, or when an effect's cleanup is silently dropped. The plugin and native registries each
contain 37 rules: 31 catalogue rules, the optional `no-react-hooks-in-components` policy, and five
house-style rules. [docs/rules.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/rules.md) is the
reference by rule name — what each catches, how to switch one off, and the optional `no-hooks`
preset. [docs/hazards.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/hazards.md) is the same material by mistake, with the code that
triggers it, why it is silent at runtime, and where the rule can be wrong.

One plugin serves both hosts, because oxlint's JS plugin API is ESLint's.

**oxlint** — one `extends` line; the plugin travels next to the preset:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"]
}
```

**ESLint v9+** — add the plugin to an existing TypeScript flat config with a TS/TSX parser already
configured:

<!-- example:file examples/readme/Tooling/EslintConfig.js -->
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

Detection is syntactic. Fixed component bases are `AntiHookComponent` and
`ScopedAntiHookComponent`; fixed store bases are `Carburetor` and `ResourceCarburetor`; the
recognized render method is `render`. Directly extending a recognized base works; inheritance
through a custom intermediate subclass is not resolved transitively. Most rules accept severity; `require-module-function` additionally accepts `scope: "all"` (default) or `"classes"`. Use `off` or a host suppression comment for rules that do not fit, or the standalone linter's `carburetor-disable` comment.

```json
{
  "rules": {
    "carburetor/no-module-level-store": "error",
    "carburetor/no-get-data-in-render": "error"
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
`context.report`. It reports diagnostics for saved files on disk, not unsaved buffers, which are not
analyzed. Disk changes invalidate cached results. Two ways to run them, good at different things.

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
suppression-comment syntax, per-project severity, and diagnostics for saved files on disk; unsaved
buffers are not analyzed. What it cannot do is
apply fixes: diagnostics arrive through `context.report`, and no host exposes a plugin API that
could hand a native fix back. It also needs the binary on disk — `carburetor-lint` is installed
as a dev dependency of your project (`pnpm add -D carburetor-lint`) and the bridge finds the
platform binary through it, so no extra step is needed; alternatively point `CARBURETOR_LINT_BIN`
at a built binary, or run
`cargo build --release` inside `native/` in a checkout of this repository. With none of those,
the run fails loudly and names the missing platform package; a missing binary never looks like
a clean run.

The measurements are this repository's, taken the way [native/README.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/native/README.md)
describes.

## API

### `IReadableCarburetor<T>`

Read consumers accept six capabilities: `getUID`, `getVersion`, `getData`, `read`, `subscribe` and
`unsubscribe`. This public interface works with `useCarburetorValue`, class `useCarburetor`,
`connect`/`connectSelection`, and the reader passed to `computed`. A custom adapter need not provide
fake mutation, snapshot or serialization methods. Native `Carburetor` already implements it.

`getData()` is raw untracked data, not a deep-immutability promise. `read(record)` and subscriptions
must honor the source's read/version lifecycle; subscription IDs must be released. `ICarburetor<T>`
extends this readable surface with writes and inspectable tooling. History and persistence still
require their own write/tooling capabilities.

### `Carburetor<T>`

| member                          | description                                                        |
|---------------------------------|--------------------------------------------------------------------|
| `constructor(data, scheduler?)` | Initial data and delivery policy — a scheduler, or `{scheduler}` options (defaults to immediate delivery). |
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
| `update(mutate, ...args)` *(protected)*  | Mutates through `draft` and publishes — the recommended write form. Arguments after `mutate` are forwarded to it. |
| `draft: T` *(protected)*        | Write proxy that records changed paths.                            |
| `emitSoon()` *(protected)*      | Publishes on the next microtask, for writes made where notifying now is unsafe. |
| `preEmit(changed)` *(protected)* | Runs before notification — derive state here. `changed` is the set of paths the emit being closed recorded (empty: nothing was written through `draft`); an override that declares no parameter keeps working. |
| `emitUpdate()` *(protected)*    | Notifies subscribers whose read paths intersect the writes.        |
| `markAllChanged()` *(protected)* | Wakes every reader, after a write that bypassed `draft`.           |
| `didSetData()` *(protected)*    | Runs after `setData`/`restore` installed new data, before the replacement notifications — synchronize derived state here. |
| `dispose(): void` | Public, idempotently cancels owned work and calls `didDispose`; update, emitUpdate and watch then throw. |
| `signal: AbortSignal` *(protected getter)* | Lazily created; aborted on disposal. |
| `after(ms: number, task: () => void)` *(protected)* | Lazily schedules cancellable work; throws after disposal. |
| `didDispose(): void` *(protected)* | Called once after built-in cleanup; overrides must call `super.didDispose()`. |
| `data: T` *(protected getter)*  | The current data, read-only: reads are untracked, writes go through `update`/`draft`. |

Members are prototype methods — here and on `ComponentUpdateThrottle`, `CarburetorScope`,
`CarburetorHistory` and `Diagnostics`: override them with method syntax and reach the base through
`super`. Bind one with `@bind` before handing it out as a callback (`onClick={this.undo}`).

The protected members above are the whole subclass contract. The engine keeps its own state —
the version counter, the identity, the write set, subscribers, the scheduler — behind
module-private symbol keys, so a subclass may declare fields named `version`, `uid`, `writes`,
`scheduler`, `subscribers` and so on for its own purposes without disturbing delivery. The same
holds for `ResourceCache`, `ResourceCarburetor` and `AntiHookComponent` (a component may declare
`uid = this.props.userId`). `data` is the one reserved name: it is the protected getter above, so
do not redeclare it.

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
| `useEffect(effect, deps)`         | The same, keyed by the stable `effect` function itself (a module-level function or a `@bind` method) instead of a name. |
| `shouldComponentUpdate(…)`        | The props/state gate. Override only with a `super` call.        |
| `@bind` *(decorator)*             | Binds a method once per instance, keeping it on the prototype and its reference stable. |

### Other exports

| export                                        | purpose                                     |
|-----------------------------------------------|---------------------------------------------|
| `computed(body, options?)`                    | Memoized derived value; `options.equals` judges the result by content instead of by reference. |
| `transaction(body)`                           | One notification pass for a group of writes. |
| `UpdateThrottle` / `ComponentUpdateThrottle(ms)` | Coalescing for streaming sources; `UpdateThrottle` is the preferred name, the long one is kept. |
| `ResourceCarburetor(loader, options?)`        | Async state with status and cancellation; `options` carries `key`, `ttl`, `maxEntries`, `scheduler`. |
| `CarburetorScope`, `carburetorToken`, `CarburetorProvider`, `ScopedAntiHookComponent`, `Carburetor.dispose` | [Per-request stores and lifecycle](#scopes-and-lifetimes). |
| `CarburetorChildScope` | A nested scope boundary that owns declared local token ids. |
| `connectDevTools`, `persist`, `CarburetorHistory`, `waitForUpdate` | Tooling.  |
| `diagnostics`, `Diagnostics`                  | [Development warning switch](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): independent instances and engine singleton. |
| `EResourceStatus`, `EDevToolsAction`, `EDevToolsMessageType` | Enums for the resource status and the DevTools protocol. |
| `getInitialResourceData` | [Initial resource state](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): Idle state only; adapters may seed their own state. |
| `CarburetorContext`                            | The context a scope is provided through. |
| `ResourceCache` `load`, `refresh`, `resolve`, `getFailure` | [Consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): resource loading, refreshing, resolution and failure access. |
| `CarburetorHistory` `undo`, `redo`, `canUndo`, `canRedo`, `clear`, `disconnect` | [Consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): history navigation and lifecycle. |
| `ResourceCarburetor` `load`, `refresh`, `clear`, `abort` | [Consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): resource loading, refreshing, clearing and cancellation. |
| `useCarburetorValue`, `useComputedValue`, `useResourceValue` (from `react-carburetor/interop`) | [Consumer API reference](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/api-reference.md): three opt-in interop readers. |
| `deepClone`, `shallowEqual`                   | Building blocks, exported for extensions.    |

The selected surface is about extensions, not user-facing adapter recipes: `Carburetor` takes initial data, `getInitialResourceData` returns only an Idle resource state, and a custom adapter can seed its own state. A plain `Carburetor` is not a resource loader. A new `Diagnostics` instance is independent; it does not replace the engine's `diagnostics` singleton. Toggling that singleton affects development complaints, but cannot restore warning strings stripped from production builds.

<!-- example:file examples/readme/Tooling/Adapter.ts -->
```ts
import {Carburetor, Diagnostics, diagnostics, getInitialResourceData} from 'react-carburetor';
interface User {name: string}
const adapterState = new Carburetor(getInitialResourceData<User>());
const localDiagnostics = new Diagnostics();
localDiagnostics.setEnabled(true);
localDiagnostics.report(`Adapter starts in ${adapterState.getData().status}`);
const wasEnabled = diagnostics.isEnabled();
try {
    diagnostics.setEnabled(false);
} finally {
    diagnostics.setEnabled(wasEnabled);
}
```

Internals — the tracking proxies, the proxy cache, path string plumbing, the update scheduler
and the batch coordinator — are deliberately not exported: they are implementation details, and
a test pins the exported surface so one does not slip in by accident.

## Scopes and lifetimes

A scope owns every distinct store created or installed, including replaced instances, and disposes
in reverse ownership order. Factories receive the scope (`() => T` remains compatible), allowing
related stores to resolve dependencies without module singletons; named cycles throw. Hydration can
be eager for selected tokens or lazy on first `get`. After scope disposal, `get`, `set`, and
`hydrate` throw. Providers expose the supplied scope only: they do not own or dispose it, and nested
providers do not fall back to a parent.

A child created with `parent.child(localTokens)` owns those token ids. Its local factories receive
the child; other reads delegate to and cache parent values. Child `set()` shadows locally, `has()`
reports local instances, and child hydration/dehydration is local. A child disposes only its own
values; parent disposal visits living children in reverse creation order before parent values.
`CarburetorChildScope` requires a parent provider, renders nothing during SSR and before mount,
creates the owned scope after mount, and disposes it on unmount. Keep `tokens` stable for the
component lifetime; to switch scope lifetimes, remount the boundary with a different React `key`.

Stores expose public `dispose(): void`; after disposal `update`, `emitUpdate`, `watch`, and resource `load`, `refresh`, and `suspend` throw `Carburetor: store has been disposed` before loader invocation or request creation (a `ResourceCache.refresh` whose own abort of the previous request disposes the store returns a promise rejected with that error instead);
while pending notifications are silent and existing subscriptions remain until owners unsubscribe.
Subclasses use protected `signal: AbortSignal` and
`after(ms: number, task: () => void): TDisposer`; both are lazy and cleaned up on disposal.
`after` throws after disposal to catch use beyond the store lifetime. Override `didDispose(): void`
for subclass cleanup and call `super.didDispose()`. Raw references obtained through `getData()`
cannot be revoked after disposal.

<!-- example:file examples/readme/App/ChildScope.tsx -->
```ts
import {CarburetorScope, carburetorToken} from 'react-carburetor';

const serviceToken = carburetorToken(() => ({name: 'shared'}), 'example/shared');
const panelToken = carburetorToken(owner => ({service: owner.get(serviceToken)}), 'example/panel');

export function createPanel(): {scope: CarburetorScope; dispose: () => void} {
    const root = new CarburetorScope();
    const scope = root.child([panelToken]);
    scope.get(panelToken);
    return {scope, dispose: (): void => root.dispose()};
}
```

Render the returned `element`; the caller owns its lifetime and calls `dispose()` when closing the
screen. No React effect owns scope disposal, avoiding StrictMode effect-replay disposal.

<!-- example:file examples/readme/App/ScopeLifetime.tsx -->
```tsx
import React from 'react';
import {CarburetorProvider, CarburetorScope, carburetorToken, Carburetor} from 'react-carburetor';

const tick = (draft: {ticks: number}): void => {
    draft.ticks += 1;
};

class ClockStore extends Carburetor<{ticks: number}> {
    public constructor() { super({ticks: 0}); }

    public start(): void {
        this.after(1000, () => this.update(tick));
    }
}

interface IScreenLifetime {
    element: React.ReactNode;
    dispose: () => void;
}

const clockToken = carburetorToken(() => new ClockStore(), 'screen/clock');
const gameToken = carburetorToken(owner => ({clock: owner.get(clockToken)}), 'screen/game');

/** Creates a screen scope and returns its provider element and owner-controlled disposer.
 *
 * @param children - the screen content to provide the scope to
 */
export function createScreen(children: React.ReactNode): IScreenLifetime {
    const scope = new CarburetorScope();
    scope.get(gameToken).clock.start();
    return {
        element: <CarburetorProvider scope={scope}>{children}</CarburetorProvider>,
        dispose: (): void => scope.dispose(),
    };
}
```

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
  leaf reads; ordinary Date raw identity is preserved without read/write wrapping. A Date draft
  exposure lasts through the synchronous turn. Each publication checks its time value through the
  end of that turn and one microtask hop. Cleanup only forgets exposures: it does not flush, write,
  or publish. An `emitSoon` queued in the same turn runs before cleanup. A mutation after the last
  publication is discarded when the exposure is cleared, not merged into a later update. Distinct
  paths are retained conservatively after movement, which can cause extra wakes. Descriptor checks
  verify only that the source key still points to the Date; the owner must keep the container
  attached. A detached container that still points to the Date may cause a conservative false wake.
  Net changes produce opaque history snapshots; unchanged setters and mutations reverted before a
  publication produce no Date write. Date subclasses, Dates with own properties, custom instances
  and unsupported native subclasses use conservative immediate exposure. Read tracking remains
  coarse at the raw leaf level.
  Alias answers for such a value are cached and refreshed only by a topological write, so an
  in-place mutation of the value — or of a `Map` behind the facade — keeps its stale alias set
  until then; that is the same invisibility an opaque leaf's contents already have. A topological
  write refreshes the ownership index for the changed subtree, not the whole store.
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
  with its own identity in a `Map` or a class instance, which are leaves. Plain state must stay a
  tree: one object under exactly one path. The same plain object reachable from two paths
  (`{left: shared, right: shared}`) is not supported — a `draft` write records only the written
  path, so a reader of the other path is never woken (development reports this as an alias
  diagnostic), and a plain cycle is rejected outright. Keep one object per path: clone it, give
  each path its own object, or refer to a shared value by id. This limits plain state only —
  native values expose their own coarser alias rules (see the tracking caveat above), and
  selection results may alias and cycle freely; that freedom belongs to selections, not to the
  store.
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
  A parent that mutates an object in place and passes the same reference down is the common case:
  the child's props stay shallow-equal, so even the parent's `forceUpdate` does not reach it. Keep
  data that changes in a store the child reads, or replace the gate for that one component with
  `shouldComponentUpdate(): boolean { return true; }` (a deliberate override, see
  [docs/hazards.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/hazards.md)).
- Ordinary plain-tree undo/redo records patches — O(changed values), not O(state). Steps that
  replace, mutate or read a native value through `draft` use owned detached graphs instead.
  `CarburetorHistory` works with the `Carburetor` family — `Carburetor`, `ResourceCarburetor`,
  `ResourceCache` and their subclasses. `attachPatchListener`, `IPatchSource` and
  `IPatchObserver` are the engine's internal protocol: they change between versions, are not part
  of the stable public contract, and custom history sources are not supported.
- Overriding a lifecycle method without calling `super` silently disables effects, subscription
  cleanup or the props gate. Override `useEffects` / `unUseEffects` instead. A `componentDidMount`
  override that skips `super.componentDidMount()` is reported in development — on the next entry
  into the base lifecycle, the first `componentDidUpdate` or unmount. Detection covers prototype
  overrides; a `componentDidMount` assigned in a subclass constructor is not reported — declare
  overrides as methods.

## Demo

The `lib/` folder contains a Todo app built on the library (React 19, Rsbuild, Tailwind).
Each row shows its own render counter, so you can watch precise invalidation at work: edit
one todo and only that row's counter moves. It uses the library's features where an app would
need them — scoped stores, async resources and a cache, computeds, selections, transactions,
undo/redo, persistence, throttling and the hooks interop; [lib/README.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/lib/README.md) maps
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
npm run lint        # oxlint with type-aware rules; requires the native binary (see CONTRIBUTING.md, "Getting started")
npm test            # Rstest + @testing-library/react

npm run bench -- --only match-precision   # path matching, against the built output
```

The perf gate suite lives outside the test suite on purpose: the test run has to stay fast
enough to be run on every change. Its manifest and rules are described in `perf/README.md`.

## License

Dual-licensed as `MIT OR Apache-2.0`: choose either license (see [LICENSE](LICENSE)):

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
