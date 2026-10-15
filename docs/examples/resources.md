# Resource examples

Async resources in React Carburetor come in three flavors: `ResourceCarburetor` (one value,
one carburetor), `ResourceCache` (many keyed entries with TTL, eviction and invalidation),
and any custom class implementing `IResourceSource`. All examples are class components —
no hooks anywhere.

## ResourceCarburetor

`ResourceCarburetor` wraps a single loader function. `load()` starts (or joins) a request,
and the component reads the whole `IResourceData` state with `this.useCarburetor()` to
subscribe, rendering from the derived flags — `view.isPending`, `view.isError`,
`view.isSuccess` — and `view.data`.

<!-- example:file examples/api/resources/resource-carburetor/load.tsx#load -->
```tsx
import {AntiHookComponent, bind, ResourceCarburetor, TResourceLoader} from 'react-carburetor';
import {type JSX} from 'react';

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

        if (view.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (view.isError) {
            return <span className="error">{view.error}</span>;
        }
        if (view.isSuccess && view.data !== undefined) {
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
failure. `suspend()` never subscribes on its own, so the component also reads a field off
`this.useCarburetor(resource)` — here `isPending`, which flips on every reload — and calls
`suspend()` unconditionally, so a failed reload still reaches the error boundary.

<!-- example:file examples/api/resources/resource-carburetor/suspend.tsx#suspend -->
```tsx
import {AntiHookComponent, IResourceData, ResourceCarburetor} from 'react-carburetor';
import {Component, ReactNode, Suspense, type JSX} from 'react';
import {fetchConfig} from '../endpoints/config';

interface Config {
    theme: string;
}

export const configResource = new ResourceCarburetor<Config, void>(
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
        const view = this.useCarburetor(configResource);
        const value: Config = configResource.suspend(undefined);
        return <span className={view.isPending ? 'theme refreshing' : 'theme'}>{value.theme}</span>;
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
    view.isSuccess ? view.data?.theme ?? '' : '';
```

While `error` in the state is a string, the raw rejection value stays available through
`getLastError()` for logging; `reload()` repeats the last `load()` with the same args.

## ResourceCache

`ResourceCache` keys entries by the `args` you pass, so one cache can serve a whole list.
`resolve(args)` gives you the key, path and `IResourceView` in one call, and
`this.useResource(cache, args)` subscribes to the entry path and triggers the load after
commit when the entry is stale.

<!-- example:file examples/api/resources/resource-cache/list.tsx#list -->
```tsx
import {AntiHookComponent, bind, ResourceCache} from 'react-carburetor';
import {type JSX} from 'react';
import {fetchPost} from '../endpoints/posts';

interface Post {
    id: string;
    title: string;
}

export const postCache = new ResourceCache<Post, string>((id: string, _signal: AbortSignal) => fetchPost(id));

const renderPost = (id: string): JSX.Element => <PostListItem key={id} postId={id} />;

export class PostList extends AntiHookComponent<{postIds: string[]}> {
    render(): JSX.Element {
        return <ul>{this.props.postIds.map(renderPost)}</ul>;
    }
}

class PostListItem extends AntiHookComponent<{postId: string}> {
    @bind
    private refresh(): void {
        void postCache.refresh(this.props.postId);
    }

    render(): JSX.Element {
        const view = this.useResource(postCache, this.props.postId);
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
        if (view.isSuccess && view.data !== undefined) {
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

<!-- example:file examples/api/resources/resource-cache/suspense.tsx#suspense -->
```tsx
import {AntiHookComponent, ResourceCache} from 'react-carburetor';
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
        const view = this.useResource(avatarCache, this.props.userId);
        const avatar: Avatar = view.data ?? avatarCache.suspend(this.props.userId);
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

export const isAvatarError = (view: {isError: boolean}): boolean =>
    view.isError;
```

Skipping the `useResource()` call itself is not the hazard — a call whose result is never read
registers no field reads either. The subscription comes from reading the fields you render
(`view.data`, `view.stale`) off the result of `useResource`/`useCarburetor`; without such reads
the component renders once and never updates when the entry reloads or refreshes.

`ttl` and `maxEntries` in `IResourceCacheOptions` give you time-based freshness and
memory bounds: entries older than `ttl` go stale (refetched after the next commit) and
least-recently-used unretained entries are evicted beyond `maxEntries`.

<!-- example:file examples/api/resources/resource-cache/ttl.ts#ttl -->
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
    const settled = view.isSuccess;
    const entry: IResourceEntry<Quote> = {
        status: settled ? EResourceStatus.Success : EResourceStatus.Idle,
        isIdle: !settled,
        isPending: false,
        isSuccess: settled,
        isError: false,
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

<!-- example:file examples/api/resources/resource-cache/invalidate.tsx#invalidate -->
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
        void saveSettings(this.props.userId, {displayName: nextName}).then(this.invalidateSettings);
    }

    @bind
    private invalidateSettings(): void {
        settingsCache.invalidate(this.props.userId);
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

<!-- example:file examples/api/resources/resource-cache/failure.ts#failure -->
```ts
import {IResourceView, ResourceCache} from 'react-carburetor';

interface Report {
    rows: string[];
}

declare function fetchReport(period: string): Promise<Report>;

const reportCache = new ResourceCache<Report, string>((period: string) => fetchReport(period));

export const describeReportFailure = (period: string): string => {
    const view: IResourceView<Report> = reportCache.getEntry(period);
    if (!view.isError || !view.failed) {
        return 'no failure';
    }
    const failure: unknown = reportCache.getFailure(period);
    return failure instanceof Error ? failure.message : String(failure);
};
```

`getFailure` may return `undefined` when the entry has not failed — check `failed` first.

To remove entries entirely (and cancel their in-flight requests), use `forget(args)` and
`forgetAll()` — for example on logout or when leaving a route.

<!-- example:file examples/api/resources/resource-cache/forget.ts#forget -->
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

<!-- example:file examples/api/resources/custom-source/label-source.tsx#label-source -->
```tsx
import {
    AntiHookComponent,
    Carburetor,
    EResourceStatus,
    IDict,
    IResourceResolution,
    IResourceSource,
    IResourceView,
} from 'react-carburetor';
import {type JSX} from 'react';

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
        // Derived flags must match status: exactly one is true.
        const status = entry?.status ?? EResourceStatus.Idle;
        const view: IResourceView<Label> = {
            status,
            isIdle: status === EResourceStatus.Idle,
            isPending: status === EResourceStatus.Pending,
            isSuccess: status === EResourceStatus.Success,
            isError: status === EResourceStatus.Error,
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
        const settle = (status: EResourceStatus, value: Label | undefined): void => {
            this.draft.entries[id] = {status, value};
            this.emitUpdate();
        };
        return fetchLabel(id).then(
            (label: Label): void => settle(EResourceStatus.Success, label),
            (): void => settle(EResourceStatus.Error, undefined),
        );
    }
}

const labelSource = new LabelSource();

export class LabelChip extends AntiHookComponent<{labelId: string}> {
    render(): JSX.Element {
        const view = this.useResource(labelSource, this.props.labelId);
        if (view.isSuccess && view.data !== undefined) {
            return <span className="chip">{view.data.text}</span>;
        }
        return <span className="chip">{view.status}</span>;
    }
}
```

Your `view` must fill every `IResourceView` field, including the entry flags. For a typed object
literal the compiler catches a missing field; only JavaScript callers and unsafe casts let one
slip through to runtime.

## Types

`IResourceSnapshot<T>` is what `snapshot()` returns and `restore()` takes — pass it
across a serialization boundary (postMessage, storage, server payload) and back.

<!-- example:file examples/api/resources/snapshots/rates.ts#rates -->
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

A snapshot is a plain tree: plain objects and arrays are copied, so `JSON.stringify`/`parse`
round-trips them. Opaque values — native `Map`/`Set`/`Date` and class instances — stay by
reference and do not survive a wire format.

`getInitialResourceData()` gives the pristine `IResourceData` shape — handy to reset a
custom carburetor or to seed your own data structure.

<!-- example:file examples/api/resources/snapshots/session.ts#session -->
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
        this.draft.current = getInitialResourceData<Session>();
        this.emitUpdate();
    }
}
```

The initial data starts as `Idle` with `data`, `error` and `updatedAt` all `undefined`.
