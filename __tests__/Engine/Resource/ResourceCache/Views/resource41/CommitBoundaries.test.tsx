import * as React from 'react';
import {act, startTransition} from 'react';
import {render} from '@testing-library/react';
import type {IResourceView, TReadonly} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

interface Data {left: {name: string}; right: {name: string}}
class Cache extends ResourceCache<Data, string> {
    public rename(branch: 'left' | 'right', name: string): void {
        const key = this.resolve('user').key;
        this.update(draft => { draft.entries[key].data![branch].name = name; });
    }
}

describe('R41 resource commit boundaries', () => {
    test('a suspended transition cannot adopt its branch into the visible memo consumer', async () => {
        const cache = new Cache(async () => ({left: {name: 'Ada'}, right: {name: 'Grace'}}), {ttl: Infinity});
        await cache.load('user');
        let renders = 0;
        const never = new Promise<void>(() => {});
        const Child = React.memo(({data}: {data: {readonly name: string}}) => {
            renders++;
            return <span>{data.name}</span>;
        });
        const Parent = ({branch, suspend = false}: {branch: 'left' | 'right'; suspend?: boolean}) => {
            const data = useResourceValue(cache, 'user', view => view.data![branch]);
            if (suspend) throw never;
            return <Child data={data}/>;
        };
        const tree = (branch: 'left' | 'right', suspend = false) => (
            <React.Suspense fallback={<span>waiting</span>}>
                <Parent branch={branch} suspend={suspend}/>
            </React.Suspense>
        );
        const mounted = render(tree('left'));
        await act(async () => { startTransition(() => mounted.rerender(tree('right', true))); });
        expect(mounted.container.textContent).toBe('Ada');
        mounted.rerender(tree('left'));
        expect(renders).toBe(1);
        await act(async () => { cache.rename('right', 'unread'); });
        expect(renders).toBe(1);
        await act(async () => { cache.rename('left', 'visible'); });
        expect(mounted.container.textContent).toBe('visible');
        expect(renders).toBe(2);
        mounted.rerender(tree('right'));
        expect(mounted.container.textContent).toBe('unread');
        const switched = renders;
        await act(async () => { cache.rename('left', 'retired'); });
        expect(renders).toBe(switched);
        await act(async () => { cache.rename('right', 'active'); });
        expect(mounted.container.textContent).toBe('active');
        mounted.unmount();
    });

    test('TTL expiry refreshes only after commit and invalidation rearms once before unmount', async () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(100);
        let mounted: ReturnType<typeof render> | undefined;
        try {
            const requests: Array<PromiseWithResolvers<Data>> = [];
            let rendering = false;
            let loadsInRender = 0;
            const cache = new Cache(() => {
                if (rendering) loadsInRender++;
                const request = Promise.withResolvers<Data>();
                requests.push(request);
                return request.promise;
            }, {ttl: 10});
            const answer = (name: string): Data => ({left: {name}, right: {name: 'other'}});
            const preload = cache.load('user');
            requests[0].resolve(answer('Ada'));
            await preload;
            const Reader = ({tick}: {tick: number}) => {
                // Loader instrumentation, not UI state: detect work started during render.
                // oxlint-disable-next-line react/immutability, react/globals -- Open loader guard.
                rendering = true;
                try {
                    const name = useResourceValue(cache, 'user', view => view.data!.left.name);
                    return <span data-tick={tick}>{name}</span>;
                } finally {
                    // oxlint-disable-next-line react/immutability, react/globals -- Always close loader guard.
                    rendering = false;
                }
            };
            mounted = render(<Reader tick={0}/>);
            expect(requests).toHaveLength(1);
            now.mockReturnValue(111);
            expect(cache.getEntry('user').stale).toBe(true);
            expect(requests).toHaveLength(1); // The clock and resolve do not start work.
            mounted.rerender(<Reader tick={1}/>);
            expect(requests).toHaveLength(2);
            expect(mounted.container.textContent).toBe('Ada');
            mounted.rerender(<Reader tick={2}/>);
            expect(requests).toHaveLength(2);
            await act(async () => { cache.invalidate('user'); });
            expect(requests).toHaveLength(2);
            await act(async () => { requests[1].resolve(answer('Grace')); });
            expect(requests).toHaveLength(3); // Invalidation survived the TTL refresh.
            expect(mounted.container.textContent).toBe('Grace');
            await act(async () => { requests[2].resolve(answer('Grace')); });
            expect(cache.getEntry('user').invalidated).toBe(false);
            expect(cache.getEntry('user').stale).toBe(false);
            expect(requests).toHaveLength(3);
            expect(loadsInRender).toBe(0);
            mounted.unmount();
            mounted = undefined;
            now.mockReturnValue(122);
            cache.invalidate('user');
            expect(requests).toHaveLength(3);
        } finally {
            mounted?.unmount();
            now.mockRestore();
        }
    });

    test('abandoned mount starts no loader; committed mount loads and unmount disarms rearm', async () => {
        let calls = 0;
        let resolve!: (data: Data) => void;
        const cache = new Cache(() => {
            calls++;
            return new Promise<Data>(done => { resolve = done; });
        }, {ttl: Infinity});
        const never = new Promise<void>(() => {});
        const Parent = ({suspend}: {suspend: boolean}) => {
            const name = useResourceValue(cache, 'user', view => view.data?.left.name);
            if (suspend) throw never;
            return <span>{name ?? 'loading'}</span>;
        };
        const mounted = render(<React.Suspense fallback={<span>waiting</span>}><Parent suspend/></React.Suspense>);
        expect(calls).toBe(0);
        mounted.rerender(<React.Suspense fallback={<span>waiting</span>}><Parent suspend={false}/></React.Suspense>);
        expect(calls).toBe(1);
        await act(async () => {
            resolve({left: {name: 'Ada'}, right: {name: 'Grace'}});
        });
        expect(mounted.container.textContent).toBe('Ada');
        await act(async () => { cache.invalidate('user'); });
        expect(calls).toBe(2);
        await act(async () => { cache.invalidate('user'); });
        mounted.unmount();
        await act(async () => { resolve({left: {name: 'Ada'}, right: {name: 'Grace'}}); });
        expect(calls).toBe(2);
    });

    test('stale selection changes on parent TTL resolution without a source version change', async () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(100);
        let mounted: ReturnType<typeof render> | undefined;
        try {
            const cache = new Cache(async () => ({left: {name: 'Ada'}, right: {name: 'Grace'}}), {ttl: 10});
            await cache.load('user');
            const version = cache.getVersion();
            const values: boolean[] = [];
            const select = (view: TReadonly<IResourceView<Data>>) => view.stale;
            const Reader = ({tick}: {tick: number}) => {
                const stale = useResourceValue(cache, 'user', select);
                values.push(stale);
                return <span data-tick={tick}>{String(stale)}</span>;
            };
            mounted = render(<Reader tick={0}/>);
            expect(values[0]).toBe(false);
            now.mockReturnValue(111);
            expect(cache.getVersion()).toBe(version);
            mounted.rerender(<Reader tick={1}/>);
            expect(values).toContain(true);
        } finally { mounted?.unmount(); now.mockRestore(); }
    });

    test.each(['forget', 'restore'])('pending entry %s reloads without observing status', async operation => {
        const requests: Array<PromiseWithResolvers<Data>> = [];
        const cache = new Cache(() => {
            const request = Promise.withResolvers<Data>();
            requests.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const observations: Array<{present: boolean | undefined; version: number}> = [];
        const select = (view: TReadonly<IResourceView<Data>>) => {
            // Observe source ownership separately, without adding status/presence selector reads.
            observations.push({present: cache.resolve('user').present, version: cache.getVersion()});
            return view.data?.left.name;
        };
        const Reader = () => <span>{useResourceValue(cache, 'user', select) ?? 'loading'}</span>;
        const mounted = render(<Reader/>);
        try {
            expect(requests).toHaveLength(1);
            expect(observations[0].present).toBe(false);
            expect(observations[observations.length - 1]).toEqual({present: true, version: cache.getVersion()});
            const pendingVersion = cache.getVersion();
            await act(async () => {
                if (operation === 'forget') cache.forget('user');
                else cache.restore({entries: {}});
            });
            expect(observations.some(observation => !observation.present
                && observation.version > pendingVersion)).toBe(true);
            expect(requests).toHaveLength(2);
            await act(async () => { requests[1].resolve({left: {name: 'current'}, right: {name: 'other'}}); });
            expect(mounted.container.textContent).toBe('current');
        } finally { mounted.unmount(); }
    });

    test.each(['status', 'refreshing'] as const)('%s selectors deliver actual loading indicators', async field => {
        const requests: Array<PromiseWithResolvers<Data>> = [];
        const cache = new Cache(() => {
            const request = Promise.withResolvers<Data>();
            requests.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const values: Array<string | boolean> = [];
        const Reader = () => {
            const value = useResourceValue(cache, 'user', view => view[field]);
            values.push(value);
            return <span>{String(value)}</span>;
        };
        const mounted = render(<Reader/>);
        try {
            expect(requests).toHaveLength(1);
            await act(async () => { requests[0].resolve({left: {name: 'Ada'}, right: {name: 'other'}}); });
            expect(mounted.container.textContent).toBe(field === 'status' ? 'success' : 'false');
            await act(async () => { cache.invalidate('user'); });
            expect(requests).toHaveLength(2);
            if (field === 'refreshing') expect(mounted.container.textContent).toBe('true');
            await act(async () => { requests[1].resolve({left: {name: 'Ada'}, right: {name: 'other'}}); });
            expect(mounted.container.textContent).toBe(field === 'status' ? 'success' : 'false');
            expect(values).toContain(field === 'status' ? 'pending' : true);
            expect(requests).toHaveLength(2);
        } finally { mounted.unmount(); }
    });

    test('source replacement during a pending refresh disarms the old settlement generation', async () => {
        const requests: Array<PromiseWithResolvers<Data>> = [];
        const old = new Cache(() => {
            const request = Promise.withResolvers<Data>();
            requests.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const current = new Cache(async () => ({left: {name: 'current'}, right: {name: 'other'}}), {ttl: Infinity});
        await current.load('user');
        const Reader = ({source}: {source: Cache}) => <span>{
            useResourceValue(source, 'user', view => view.data?.left.name) ?? 'loading'
        }</span>;
        const mounted = render(<Reader source={old}/>);
        try {
            expect(requests).toHaveLength(1);
            await act(async () => { old.invalidate('user'); });
            mounted.rerender(<Reader source={current}/>);
            expect(mounted.container.textContent).toBe('current');
            await act(async () => { requests[0].resolve({left: {name: 'retired'}, right: {name: 'other'}}); });
            expect(requests).toHaveLength(1);
            expect(mounted.container.textContent).toBe('current');
            await act(async () => { current.rename('left', 'delivered'); });
            expect(mounted.container.textContent).toBe('delivered');
        } finally { mounted.unmount(); }
    });

    test('failure disarms automatic loads and explicit invalidation rearms exactly once', async () => {
        const requests: Array<PromiseWithResolvers<Data>> = [];
        const cache = new Cache(() => {
            const request = Promise.withResolvers<Data>();
            requests.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const Reader = ({tick}: {tick: number}) => <span data-tick={tick}>{
            useResourceValue(cache, 'user', view => view.error ?? view.data?.left.name ?? 'loading')
        }</span>;
        const mounted = render(<Reader tick={0}/>);
        try {
            await act(async () => { requests[0].reject(new Error('failed')); });
            expect(mounted.container.textContent).toBe('failed');
            mounted.rerender(<Reader tick={1}/>);
            expect(requests).toHaveLength(1);
            await act(async () => { cache.invalidate('user'); });
            expect(requests).toHaveLength(2);
            await act(async () => { cache.abort('user'); });
            mounted.rerender(<Reader tick={2}/>);
            expect(requests).toHaveLength(2);
            await act(async () => { cache.invalidateAll(); });
            expect(requests).toHaveLength(3);
            await act(async () => { requests[2].resolve({left: {name: 'recovered'}, right: {name: 'other'}}); });
            expect(mounted.container.textContent).toBe('recovered');
        } finally { mounted.unmount(); }
    });
});
