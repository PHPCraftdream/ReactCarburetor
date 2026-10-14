# Resource examples

Async resources in React Carburetor come in three flavors: `ResourceCarburetor` (one value,
one carburetor), `ResourceCache` (many keyed entries with TTL, eviction and invalidation),
and any custom class implementing `IResourceSource`. All examples are class components —
no hooks anywhere.

## ResourceCarburetor

`ResourceCarburetor` wraps a single loader function. `load()` starts (or joins) a request,
and the component reads the whole `IResourceData` state with `this.useCarburetor()` to
subscribe, rendering from `view.status` / `view.data` / `view.error`.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind, EResourceStatus, ResourceCarburetor, TResourceLoader} from 'react-carburetor';
import {Component, type JSX} from 'react';

interface User {
    id: string;
    name: string;
}

declare function fetchUser(id: string): Promise<User>;

const userLoader: TResourceLoader<User, string> = (id: string, signal: AbortSignal) =>
    fetchUser(id).then((user: User) => {
        if (signal.aborted) {
            throw new Error('aborted');
        }
        return user;
    });

const userResource = new ResourceCarburetor<User, string>(userLoader);

export class UserProfile extends AntiHookComponent<{userId: string}> {
    @bind
    private loadUser(id: string): void {
        void userResource.load(id);
    }

    @bind
    private loadProfile(): void {
        this.loadUser(this.props.userId);
    }

    render(): JSX.Element {
        const view = this.useCarburetor(userResource);

        if (view.status === EResourceStatus.Pending) {
            return <span className="spinner">Loading…</span>;
        }
        if (view.status === EResourceStatus.Error) {
            return <span className="error">{view.error}</span>;
        }
        if (view.status === EResourceStatus.Success && view.data !== undefined) {
            return <h1>{view.data.name}</h1>;
        }
        return (
            <button type="button" onClick={this.loadProfile}>
                Load profile
            </button>
        );
    }
}
```

Calling `load()` again with different args aborts the previous request automatically; call
`abort()` yourself only to cancel without starting a new one.

For shell-style layouts, `suspend()` reads the value or throws the in-flight promise / the
raw failure, so a `<Suspense>` boundary and an error boundary handle the waiting and the
failure. The component must still call `this.useCarburetor(resource)` — `suspend()` never
subscribes on its own.

<!-- example:compile -->
```tsx
import {AntiHookComponent, EResourceStatus, IResourceData, ResourceCarburetor} from 'react-carburetor';
import {Component, ReactNode, Suspense, type JSX} from 'react';

interface Config {
    theme: string;
}

declare function fetchConfig(): Promise<Config>;

const configResource = new ResourceCarburetor<Config, void>(
    (_args: void, _signal: AbortSignal) => fetchConfig()
);

class ConfigErrorBoundary extends Component<{children?: ReactNode}, {error: string | undefined}> {
    public state = {error: undefined as string | undefined};

    public static getDerivedStateFromError(error: unknown): {error: string} {
        return {error: error instanceof Error ? error.message : String(error)};
    }

    render(): JSX.Element {
        if (this.state.error !== undefined) {
            return <span className="error">Config failed: {this.state.error}</span>;
        }
        return <>{this.props.children}</>;
    }
}

export class ConfigView extends AntiHookComponent {
    render(): JSX.Element {
        const value: Config = configResource.suspend(undefined);
        this.useCarburetor(configResource);
        return <span className="theme">{value.theme}</span>;
    }
}

export class ConfigShell extends AntiHookComponent {
    render(): JSX.Element {
        return (
            <ConfigErrorBoundary>
                <Suspense fallback={<span className="spinner">Loading…</span>}>
                    <ConfigView />
                </Suspense>
            </ConfigErrorBoundary>
        );
    }
}

export const describeResourceState = (view: IResourceData<Config>): string =>
    view.status === EResourceStatus.Success ? view.data?.theme ?? '' : '';
```

While `error` in the state is a string, the raw rejection value stays available through
`getLastError()` for logging; `reload()` repeats the last `load()` with the same args.

## ResourceCache

`ResourceCache` keys entries by the `args` you pass, so one cache can serve a whole list.
`resolve(args)` gives you the key, path and `IResourceView` in one call, and
`this.useResource(cache, args)` subscribes to the entry path and triggers the load after
commit when the entry is stale.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind, EResourceStatus, IResourceView, ResourceCache} from 'react-carburetor';
import {Component, type JSX} from 'react';

interface Post {
    id: string;
    title: string;
}

declare function fetchPost(id: string): Promise<Post>;

const postCache = new ResourceCache<Post, string>((id: string, _signal: AbortSignal) => fetchPost(id));

export class PostList extends AntiHookComponent<{postIds: string[]}> {
    render(): JSX.Element {
        return (
            <ul>
                {this.props.postIds.map((id: string): JSX.Element => <PostListItem key={id} postId={id} />)}
            </ul>
        );
    }
}

class PostListItem extends AntiHookComponent<{postId: string}> {
    @bind
    private refresh(): void {
        void postCache.refresh(this.props.postId);
    }

    render(): JSX.Element {
        const view: IResourceView<Post> = postCache.resolve(this.props.postId).view;
        return (
            <li className={view.stale ? 'stale' : undefined}>
                <button type="button" onClick={this.refresh}>↻</button>
                <PostRow postId={this.props.postId} />
            </li>
        );
    }
}

class PostRow extends AntiHookComponent<{postId: string}> {
    render(): JSX.Element {
        const view = this.useResource(postCache, this.props.postId);
        if (view.status === EResourceStatus.Success && view.data !== undefined) {
            return <span className="title">{view.data.title}</span>;
        }
        return <span className="status">{view.status}</span>;
    }
}
```

A stale entry keeps rendering its old data while the refetch runs — the UI never blanks.

`ResourceCache` also supports the Suspense read. `suspend(args)` throws the in-flight
promise while pending; pair it with `this.useResource(cache, args)` so the component
actually subscribes and triggers the load.

<!-- example:compile -->
```tsx
import {AntiHookComponent, EResourceStatus, ResourceCache} from 'react-carburetor';
import {Component, ReactNode, Suspense, type JSX} from 'react';

interface Avatar {
    url: string;
}

declare function fetchAvatar(userId: string): Promise<Avatar>;

const avatarCache = new ResourceCache<Avatar, string>((userId: string) => fetchAvatar(userId));

class AvatarBoundary extends Component<{children?: ReactNode}, {error: unknown}> {
    public state = {error: undefined as unknown};

    public static getDerivedStateFromError(error: unknown): {error: unknown} {
        return {error};
    }

    render(): JSX.Element {
        if (this.state.error !== undefined) {
            return <span className="error">Avatar failed to load</span>;
        }
        return <>{this.props.children}</>;
    }
}

export class AvatarImage extends AntiHookComponent<{userId: string}> {
    render(): JSX.Element {
        const avatar: Avatar = avatarCache.suspend(this.props.userId);
        this.useResource(avatarCache, this.props.userId);
        return <img className="avatar" src={avatar.url} alt="" />;
    }
}

export class AvatarWithFallback extends AntiHookComponent<{userId: string}> {
    render(): JSX.Element {
        return (
            <AvatarBoundary>
                <Suspense fallback={<span className="spinner">…</span>}>
                    <AvatarImage userId={this.props.userId} />
                </Suspense>
            </AvatarBoundary>
        );
    }
}

export const isAvatarError = (view: {status: EResourceStatus}): boolean =>
    view.status === EResourceStatus.Error;
```

If you skip the `useResource()` call the value renders once but the component never
re-renders when the entry changes.

`ttl` and `maxEntries` in `IResourceCacheOptions` give you time-based freshness and
memory bounds: entries older than `ttl` go stale (refetched after the next commit) and
least-recently-used unretained entries are evicted beyond `maxEntries`.

<!-- example:compile -->
```ts
import {EResourceStatus, IResourceCacheData, IResourceCacheOptions, IResourceEntry, ResourceCache} from 'react-carburetor';

interface Quote {
    text: string;
}

declare function fetchQuote(symbol: string): Promise<Quote>;

const quoteOptions: IResourceCacheOptions = {ttl: 30_000, maxEntries: 100, keyCacheSize: 256};

const quoteCache = new ResourceCache<Quote, string>(
    (symbol: string, _signal: AbortSignal) => fetchQuote(symbol),
    quoteOptions
);

export const quoteSnapshot = (symbol: string): IResourceCacheData<Quote>['entries'] => {
    const view = quoteCache.getEntry(symbol);
    const entry: IResourceEntry<Quote> = {
        status: view.status === EResourceStatus.Success ? EResourceStatus.Success : EResourceStatus.Idle,
        data: view.data,
        error: view.error,
        updatedAt: view.updatedAt,
        refreshing: view.refreshing,
        invalidated: view.invalidated,
        failed: view.failed,
    };
    return {[symbol]: entry};
};
```

`keyCacheSize` bounds the internal args→key map; raise it only for very hot caches.

After a mutation, mark the affected entries stale so the next render refetches them while
the old data stays on screen. `invalidate(args)` targets one entry, `invalidateAll()` all
of them.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind, ResourceCache} from 'react-carburetor';
import {Component, type JSX} from 'react';

interface Settings {
    displayName: string;
}

declare function fetchSettings(userId: string): Promise<Settings>;
declare function saveSettings(userId: string, next: Settings): Promise<void>;

const settingsCache = new ResourceCache<Settings, string>((userId: string) => fetchSettings(userId));

export class SettingsPanel extends AntiHookComponent<{userId: string}> {
    @bind
    private rename(nextName: string): void {
        void saveSettings(this.props.userId, {displayName: nextName}).then((): void => {
            settingsCache.invalidate(this.props.userId);
        });
    }

    @bind
    private reloadEverything(): void {
        settingsCache.invalidateAll();
    }

    render(): JSX.Element {
        return (
            <div>
                <RenameForm onRename={this.rename} />
                <button type="button" onClick={this.reloadEverything}>Refresh all</button>
            </div>
        );
    }
}

class RenameForm extends Component<{onRename: (name: string) => void}> {
    render(): JSX.Element {
        return <span className="rename-form" data-name={this.props.onRename.name} />;
    }
}
```

Invalidating is not forgetting: the data remains readable while the refetch is scheduled.

An entry can fail; the state's `error` is only a string, so use `getFailure(args)` when
you need the raw rejection (an `Error`, a server payload, whatever the loader threw).

<!-- example:compile -->
```ts
import {EResourceStatus, IResourceView, ResourceCache} from 'react-carburetor';

interface Report {
    rows: string[];
}

declare function fetchReport(period: string): Promise<Report>;

const reportCache = new ResourceCache<Report, string>((period: string) => fetchReport(period));

export const describeReportFailure = (period: string): string => {
    const view: IResourceView<Report> = reportCache.getEntry(period);
    if (view.status !== EResourceStatus.Error || !view.failed) {
        return 'no failure';
    }
    const failure: unknown = reportCache.getFailure(period);
    return failure instanceof Error ? failure.message : String(failure);
};
```

`getFailure` may return `undefined` when the entry has not failed — check `failed` first.

To remove entries entirely (and cancel their in-flight requests), use `forget(args)` and
`forgetAll()` — for example on logout or when leaving a route.

<!-- example:compile -->
```ts
import {ResourceCache} from 'react-carburetor';

interface Draft {
    body: string;
}

declare function fetchDraft(id: string): Promise<Draft>;

const draftCache = new ResourceCache<Draft, string>((id: string) => fetchDraft(id));

export function dropDraft(id: string): void {
    draftCache.forget(id);
}

export function dropAllDrafts(): void {
    draftCache.forgetAll();
}
```

`forget` is destructive — invalidated entries refetch on next render, forgotten ones
reload from scratch (or render `Idle` until a read triggers them again).

## Custom resource source

Anything with `resolve()` + `load()` (plus the subscription surface `Carburetor` already
provides) works as a resource source: extend `Carburetor` with your own data shape,
implement `IResourceSource`, and read it with `this.useResource(source, args)`.

<!-- example:compile -->
```tsx
import {AntiHookComponent, Carburetor, EResourceStatus, IDict, IResourceResolution, IResourceSource, IResourceView} from 'react-carburetor';
import {Component, type JSX} from 'react';

interface Label {
    id: string;
    text: string;
}

declare function fetchLabel(id: string): Promise<Label>;

interface ILabelEntry {
    status: EResourceStatus;
    value: Label | undefined;
}

interface ILabelSourceData {
    entries: IDict<ILabelEntry>;
}

export class LabelSource extends Carburetor<ILabelSourceData> implements IResourceSource<Label, string> {
    public constructor() {
        super({entries: {}});
    }

    public resolve(id: string): IResourceResolution<Label> {
        const entry = this.data.entries[id];
        const view: IResourceView<Label> = {
            status: entry?.status ?? EResourceStatus.Idle,
            data: entry?.value,
            error: undefined,
            updatedAt: undefined,
            refreshing: false,
            invalidated: false,
            failed: false,
            stale: entry === undefined,
        };
        return {key: id, path: `entries.${id}`, view};
    }

    public load(id: string): Promise<void> {
        this.draft.entries[id] = {status: EResourceStatus.Pending, value: undefined};
        this.emitUpdate();
        return fetchLabel(id).then((label: Label): void => {
            this.draft.entries[id] = {status: EResourceStatus.Success, value: label};
            this.emitUpdate();
        });
    }
}

const labelSource = new LabelSource();

export class LabelChip extends AntiHookComponent<{labelId: string}> {
    render(): JSX.Element {
        const view = this.useResource(labelSource, this.props.labelId);
        if (view.status === EResourceStatus.Success && view.data !== undefined) {
            return <span className="chip">{view.data.text}</span>;
        }
        return <span className="chip">{view.status}</span>;
    }
}
```

Your `view` must fill every `IResourceView` field, including the entry flags — a missing
field shows up only at runtime, not at compile time.

## Types

`IResourceSnapshot<T>` is what `snapshot()` returns and `restore()` takes — pass it
across a serialization boundary (postMessage, storage, server payload) and back.

<!-- example:compile -->
```ts
import {IResourceSnapshot, ResourceCarburetor} from 'react-carburetor';

interface Currency {
    code: string;
    rate: number;
}

declare function fetchRate(code: string): Promise<Currency>;

const rateResource = new ResourceCarburetor<Currency, string>((code: string) => fetchRate(code));

export function exportRates(): Array<{id: string; snapshot: IResourceSnapshot<Currency>}> {
    void rateResource.load('EUR');
    return [{id: 'rates', snapshot: rateResource.snapshot()}];
}

export function importRates(payload: IResourceSnapshot<Currency>): void {
    rateResource.restore(payload);
}
```

A snapshot is a plain tree, so `JSON.stringify`/`parse` round-trips it — no live
references cross the boundary.

`getInitialResourceData()` gives the pristine `IResourceData` shape — handy to reset a
custom carburetor or to seed your own data structure.

<!-- example:compile -->
```ts
import {Carburetor, getInitialResourceData, IResourceData} from 'react-carburetor';

interface Session {
    token: string;
}

class SessionStore extends Carburetor<{current: IResourceData<Session>}> {
    public constructor() {
        super({current: getInitialResourceData<Session>()});
    }

    public reset(): void {
        this.update((draft) => {
            draft.current = getInitialResourceData<Session>();
        });
    }
}
```

The initial data starts as `Idle` with `data`, `error` and `updatedAt` all `undefined`.
