# Adopting React Carburetor in an existing app

This is a migration path for an existing functional-component app whose state lives in
`useState`, Context, or a Redux-style store. You do not rewrite the app: you introduce one
store, read it from the components you already have, and move components to classes only
where the render cost justifies it. Each step stands on its own; the app works after any
of them.

## 1. Start with one store

Model one slice of state as a class extending `Carburetor<T>`. Methods that write go through
`this.update((draft) => {...})`; the draft is a mutable view and the changed paths are
recorded from the assignment. Instantiate one module-level instance — this is right for a
client-only app. If the codebase renders on the server, a module-level store is shared by
every request; the lint rule `no-module-level-store` exists to flag exactly this, and
[step 4](#4-scope-per-request-when-rendering-on-the-server) is the fix.

Methods you pass as callbacks must be `@bind`-decorated. Prototype methods lose `this` when
detached, and an unbound `inc` passed to `onClick` fails at the first `this.update`.

<!-- example:file examples/interop/adopting/Store.ts#doc -->
```ts
import {bind, Carburetor} from 'react-carburetor';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});
```

## 2. Read it from existing components

Functional components need no rewrite. `useCarburetorValue(carburetor, select)` from
`react-carburetor/interop` subscribes to exactly the paths the selector reads — the same
precision the class API gets — and returns a detached readonly selection. The selector is
required; an optional third argument overrides the structural equality check. Existing
hook-based components can adopt the store one component at a time, mixed freely with the
state they still hold in `useState`.

<!-- example:file examples/interop/adopting/InteropCounter.tsx#doc -->
```tsx
import {bind, Carburetor} from 'react-carburetor';
import {useCarburetorValue} from 'react-carburetor/interop';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };
const selectValue = (state: {value: number}): number => state.value;

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});
const incrementCounter = (): void => { counterCarburetor.inc(); };

function Counter() {
    const value = useCarburetorValue(counterCarburetor, selectValue);

    return <button onClick={incrementCounter}>{value}</button>;
}
```

## 3. Move hot components to classes

Where render cost matters, replace the function component with a class extending
`AntiHookComponent` and read through `this.useCarburetor(carburetor)`. There is no selector
and no dependency array: the read itself records which fields the component touched, and the
subscription follows those paths. A write to `value` wakes only components that read `value`.
Methods can go straight to `onClick` — provided they are `@bind`-decorated as in step 1.

<!-- example:file examples/interop/adopting/ClassCounter.tsx -->
```tsx
import {AntiHookComponent, bind, Carburetor} from 'react-carburetor';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});

export class Counter extends AntiHookComponent {
    render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={counterCarburetor.inc}>{value}</button>;
    }
}
```

## 4. Scope per request when rendering on the server

A module-level instance is a client-only convenience: on the server every request would read
and write the same store. Put instances behind `CarburetorScope`, create one scope per
request, name each store with a `carburetorToken`, and read from components extending
`ScopedAntiHookComponent`, which resolves the instance through the scope instead of a
module-level singleton. After rendering, `scope.dehydrate()` produces the serializable state
to send to the client.

For the resource-loading side of server rendering — cache semantics, hydration of the
prepared state, and what the client does with it — see [promise-cache.md](promise-cache.md)
(the "Server rendering" section) and the tooling examples in the repository demo. The rule
that keeps this honest in code review is `no-module-level-store`; see
[rules.md](rules.md) and the corresponding hazard in [hazards.md](hazards.md).

## 5. Test the store, not the tree

A store is a plain class: instantiate it, call methods, assert on `store.getData()` or public getters —
no renderer, no act, no mocked React. For writes that land asynchronously, `waitForUpdate`
subscribes for one notification and resolves on the next update (or rejects after a timeout,
1000 ms by default), so the assertion waits for the store instead of guessing at ticks.

<!-- example:file examples/interop/adopting/Testing.ts -->
```ts
import {bind, Carburetor, waitForUpdate} from 'react-carburetor';

const fetchCount = async (): Promise<number> => 1;

class CountCarburetor extends Carburetor<{value: number}> {
    @bind
    public async reload(): Promise<void> {
        const value = await fetchCount();
        this.draft.value = value;
        this.emitUpdate();
    }
}

export async function testReload(): Promise<void> {
    const store = new CountCarburetor({value: 0});
    const updated = waitForUpdate(store);

    void store.reload();
    await updated;

    if (store.getData().value !== 1) {
        throw new Error('reload did not apply the fetched count');
    }
}
```

## 6. Turn on the linter

The lint rules ship with the package; see [rules.md](rules.md) for setup and
[hazards.md](hazards.md) for what each one catches. The recommended preset flags the hazards
adopted code is most likely to hit: draft writes that never publish, unbound methods passed
as callbacks, and subscriptions without disposal.

## Order of adoption

1. One store for one slice of state, instantiated at module level (client-only).
2. Hook readers (`useCarburetorValue`) in the existing functional components.
3. Class components (`AntiHookComponent`) where render cost matters.
4. Scope per request (`CarburetorScope` + `ScopedAntiHookComponent`) when rendering on the server.
5. The linter, with the recommended preset.
