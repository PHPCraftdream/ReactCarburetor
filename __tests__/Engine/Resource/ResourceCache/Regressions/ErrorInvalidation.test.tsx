import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import * as React from 'react';
import {TestCache} from '../Helpers/TestCache';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';

class ObservedCache extends TestCache<string, string> {
    /** Number of mounted readers retained by this cache. */
    public readerCount(): number {
        return Object.keys(this[S.subscribers]).length;
    }
}

test('a mounted failed reader retries after invalidation, stays quiet and releases on unmount', async () => {
    const pending: Array<PromiseWithResolvers<string>> = [];
    const calls: string[] = [];
    let rendering = false;
    let loadedDuringRender = false;
    const cache = new ObservedCache((key) => {
        loadedDuringRender ||= rendering;
        calls.push(key);
        const request = Promise.withResolvers<string>();
        pending.push(request);
        return request.promise;
    });

    class Reader extends AntiHookComponent {
        public render() {
            rendering = true;
            try {
                const view = this.useResource(cache, 'a');
                return <span>{view.status}:{String(view.failed)}:{view.data ?? '-'}</span>;
            } finally {
                rendering = false;
            }
        }
    }

    const mounted = render(<Reader/>);
    expect(mounted.container.textContent).toBe('pending:false:-');
    expect(calls).toEqual(['a']);
    expect(cache.readerCount()).toBe(1);

    await act(async () => {
        pending[0].reject(new Error('first failure'));
    });
    expect(mounted.container.textContent).toBe('error:true:-');
    expect(calls).toEqual(['a']);
    mounted.rerender(<Reader/>);
    expect(calls).toEqual(['a']);

    await act(async () => {
        cache.invalidate('a');
    });
    expect(calls).toEqual(['a', 'a']);
    expect(mounted.container.textContent).toBe('pending:false:-');

    // Aborting that retry must not cause its own Idle notification to refetch it.
    await act(async () => {
        cache.abort('a');
    });
    expect(mounted.container.textContent).toBe('idle:true:-');
    expect(calls).toEqual(['a', 'a']);

    await act(async () => {
        cache.invalidate('a');
    });
    expect(mounted.container.textContent).toBe('pending:false:-');
    expect(calls).toEqual(['a', 'a', 'a']);

    await act(async () => {
        pending[2].reject(new Error('retry failure'));
    });
    expect(mounted.container.textContent).toBe('error:true:-');
    expect(calls).toEqual(['a', 'a', 'a']);
    mounted.rerender(<Reader/>);
    expect(calls).toEqual(['a', 'a', 'a']);

    await act(async () => {
        cache.invalidateAll();
    });
    expect(calls).toEqual(['a', 'a', 'a', 'a']);
    expect(mounted.container.textContent).toBe('pending:false:-');

    await act(async () => {
        pending[3].resolve('recovered');
    });
    expect(mounted.container.textContent).toBe('success:false:recovered');
    expect(calls).toEqual(['a', 'a', 'a', 'a']);
    expect(loadedDuringRender).toBe(false);

    await act(async () => {
        pending[1].resolve('late');
    });
    expect(mounted.container.textContent).toBe('success:false:recovered');
    expect(calls).toEqual(['a', 'a', 'a', 'a']);

    mounted.unmount();
    expect(cache.readerCount()).toBe(0);
});

test.each(['setData', 'restore', 'fromJSON'] as const)(
    'an invalidated %s replacement retains its retry guard when that retry is aborted',
    async (method) => {
        const pending: Array<PromiseWithResolvers<string>> = [];
        let calls = 0;
        const cache = new ObservedCache(() => {
            calls++;
            const request = Promise.withResolvers<string>();
            pending.push(request);
            return request.promise;
        });

        class Reader extends AntiHookComponent {
            public render() {
                const view = this.useResource(cache, 'a');
                return <span>{view.status}:{String(view.failed)}:{view.data ?? '-'}</span>;
            }
        }

        const mounted = render(<Reader/>);
        await act(async () => {
            pending[0].reject(new Error('old-raw'));
        });
        expect(mounted.container.textContent).toBe('error:true:-');

        const key = cache.exposeKeyOf('a');
        await act(async () => {
            cache[method]({entries: {[key]: {...cache.getData().entries[key], error: 'replacement'}}});
        });
        expect(cache.getFailure('a')).toBeUndefined();
        expect(() => cache.suspend('a')).toThrow('replacement');
        expect(calls).toBe(1);

        await act(async () => {
            cache.invalidate('a');
        });
        expect(mounted.container.textContent).toBe('pending:false:-');
        expect(calls).toBe(2);

        await act(async () => {
            cache.abort('a');
        });
        expect(mounted.container.textContent).toBe('idle:true:-');
        expect(calls).toBe(2);

        await act(async () => {
            cache.invalidate('a');
        });
        expect(mounted.container.textContent).toBe('pending:false:-');
        expect(calls).toBe(3);

        await act(async () => {
            pending[2].resolve('recovered');
        });
        expect(mounted.container.textContent).toBe('success:false:recovered');

        await act(async () => {
            pending[1].resolve('late');
        });
        expect(mounted.container.textContent).toBe('success:false:recovered');
        expect(calls).toBe(3);

        mounted.unmount();
        expect(cache.readerCount()).toBe(0);
    }
);

test.each(['initial', 'refresh'] as const)(
    'a mounted reader consumes an invalidation left behind by an older %s answer after commit',
    async (phase) => {
        const pending: Array<PromiseWithResolvers<string>> = [];
        const calls: string[] = [];
        let rendering = false;
        let loadedDuringRender = false;
        const cache = new ObservedCache((key) => {
            loadedDuringRender ||= rendering;
            calls.push(key);
            const request = Promise.withResolvers<string>();
            pending.push(request);
            return request.promise;
        }, {ttl: Infinity});

        if (phase === 'refresh') {
            const first = cache.load('a');
            pending[0].resolve('original');
            await first;
        }

        class Reader extends AntiHookComponent {
            public render() {
                rendering = true;
                try {
                    const view = this.useResource(cache, 'a');
                    return <span>{view.status}:{String(view.stale)}:{view.data ?? '-'}</span>;
                } finally {
                    rendering = false;
                }
            }
        }

        const mounted = render(<Reader/>);
        if (phase === 'refresh') {
            await act(async () => { void cache.refresh('a'); });
        }
        const oldIndex = pending.length - 1;
        expect(calls).toHaveLength(oldIndex + 1);

        await act(async () => { cache.invalidate('a'); });
        expect(calls).toHaveLength(oldIndex + 1);
        await act(async () => { pending[oldIndex].resolve('older'); });
        expect(calls).toHaveLength(oldIndex + 2);
        expect(mounted.container.textContent).toBe('success:true:older');
        await act(async () => { pending[oldIndex + 1].resolve('newer'); });
        expect(mounted.container.textContent).toBe('success:false:newer');
        expect(calls).toHaveLength(oldIndex + 2);
        expect(loadedDuringRender).toBe(false);
        mounted.unmount();
        expect(cache.readerCount()).toBe(0);
    }
);
