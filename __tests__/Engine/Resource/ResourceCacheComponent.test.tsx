import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, CarburetorScope, carburetorToken, EResourceStatus} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const makeLoader = () => {
    const calls: string[] = [];
    const settle: ((value: string) => void)[] = [];
    const fail: ((error: unknown) => void)[] = [];

    const load = (id: string): Promise<string> => {
        calls.push(id);

        return new Promise<string>((resolve, reject) => {
            settle.push(resolve);
            fail.push(reject);
        });
    };

    return {calls, settle, fail, load};
};

/** Exposes the subscriber count, which is protected state, to check nothing is left behind. */
class ObservableCache extends ResourceCache<string, string> {
    public subscriberCount = (): number => {
        return Object.keys(this.subscribers).length;
    };
}

const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

interface IRowProps {
    cache: ResourceCache<string, string>;
    id: string;
    onRender?: () => void;
}

class Row extends AntiHookComponent<IRowProps> {
    public render() {
        const {cache, id, onRender} = this.props;
        const entry = this.useResource(cache, id);

        if (onRender) {
            onRender();
        }

        return <span className="value">{entry.data || entry.status}</span>;
    }
}

interface IQueryProps {
    cache: ResourceCache<string, {id: string}>;
    query: {id: string};
}

class QueryRow extends AntiHookComponent<IQueryProps> {
    public render() {
        const entry = this.useResource(this.props.cache, this.props.query);

        return <span className="value">{entry.data || entry.status}</span>;
    }
}

describe('a component reading a resource cache', () => {
    test('fetches after the commit, not during render', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        const versions: number[] = [];

        class Watcher extends AntiHookComponent<IRowProps> {
            public render() {
                // The version must not move while this render is running.
                versions.push(this.props.cache.getVersion());

                const entry = this.useResource(this.props.cache, this.props.id);

                versions.push(this.props.cache.getVersion());

                return <span>{entry.status}</span>;
            }
        }

        const {unmount} = render(<Watcher cache={cache} id="a"/>);

        expect(versions[0]).toEqual(versions[1]);
        // The request went out once the commit had happened.
        expect(loader.calls).toEqual(['a']);

        loader.settle[0]('value-a');
        await flush();

        unmount();
    });

    test('the answer reaches the component that asked for it', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        const {container, unmount} = render(<Row cache={cache} id="a"/>);

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

        loader.settle[0]('Ann');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('Ann');

        unmount();
    });

    test('two components reading one entry share a single request', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        const {unmount} = render(
            <div>
                <Row cache={cache} id="a"/>
                <Row cache={cache} id="a"/>
            </div>
        );

        expect(loader.calls).toEqual(['a']);

        loader.settle[0]('Ann');
        await flush();

        unmount();
    });

    test('a component reading one entry does not re-render when another entry answers', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        let rendersOfA = 0;

        const {unmount} = render(
            <div>
                <Row cache={cache} id="a" onRender={() => rendersOfA++}/>
                <Row cache={cache} id="b"/>
            </div>
        );

        loader.settle[0]('Ann');
        await flush();

        const after = rendersOfA;

        loader.settle[1]('Bob');
        await flush();

        // Entry `b` answering is none of A's business.
        expect(rendersOfA).toEqual(after);

        unmount();
    });

    test('a failed entry is not retried from render', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        const {container, rerender, unmount} = render(<Row cache={cache} id="a"/>);

        loader.fail[0](new Error('nope'));
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Error);
        // Retrying here would loop: the failure re-renders, which would queue the request again.
        expect(loader.calls).toEqual(['a']);

        rerender(<Row cache={cache} id="a"/>);
        await flush();

        // One more commit on top of the failure: still no new request.
        expect(loader.calls).toEqual(['a']);

        unmount();
    });

    test('a failed refresh is not retried from render, but an explicit refresh retries', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        void cache.load('a');
        loader.settle[0]('first');
        await flush();

        const {container, rerender, unmount} = render(<Row cache={cache} id="a"/>);

        expect(container.querySelector('.value')?.textContent).toEqual('first');
        expect(loader.calls).toEqual(['a']);

        // A write landed elsewhere: the entry is invalidated, so the next render refetches it.
        act(() => {
            cache.invalidate('a');
        });
        await flush();

        expect(loader.calls).toEqual(['a', 'a']);

        // The rejection notifies the mounted row synchronously, so the re-render it causes
        // must happen inside act, or React warns about it.
        act(() => {
            loader.fail[1](new Error('gateway timeout'));
        });
        await flush();

        // The refresh failed, but the data the user is reading is still there.
        expect(container.querySelector('.value')?.textContent).toEqual('first');
        // One attempt per external event: the failure's own notification must not queue another.
        expect(loader.calls).toEqual(['a', 'a']);

        rerender(<Row cache={cache} id="a"/>);
        await flush();

        expect(loader.calls).toEqual(['a', 'a']);

        // The escape hatch: an explicit refresh is allowed to try again. Its synchronous
        // notification is act-wrapped for the same reason as the rejection above.
        const request = act(() => cache.refresh('a'));
        loader.settle[2]('second');
        await request;
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('second');
        expect(loader.calls).toEqual(['a', 'a', 'a']);
        expect(cache.getEntry('a').failed).toBeFalsy();

        unmount();
    });

    test('a fresh entry is rendered without asking the loader', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        void cache.load('a');
        loader.settle[0]('Ann');
        await flush();

        const {container, unmount} = render(<Row cache={cache} id="a"/>);

        expect(container.querySelector('.value')?.textContent).toEqual('Ann');
        expect(loader.calls).toEqual(['a']);

        unmount();
    });

    test('unmounting while a request is in flight leaves nothing behind', async () => {
        const loader = makeLoader();
        const cache = new ObservableCache(loader.load);

        const {unmount} = render(<Row cache={cache} id="a"/>);

        expect(cache.subscriberCount()).toEqual(1);

        unmount();

        loader.settle[0]('Ann');
        await flush();

        // The answer landed in the cache; no subscriber remains to be notified.
        expect(cache.getEntry('a').data).toEqual('Ann');
        expect(cache.subscriberCount()).toEqual(0);
    });

    test('a class component suspends per entry and recovers when the answer lands', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        class Suspended extends AntiHookComponent<IRowProps> {
            public render() {
                // Throws the in-flight promise, which is what a Suspense boundary waits for.
                const value = this.props.cache.suspend(this.props.id);

                return <span className="value">{value}</span>;
            }
        }

        const {container, unmount} = render(
            <React.Suspense fallback={<span className="waiting">waiting</span>}>
                <Suspended cache={cache} id="a"/>
            </React.Suspense>
        );

        expect(container.querySelector('.waiting')).toBeTruthy();
        expect(loader.calls).toEqual(['a']);

        loader.settle[0]('Ann');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('Ann');

        unmount();
    });

    test('hydrated data is rendered as it is, without a request', async () => {
        const loader = makeLoader();
        const token = carburetorToken(() => new ResourceCache<string, string>(loader.load, {ttl: 60_000}), 'resource-cache-test/cache');

        const server = new CarburetorScope();
        const serverCache = server.get(token);

        void serverCache.load('a');
        loader.settle[0]('from the server');
        await flush();

        const state = server.dehydrate();

        const client = new CarburetorScope();
        client.hydrate(state, [token]);

        const clientCache = client.get(token);
        const {container, unmount} = render(<Row cache={clientCache} id="a"/>);

        expect(container.querySelector('.value')?.textContent).toEqual('from the server');
        // Refetching everything on hydration is the cost server rendering was meant to avoid.
        expect(loader.calls).toEqual(['a']);

        unmount();
    });

    test('delivers loading and completion updates for keys the path builder must escape', async () => {
        for (const id of ['plain', 'a.b', 'a~b']) {
            const loader = makeLoader();
            const cache = new ResourceCache<string, string>(loader.load);

            const {container, unmount} = render(<Row cache={cache} id={id}/>);

            // The deferred load's pending write reached the component.
            expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

            loader.settle[0](`value for ${id}`);
            await flush();

            expect(container.querySelector('.value')?.textContent).toEqual(`value for ${id}`);

            unmount();
        }
    });

    test('delivers updates when the arguments are objects holding escaped characters', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, {id: string}>(loader.load);

        const {container, unmount} = render(<QueryRow cache={cache} query={{id: 'a.b'}}/>);

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);

        loader.settle[0]('Ann');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('Ann');

        unmount();
    });

    test('one escaped entry answering does not re-render the reader of another', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        let rendersOfDot = 0;

        const {unmount} = render(
            <div>
                <Row cache={cache} id="a.b" onRender={() => rendersOfDot++}/>
                <Row cache={cache} id="a~b"/>
            </div>
        );

        loader.settle[0]('Ann');
        await flush();

        const after = rendersOfDot;

        loader.settle[1]('Bob');
        await flush();

        // Entry `a~b` answering is none of `a.b`'s business.
        expect(rendersOfDot).toEqual(after);

        unmount();
    });

    test('hydrated entries survive for keys holding escaped characters', async () => {
        const loader = makeLoader();
        const token = carburetorToken(() => new ResourceCache<string, string>(loader.load, {ttl: 60_000}), 'resource-cache-test/escaped-cache');

        const server = new CarburetorScope();
        const serverCache = server.get(token);

        void serverCache.load('a.b');
        loader.settle[0]('from the server');
        await flush();

        const state = server.dehydrate();

        const client = new CarburetorScope();
        client.hydrate(state, [token]);

        const clientCache = client.get(token);
        const {container, unmount} = render(<Row cache={clientCache} id="a.b"/>);

        expect(container.querySelector('.value')?.textContent).toEqual('from the server');
        // Hydration must not refetch: that is the cost server rendering was meant to avoid.
        expect(loader.calls).toEqual(['a.b']);

        unmount();
    });

    test('scope hydration normalizes a refreshing+invalidated entry before a reader mounts (R3-04)', async () => {
        const loader = makeLoader();
        const token = carburetorToken(
            () => new ResourceCache<string, string>(loader.load, {ttl: 60_000}),
            'resource-cache-restore-test/scope-cache'
        );

        const server = new CarburetorScope();
        const serverCache = server.get(token);

        void serverCache.load('a');
        loader.settle[0]('Ann');
        await flush();

        serverCache.invalidate('a');
        void serverCache.refresh('a');

        const state = server.dehydrate();

        // The client re-creates its cache with its own loader, but through the same token
        // declaration: server and client are different processes sharing one token, not two
        // independent tokens that happen to share a name.
        const clientLoader = makeLoader();
        const client = new CarburetorScope();

        client.set(token, new ResourceCache<string, string>(clientLoader.load, {ttl: 60_000}));
        client.hydrate(state, [token]);

        const clientCache = client.get(token);
        const entry = clientCache.getEntry('a');

        expect(entry.refreshing).toBeFalsy();
        expect(entry.invalidated).toBeTruthy();
        expect(entry.data).toEqual('Ann');
        expect(entry.stale).toBeTruthy();

        void clientCache.refresh('a');
        expect(clientLoader.calls).toEqual(['a']);

        clientLoader.settle[0]('Anna');
        await flush();

        expect(clientCache.getEntry('a').data).toEqual('Anna');
    });

    test('a mounted reader refetches a hydrated entry that was refreshing and invalidated (R3-04)', async () => {
        const loader = makeLoader();
        const token = carburetorToken(
            () => new ResourceCache<string, string>(loader.load, {ttl: 60_000}),
            'resource-cache-restore-test/refreshing-invalidated'
        );

        const server = new CarburetorScope();
        const serverCache = server.get(token);

        void serverCache.load('a');
        loader.settle[0]('first');
        await flush();

        // Invalidated and mid-refresh at the moment the server state was captured: zero client
        // requests will ever exist for this snapshot once it crosses the boundary.
        serverCache.invalidate('a');
        void serverCache.refresh('a');

        const state = server.dehydrate();

        // The client re-creates its cache with its own loader, but through the same token
        // declaration: server and client are different processes sharing one token, not two
        // independent tokens that happen to share a name.
        const clientLoader = makeLoader();
        const client = new CarburetorScope();

        client.set(token, new ResourceCache<string, string>(clientLoader.load, {ttl: 60_000}));
        client.hydrate(state, [token]);

        const clientCache = client.get(token);

        // Before a component ever mounts: the hydrated entry must not claim live work.
        expect(clientCache.getEntry('a').refreshing).toBeFalsy();

        const {container, unmount} = render(<Row cache={clientCache} id="a"/>);

        // Stale data is shown immediately, and the mount's own commit queues a real fetch —
        // not an indefinite refresh indicator over data nothing is renewing.
        expect(container.querySelector('.value')?.textContent).toEqual('first');
        expect(clientLoader.calls).toEqual(['a']);

        clientLoader.settle[0]('refreshed');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('refreshed');
        expect(clientCache.getEntry('a').invalidated).toBeFalsy();

        unmount();
    });
});
