/* oxlint-disable react/globals -- Render counters and render-phase flags are intentional test instrumentation. */
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {hydrateRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {diagnostics} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {useResourceValue} from '@/Interop';

interface IUser {
    id: number;
    name: string;
}

interface IArgs {
    id: number;
}

class ObservedCache extends ResourceCache<IUser, IArgs> {
    /** Counts live registrations rather than subscribe calls. */
    public get observerCount(): number { return Object.keys(this[S.subscribers]).length; }
}

const fixture = () => {
    const calls: number[] = [];
    const pending: Array<PromiseWithResolvers<IUser>> = [];
    let rendering = false;
    let loadedDuringRender = false;
    let renders = 0;
    const cache = new ObservedCache(args => {
        loadedDuringRender ||= rendering;
        calls.push(args.id);
        const request = Promise.withResolvers<IUser>();
        pending.push(request);
        return request.promise;
    }, {ttl: Infinity});
    const Reader = ({args}: {args: IArgs}) => {
        rendering = true;
        try {
            renders++;
            const name = useResourceValue(cache, args, view => view.data?.name);
            return <span>{name ?? '…'}</span>;
        } finally {
            rendering = false;
        }
    };
    const settle = async (index: number, name: string = `user ${calls[index]}`) => {
        await act(async () => { pending[index].resolve({id: calls[index], name}); });
    };
    return {cache, calls, pending, Reader, settle, renders: () => renders,
        loadedDuringRender: () => loadedDuringRender};
};

describe('R40-04 useResourceValue ownership', () => {
    test('the first render snapshots zero loader calls and commit starts exactly one load', async () => {
        const state = fixture();
        const renderSnapshots: number[] = [];
        const Reader = () => {
            const name = useResourceValue(state.cache, {id: 0}, view => view.data?.name);
            renderSnapshots.push(state.calls.length);
            return <span>{name ?? '…'}</span>;
        };
        const mounted = render(<Reader/>);
        try {
            expect(renderSnapshots[0]).toBe(0);
            expect(state.calls).toHaveLength(1);
            expect(state.calls).toEqual([0]);
            await state.settle(0);
            expect(mounted.container.textContent).toBe('user 0');
            expect(state.calls).toHaveLength(1);
        } finally {
            mounted.unmount();
        }
    });

    test.each([true, false])(
        'direct cache.load during hooked render uses development diagnostics (enabled=%s)', async enabled => {
        const state = fixture();
        const original = console.error;
        const wasEnabled = diagnostics.isEnabled();
        const reported: string[] = [];
        let mounted: ReturnType<typeof render> | undefined;
        const DirectLoader = () => {
            useResourceValue(state.cache, {id: 0}, view => view.data?.name);
            void state.cache.load({id: 0});
            return <span>direct load</span>;
        };
        console.error = (...args: unknown[]) => { reported.push(args.map(String).join(' ')); };
        diagnostics.setEnabled(enabled);
        try {
            mounted = render(<DirectLoader/>);
            const complaints = reported.filter(message =>
                message.startsWith('Carburetor: ') && /load/i.test(message) && /render/i.test(message));
            if (enabled) {
                expect(complaints.length).toBeGreaterThan(0);
            } else {
                expect(complaints).toEqual([]);
            }
            await state.settle(0);
        } finally {
            mounted?.unmount();
            console.error = original;
            diagnostics.setEnabled(wasEnabled);
        }
    });

    test('equivalent argument objects share one load and one invalidation refresh', async () => {
        const state = fixture();
        const mounted = render(<><state.Reader args={{id: 0}}/><state.Reader args={{id: 0}}/></>);
        expect(state.calls).toEqual([0]);
        expect(state.cache.observerCount).toBeGreaterThan(0);
        await state.settle(0);
        expect(mounted.container.textContent).toBe('user 0user 0');
        await act(async () => { state.cache.invalidate({id: 0}); });
        expect(state.calls).toEqual([0, 0]);
        await state.settle(1, 'shared');
        expect(mounted.container.textContent).toBe('sharedshared');
        expect(state.calls).toEqual([0, 0]);
        expect(state.loadedDuringRender()).toBe(false);
        mounted.unmount();
        expect(state.cache.observerCount).toBe(0);
        await act(async () => { state.cache.invalidateAll(); });
        expect(state.calls).toEqual([0, 0]);
    });

    test('switching args releases the old entry and ignores its pending settlement', async () => {
        const state = fixture();
        const mounted = render(<state.Reader args={{id: 0}}/>);
        expect(state.calls).toEqual([0]);
        const registrations = state.cache.observerCount;
        expect(registrations).toBeGreaterThan(0);
        mounted.rerender(<state.Reader args={{id: 1}}/>);
        expect(state.calls).toEqual([0, 1]);
        expect(mounted.container.textContent).toBe('…');
        expect(state.cache.observerCount).toBe(registrations);
        const beforeOldAnswer = state.renders();
        await state.settle(0, 'old');
        expect(state.renders()).toBe(beforeOldAnswer);
        expect(mounted.container.textContent).toBe('…');
        await state.settle(1, 'current');
        expect(mounted.container.textContent).toBe('current');
        const beforeOldInvalidation = state.renders();
        await act(async () => { state.cache.invalidate({id: 0}); });
        expect(state.renders()).toBe(beforeOldInvalidation);
        expect(state.calls).toEqual([0, 1]);
        mounted.unmount();
        expect(state.cache.observerCount).toBe(0);
        await act(async () => { state.cache.invalidate({id: 1}); });
        expect(state.calls).toEqual([0, 1]);
        expect(state.loadedDuringRender()).toBe(false);
    });

    test('unmount during an invalidated refresh releases subscribers and suppresses rearming', async () => {
        const state = fixture();
        const mounted = render(<state.Reader args={{id: 0}}/>);
        await state.settle(0);
        await act(async () => { state.cache.invalidate({id: 0}); });
        expect(state.calls).toEqual([0, 0]);
        await act(async () => { state.cache.invalidate({id: 0}); });
        mounted.unmount();
        expect(state.cache.observerCount).toBe(0);
        const before = state.renders();
        await state.settle(1);
        expect(state.cache.getEntry({id: 0}).invalidated).toBe(true);
        expect(state.calls).toEqual([0, 0]);
        expect(state.renders()).toBe(before);
        expect(state.cache.observerCount).toBe(0);
    });

    test('SSR of a missing entry neither loads nor subscribes; hydration loads after commit', async () => {
        const state = fixture();
        const container = document.createElement('div');
        container.innerHTML = renderToString(<state.Reader args={{id: 0}}/>);
        expect(container.textContent).toBe('…');
        expect(state.calls).toEqual([]);
        expect(state.cache.observerCount).toBe(0);
        expect(Object.keys(state.cache.getData().entries)).toEqual([]);
        const errors: unknown[] = [];
        document.body.appendChild(container);
        let root: ReturnType<typeof hydrateRoot> | undefined;
        try {
            await act(async () => {
                root = hydrateRoot(container, <state.Reader args={{id: 0}}/>, {
                    onRecoverableError: error => { errors.push(error); },
                });
            });
            expect(errors).toEqual([]);
            expect(state.calls).toEqual([0]);
            expect(state.cache.observerCount).toBeGreaterThan(0);
            expect(container.textContent).toBe('…');
            await state.settle(0);
            expect(container.textContent).toBe('user 0');
            expect(state.calls).toEqual([0]);
            expect(state.loadedDuringRender()).toBe(false);
        } finally {
            await act(async () => { root?.unmount(); });
            container.remove();
        }
        expect(state.cache.observerCount).toBe(0);
    });

    test.each([false, true])('restored SSR data hydrates without mismatch (invalidated=%s)', async invalidated => {
        const server = fixture();
        const loaded = server.cache.load({id: 0});
        server.pending[0].resolve({id: 0, name: 'server'});
        await loaded;
        if (invalidated) server.cache.invalidate({id: 0});
        const markup = renderToString(<server.Reader args={{id: 0}}/>);
        expect(server.calls).toEqual([0]);
        expect(server.cache.observerCount).toBe(0);
        const client = fixture();
        client.cache.restore(JSON.parse(JSON.stringify(server.cache.getData())));
        const container = document.createElement('div');
        container.innerHTML = markup;
        document.body.appendChild(container);
        const errors: unknown[] = [];
        let root: ReturnType<typeof hydrateRoot> | undefined;
        try {
            await act(async () => {
                root = hydrateRoot(container, <client.Reader args={{id: 0}}/>, {
                    onRecoverableError: error => { errors.push(error); },
                });
            });
            expect(errors).toEqual([]);
            expect(container.textContent).toBe('server');
            expect(client.calls).toEqual(invalidated ? [0] : []);
            expect(client.cache.observerCount).toBeGreaterThan(0);
            if (invalidated) {
                await client.settle(0, 'client');
                expect(container.textContent).toBe('client');
                expect(client.calls).toEqual([0]);
            }
            expect(client.loadedDuringRender()).toBe(false);
        } finally {
            await act(async () => { root?.unmount(); });
            container.remove();
        }
        expect(client.cache.observerCount).toBe(0);
    });
});
