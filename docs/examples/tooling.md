# Tooling examples

The tooling layer adds cross-cutting behaviors on top of any carburetor: undo/redo
(`CarburetorHistory`), storage mirroring (`persist`), Redux DevTools integration
(`connectDevTools`) and an awaitable update primitive (`waitForUpdate`). All examples are
class components — no hooks anywhere.

## Undo and redo

`CarburetorHistory` records every change made through a store and can step back and forward
through them. Attach it right after creating the store; it watches the store's patch stream,
so all later `this.update(...)` calls are captured automatically.

<!-- example:file examples/api/tooling/History.tsx -->
```tsx
import {AntiHookComponent, bind, Carburetor, CarburetorHistory, IHistoryOptions} from '@react-carburetor/core';
import {ReactElement} from 'react';

const increment = (draft: {count: number}): void => { draft.count += 1; };
const decrement = (draft: {count: number}): void => { draft.count -= 1; };

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind public increment(): void { this.update(increment); }
    @bind public decrement(): void { this.update(decrement); }
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

`flush(store)` or `flush(scope)` from testing also commits pending persistence synchronously,
ignoring any `throttleMs` window.

<!-- example:file examples/api/tooling/Persist.ts -->
```ts
import {bind, Carburetor, IPersistOptions, IStorageLike, persist} from '@react-carburetor/core';

class TodoCarburetor extends Carburetor<{items: string[]}> {
    @bind
    public add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const logPersistError = (error: unknown): void => { console.error('persist failed', error); };

const memoryStorage = (): IStorageLike => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string): string | null => items.get(key) ?? null,
        setItem: (key: string, value: string): void => { items.set(key, value); },
        removeItem: (key: string): void => { items.delete(key); },
    };
};

const store = new TodoCarburetor({items: []});
const options: IPersistOptions<{items: string[]}> = {
    key: 'todos',
    storage: memoryStorage(),
    coalesce: false,
    onError: logPersistError,
};
const stop = persist(store, options);

store.add('first');
stop();
```

The returned disposer stops persisting and flushes a pending write. Load and write errors
reach `onError`; without it a failed read throws. A malformed entry is removed and reported —
through the engine diagnostics in development, or the caller's `onError` (in production without
`onError` the removal is silent). A restore the store rejects is reported too, and the stored
data is removed only when the culprit is known — a single key or the single stored partition;
with several partitions every stored entry is kept (the culprit is unknown) and the failure is
only reported. `onCorrupt: 'reset'` makes persist remove an unparseable entry or one the store
rejects and keep writing the live state, instead of the default keep-and-stop-writing under
`version` or a function `prune`; it never applies to fallback keys, newer versions, failed
migrations, or throwing prune callbacks, and it cannot be combined with `partitions`.

After a successful restore from the current key, `writeAfterRestore` decides whether persist
writes the restored state back at connect: `'changed'` (the default) rewrites only when the
serialization a normal write would produce no longer matches the stored text — so prune,
migration, or default filling clean up stale entries right away instead of at the first change —
`'always'` rewrites after every restore from the key, and `'never'` opts out and keeps the old
write-only-on-change behaviour. The write never moves a `throttleMs` window and never applies
to a `previousKeys` fallback source, whose transfer write already covers it.

Two options bound the cost of mirroring large stores. `throttleMs` sets the minimum time
between storage writes: the first write still happens right away, later flushes wait out the
window, and the disposer writes a state still held back. `partitions` lists top-level branch
names to store under their own keys (`todos.items` next to `todos.filters`), rewriting only
the branches that changed — a flush then pays for the dirty partitions instead of the whole
state. The first write seals every partition once; restore composes the stored branches over
the current state, and a legacy single-key entry is still read when no partition entries
exist yet. A function `prune` callback receives migrated saved data before merging and the
current wire baseline. Its third argument, `merge(saved)`, opts into filling defaults and
pruning unknown keys; a callback that ignores it behaves as before.
`partitions` continues to reject `version`, `migrate`, and `prune`.

## Redux DevTools

`connectDevTools` publishes the state of the given carburetors to the Redux DevTools
extension and applies time travel back onto them. Each key of the object becomes a top-level
key of the published state; the `extension` option replaces the auto-discovered browser
extension, which is how tests and non-browser environments inject a stub. Every update
publishes one action per notifying store; a time-travel jump is never published back, even
when a deferring scheduler delivers the matching update after the jump.

<!-- example:file examples/api/tooling/DevTools.ts -->
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
} from '@react-carburetor/core';

const incrementCount = (draft: {count: number}): void => { draft.count += 1; };
const sendDevTools = (action: string, state: unknown): void => { console.log(action, state); };

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind
    public increment(): void { this.update(incrementCount); }
}

const store = new CounterCarburetor({count: 0});
store.increment();

class StubDevToolsExtension implements IDevToolsExtension {
    private listener: ((message: IDevToolsMessage) => void) | undefined;

    public connect(options: {name?: string}): IDevToolsConnection {
        return {
            init: (state: unknown): void => { console.log(options.name ?? '', state); },
            send: sendDevTools,
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

<!-- example:file examples/api/tooling/WaitForUpdate.ts#doc -->
```ts
class UserCarburetor extends Carburetor<{user: User | undefined; loading: boolean}> {
    @bind
    public async load(id: string): Promise<void> {
        this.draft.loading = true;
        this.emitUpdate();
        const user = await fetchUser(id);
        try {
            this.draft.user = user;
            this.draft.loading = false;
        } finally {
            this.emitUpdate();
        }
    }
}

export const store = new UserCarburetor({user: undefined, loading: false});

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
