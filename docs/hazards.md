# Hazard catalogue

This document is the specification for the lint rules shipped in `eslint-plugin-carburetor`.
Every hazard below is a way to use React Carburetor that compiles, runs, and produces wrong
behaviour **without any error** — a component that never updates, a write nobody hears, an
effect that never cleans up. That silence is the reason the rules exist: the type system
catches the loud mistakes already.

Each entry records the same fields, so a rule can be written from it without re-deriving the
semantics:

- **Wrong** — the smallest code shape that triggers it.
- **Why it is silent** — what the engine does instead of failing.
- **Right** — the supported form the rule points at.
- **Rule** / **Severity** — the rule name and its default level in the recommended config.
- **Detection** — what the rule matches on, and what it cannot see.
- **False positives** — the honest risk, and the escape hatch where one is needed.

## What the rules can and cannot see

oxlint's JS plugin API is ESLint's, and neither gives a JS rule the TypeScript type checker.
Every rule here is therefore **syntactic**: it recognises carburetor code by shape, not by
type.

The shapes a rule may rely on:

- a class whose `extends` clause names `AntiHookComponent` or `ScopedAntiHookComponent`;
- a class whose `extends` clause names `Carburetor` or `ResourceCarburetor`;
- `this.draft`, `this.data`, `this.update(...)`, `this.emitUpdate()`, `this.emitSoon()`
  inside such a class;
- `this.useCarburetor(...)`, `this.useComputed(...)`, `this.useEffect(...)` inside a component;
- a call to the imported `computed(...)` or `transaction(...)`;
- `.getData()`, `.get()`, `.subscribe(...)`, `.watch(...)` as member calls.

A rule that would need a type to be correct (is this `.set()` a `Map` or a setter of my own?)
is documented as such, defaults to `warn` at most, and states its heuristic.

## Rule index

| # | Rule | Group | Severity | Type info needed |
|---|------|-------|----------|------------------|
| H1 | `no-get-data-in-render` | reads | error | no |
| H2 | `no-computed-get-in-render` | reads | error | no |
| H3 | `no-computed-get-in-computed` | reads | error | no |
| H4 | `no-use-carburetor-outside-render` | reads | error | no |
| H5 | `no-escaping-tracked-data` | reads | warn | no |
| H28 | none — a development diagnostic, not a rule | reads | — | — |
| H6 | `require-emit-after-draft-write` | writes | error | no |
| H7 | `no-direct-data-write` | writes | warn | no |
| H8 | `no-external-data-mutation` | writes | error | no |
| H9 | `no-tracked-data-mutation` | writes | error | no |
| H10 | `no-untrackable-draft-mutation` | writes | warn | helps |
| H11 | `no-store-write-in-render` | writes | error | no |
| H12 | `require-super-in-lifecycle` | lifecycle | error | no |
| H13 | `no-lifecycle-class-property` | lifecycle | error | no |
| H21 | `no-handler-created-in-render` | lifecycle | warn | no |
| H22 | `require-bind-for-passed-method` | lifecycle | error | no |
| H14 | `no-async-effect` | effects | error | no |
| H15 | `no-duplicate-effect-name` | effects | error | no |
| H16 | `require-effect-deps` | effects | warn | no |
| H17 | `no-async-transaction` | boundaries | error | no |
| H18 | `no-module-level-store` | boundaries | off | no |
| H19 | `no-untrackable-store-data` | boundaries | warn | helps |
| H20 | `require-subscription-disposal` | boundaries | warn | no |
| H23 | `no-external-data-mutation` (shared with H8) | cache | error | no |
| H24 | `no-unserializable-cache-args` | cache | warn | no |
| H25 | `require-invalidate-after-mutation` | cache | off | no |
| H26 | `no-store-write-in-render` (shared with H11) | cache | error | no |
| H27 | none — a judgement about the data | cache | — | — |

Three of these overlap with a runtime diagnostic the engine already reports in development
(H6, H14, H17). The rule is still worth having: it fires on code paths that were never
executed, and in CI rather than in a console nobody is watching.

All four syntactic forms of a change count wherever a rule looks for one: `x.y = v`, `x.y++`,
`delete x.y`, and an in-place array method (`push`, `splice`, `sort`, …). A rule that handled only
assignment would miss three quarters of the hazard.

**22 rules are implemented**, covering H1–H23 and H26: reads (H1–H5), writes (H6–H11), lifecycle
(H12, H13, H21, H22), effects (H14–H16) and boundaries (H17–H20), with H23 and H26 folded into the
rules they share. H24 and H25 are specified and named but not written yet; H27 cannot be a rule at
all. Detection lives in `native/src/rules/`, tested there with oxc's own parser over hand-written
edge cases; `plugin/src/Rules/` is now a thin bridge that calls that binary once per lint run and
reports through whichever host is running, so oxlint's `RuleTester` — which never writes its
synthetic snippets to disk — cannot exercise it. `__tests__/Native/conformance.test.ts` and
`__tests__/Plugin/host.test.ts` cover that path instead: real fixtures in `plugin/__fixtures__`,
run through the real binary and the real host together. The fixture run doubles as a positive
control: a green lint proves nothing if the rules never see the file. See CONTRIBUTING for the
bridge's mechanics and the host constraints that are easy to trip over.

## Reads

### H1 — reading a store through `getData()` in render

**Wrong**

```tsx
public render() {
    const {count} = todoCarburetor.getData();

    return <span>{count}</span>;
}
```

**Why it is silent.** `getData()` returns the raw state. Nothing is tracked, so the component
never subscribes. It renders the correct value once and then stays frozen forever — there is no
error, no warning, just a number that stops moving.

**Right**

```tsx
const {count} = this.useCarburetor(todoCarburetor);
```

**Rule** `no-get-data-in-render` — **error**.

**Detection.** A `.getData()` call whose immediately enclosing function *is* the render method
of a class extending a component base. "Immediately enclosing" is the whole point: a call inside
`onClick={() => store.getData()}` sits in another function and runs after the commit, where
`getData()` is correct. The one exception is a callback a synchronous method runs on the spot —
`map`, `filter`, `forEach`, `reduce`, `sort` and friends — which is render code and is treated as
such, because building a list with `ids.map(...)` is the ordinary way to render one.

Extra render helpers are named through the `renderMethods` option, and a project-local base class
through `componentBases`; neither is discoverable without types.

**False positives.** `getData()` is legitimate in event handlers, effects and outside components,
and none of those are reported. A store passed into a free function that calls `getData()` cannot
be followed and is out of scope.

### H2 — reading a computed through `get()` in render

**Wrong**

```tsx
public render() {
    return <span>{visibleCount.get()}</span>;
}
```

**Why it is silent.** Same as H1: `get()` returns the memoized value and registers no
subscription, so the component never hears that the derived value changed.

**Right**

```tsx
const count = this.useComputed(visibleCount);
```

**Rule** `no-computed-get-in-render` — **error**.

**Detection.** A `.get()` call **with no arguments** in render, by the same "runs during render"
rule as H1. The argument count is the discriminator: `IComputed.get()` takes none, while
`Map.get(key)`, `FormData.get(name)` and every other `get` worth confusing it with needs a key.
That works across files, which resolving an identifier back to a `computed(...)` initialiser would
not.

**False positives.** A zero-argument `.get()` on something that is not a computed — a wrapper of
your own, say. Rare in render, and the message names the assumption so the report is easy to
judge.

### H3 — reading a computed inside another computed through `get()`

**Wrong**

```ts
export const total = computed(() => visibleCount.get() * 2);
```

**Why it is silent.** The body receives a `read` function that registers dependencies. A direct
`get()` bypasses it, so `total` records no dependency on `visibleCount`, is never invalidated,
and returns a stale value for the rest of the process's life. This one was a real bug in the
engine's own history and is the single most silent hazard in the list.

**Right**

```ts
export const total = computed(read => read(visibleCount) * 2);
```

**Rule** `no-computed-get-in-computed` — **error**.

**Detection.** Inside the callback passed to `computed(...)`: a zero-argument `.get()` call or any
`.getData()` call, on anything other than the callback's own reader parameter (whatever it is
named). Nesting is handled by taking the innermost enclosing `computed(...)` call.

**False positives.** Low, thanks to the argument count: `titles.get(read(current).id)` inside a
computed is not reported, and neither is `when.getTime()`.

### H4 — calling `useCarburetor` outside render

**Wrong**

```ts
private onClick = () => {
    const data = this.useCarburetor(todoCarburetor);

    todoCarburetor.toggle(data.orderIds[0]);
};
```

**Why it is silent.** The read returns current data but records nothing: outside a render attempt
the engine attributes it to no render, so it can never alter what any render established — a
handler read cannot pollute the next render either. The component simply never subscribes to what
was read there and keeps showing the value it first rendered, with no error.

**Right.** Read in render and use the value, or use `getData()` in the handler, where no
subscription is wanted.

**Rule** `no-use-carburetor-outside-render` — **error**.

**Detection.** `this.useCarburetor(...)` / `this.useComputed(...)` inside a method or class
property of an `AntiHookComponent` subclass that is not `render` and not called from render.

**False positives.** A render helper method the rule cannot recognise as such. The
`renderMethods` option lists extra method names to treat as render.

### H5 — tracked data escaping render

**Wrong**

```tsx
public render() {
    const data = this.useCarburetor(todoCarburetor);

    this.lastData = data;                       // kept across renders

    return <button onClick={() => console.log(data.items)}>log</button>;
}
```

**Why it is silent.** The returned value is a proxy over the state at that moment. Read it
after commit and nothing is tracked; read it after a branch was replaced and the proxy may
point at data that is no longer in the store. Both produce a plausible-looking wrong value
rather than an error.

**Right.** Read the leaf you need in render and close over the primitive, or call `getData()`
in the handler.

**Rule** `no-escaping-tracked-data` — **warn**.

**Detection.** A binding whose initialiser is `this.useCarburetor(...)` in render, then either an
assignment of that name to a member of `this`, or a reference to it from a function that does not
run during the render (the same synchronous-callback distinction as H1, so a `map` callback is
not an escape). Only whole bindings count: `const {title} = this.useCarburetor(store)` extracts a
leaf, usually a primitive carrying no proxy, so destructuring is left alone. References are
matched inside the declaring render's source range, which keeps a same-named local in another
method from being mistaken for the tracked one — the rule has no scope analyser.

**False positives.** Real. Closing over tracked data in a handler is often harmless because the
handler runs while that render is still current. `warn`, not `error`, for that reason.

### H28 — a live view handed to a child gated by props comparison

**Wrong**

```tsx
private readonly todos = this.connect(() => this.props.carburetor);

public render() {
    return <MemoRow todos={this.todos.items} />;   // a branch of the live view
}
```

`MemoRow` is wrapped in `React.memo` or extends `AntiHookComponent` — anything that compares props
shallowly. Passing the view itself instead of a branch is the same mistake.

**Why it is silent.** The view's reference never changes, so the child's props compare as unchanged
every time: it bails out forever and keeps its first render. A child that reads the captured view
in its own render records nothing — the read happens outside the owner's render attempt — so no
subscription covers what it sees. Nothing errors anywhere.

**Right.** A Carburetor-aware child reads the store itself: pass the carburetor and an identity as
props, and let the child declare its own `connect()` or `useCarburetor`. An external child gets a
`connectSelection()` snapshot — detached plain data whose identity changes only when the selected
content changes.

**Rule** none yet — the engine itself reports handing a live view through a `connectSelection()`
snapshot, once per selection, in development; see the README's Diagnostics section.

## Writes

### H6 — writing through `draft` without publishing

**Wrong**

```ts
public toggle = (id: string) => {
    this.draft.items[id].done = !this.data.items[id].done;
};
```

**Why it is silent.** The data changes and nobody is notified, so the UI keeps showing the old
value until some unrelated write happens to wake the same subscribers. Development reports it
through `diagnostics`, but only for code paths that actually ran.

**Right**

```ts
public toggle = (id: string) => {
    this.update(draft => {
        draft.items[id].done = !this.data.items[id].done;
    });
};
```

**Rule** `require-emit-after-draft-write` — **error**.

**Detection.** In a class extending a store base: a method containing a write through
`this.draft` — assignment, update-assignment, `delete`, or an in-place array method, all four
forms — and no `this.emitUpdate()`, `this.emitSoon()`, `this.emitByKey()` in the same method, and
no enclosing `this.update(...)` callback. One report per method, on its first unpublished write.

`preEmit` is exempt: `emitUpdate` calls it right before notifying, so deriving state there is what
it is for and calling `emitUpdate()` inside it would recurse. The exemption travels along `this.x()`
calls out of `preEmit`, because a helper it delegates to is in the same position — the demo's
`countStats` and `sortItems` are exactly that shape, and the rule found them before the exemption
existed.

**False positives.** A method that deliberately leaves publishing to its caller and is not reachable
from `preEmit`. Name it in the `deferredEmitMethods` option; a one-off is silenced with a disable
comment on the write itself.

### H7 — writing to `this.data` directly

**Wrong**

```ts
public setTitle = (title: string) => {
    this.data.title = title;

    this.emitUpdate();
};
```

**Why it is silent.** It works — and quietly costs the whole point of the library. No path is
recorded, so `emitUpdate` falls back to invalidating everything and every subscriber of the
store re-renders. Nothing breaks; the app just gets slow the way a hooks app does.

**Right.** Write through `this.draft`, or `this.update(draft => ...)`.

**Rule** `no-direct-data-write` — **warn**.

**Detection.** An assignment, update-assignment, `delete` or mutating method call whose object
chain starts at `this.data` inside a `Carburetor` subclass.

**False positives.** Low. A deliberate wildcard invalidation is the only case, and
`setData(...)` expresses it better.

### H8 — mutating `getData()` from outside the store

**Wrong**

```ts
todoCarburetor.getData().items[id].done = true;
```

**Why it is silent.** No path is recorded and no `emitUpdate` runs at all, so the state and the
screen disagree until something else triggers a render. Snapshots and undo/redo recorded before
this write also silently drift, because the mutation edited the same object they share.

**Right.** Add a method to the carburetor and write through `draft` there. State changes belong
to the store that owns the state.

**Rule** `no-external-data-mutation` — **error**.

**Detection.** A write whose object chain starts at a `.getData()` call, anywhere outside the
class that owns it.

**False positives.** Low.

### H9 — mutating data returned by `useCarburetor`

**Wrong**

```tsx
const data = this.useCarburetor(todoCarburetor);

data.items[id].done = true;
```

**Why it is silent.** It is not, at runtime: the read proxy throws, and the type is deeply
read-only. It becomes silent only once a cast is involved (`as ITodoData`, `as any`), which is
exactly what people reach for when the compiler complains.

**Right.** Call a method on the carburetor.

**Rule** `no-tracked-data-mutation` — **error**.

**Detection.** A write whose object chain starts at an identifier bound to
`this.useCarburetor(...)`, including through an intermediate cast or destructured object.

**False positives.** Low.

### H10 — mutating an untrackable value reached through `draft`

**Wrong**

```ts
this.update(draft => {
    draft.index.set(id, 1);      // index is a Map
});
```

**Why it is silent.** It no longer is: reaching for an untrackable value through `draft`
records the path it came from, so the subscribers of `index` are notified. Before that fix the
write was lost entirely. What remains is a precision cliff — the whole `index` is invalidated,
whatever changed inside it — and the trap that the same mutation through `this.data` still
invalidates the entire store.

**Right.** Replace the value (`draft.index = next`) or keep plain data in the store.

**Rule** `no-untrackable-draft-mutation` — **warn**.

**Detection.** A call to a known mutating method (`set`, `delete`, `clear`, `add`, `setTime`,
`setDate`, `setHours`, …) on a member chain rooted at `this.draft` or at the `draft` parameter
of `this.update(...)`. Without type information the rule cannot tell a `Map` from an object
with a method called `set`, so the method-name list is the heuristic and it is configurable.

**False positives.** Real: a plain nested object is not mutated by a method call, but a class
instance of your own with a `set` method would be reported. `warn`, and the `mutatingMethods`
option narrows it.

### H11 — writing to a store from render

**Wrong**

```tsx
public render() {
    todoCarburetor.markSeen();       // writes and emits

    return <div/>;
}
```

**Why it is silent.** With the default synchronous scheduler the write notifies subscribers
during render. In the lucky case it re-renders the component that is currently rendering — an
extra pass, or a loop that React reports as a maximum-update-depth error far away from the
cause. In the unlucky case an abandoned concurrent render has already changed the state.

**Right.** Write in `useEffects`, in an event handler, or in a resource load.

**Rule** `no-store-write-in-render` — **error**.

**Detection.** A call in render on something the file identified as a store, with a method name
outside the read allow-list (`getData`, `getVersion`, `getUID`, `getLastError`, `snapshot`,
`toJSON`, `read`, `get`, `suspend`).

A store is identified by evidence, not by a naming convention: whatever is passed to
`this.useCarburetor(...)` or `this.useComputed(...)` anywhere in the file is one, matched by the
source text of that argument, so `this.props.carburetor` works as well as an imported singleton. A
component that writes to a store it never reads is not detected; `storeNames` covers that.

`suspend()` is in the allow-list even though it writes. It marks the resource pending and defers
the notification to a microtask precisely because a render must not notify, and it is *designed*
to be called from render — the rule reported the library's own Suspense test before this was fixed.

**False positives.** A store method that only reads and is not in the allow-list.

## Lifecycle

### H12 — overriding a lifecycle method without calling `super`

**Wrong**

```tsx
public componentDidMount(): void {
    this.load();
}
```

**Why it is silent.** The base class does the real work there: `componentDidMount` commits
subscriptions and runs effects, `componentDidUpdate` also re-runs them, `componentWillUnmount`
releases both, `shouldComponentUpdate` is the props gate. Skipping `super` disables exactly
one of those, so the component renders correctly on mount and then never updates, or leaks
every subscription it ever made. No error is raised at any point.

**Right**

```tsx
public componentDidMount(): void {
    super.componentDidMount();

    this.load();
}
```

Better still: override `useEffects` / `unUseEffects`, which exist so that the lifecycle does not
have to be touched.

**Rule** `require-super-in-lifecycle` — **error**.

**Detection.** In a class extending a component base: a method named `componentDidMount`,
`componentDidUpdate`, `componentWillUnmount` or `shouldComponentUpdate` with no
`super.<sameName>(...)` call anywhere in it — a call to a *different* super method does not count.
`shouldComponentUpdate` additionally reports a super call whose value is discarded: the result has
to reach a `return`, directly or through a variable.

**False positives.** A deliberate replacement of the props gate
(`shouldComponentUpdate() { return true; }`) is a conscious choice; the rule is silenced per
line by a disable comment, which is the right amount of friction for something this easy to
get wrong.

### H13 — declaring a lifecycle method as a class property

**Wrong**

```tsx
public componentDidMount = () => {
    super.componentDidMount();       // reachable, but the base method is shadowed anyway

    this.load();
};
```

**Why it is silent.** A class field is installed on the instance and shadows the prototype
method for good. Any base implementation that React would have called through the prototype is
gone, and in an earlier version of this library that silently disabled every effect in the
component — the field initializer ran after the constructor had wired things up. The component
looks completely normal.

**Right.** Declare lifecycle methods as methods. Class properties are for handlers.

**Rule** `no-lifecycle-class-property` — **error**.

**Detection.** A `PropertyDefinition` in an `AntiHookComponent` subclass whose key is a React
lifecycle name or `render`.

**False positives.** None worth the name.

### H21 — building a handler in render

**Wrong**

```tsx
<TodoRow onToggle={() => this.toggle(id)}/>
<TodoRow onToggle={this.toggle.bind(this)}/>
```

**Why it is silent.** Both produce a new function on every render of the parent. The child's
props therefore always compare as changed, `shouldComponentUpdate` never bails out, and the
props gate — the thing that stops a parent render from cascading down the tree — quietly stops
working. Nothing breaks; the app just re-renders as much as it would have without the library.

**Right**

```tsx
class Parent extends AntiHookComponent {
    @bind
    protected onToggle(): void { /* ... */ }

    public render() {
        return <TodoRow onToggle={this.onToggle}/>;
    }
}
```

When the handler needs a per-row argument, let the child pass it back (`onToggle(id)`) or give
the child the id as a prop and let it call the store itself — that is what the demo does.

**Rule** `no-handler-created-in-render` — **warn**.

**Detection.** In `render` of an `AntiHookComponent` subclass: a JSX attribute whose value is an
arrow function, a function expression, or a `.bind(...)` call, on a component element (an
element whose name starts with an uppercase letter). DOM elements are excluded: a fresh
`onClick` on a `<button>` costs an attribute update, not a subtree render.

**False positives.** Deliberate for cheap leaf children. `warn`, and the `ignoreComponents`
option lists component names to skip.

### H22 — passing an unbound method as a value

**Wrong**

```tsx
class Row extends AntiHookComponent {
    protected onToggle(): void {
        this.props.carburetor.toggle(this.props.id);       // `this` is undefined here
    }

    public render() {
        return <button onClick={this.onToggle}>toggle</button>;
    }
}
```

**Why it is silent.** It is not silent at runtime — it throws when the handler fires — but it
is invisible until someone clicks, and the fix people reach for (`.bind(this)` in render, an
inline arrow) is H21. So the rule exists to point at `@bind` rather than at either workaround.

**Right.** Decorate the method with `@bind`, which binds once per instance and keeps the method
on the prototype.

**Rule** `require-bind-for-passed-method` — **error**.

**Detection.** A reference to `this.<name>` used as a value (a JSX attribute, a call argument,
an assignment) inside a class extending `AntiHookComponent`, where `<name>` is declared in that
class as a method, is not decorated with `@bind`, and is not a property holding an arrow
function.

**False positives.** A method that never touches `this`. The rule only reports methods whose
body contains `this`.

**Note.** `typescript/unbound-method` (and `@typescript-eslint/unbound-method`) covers the same
ground without seeing the decorator, so it reports correct `@bind` usage as an error. This
repository turns that rule off and relies on this one instead; consumers using `@bind` should do
the same.

## Effects

### H14 — an async effect body

**Wrong**

```ts
protected useEffects(): void {
    this.useEffect(async () => {
        await todoResource.load();
    }, 'load', []);
}
```

**Why it is silent.** Whatever the effect returns is treated as its cleanup. An async function
returns a promise, which is not a function, so the cleanup is dropped: the effect can never
tear itself down, and the abort it was supposed to perform on unmount never happens. Nothing
warns, because returning nothing is also legal.

**Right**

```ts
this.useEffect(() => {
    const controller = new AbortController();

    void todoResource.load(controller.signal);

    return () => controller.abort();
}, 'load', []);
```

**Rule** `no-async-effect` — **error**.

**Detection.** The first argument of `this.useEffect(...)` is an `async` function, or a function
whose body returns a call to an `async` function without a cleanup return.

**False positives.** Low for the `async` keyword case; the "returns a promise" case is limited
to a directly returned call expression of a function declared `async` in the same file.

### H15 — two effects sharing a name in one component

**Wrong**

```ts
this.useEffect(subscribeToSocket, 'effect', [url]);
this.useEffect(startTimer, 'effect', [interval]);
```

**Why it is silent.** The name is the effect's identity: its deps and its cleanup are stored
under it. The second registration overwrites the first one's record, so the first effect's
cleanup is lost and its deps comparison starts answering for the second. The symptom is a
listener that is never removed, appearing much later as a leak.

**Right.** Give every effect in a component a distinct name.

**Rule** `no-duplicate-effect-name` — **error**.

**Detection.** Two `this.useEffect(...)` calls with the same string-literal name within the
same class. Non-literal names are skipped.

**False positives.** None for literals. A name built at runtime cannot be checked and is not
reported.

### H16 — a dependency used in the body but missing from `deps`

**Wrong**

```ts
this.useEffect(() => connect(this.props.url), 'connect', []);
```

**Why it is silent.** The effect runs once with the first `url` and never again. The component
re-renders with the new prop and the effect keeps holding the old connection. Exactly the
`exhaustive-deps` class of bug, minus the hook.

**Right**

```ts
this.useEffect(() => connect(this.props.url), 'connect', [this.props.url]);
```

**Rule** `require-effect-deps` — **warn**.

**Detection.** Member expressions rooted at `this.props` or `this.state`, read inside the effect
body and not covered by the `deps` array. Comparison is by source text, and a dependency covers
everything below it: `[this.props.user]` satisfies a read of `this.props.user.name`. Values that are
not `this.props`/`this.state` (module-level stores, imported constants) are out of scope — a store
is not a dependency, it is subscribed to.

Only an inline function body is analysed. `this.useEffect(this.props.carburetor.loadData, 'load', [])`
passes a reference whose body is in another file, and reporting the reference itself would fire on a
pattern this library recommends — passing a stable bound method instead of building a closure every
render. The demo does exactly that, and the rule reported it before this narrowing.

**False positives.** Real, as in every exhaustive-deps implementation: a prop read inside a nested
callback that intentionally sees the latest value. `warn`, with a disable comment as the escape.

## Transactions, SSR and boundaries

### H17 — an async transaction body

**Wrong**

```ts
await transaction(async () => {
    await save();

    profileCarburetor.setName(name);
});
```

**Why it is silent.** The batch is open only while the body runs synchronously. At the first
`await` the body returns a promise, `transaction` closes the batch, and every write after the
await is delivered separately — the batching silently does nothing. Development reports it;
the rule catches paths that never ran.

**Right**

```ts
await save();

transaction(() => {
    profileCarburetor.setName(name);
});
```

The same applies to `this.update(draft => ...)`: it publishes when the callback returns, so an
async callback publishes at the first `await` and leaves everything written afterwards
unpublished. The rule covers both call shapes.

**Rule** `no-async-transaction` — **error**.

**Detection.** The argument of `transaction(...)` or `this.update(...)` is an `async` function
or a function containing an `await`.

**False positives.** None known: both APIs are documented as synchronous.

### H18 — a module-level store in a project that uses scopes

**Wrong**

```ts
export const todoCarburetor = new TodoCarburetor(getInitialData());
```

**Why it is silent.** On a server this instance is shared by every request in the process: one
user's state leaks into another's render. Locally, with one user, it behaves perfectly. This is
the only hazard in the catalogue whose symptom appears exclusively in production.

**Right.** Create stores through `CarburetorScope` and resolve them by token in
`ScopedAntiHookComponent`.

**Rule** `no-module-level-store` — **off by default**.

**Detection.** A module-level `new <X>Carburetor(...)` where `<X>Carburetor` extends
`Carburetor` or `ResourceCarburetor`. Enabled by setting the rule's severity, intended for
projects that render on a server.

**False positives.** By design: a module-level store is the correct and recommended pattern in
a client-only app. Off unless the project opts in, rather than nagging every consumer.

### H19 — untrackable values in store data

**Wrong**

```ts
interface IData {
    index: Map<string, number>;
}
```

**Why it is silent.** Tracking stops at `Map`, `Set`, `Date` and class instances. Reads are
coarse (the whole value is one leaf), in-place mutation through `draft` invalidates the whole
value, and the same mutation through `this.data` invalidates the whole store. Everything keeps
working, at a granularity that quietly defeats the library's purpose. `snapshot()` also shares
these values by reference instead of copying them, so undo/redo over them does not restore.

**Right.** Keep plain objects and arrays in the store; convert at the edges.

**Rule** `no-untrackable-store-data` — **warn**.

**Detection.** In a type annotation of a store's data interface, or in the initial-data factory
of a `Carburetor` subclass: a `Map`/`Set`/`Date`/`WeakMap`/`WeakSet` type reference or `new`
expression. Purely syntactic, so it sees the declared shape only.

**False positives.** A `Date` in a store is common and sometimes deliberate. `warn`, with the
`allowedTypes` option.

### H20 — a subscription nobody disposes of

**Wrong**

```ts
todoCarburetor.subscribe(() => log(todoCarburetor.getData()));
```

**Why it is silent.** The carburetor holds the callback, and the callback holds whatever it
closed over, for the lifetime of the store. Nothing fails; memory grows and the callback keeps
firing after the thing it served is gone.

**Right**

```ts
const dispose = todoCarburetor.watch(reads, () => log(todoCarburetor.getData()));
```

`watch` returns a disposer, which makes the cleanup impossible to forget. Components do not
need either: `useCarburetor` subscribes and `componentWillUnmount` releases.

**Rule** `require-subscription-disposal` — **warn**.

**Detection.** A `.subscribe(...)` call whose returned id is discarded — the call is an expression
statement — and which passed no `id` option. An explicit `{id}` means the caller kept a handle and
can release or replace the subscription by it, which is exactly how the engine subscribes components
and computed values. That discriminator is what keeps the rule off the library's own code without
needing an exemption list.

**False positives.** A deliberately process-long subscription — logging, persistence — is a
legitimate case, which is why this is a `warn` and why the message names `watch` rather than
demanding it.

## Cached resources

`ResourceCache` adds a layer with hazards of its own. They are catalogued here in the same form, and
the rule names are reserved; only H23 is implemented so far, by extending H8.

### H23 — writing through a cache entry

**Wrong**

```ts
userCache.getEntry(id).data.name = 'edited';
```

**Why it is silent.** `getEntry` returns a fresh view object, which makes the write look local — but
the `data` inside it is the object every reader of that entry sees. So the edit reaches every
component without a path being recorded and without anyone being notified, and the next refresh
replaces it without warning.

**Right.** Change it on the server and `invalidate(args)`, or keep edited state in a store of your own.

**Rule** `no-external-data-mutation` — **error**, the same rule as H8: both `getData()` and
`getEntry()` hand out live state.

### H24 — arguments that cannot become a key

**Wrong**

```ts
void userCache.load({id, onDone: () => refresh()});
```

**Why it is silent.** The key is the arguments serialised as JSON. A function or a symbol disappears,
so two different argument sets collapse into one key and share an answer; a circular reference throws
from inside `load` instead. Both look like the cache misbehaving rather than like the arguments being
wrong.

**Right.** Pass only data. Callbacks belong to the caller, not to the cache key.

**Rule** `no-unserializable-cache-args` — **warn**, not implemented yet. Detectable when the argument
is an object literal with a function property or a shorthand method.

### H25 — a mutation that forgets to invalidate

**Wrong**

```ts
await api.renameUser(id, name);
// nothing else
```

**Why it is silent.** The cached entry still holds the old name and is still fresh, so every component
reading it keeps showing what the server no longer says — until the lifetime runs out, which may be
half a minute or never.

**Right.** `userCache.invalidate(id)` after the server accepted the write, or `invalidateAll()` when the
change is broad.

**Rule** `require-invalidate-after-mutation` — **off by default**, not implemented yet. Any rule here
must guess which calls are mutations, so it would need a configured list of loader names and would be
opt-in.

### H26 — loading from render

**Wrong**

```tsx
public render() {
    void userCache.load(this.props.id);

    return <span>{userCache.getEntry(this.props.id).data?.name}</span>;
}
```

**Why it is silent.** `load` writes the pending state, which notifies subscribers in the middle of the
render — the hazard H11 describes, reached through the cache instead of a store method.

**Right.** `this.useResource(userCache, id)`, which reads in render and fetches after the commit.

**Rule** `no-store-write-in-render` — **error**, H11's rule, once `load`, `refresh`, `invalidate` and
`forget` are added to the methods it recognises as writes. Not done yet.

### H27 — a lifetime longer than the data's truth

**Wrong**

```ts
export const draftCache = new ResourceCache(loadDraft, {ttl: Infinity});
```

**Why it is silent.** An entry the user edits elsewhere in the application stays "fresh" forever, so
the screen keeps showing a version that only the cache still believes in. Nothing fails; the data is
simply wrong, and `invalidate` is the only thing that can rescue it.

**Right.** Give data the user edits a short lifetime, or none at all, and invalidate on write.

**Rule** none. This is a judgement about the data, and a linter has no way to make it.

## Not hazards

These look like the patterns hook linters forbid, and are explicitly fine here. No rule may
report them.

- **Conditional reads.** `if (this.props.expanded) { const d = this.useCarburetor(store); }` is
  supported. There is no slot array and no call-order requirement: a read registers a path, and
  `commitSubscriptions` subscribes to whatever the render actually read. A component that reads
  different stores on different renders unsubscribes from the ones it stopped reading.
- **Reads in a loop.** Same reason.
- **An early `return` in render before a read.** Same reason.
- **Reading the same store twice in one render.** The reads merge into one subscription.
- **`useEffect` behind a condition.** Effects are keyed by name, not by call order.
- **`getData()` in an event handler, an effect, or outside a component.** That is what it is
  for; only render is the wrong place (H1).
- **A carburetor method that writes without `draft`** when it replaces the whole state through
  `setData(...)`: the wildcard invalidation is explicit and intended there.
