import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from "@/Carburetor";
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

const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

interface ISuspendingProps {
    cache: ResourceCache<string, string>;
    id: string;
}

// Mirrors the fixed README example: suspend() for the first paint, the `data` read for the subscription.
class SuspendingUser extends AntiHookComponent<ISuspendingProps> {
    public render() {
        const {data} = this.useResource(this.props.cache, this.props.id);

        this.props.cache.suspend(this.props.id);

        return <span className="value">{data}</span>;
    }
}

describe('a suspending reader without field reads', () => {
    test('stays subscribed across a refresh only when it reads data from useResource', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);

        const {container, unmount} = render(
            <React.Suspense fallback={<span className="waiting">waiting</span>}>
                <SuspendingUser cache={cache} id="a"/>
            </React.Suspense>
        );

        expect(container.querySelector('.waiting')).toBeTruthy();
        expect(loader.calls).toEqual(['a']);

        loader.settle[0]('first');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('first');

        // refresh notifies synchronously, so the render it triggers must be act-wrapped.
        const request = act(() => cache.refresh('a'));
        loader.settle[1]('second');
        await request;
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('second');

        unmount();
    });
});
