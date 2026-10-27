# Stores

`Carburetor` is the store: it wraps a plain state object, records which paths each
read touches, and wakes only the subscribers a write actually concerns. This page
covers the store part of the public API outside React — construction, writes,
subscriptions, snapshots and the small utilities that ship with it.

All examples import from `'@react-carburetor/core'` and compile standalone. External
I/O is stubbed with `declare` where it appears.

## Creating a store

<!-- example:file examples/api/stores/construction/counter.ts#creating-store -->
```ts
import {Carburetor, ICarburetor} from '@react-carburetor/core';

const increment = (draft: {value: number}): void => { draft.value += 1; };

class CounterStore extends Carburetor<{value: number}> {
    public increment(): void { this.update(increment); }
}

const counterStore = new CounterStore({value: 0});
const counter: ICarburetor<{value: number}> = counterStore; // the full contract, kept narrow for consumers
counterStore.increment();
```

The first constructor argument is the initial state; writes go through
`update`, which mutates a draft and publishes the changed paths in one step.
Prefer `update` over writing to `draft` by hand: it cannot forget the emit.

Pitfall: `update` requires a synchronous body — an `await` inside it leaves the
later writes unpublished.

## getVersion

<!-- example:file examples/api/stores/read-write/get-version.ts#get-version -->
```ts
import {Carburetor} from '@react-carburetor/core';

const store = new Carburetor({value: 0});

const before: number = store.getVersion();
store.setData({value: 1});
const after: number = store.getVersion();

console.log(after > before); // true: every published write bumps the version
```

`getVersion()` is the store's write counter. Tooling compares it between two
moments to detect that a write landed in between, without inspecting the data.

## A custom update scheduler

<!-- example:file examples/api/stores/construction/scheduler.ts#scheduler -->
```ts
import {Carburetor, IUpdateScheduler, TUpdater} from '@react-carburetor/core';

/** Delivers every update on the next macrotask instead of synchronously. */
class NextTickScheduler implements IUpdateScheduler {
    private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    public schedule(uid: string, updater: TUpdater): void {
        this.cancel(uid);
        this.timers.set(uid, setTimeout(updater, 0));
    }

    public cancel(uid: string): void {
        const timer = this.timers.get(uid);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(uid);
        }
    }
}

const store = new Carburetor({tick: 0}, new NextTickScheduler());
store.setData({tick: 1});
```

The second constructor argument is the delivery policy: an `IUpdateScheduler`
decides *when* a matched subscriber's callback runs. The default delivers
immediately; implement your own when updates need deferring or coalescing.

## ComponentUpdateThrottle

<!-- example:file examples/api/stores/construction/throttle.ts#throttle -->
```ts
import {Carburetor, ComponentUpdateThrottle} from '@react-carburetor/core';

interface ICursor {x: number; y: number}

// At most one notification per subscriber per 40 ms, no matter how many writes land.
const throttle = new ComponentUpdateThrottle(40);
const cursorStore = new Carburetor<ICursor>({x: 0, y: 0}, throttle);

cursorStore.setData({x: 1, y: 1});
cursorStore.setData({x: 2, y: 2}); // coalesced into one flush with the write above
```

`ComponentUpdateThrottle` is the built-in scheduler for streaming sources —
sockets, `mousemove`, presence cursors — where many writes arrive in separate
ticks and collapsing them into one delivery genuinely helps. Regular UI does
not need it: the default is immediate delivery.

The same scheduler can be passed through the options-object constructor form,
where `{scheduler}` carries the identical delivery policy.

<!-- example:file examples/api/stores/construction/scheduler-options.ts#scheduler-options -->
```ts
import {Carburetor, ICarburetorOptions, UpdateThrottle} from '@react-carburetor/core';

interface ICursor {x: number; y: number}

// The options-object form carries the same delivery policy as the positional
// argument, spelled as construction options.
const options: ICarburetorOptions = {scheduler: new UpdateThrottle(40)};
const cursorStore = new Carburetor<ICursor>({x: 0, y: 0}, options);

cursorStore.setData({x: 1, y: 1});
```

Pitfall: the throttle delivers on a timer, so tests and components must wait
for the window (at least `updateTimeout` ms) before asserting.

## Raw writes and markAllChanged

<!-- example:file examples/api/stores/construction/raw-writes.ts#raw-writes -->
```ts
import {Carburetor, IDict} from '@react-carburetor/core';

interface IUser {name: string}

class UserStore extends Carburetor<IDict<IUser>> {
    /** Replaces an entry's object wholesale through a raw reference from the server. */
    public replaceRaw(id: string, user: IUser): void {
        this.draft[id] = {name: 'written through draft'};
        // A write made outside draft does not record a path; publish it deliberately.
        // carburetor-disable-next-line carburetor/no-external-data-mutation -- raw write, published by markAllChanged()
        this.getData()[id].name = user.name;
        this.markAllChanged();
        this.emitUpdate();
    }
}

const store = new UserStore({u1: {name: 'ada'}});
store.replaceRaw('u1', {name: 'grace'});
console.log(store.getData().u1.name); // 'grace'
```

`draft` and `markAllChanged` are protected, so this pattern lives inside a
store method. Without `markAllChanged()` the raw write still mutates the data
but wakes nobody; with a draft write in the same emit it would wake no one at
all. This deliberately demonstrates a low-level raw mutation and is an intentional
lint finding for `markAllChanged`.

Pitfall: this escape hatch is for writes that genuinely bypass draft (server
hydrated objects, external mutation). Ordinary writes belong in `draft`.

## setData and getData

<!-- example:file examples/api/stores/read-write/set-get-data.ts#set-get-data -->
```ts
import {Carburetor} from '@react-carburetor/core';

const store = new Carburetor({items: ['a'], done: false});

const current = store.getData();        // raw, untracked state — reads subscribe to nothing
store.setData({...current, done: true}); // adopts the new root wholesale
```

`setData` swaps the whole root and wakes the readers of the paths that
actually changed — it diffs the replacement against the old root, so an equal
replacement wakes nobody; `getData` returns the raw state for code outside
render. Use them for full replacements — hydration, resets; a deliberate
write that must wake everyone, including readers of unchanged paths, calls
the protected `markAllChanged()` inside a store method (see
["Raw writes and markAllChanged"](#raw-writes-and-markallchanged) above).

## read: the tracked read API

<!-- example:file examples/api/stores/read-write/read-api.ts#read-api -->
```ts
import {Carburetor} from '@react-carburetor/core';

const store = new Carburetor({user: {name: 'ada', age: 36}});

const readPaths: string[] = [];
const view = store.read((path) => readPaths.push(path));
const name: string = view.user.name;

console.log(name);       // 'ada'
console.log(readPaths);  // ['user', 'user.name'] — exactly what the read touched
```

`read(record)` returns the state behind a read proxy that reports every path
the caller touches. This is the same mechanism the React hooks bridge uses;
engine-level tooling (custom bridges, trackers) consumes it directly.

Pitfall: `record` receives internal path strings. Read them, never parse or
build them — the grammar is not a stable format.

## watch: subscribe to a selection

<!-- example:file examples/api/stores/observe/watch-api.ts#watch-api -->
```ts
import {Carburetor, TDisposer, TReadonly, TSelector} from '@react-carburetor/core';

const store = new Carburetor({items: [{done: false}, {done: true}]});

const isDone = (item: {done: boolean}): boolean => item.done;
const select: TSelector<{items: {done: boolean}[]}, number> = (data) => data.items.filter(isDone).length;

const disposer: TDisposer = store.watch(
    select,
    (next: TReadonly<number>, previous: TReadonly<number>) => {
        console.log(previous, '->', next);
    }
);

store.setData({items: [{done: true}, {done: true}]}); // selection changes 1 -> 2, so onChange fires

disposer(); // stop watching; never fires again
```

`watch(select, onChange)` runs `select` against a tracked read view: its reads
become the subscription's read set, and `onChange(next, previous)` fires only
when the selection actually changed — never on the initial call. Prefer it
over `subscribe` unless you need every write.

Pitfall: selected plain objects/arrays are borrowed readonly projections used
as a comparison baseline — copy before editing.

## subscribe and unsubscribe

<!-- example:file examples/api/stores/observe/subscribe-api.ts#subscribe-api -->
```ts
import {Carburetor, ICarburetorSubscription, ISubscribeOptions, TSubscriber} from '@react-carburetor/core';

const store = new Carburetor({value: 0});
const logging: ICarburetorSubscription = store; // the subscription surface every store has

const onWrite: TSubscriber = () => console.log('value is now', store.getData().value);

// Options are optional; here a stable id (re-subscribing with it replaces this
// registration) and the default read set — every write.
const options: ISubscribeOptions = {id: 'logger'};
const id: string = store.subscribe(onWrite, options);

store.setData({value: 1}); // logs 'value is now 1'
store.unsubscribe(id);     // also cancels an update already scheduled for it
store.setData({value: 2}); // nothing logged
console.log(logging.getUID() === store.getUID()); // true
```

`subscribe(callback, options?)` registers a callback outside React and returns
a store-local id; `unsubscribe(id)` removes it. With no `reads` option the
subscriber hears every write — the right choice for history, persistence and
devtools. A throwing callback does not stop the other subscribers.

## snapshot and restore

<!-- example:file examples/api/stores/persistence/snapshot-restore.ts#snapshot-restore -->
```ts
import {Carburetor} from '@react-carburetor/core';

const store = new Carburetor({count: 1, tags: ['a']});

const checkpoint = store.snapshot();
store.setData({...checkpoint, count: 99, tags: [...checkpoint.tags, 'b']});
console.log(checkpoint.tags.length); // 1 — the snapshot is detached

store.restore(checkpoint);
console.log(store.getData()); // {count: 1, tags: ['a']}
```

`snapshot()` returns a detached deep copy of the plain state; `restore(data)`
installs a previously taken snapshot, diffing it through draft so subscribers
hear only the paths that actually changed. Restore keeps native values
(`Map`, `Set`, `Date`, class instances) shared by reference — the same
boundary `snapshot()` uses.

Pitfall: never mutate a live `getData()` result after passing it to
`restore` expecting the old state back — restore reads the argument but
installs its own copy.

## deepClone

<!-- example:file examples/api/stores/utilities/deep-clone.ts#deep-clone -->
```ts
import {Carburetor, deepClone} from '@react-carburetor/core';

const store = new Carburetor({profile: {name: 'ada'}});

const offline = deepClone(store.getData()); // a standalone copy, no store involved
offline.profile.name = 'local edit';

console.log(store.getData().profile.name); // 'ada' — untouched
```

`deepClone` copies plain objects and arrays deeply; native values and class
instances are carried over by reference, exactly like `snapshot()`. Use it to
detach data before handing it to code that must not touch live state.

## toJSON and fromJSON

<!-- example:file examples/api/stores/persistence/json.ts#json -->
```ts
import {Carburetor, IInspectable} from '@react-carburetor/core';

const store = new Carburetor({value: 1});

const wire: IInspectable = store; // the tooling surface: JSON in and out, no data type

const saved: unknown = wire.toJSON();
console.log(JSON.stringify(saved)); // '{"value":1}'

wire.fromJSON(JSON.parse('{"value":42}'));
console.log(store.getData().value); // 42
```

`toJSON()` returns the live state as it stands (a detached copy is
`snapshot()`); `fromJSON(value)` adopts freshly parsed JSON directly, without
copying it — the store keeps the exact object parsed. Together they are the
persistence contract devtools and storage layers program against.

Pitfall: `fromJSON` keeps the passed object as the live state, so parse
freshly for each call instead of reusing a cached object.

## transaction: many writes, one delivery

<!-- example:file examples/api/stores/utilities/transaction.ts#transaction -->
```ts
import {Carburetor, transaction} from '@react-carburetor/core';

const profile = new Carburetor({name: 'ada'});
const settings = new Carburetor({theme: 'light'});

// Both stores' writes land before any subscriber runs: observers see the
// consistent pair, never the intermediate state.
transaction(() => {
    profile.setData({name: 'grace'});
    settings.setData({theme: 'dark'});
});

console.log(profile.getData().name, settings.getData().theme); // 'grace dark'
```

`transaction(body)` runs a synchronous block as one update: every write inside
it is delivered once, after the body returns. Use it when several stores (or
several writes) must become visible together.

Pitfall: the batch closes when the body returns — an async body only covers
the part before its first await.

## shallowEqual

<!-- example:file examples/api/stores/utilities/shallow-equal.ts#shallow-equal -->
```ts
import {shallowEqual} from '@react-carburetor/core';

console.log(shallowEqual({a: 1, b: 2}, {a: 1, b: 2}));  // true
console.log(shallowEqual({a: {b: 1}}, {a: {b: 1}}));    // false: nested objects by reference
console.log(shallowEqual([1, 2], [1, 2]));              // true: arrays get a dedicated loop
```

`shallowEqual` compares two objects one level deep with `Object.is` — the same
semantics React's bailout uses. Reach for it in custom `shouldComponentUpdate`
implementations or `equals` options, not for comparing store state (tracking
already does that precisely).

## Diagnostics

<!-- example:file examples/api/stores/utilities/diagnostics.ts#diagnostics -->
```ts
import {Diagnostics, diagnostics} from '@react-carburetor/core';

// The shared instance the engine reports misuse through.
diagnostics.setEnabled(true);
diagnostics.report('a demonstration complaint'); // console.error: 'Carburetor: ...'

// Or run an isolated channel of your own, e.g. for a test harness.
const quiet = new Diagnostics();
quiet.setEnabled(false);
quiet.report('never printed');
```

`Diagnostics` is the development-only complaint channel — an unpublished draft
write, an async `transaction` body — on in development, off in production,
switchable either way. Use the shared `diagnostics` instance unless you need
an isolated channel.

## Typing a store for consumers

<!-- example:file examples/api/stores/utilities/contracts.ts#typing -->
```ts
import {
    Carburetor,
    ICarburetor,
    IReadableCarburetor,
    IPatchSource, // unstable, do not implement: internal engine protocol, no stability guarantee
} from '@react-carburetor/core';

interface IState {value: number}

const ignorePath = (_path: string): void => {};

/** Read-only consumers (trackers, telemetry) accept the narrow interface. */
function observe(source: IReadableCarburetor<IState>): void {
    source.read(ignorePath);
}

/** History tooling additionally needs the unstable patch surface. */
function attachHistory(source: ICarburetor<IState> & IPatchSource): void {
    void source;
}

const store = new Carburetor<IState>({value: 0});
observe(store);
attachHistory(store);
```

`ICarburetor<T>` is the full store contract; `IReadableCarburetor<T>` and
`IInspectable` slice it down for consumers that need only reads, or only
JSON/snapshot tooling. Accept the narrowest interface that works — it keeps
functions usable with derived and scoped sources too.
