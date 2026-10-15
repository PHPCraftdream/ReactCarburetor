# Derived (computed) values

A computed is a memoized value over one or more stores. Its body declares what it reads, and
those reads become its dependencies: the value is recomputed only when one of them is written,
and subscribers are woken only when the result actually changed.

All examples import from the root entry `react-carburetor`.

## A store and a simple computed

`computed()` takes a body that receives a tracking `read` function. Everything the body reads
through `read` becomes a dependency of the value.

<!-- example:file examples/api/computed/Simple.ts -->
```ts
import {Carburetor, bind, computed} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {
    @bind
    add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const cart = new CartCarburetor({items: ['apple']});

const itemCount = computed((read) => read(cart).items.length);

console.log(itemCount.get()); // 1
cart.add('pear');
console.log(itemCount.get()); // 2 — the body reran because `items` moved
```

Pitfall: reading the store directly (`cart.getData().items.length`) inside the body registers no
dependency — always go through `read`.

## Reading outside a component with `.get()`

`get()` returns the value, recomputing first when a dependency moved. Outside React this is the
whole read API; the value stays cached between calls.

<!-- example:file examples/api/computed/Get.ts -->
```ts
import {Carburetor, computed} from 'react-carburetor';

class SettingsCarburetor extends Carburetor<{theme: string}> {}

const settings = new SettingsCarburetor({theme: 'light'});
const theme = computed((read) => read(settings).theme);

console.log(theme.get()); // 'light'
settings.setData({theme: 'dark'});
console.log(theme.get()); // 'dark'
```

Pitfall: `get()` inside a component body does not subscribe the component — use
`this.useComputed(...)` in render instead (see below).

## Composing computeds

A computed can read another computed through the same `read` function. The outer value then
depends on the inner one as a whole and is invalidated only when the inner value is.

<!-- example:file examples/api/computed/advanced/Compose.ts -->
```ts
import {Carburetor, computed} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: ['apple', 'pear']});

const items = computed((read) => read(cart).items);
const count = computed((read) => read(items).length);
const label = computed((read) => `${read(count)} item(s)`);

console.log(label.get()); // '2 item(s)'
cart.setData({items: ['apple', 'pear', 'plum']});
console.log(label.get()); // '3 item(s)'
```

Pitfall: calling `inner.get()` directly inside a body bypasses tracking and leaves the outer
value stale — pass the inner computed through `read`.

## The `Computed` class and explicit types

`computed()` is a thin factory over the `Computed` class. When you want the body and options
annotated, type them with `TComputeBody<R>` and `IComputedOptions<R>`; the value itself satisfies
`IComputed<R>`.

<!-- example:file examples/api/computed/advanced/Typed.ts -->
```ts
import {Carburetor, Computed} from 'react-carburetor';
import type {IComputed, IComputedOptions, TComputedReader, TComputeBody} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: []});

const body: TComputeBody<string[]> = (read: TComputedReader) => [...read(cart).items];
const options: IComputedOptions<string[]> = {};
const snapshot: IComputed<string[]> = new Computed(body, options);

console.log(snapshot.get());
```

Pitfall: `IComputed<R>` exposes `get()`, but a plain `get()` read never registers a dependency —
subscription happens through a component's `useComputed` or an explicit `subscribe`.

## Custom equality with `shallowEqual`

By default a settled result is compared by reference. Pass `equals` to judge results by content;
`shallowEqual` (exported from the root entry) compares one level deep, like `React.memo` props.

<!-- example:file examples/api/computed/advanced/ShallowEqual.ts -->
```ts
import {Carburetor, computed, shallowEqual} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {}

const cart = new CartCarburetor({items: ['apple']});

const items = computed((read) => [...read(cart).items], {equals: shallowEqual});

const before = items.get();
cart.setData({items: ['apple']});           // new array, same content
console.log(items.get() === before);        // true — the cached result was kept
```

Pitfall: `equals` is consulted only when the reference actually changed; an in-place mutation of
the same result object aliases `previous` and `next`, so rebuild the result (spread it) in the body.

## Reading a computed inside a component

`AntiHookComponent` reads a computed in render with `this.useComputed(computed)`. The component
subscribes to the computed itself — not to its inputs — so it re-renders only when the derived
value changes.

<!-- example:file examples/api/computed/read/UseComputed.tsx#doc -->
```tsx
import {AntiHookComponent, Carburetor, bind, computed} from 'react-carburetor';

class CartCarburetor extends Carburetor<{items: string[]}> {
    @bind
    add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const cart = new CartCarburetor({items: []});
const itemCount = computed((read) => read(cart).items.length);

class CartControls extends AntiHookComponent {
    @bind
    private addOne(): void {
        cart.add('plum');
    }

    public render() {
        const count = this.useComputed(itemCount);

        return (
            <span data-testid="badge">
                {count} item(s)
                <button onClick={this.addOne}>add</button>
            </span>
        );
    }
}
```

Pitfall: pass methods as `onClick` values only when they are `@bind`-decorated — an undecorated
prototype method loses its `this` when detached.
