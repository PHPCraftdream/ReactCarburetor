# Hooks (interop)

The hooks re-exported from `react-carburetor/interop` are the **only hooks API** in the
library. They are the bridge for hooks-based code — a router shell, a third-party UI kit,
an existing hooks codebase — while the engine itself needs no hooks at all. Stores are
still classes extending `Carburetor` from `'react-carburetor'`; these hooks only change
how components read them. All examples are compatible with React 18 and 19.

Reminders that apply to every store below: no arrow-function class fields, decorate any
method you pass around as a value with `@bind`, and write state through
`this.update(updater)` where `updater` is a module-level function; use direct draft writes plus `emitUpdate()` if the update needs a member parameter.

## Reading with a selector

`useCarburetorValue(carburetor, select, isEqual?)` subscribes to exactly the paths the
selector reads. The selector runs on a tracked readonly view, and the component gets back a
borrowed readonly selection: do not mutate it. To edit it, copy first (`{...selected}`) — the
plain projection is cached for equality comparison, and a mutation can corrupt that comparison
baseline (see "Selection results and ownership" in the README).
Use it whenever a function component needs a slice of a store.

<!-- example:file examples/interop/selectors/ProfileName.tsx#name -->
```tsx
import type {ReactElement} from 'react';
import {Carburetor, bind} from 'react-carburetor';
import {useCarburetorValue} from 'react-carburetor/interop';

class ProfileCarburetor extends Carburetor<{name: string; email: string}> {
    public constructor() {
        super({name: 'Ada Lovelace', email: 'ada@example.com'});
    }

    @bind
    public rename(name: string): void {
        this.draft.name = name;
        this.emitUpdate();
    }
}

const profile = new ProfileCarburetor();

const selectName = (profile: {name: string; email: string}): string => profile.name;

function ProfileName(): ReactElement {
    const name = useCarburetorValue(profile, selectName);
    return <span>{name}</span>;
}
```

Only `name` is read, so a write to `email` alone never re-renders `ProfileName`.

Selecting a live class instance throws — select plain fields, or a plain object built
from fields.

A selector may build a small derived object from the fields it reads; the custom
`isEqual` decides when React actually re-renders on top of the structural default.

<!-- example:file examples/interop/selectors/ProfileLabel.tsx#label -->
```tsx
import type {ReactElement} from 'react';
import {Carburetor} from 'react-carburetor';
import {TValueComparator, useCarburetorValue} from 'react-carburetor/interop';

class ProfileCarburetor extends Carburetor<{name: string; email: string}> {
    public constructor() {
        super({name: 'Ada Lovelace', email: 'ada@example.com'});
    }
}

const profile = new ProfileCarburetor();

const sameLabel: TValueComparator<{label: string}> =
    (a, b) => a.label === b.label;

const selectLabel = (p: {name: string; email: string}): {label: string} => ({label: p.name.toUpperCase()});

function ProfileLabel(): ReactElement {
    const view = useCarburetorValue(
        profile,
        selectLabel,
        sameLabel,
    );
    return <span>{view.label}</span>;
}
```

A new object is allocated per selector run; without the comparator the structural
default already avoids re-renders when its contents are equal.

## Comparing results

Pass `isEqual` explicitly when the default structural comparison is not what you want.
For a returned array of ids, a shallow element-wise comparison keeps re-renders tied to
actual membership changes:

<!-- example:file examples/interop/selectors/IdList.tsx#ids -->
```tsx
import type {ReactElement} from 'react';
import {Carburetor} from 'react-carburetor';
import {TSelector, TValueComparator, useCarburetorValue} from 'react-carburetor/interop';

class SelectionCarburetor extends Carburetor<{ids: number[]}> {
    public constructor() {
        super({ids: [1, 2, 3]});
    }
}

const selection = new SelectionCarburetor();

const selectIds: TSelector<{ids: number[]}, readonly number[]> = (view) => view.ids;

const sameIds: TValueComparator<readonly number[]> = (a, b) =>
    a.length === b.length && a.every((id, index) => id === b[index]);

const renderId = (id: number): ReactElement => <li key={id}>{id}</li>;
function IdList(): ReactElement {
    const ids = useCarburetorValue(selection, selectIds, sameIds);
    return <ul>{ids.map(renderId)}</ul>;
}
```

For values you want compared by reference only, pass `Object.is`:

<!-- example:file examples/interop/selectors/Count.tsx#count -->
```tsx
import type {ReactElement} from 'react';
import {Carburetor} from 'react-carburetor';
import {useCarburetorValue} from 'react-carburetor/interop';

class CounterCarburetor extends Carburetor<{count: number}> {
    public constructor() {
        super({count: 0});
    }
}

const counter = new CounterCarburetor();

const selectCount = (counter: {count: number}): number => counter.count;

function Count(): ReactElement {
    const count = useCarburetorValue(counter, selectCount, Object.is);
    return <span>{count}</span>;
}
```

The default comparison is structural and receives **detached** values, so a custom
comparator such as `Object.is` must decide equality on copies, not live references.

## Live computed values

`useComputedValue(computed)` reads a `Computed` publication from
`'react-carburetor'`. Unlike `useCarburetorValue` — which hands you a detached copy —
the returned value stays **live**: the hook caches a versioned snapshot record and
detects publications without cloning. A scalar result is compared by value, so passing it to a
memoized child is safe. A mutable or native object result can keep the same identity across
publications, so a memoized child that receives it as a prop may skip a re-render; pass a
detached projection of objects and arrays instead (see "Derived lists" in the README).

<!-- example:file examples/interop/computed/CounterView.tsx#view -->
```tsx
import {memo, type ReactElement} from 'react';
import {Carburetor, Computed} from 'react-carburetor';
import {useComputedValue, useCarburetorValue} from 'react-carburetor/interop';

class CounterCarburetor extends Carburetor<{count: number}> {
    public constructor() {
        super({count: 0});
    }
}

const counter = new CounterCarburetor();
const doubled = new Computed((read) => read(counter).count * 2);

const DoubledLabel = memo(function DoubledLabel({value}: {value: number}): ReactElement {
    return <span>{value}</span>;
});

const selectCounterCount = (c: {count: number}): number => c.count;

function CounterView(): ReactElement {
    const count = useCarburetorValue(counter, selectCounterCount);
    const value = useComputedValue(doubled);
    return (
        <div>
            <span>{count}</span>
            <DoubledLabel value={value} />
        </div>
    );
}
```

`DoubledLabel` re-renders only when `doubled` republishes; writes that leave
`count * 2` unchanged wake nobody.

Prefer `useComputedValue` over selecting the same arithmetic in every component: the
computation lives in one place, is memoized against the paths it actually reads, and keeps a
stable identity between publications for scalar or otherwise immutable results.

## Reading a resource entry

`useResourceValue(source, args, select, isEqual?)` reads one entry of a resource
source — `ResourceCache` implements the required `IResourceSource` interface. The
selector runs synchronously on every render over the entry view (`IResourceView<T>`,
which carries `status`, `data`, `error`, and friends); the load itself starts only
after the commit, never during render. Select only the fields you render.

<!-- example:file examples/interop/resources/UserName.tsx#name -->
```tsx
import type {ReactElement} from 'react';
import {ResourceCache} from 'react-carburetor';
import {useResourceValue} from 'react-carburetor/interop';

interface User {
    id: number;
    name: string;
}

declare function fetchUser(id: number): Promise<User>;

const userCache = new ResourceCache<User, [number]>(async (id) => fetchUser(id));

const selectUserName = (entry: {data?: User}): string | undefined => entry.data?.name;

function UserName({userId}: {userId: number}): ReactElement {
    const name = useResourceValue(userCache, [userId], selectUserName);
    return <span>{name ?? '…'}</span>;
}
```

Do not call the loader during render — the hook owns when the load starts.

Status is just another field of the entry view, so a parent component can render a
spinner while the same entry is `Pending`. Read the derived `isPending` flag off the
entry — it mirrors `status`, exactly one of `isIdle`/`isPending`/`isSuccess`/`isError`
is true:

<!-- example:file examples/interop/resources/UserStatusCard.tsx#status -->
```tsx
import type {ReactElement} from 'react';
import {ResourceCache} from 'react-carburetor';
import {useResourceValue} from 'react-carburetor/interop';

interface User {
    id: number;
    name: string;
}

declare function fetchUser(id: number): Promise<User>;

const userCache = new ResourceCache<User, [number]>(async (id) => fetchUser(id));

const selectPending = (entry: {isPending: boolean}): boolean => entry.isPending;

function UserStatus({userId}: {userId: number}): ReactElement | null {
    const isPending = useResourceValue(userCache, [userId], selectPending);
    if (isPending) return <div className="spinner" />;
    return null;
}

const selectCard = (entry: {isPending: boolean; data?: User}) => ({isPending: entry.isPending, name: entry.data?.name});

function UserCard({userId}: {userId: number}): ReactElement {
    const view = useResourceValue(userCache, [userId], selectCard);
    if (view.isPending) return <div className="spinner" />;
    return <span>{view.name ?? 'unknown'}</span>;
}
```

The two hooks above share the same cache entry, so the second read never triggers a
second fetch — the cache deduplicates by the serialized `args`.

## Types

The interop entry point re-exports `TSelector` and `TValueComparator`; annotate shared
selectors and comparators with them instead of repeating inline parameter types:

<!-- example:file examples/interop/types/Models.ts#shared -->
```ts
import {TSelector, TValueComparator} from 'react-carburetor/interop';

interface Settings {
    ids: number[];
    title: string;
}

export const selectIds: TSelector<Settings, readonly number[]> = (view) => view.ids;

export const sameIds: TValueComparator<readonly number[]> = (a, b) =>
    a.length === b.length && a.every((id, index) => id === b[index]);
```

Annotated selectors can be hoisted to module scope and shared across components.
