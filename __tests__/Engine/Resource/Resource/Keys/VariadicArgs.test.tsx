// Variadic arguments (two or more, differing in the SECOND argument) must survive every
// path: the loader sees all of them with the signal last, the key never splits on a
// trailing undefined, every read/control method addresses the same entry, the custom key
// function runs exactly once per method call, and the tuple reaches React components.
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, EResourceStatus, ResourceCarburetor} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

interface IRecordedCall {
    a: string;
    b: number;
    signal: unknown;
}

/** An immediate loader recording every call, with the signal expected last. */
const makeRecordingLoader = () => {
    const calls: IRecordedCall[] = [];
    const load = async (a: string, b: number, signal: AbortSignal): Promise<string> => {
        calls.push({a, b, signal});
        return `${a}-${b}`;
    };
    return {calls, load};
};

describe('ResourceCarburetor variadic arguments', () => {
    test('the loader receives all arguments with the signal last', async () => {
        const loader = makeRecordingLoader();
        const resource = new ResourceCarburetor<string, [string, number]>(loader.load);

        await resource.load('x', 2);

        expect(resource.getData().data).toEqual('x-2');
        expect(loader.calls).toHaveLength(1);
        expect(loader.calls[0].a).toEqual('x');
        expect(loader.calls[0].b).toEqual(2);
        expect(loader.calls[0].signal instanceof AbortSignal).toBe(true);
    });

    test('load/suspend/refresh/abort serve one slot for the same argument set', async () => {
        const loader = makeRecordingLoader();
        const resource = new ResourceCarburetor<string, [string, number]>(loader.load);

        await resource.load('x', 2);
        expect(resource.suspend('x', 2)).toEqual('x-2');

        await resource.refresh('x', 2);
        expect(resource.getData().data).toEqual('x-2');
        expect(loader.calls).toHaveLength(2);

        // Nothing is in flight: aborting must not throw.
        expect(() => resource.abort()).not.toThrow();
        expect(resource.getData().data).toEqual('x-2');

        resource.clear();
        expect(resource.getData().status).toEqual(EResourceStatus.Idle);
    });

    test('the key function runs exactly once per load/refresh/suspend call', async () => {
        let keyCalls = 0;
        const loader = makeRecordingLoader();
        const resource = new ResourceCarburetor<string, [string, number]>(loader.load, {
            key: (a: string, b: number) => {
                keyCalls += 1;
                return `${a}#${b}`;
            },
        });

        keyCalls = 0;
        await resource.load('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        await resource.refresh('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        resource.suspend('x', 2); // served from state, no request
        expect(keyCalls).toBe(1);
        await flush();
    });

    test('the tuple reaches a class component through useCarburetor + suspend', async () => {
        const loader = makeRecordingLoader();
        const resource = new ResourceCarburetor<string, [string, number]>(loader.load);
        await resource.load('x', 2);

        interface IResourceProps {
            resource: ResourceCarburetor<string, [string, number]>;
        }

        class Reader extends AntiHookComponent<IResourceProps> {
            public render() {
                this.useCarburetor(this.props.resource);

                return <span className="value">{this.props.resource.suspend('x', 2)}</span>;
            }
        }

        const {container, unmount} = render(
            <React.Suspense fallback={<span className="waiting">waiting</span>}>
                <Reader resource={resource}/>
            </React.Suspense>
        );

        await flush();

        // 'x-2', not 'x-undefined': the second argument must have survived every hop.
        expect(container.querySelector('.value')?.textContent).toEqual('x-2');

        unmount();
    });
});

describe('ResourceCache variadic arguments', () => {
    test('the loader receives all arguments with the signal last', async () => {
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);

        await cache.load('x', 2);

        expect(cache.getEntry('x', 2).data).toEqual('x-2');
        expect(loader.calls).toHaveLength(1);
        expect(loader.calls[0].a).toEqual('x');
        expect(loader.calls[0].b).toEqual(2);
        expect(loader.calls[0].signal instanceof AbortSignal).toBe(true);
    });

    test('a trailing undefined does not split the key', async () => {
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);

        await cache.load('x', 2);
        await cache.load('x', 2, undefined);

        expect(loader.calls).toHaveLength(1);
        expect(cache.resolve('x', 2).key).toEqual(cache.resolve('x', 2, undefined).key);
        expect(cache.getEntry('x', 2, undefined).status).toEqual(EResourceStatus.Success);
    });

    test('every read/control method addresses the same single entry', async () => {
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);

        await cache.load('x', 2);

        expect(cache.getEntry('x', 2).data).toEqual('x-2');
        expect(cache.resolve('x', 2).view.data).toEqual('x-2');
        expect(cache.getFailure('x', 2)).toBeUndefined();

        await cache.refresh('x', 2);
        expect(cache.getEntry('x', 2).status).toEqual(EResourceStatus.Success);
        expect(loader.calls).toHaveLength(2);

        cache.invalidate('x', 2);
        expect(cache.getEntry('x', 2).invalidated).toBe(true);

        // Nothing is in flight: aborting must not throw.
        expect(() => cache.abort('x', 2)).not.toThrow();

        cache.forget('x', 2);
        // Forgetting is documented to yield a fresh default entry, not undefined.
        expect(cache.getEntry('x', 2).status).toBe(EResourceStatus.Idle);
        expect(cache.getEntry('x', 2).data).toBeUndefined();
    });

    test('the custom key function runs exactly once per method call', async () => {
        let keyCalls = 0;
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load, {
            key: (a: string, b: number) => {
                keyCalls += 1;
                return `${a}#${b}`;
            },
        });

        keyCalls = 0;
        await cache.load('x', 2); // miss
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        await cache.refresh('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.getEntry('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.resolve('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.getFailure('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.invalidate('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.forget('x', 2);
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        await cache.load('x', 2); // a fresh miss after the forget
        expect(keyCalls).toBe(1);

        keyCalls = 0;
        cache.abort('x', 2);
        expect(keyCalls).toBe(1);

        // Suspend served from the entry computes the key once too.
        keyCalls = 0;
        cache.suspend('x', 2);
        expect(keyCalls).toBe(1);
        await flush();
    });

    test('the tuple reaches a class component through useResource', async () => {
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);
        await cache.load('x', 2);

        interface IRowProps {
            cache: ResourceCache<string, [string, number]>;
        }

        class Row extends AntiHookComponent<IRowProps> {
            public render() {
                const entry = this.useResource(this.props.cache, 'x', 2);

                return <span className="value">{entry.data}</span>;
            }
        }

        const {container, unmount} = render(<Row cache={cache}/>);

        expect(container.querySelector('.value')?.textContent).toEqual('x-2');

        unmount();
    });

    test('the tuple reaches a function component through useResourceValue', async () => {
        const loader = makeRecordingLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);
        await cache.load('x', 2);

        const ValueSpan = (): React.ReactElement => {
            const data = useResourceValue(cache, ['x', 2], (view) => view.data);

            return <span className="value">{data}</span>;
        };

        const {container, unmount} = render(<ValueSpan/>);

        expect(container.querySelector('.value')?.textContent).toEqual('x-2');

        unmount();
    });
});

describe('argument sets differing only in the second argument stay apart', () => {
    /** Per-call deferred answers keyed by `a-b`, so requests can hang, fail or succeed. */
    const makeControlledLoader = () => {
        const signals = new Map<string, AbortSignal>();
        const pending = new Map<string, {resolve: (v: string) => void; reject: (e: Error) => void}>();
        const load = (a: string, b: number, signal: AbortSignal): Promise<string> =>
            new Promise<string>((resolve, reject) => {
                signals.set(`${a}-${b}`, signal);
                pending.set(`${a}-${b}`, {resolve, reject});
            });
        return {signals, pending, load};
    };

    test('ResourceCache keeps one entry, failure and request per full argument set', async () => {
        const loader = makeControlledLoader();
        const cache = new ResourceCache<string, [string, number]>(loader.load);

        const one = cache.load('x', 1);
        const two = cache.load('x', 2);
        // Abort addresses only ('x', 1).
        cache.abort('x', 1);
        expect(loader.signals.get('x-1')!.aborted).toBe(true);
        expect(loader.signals.get('x-2')!.aborted).toBe(false);
        // An aborted load settles when its loader does; its late answer is ignored.
        loader.pending.get('x-1')!.resolve('late-1');
        await one.catch(() => undefined);

        loader.pending.get('x-2')!.resolve('answer-2');
        await two;
        expect(cache.getEntry('x', 2).data).toBe('answer-2');
        expect(cache.getEntry('x', 1).data).toBeUndefined();

        const failing = cache.load('x', 3);
        loader.pending.get('x-3')!.reject(new Error('boom-3'));
        await failing.catch(() => undefined);
        expect((cache.getFailure('x', 3) as Error).message).toBe('boom-3');
        expect(cache.getFailure('x', 2)).toBeUndefined();
        expect(cache.resolve('x', 3).view.status).toBe(EResourceStatus.Error);

        cache.invalidate('x', 2);
        expect(cache.getEntry('x', 2).invalidated).toBe(true);
        expect(cache.getEntry('x', 3).invalidated).not.toBe(true);
        cache.forget('x', 3);
        expect(cache.getEntry('x', 3).status).toBe(EResourceStatus.Idle);
        expect(cache.getEntry('x', 2).data).toBe('answer-2');
    });

    test('ResourceCarburetor switches answers by the full argument set', async () => {
        const answers: string[] = [];
        const resource = new ResourceCarburetor<string, [string, number]>(
            async (a: string, b: number) => {
                answers.push(`${a}-${b}`);
                return `${a}-${b}`;
            },
            {ttl: 60_000},
        );

        await resource.load('x', 1);
        await resource.load('x', 2);
        expect(resource.getData().data).toBe('x-2');
        await resource.load('x', 1); // memory hit for the other second argument
        expect(resource.getData().data).toBe('x-1');
        expect(answers).toEqual(['x-1', 'x-2']);
    });
});
