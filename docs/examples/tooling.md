# Tooling examples

The tooling layer adds cross-cutting behaviors on top of any carburetor: undo/redo
(`CarburetorHistory`), storage mirroring (`persist`), Redux DevTools integration
(`connectDevTools`) and an awaitable update primitive (`waitForUpdate`). All examples are
class components — no hooks anywhere.

## Undo and redo

`CarburetorHistory` records every change made through a store and can step back and forward
through them. Attach it right after creating the store; it watches the store's patch stream,
so all later `this.update(...)` calls are captured automatically.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind, Carburetor, CarburetorHistory, IHistoryOptions} from 'react-carburetor';
import {ReactElement} from 'react';

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind
    public increment(): void {
        this.update((draft) => { draft.count += 1; });
    }

    @bind
    public decrement(): void {
        this.update((draft) => { draft.count -= 1; });
    }
}

const store = new CounterCarburetor({count: 0});
const historyOptions: IHistoryOptions = {limit: 20};
const history = new CarburetorHistory(store, historyOptions);

export class CounterView extends AntiHookComponent {
    @bind
    private undo(): void {
        history.undo();
    }

    @bind
    private redo(): void {
        history.redo();
    }

    render(): ReactElement {
        const view = this.useCarburetor(store);
        return (
            <div>
                <span>count: {view.count}</span>
                <button type="button" onClick={this.undo} disabled={!history.canUndo()}>Undo</button>
                <button type="button" onClick={this.redo} disabled={!history.canRedo()}>Redo</button>
            </div>
        );
    }
}
```

`undo()`/`redo()` return whether they actually moved; if you render that, reconstruct the UI
from the store state, not from the booleans. Call `history.disconnect()` when the store
outlives the history to stop recording, and `clear()` to drop all entries in place.

## Persistence

`persist` hydrates a store from storage on connect and writes the store's wire form back on
every change. Storage is any object with `getItem`/`setItem`/`removeItem` (`IStorageLike`), so
`localStorage` and in-memory test doubles both fit.

<!-- example:compile -->
```ts
import {bind, Carburetor, IPersistOptions, IStorageLike, persist} from 'react-carburetor';

class TodoCarburetor extends Carburetor<{items: string[]}> {
    @bind
    public add(item: string): void {
        this.update((draft) => { draft.items.push(item); });
    }
}

const memoryStorage = (): IStorageLike => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string): string | null => items.get(key) ?? null,
        setItem: (key: string, value: string): void => { items.set(key, value); },
        removeItem: (key: string): void => { items.delete(key); },
    };
};

const store = new TodoCarburetor({items: []});
const options: IPersistOptions = {
    key: 'todos',
    storage: memoryStorage(),
    coalesce: false,
    onError: (error: unknown): void => { console.error('persist failed', error); },
};
const stop = persist(store, options);

store.add('first');
stop();
```

The returned disposer stops persisting and flushes a pending write. Load and write errors
reach `onError`; without it a failed read throws, and corrupt stored data is removed by
default.

## Redux DevTools

`connectDevTools` publishes the state of the given carburetors to the Redux DevTools
extension and applies time travel back onto them. Each key of the object becomes a top-level
key of the published state; the `extension` option replaces the auto-discovered browser
extension, which is how tests and non-browser environments inject a stub.

<!-- example:compile -->
```ts
import {
    bind,
    Carburetor,
    connectDevTools,
    EDevToolsAction,
    EDevToolsMessageType,
    IDevToolsConnection,
    IDevToolsExtension,
    IDevToolsMessage,
    IDevToolsOptions,
    TDisposer,
} from 'react-carburetor';

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind
    public increment(): void {
        this.update((draft) => { draft.count += 1; });
    }
}

const store = new CounterCarburetor({count: 0});
store.increment();

class StubDevToolsExtension implements IDevToolsExtension {
    private listener: ((message: IDevToolsMessage) => void) | undefined;

    public connect(options: {name?: string}): IDevToolsConnection {
        return {
            init: (state: unknown): void => { console.log(options.name, state); },
            send: (action: string, state: unknown): void => { console.log(action, state); },
            subscribe: (listener: (message: IDevToolsMessage) => void): TDisposer => {
                this.listener = listener;
                return () => { this.listener = undefined; };
            },
        };
    }

    @bind
    public jumpTo(state: {counter: {count: number}}): void {
        this.listener?.({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.JumpToAction},
            state: JSON.stringify(state),
        });
    }
}

const extension = new StubDevToolsExtension();
const devToolsOptions: IDevToolsOptions = {name: 'Counter demo', extension};
const stopDevTools = connectDevTools({counter: store}, devToolsOptions);

extension.jumpTo({counter: {count: 0}});
console.log(store.getData().count); // 0 — time travel reverted the store
stopDevTools();
```

A time-travel message is a dispatch whose payload type is `JUMP_TO_ACTION`, `JUMP_TO_STATE`
or `ROLLBACK`; the state it carries is applied through each store's `fromJSON`. Any store
exposing `snapshot()`/`fromJSON()`/`getVersion()`/`subscribe()` qualifies — plain
`Carburetor`, `ResourceCarburetor` and `ResourceCache` all work.

## Waiting for the next update

`waitForUpdate` resolves on the next update of a carburetor (or a computed) and rejects after
a timeout, 1000 ms by default. It is meant for orchestration code around throttled stores and
async resources, where the update does not arrive within the current tick.

<!-- example:compile -->
```ts
import {bind, Carburetor, waitForUpdate} from 'react-carburetor';

interface User {
    name: string;
}

declare function fetchUser(id: string): Promise<User>;

class UserCarburetor extends Carburetor<{user: User | undefined; loading: boolean}> {
    @bind
    public async load(id: string): Promise<void> {
        this.update((draft) => { draft.loading = true; });
        const user = await fetchUser(id);
        this.update((draft) => {
            draft.user = user;
            draft.loading = false;
        });
    }
}

const store = new UserCarburetor({user: undefined, loading: false});

const run = async (): Promise<void> => {
    const updated = waitForUpdate(store, 2000);
    void store.load('u1');
    await updated;
    console.log(store.getData().loading); // true — the first update (loading = true) arrived
};
```

The promise settles once: the first notification resolves it and drops the subscription, so
the second update in `load` above is not awaited — chain a second `waitForUpdate` call if you
need the final state. Create the subscription **before** the write starts: the default scheduler
delivers synchronously, so a `waitForUpdate` created after `load()` begins misses the first
publication. To await the final result of `load`, `await store.load(...)` (or the chained
second `waitForUpdate`) is what you want.
