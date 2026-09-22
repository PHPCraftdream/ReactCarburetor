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

        const {container, unmount} = render(<Row cache={cache} id="a"/>);

        loader.fail[0](new Error('nope'));
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Error);
        // Retrying here would loop: the failure re-renders, which would queue the request again.
        expect(loader.calls).toEqual(['a']);

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
});
