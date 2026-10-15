# Component examples

`AntiHookComponent` and `ScopedAntiHookComponent` are **classes**: you extend them and override
`render()`. There are no hooks at the call site — every read API is a method on `this`, and the
component subscribes to exactly the store fields the render actually read.

The two class rules that keep the engine fast:

- **Never use arrow class fields.** An arrow property replaces the prototype method on the
  instance, so `super.method()` and overriding stop working — declaring a lifecycle method as a
  property silently disables effects.
- **Pass store methods as values only when they are `@bind`-decorated.** `onClick={store.save}`
  needs a stable reference; an undecorated method passed as a value loses its `this`.

## Reading state in render: `useCarburetor`

`useCarburetor(carburetor)` is the direct way to read store state inside `render()`, but it is not
the only one: `connect` and `connectSelection` below build persistent connections to the same
tracked view. In every case the component re-renders only when the fields the render actually read
change.

<!-- example:compile -->
```tsx
import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counter = new CounterCarburetor({count: 0});

interface ICounterProps {
    carburetor: CounterCarburetor;
}

class CounterView extends AntiHookComponent<ICounterProps> {
    public render() {
        const data = this.useCarburetor(this.props.carburetor);
        return <span>{data.count}</span>;
    }
}
```

Pitfall: reads through a captured view outside `render()` — from a timer or another component's
callback — record nothing; read in `render()`, act in handlers.

## Passing handlers as values: the `@bind` decorator

`@bind` binds a method to its instance once, at construction. The method stays on the prototype
(so `super.method()` still works) and the bound reference is stable for the instance's lifetime,
so the props gate can bail out of parent-driven re-renders.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind, Carburetor} from 'react-carburetor';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counter = new CounterCarburetor({count: 0});

class CounterButton extends AntiHookComponent {
    private readonly data = this.connect(counter);

    @bind
    protected onClick(): void {
        counter.increment();
    }

    public render() {
        return <button onClick={this.onClick}>{this.data.count}</button>;
    }
}
```

Pitfall: `onClick={this.onClick}` is only safe because of `@bind`; an undecorated method passed
as a value is called with `this === undefined`.

## A persistent connection: `connect`

`connect(source)` builds one view of a store, once, and hands back the exact same object for the
component's lifetime — the facade is created per connection and stays stable until the component
dies, independent of what the underlying data object does. A field initializer is the intended call
site; the returned view is read directly in `render()`.

<!-- example:compile -->
```tsx
import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface IGreetingData {
    name: string;
}

const greeting = new Carburetor<IGreetingData>({name: 'Ada'});

class Greeting extends AntiHookComponent {
    private readonly data = this.connect(greeting);

    public render() {
        return <span>Hello, {this.data.name}</span>;
    }
}
```

Pitfall: `connect()` accepts a function as its source too — `this.connect(() => this.props.carburetor)`
— so a prop swap re-points the connection at the new store.

## A typed selection for memo children: `connectSelection`

`connectSelection(source, select)` is declared once as a field initializer and the returned
function is called in render. It produces a detached plain-data snapshot whose identity changes
only when the selected content changes — safe to hand a child gated by shallow props comparison.

<!-- example:compile -->
```tsx
import * as React from 'react';
import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface IItemListData {
    items: Array<{id: string; title: string}>;
}

const list = new Carburetor<IItemListData>({
    items: [{id: 'a1', title: 'First'}],
});

interface ITitleProps {
    title: string;
}

const Title = React.memo(function Title(props: ITitleProps) {
    return <span>{props.title}</span>;
});

class ItemTitle extends AntiHookComponent {
    private readonly row = this.connectSelection(
        list,
        (data) => ({title: data.items[0].title}),
    );

    public render() {
        return <Title title={this.row().title}/>;
    }
}
```

Pitfall: call what `connectSelection` returned on every render even inside a branch — the call
itself is what keeps the subscription's read set fresh.

## Effects: `useEffects` and `useEffect`

A subclass overrides the protected `useEffects()` method; it runs on mount and after every
committed update. Each effect is declared with `useEffect(name, callBack, deps)`; whatever the
callback returns is that effect's cleanup, run before the effect runs again and on unmount.

<!-- example:compile -->
```tsx
import {AntiHookComponent, Carburetor, TEffect, TEffectCleanup, TEffectDeps, TTimerHandle} from 'react-carburetor';

interface IDraftData {
    text: string;
}

const draft = new Carburetor<IDraftData>({text: ''});

declare function saveToServer(text: string): void;

const cleanupAutosave = (handle: TTimerHandle | undefined): TEffectCleanup => (): void => {
    if (handle !== undefined) {
        clearTimeout(handle);
    }
};

const autosaveEffect: TEffect = (): TEffectCleanup => {
    let handle: TTimerHandle;
    handle = setTimeout((): void => saveToServer(draft.getData().text), 500);
    return cleanupAutosave(handle);
};

class AutosaveDraft extends AntiHookComponent {
    public render() {
        const view = this.useCarburetor(draft);
        return <textarea value={view.text} readOnly/>;
    }

    protected useEffects(): void {
        const deps: TEffectDeps = [draft.getData().text];
        this.useEffect('autosave', autosaveEffect, deps);
    }
}
```

Pitfall: reads through `getData()` in `render()` record nothing — read through
`this.useCarburetor(draft)` instead. Reading `draft.getData()` in an effect body is correct, because
effects re-run after the committed update, and the subscription from `render()` is what re-renders the
component when `draft.setData(...)` publishes.

Pitfall: two effects sharing one name overwrite each other's deps and cleanup — give every
effect its own name.

## Async data: `useResource`

`useResource` reads a resource (a loader with loading/pending/error status) and is documented,
with its Suspense and caching story, in [docs/examples/resources.md](./resources.md). It is not
covered here.

## Per-request stores: `carburetorToken`, `CarburetorScope`, `ScopedAntiHookComponent`

A module-level singleton is shared by every request on a server and leaks one user's state into
another's render. A token names a carburetor; a `CarburetorScope` creates one instance per token,
lazily, on first `get()`. `set()` replaces an instance (tests, hydration), `has()` asks whether
one exists, `dehydrate()`/`hydrate()` carry state across a server/client boundary.

<!-- example:compile -->
```tsx
import {
    AntiHookComponent,
    bind,
    carburetorToken,
    Carburetor,
    CarburetorScope,
    ICarburetorToken,
    ScopedAntiHookComponent,
} from 'react-carburetor';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counterToken: ICarburetorToken<CounterCarburetor> = carburetorToken(
    () => new CounterCarburetor({count: 0}),
    'examples-counter',
);

class ScopedCounter extends ScopedAntiHookComponent {
    @bind
    protected onClick(): void {
        this.resolve(counterToken).increment();
    }

    public render() {
        const counter = this.useCarburetor(this.resolve(counterToken));
        return <button onClick={this.onClick}>{counter.count}</button>;
    }
}

const scope = new CarburetorScope();
const counter = scope.get(counterToken);
```

Pitfall: a `ScopedAntiHookComponent` rendered without a `<CarburetorProvider>` above it throws
on `resolve()` — a missing provider is a wiring mistake, not a default.

## Publishing a scope outside the provider tree: `CarburetorProvider` and `CarburetorContext`

`CarburetorProvider` publishes a scope to its subtree. `CarburetorContext` is exported for the
one case the provider cannot reach: content rendered through a React **portal** into a container
outside the provider's DOM subtree still shares the React context tree, but a tree rendered by a
different root does not — re-provide the scope there with `CarburetorContext.Provider` so scoped
components resolve their tokens.

<!-- example:compile -->
```tsx
import * as React from 'react';
import {createPortal} from 'react-dom';
import {
    carburetorToken,
    CarburetorContext,
    CarburetorScope,
    ScopedAntiHookComponent,
} from 'react-carburetor';

const statusToken = carburetorToken(
    () => ({message: 'ready'}),
    'examples-portal-status',
);

class StatusBar extends ScopedAntiHookComponent {
    public render() {
        return <span>{this.resolve(statusToken).message}</span>;
    }
}

interface IPortalPanelProps {
    scope: CarburetorScope;
    container: HTMLElement;
}

class PortalPanel extends React.Component<IPortalPanelProps> {
    public render() {
        return createPortal(
            <CarburetorContext.Provider value={this.props.scope}>
                <StatusBar/>
            </CarburetorContext.Provider>,
            this.props.container,
        );
    }
}
```

Pitfall: `CarburetorContext.Provider` re-provides a scope for trees a separate React root
renders; inside one normal tree, `<CarburetorProvider>` at the top is all you need.
