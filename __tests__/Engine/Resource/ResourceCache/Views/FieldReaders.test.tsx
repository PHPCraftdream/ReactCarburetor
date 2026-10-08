import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, EResourceStatus} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

interface IUser {
    id: number;
    name: string;
}

class FieldCache extends ResourceCache<IUser, number> {
    /** Publishes an error-only write to test escaped-view tracking. */
    public setError(id: number, error: string): void {
        const key = this.resolve(id).key;
        this.update(draft => { draft.entries[key].error = error; });
    }
}

const fixture = (maxEntries: number = Infinity) => {
    const calls: number[] = [];
    const pending: Array<PromiseWithResolvers<IUser>> = [];
    const renders = Array.from({length: 50}, () => 0);
    let rendering = false;
    let loadedDuringRender = false;
    const cache = new FieldCache((id) => {
        loadedDuringRender ||= rendering;
        calls.push(id);
        const request = Promise.withResolvers<IUser>();
        pending.push(request);
        return request.promise;
    }, {ttl: 60_000, maxEntries});

    class Badge extends AntiHookComponent<{id: number}> {
        public render() {
            rendering = true;
            try {
                renders[this.props.id]++;
                const view = this.useResource(cache, this.props.id);
                return <span>{view.data?.name ?? '…'}</span>;
            } finally {
                rendering = false;
            }
        }
    }

    const settle = async (start: number, end: number) => {
        await act(async () => {
            for (let index = start; index < end; index++) {
                const id = calls[index];
                pending[index].resolve({id, name: `user ${id}`});
            }
        });
    };

    return {cache, calls, pending, renders, Badge, settle, loadedDuringRender: () => loadedDuringRender};
};

const mountRows = (Badge: ReturnType<typeof fixture>['Badge']) => render(
    <div>{Array.from({length: 50}, (_, id) => <Badge key={id} id={id}/>)}</div>
);

describe('R39-07 resource field readers', () => {
    test('separate first creations for multiple absent entries do not render default data', async () => {
        const state = fixture();
        let renders = 0;
        class Pair extends AntiHookComponent {
            public render() {
                renders++;
                const first = this.useResource(state.cache, 0).data;
                const second = this.useResource(state.cache, 1).data;
                return <span>{first?.name ?? '…'}:{second?.name ?? '…'}</span>;
            }
        }
        const mounted = render(<Pair/>);
        await act(async () => {});
        expect(state.calls).toEqual([0, 1]);
        expect(mounted.container.textContent).toBe('…:…');
        expect(renders).toBe(1);
        await state.settle(0, 2);
        expect(mounted.container.textContent).toBe('user 0:user 1');
        mounted.unmount();
    });

    test('field facades retain writable snapshot fields without mutating the cache', async () => {
        const state = fixture();
        const loaded = state.cache.load(0);
        state.pending[0].resolve({id: 0, name: 'user 0'});
        await loaded;
        const resolved = state.cache.resolve(0);
        const paths: string[] = [];
        const view = resolved.fieldView!(path => paths.push(path));
        view.data = {id: 9, name: 'local'};
        view.refreshing = true;
        expect(paths).toEqual([]);
        expect(view.data?.name).toBe('local');
        expect(view.refreshing).toBe(true);
        expect(state.cache.getEntry(0).data?.name).toBe('user 0');
        expect(resolved.view.refreshing).toBe(false);
    });

    test('50 data-only readers render at most twice on mount', async () => {
        const state = fixture();
        const mounted = mountRows(state.Badge);
        await state.settle(0, 50);
        expect(state.calls).toEqual(Array.from({length: 50}, (_, id) => id));
        expect(state.loadedDuringRender()).toBe(false);
        expect(mounted.container.textContent).toBe(state.calls.map(id => `user ${id}`).join(''));
        mounted.unmount();
        expect(Math.max(...state.renders)).toBeLessThanOrEqual(2);
    });

    test('50 equal invalidateAll refreshes preserve text with at most two renders each', async () => {
        const state = fixture();
        const mounted = mountRows(state.Badge);
        await state.settle(0, 50);
        const text = mounted.container.textContent;
        state.renders.fill(0);
        await act(async () => { state.cache.invalidateAll(); });
        expect(state.calls).toHaveLength(100);
        expect(state.calls.slice(50)).toEqual(Array.from({length: 50}, (_, id) => id));
        await state.settle(50, 100);
        expect(state.calls).toHaveLength(100);
        expect(state.loadedDuringRender()).toBe(false);
        expect(mounted.container.textContent).toBe(text);
        mounted.unmount();
        expect(Math.min(...state.renders)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...state.renders)).toBeLessThanOrEqual(2);
    });

    test.each(['setData', 'restore'] as const)('%s status-only Error to Idle rearms a stale reader', async method => {
        const state = fixture();
        const key = state.cache.resolve(0).key;
        const entry = {...state.cache.getEntry(0), status: EResourceStatus.Error};
        state.cache.setData({entries: {[key]: entry}});
        const mounted = render(<state.Badge id={0}/>);
        expect(state.calls).toEqual([]);
        expect(state.renders[0]).toBe(1);
        await act(async () => {
            state.cache[method]({entries: {[key]: {...entry, status: EResourceStatus.Idle}}});
        });
        expect(state.calls).toEqual([0]);
        expect(state.cache.getEntry(0).status).toBe(EResourceStatus.Pending);
        expect(state.renders[0]).toBe(3);
        await state.settle(0, 1);
        expect(state.cache.getEntry(0).status).toBe(EResourceStatus.Success);
        expect(state.renders[0]).toBe(4);
        expect(state.calls).toEqual([0]);
        expect(state.loadedDuringRender()).toBe(false);
        mounted.unmount();
    });

    test.each(['setData', 'restore'] as const)('%s status-only Idle to Success wakes without loading', async method => {
        const state = fixture();
        const key = state.cache.resolve(0).key;
        const entry = {...state.cache.getEntry(0), updatedAt: Date.now()};
        state.cache.setData({entries: {[key]: entry}});
        const mounted = render(<state.Badge id={0}/>);
        expect(state.calls).toEqual([]);
        await act(async () => {
            state.cache[method]({entries: {[key]: {...entry, status: EResourceStatus.Success}}});
        });
        expect(state.renders[0]).toBe(2);
        expect(state.calls).toEqual([]);
        expect(state.cache.getEntry(0).status).toBe(EResourceStatus.Success);
        mounted.unmount();
    });

    test.each(['refreshing', 'status'] as const)('%s-only reader has exact indicator renders', async field => {
        const state = fixture();
        const values: Array<boolean | string> = [];
        class Indicator extends AntiHookComponent {
            public render() {
                const value = this.useResource(state.cache, 0)[field];
                values.push(value);
                return <span>{String(value)}</span>;
            }
        }
        const mounted = render(<Indicator/>);
        await state.settle(0, 1);
        expect(values).toEqual(field === 'refreshing' ? [false, false] : ['idle', 'pending', 'success']);
        values.length = 0;
        await act(async () => { state.cache.invalidateAll(); });
        await state.settle(1, 2);
        expect(values).toEqual(field === 'refreshing' ? [false, true, false] : ['success', 'success']);
        expect(state.calls).toEqual([0, 0]);
        mounted.unmount();
    });

    test('refreshing and status readers still receive their indicator transitions', async () => {
        const state = fixture();
        const statuses: EResourceStatus[] = [];
        const refreshing: boolean[] = [];
        class Indicators extends AntiHookComponent {
            public render() {
                const view = this.useResource(state.cache, 0);
                statuses.push(view.status);
                refreshing.push(view.refreshing);
                return <span>{view.status}:{String(view.refreshing)}</span>;
            }
        }
        const mounted = render(<Indicators/>);
        expect(mounted.container.textContent).toBe('pending:false');
        await state.settle(0, 1);
        expect(mounted.container.textContent).toBe('success:false');
        await act(async () => { state.cache.invalidateAll(); });
        expect(mounted.container.textContent).toBe('success:true');
        await state.settle(1, 2);
        expect(mounted.container.textContent).toBe('success:false');
        expect(statuses).toContain(EResourceStatus.Idle);
        expect(statuses).toContain(EResourceStatus.Pending);
        expect(statuses).toContain(EResourceStatus.Success);
        expect(refreshing.slice(-2)).toEqual([true, false]);
        mounted.unmount();
    });

    test.each(['invalidate', 'invalidateAll'] as const)(
        '%s rearms a failed data-only refresh only after commit',
        async (method) => {
            const state = fixture();
            const mounted = render(<state.Badge id={0}/>);
            await state.settle(0, 1);
            await act(async () => {
                if (method === 'invalidate') state.cache.invalidate(0);
                else state.cache.invalidateAll();
            });
            expect(state.calls).toEqual([0, 0]);
            await act(async () => { state.pending[1].reject(new Error('offline')); });
            expect(state.calls).toEqual([0, 0]);
            expect(mounted.container.textContent).toBe('user 0');
            mounted.rerender(<state.Badge id={0}/>);
            await act(async () => {});
            expect(state.calls).toEqual([0, 0]);
            await act(async () => {
                if (method === 'invalidate') state.cache.invalidate(0);
                else state.cache.invalidateAll();
            });
            expect(state.calls).toEqual([0, 0, 0]);
            await state.settle(2, 3);
            expect(state.calls).toEqual([0, 0, 0]);
            expect(state.loadedDuringRender()).toBe(false);
            expect(mounted.container.textContent).toBe('user 0');
            mounted.unmount();
        }
    );

    test('a field-read component retains its entry under maxEntries zero until unmount', async () => {
        const state = fixture(0);
        const mounted = render(<state.Badge id={0}/>);
        await state.settle(0, 1);
        await act(async () => {
            void state.cache.load(1);
        });
        await state.settle(1, 2);
        expect(state.cache.getEntry(0).data?.name).toBe('user 0');
        expect(state.cache.getEntry(1).data).toBeUndefined();
        expect(mounted.container.textContent).toBe('user 0');
        expect(state.calls).toEqual([0, 1]);
        mounted.unmount();
        void state.cache.load(2);
        await state.settle(2, 3);
        expect(state.cache.getEntry(0).data).toBeUndefined();
        expect(Object.keys(state.cache.getData().entries)).toHaveLength(0);
    });

    test('stale reads record real freshness fields while ordinary views remain plain', async () => {
        const state = fixture();
        const loaded = state.cache.load(0);
        state.pending[0].resolve({id: 0, name: 'user 0'});
        await loaded;
        const resolved = state.cache.resolve(0);
        const paths: string[] = [];
        const fieldView = resolved.fieldView!(path => paths.push(path));
        expect(fieldView.stale).toBe(false);
        expect(paths).toHaveLength(2);
        expect(paths.every(path => path.startsWith(resolved.path))).toBe(true);
        expect(paths.some(path => path.endsWith('invalidated'))).toBe(true);
        expect(paths.some(path => path.endsWith('updatedAt'))).toBe(true);
        expect(Object.getOwnPropertyDescriptor(resolved.view, 'data')?.get).toBeUndefined();
        expect(Object.getOwnPropertyDescriptor(state.cache.getEntry(0), 'stale')?.get).toBeUndefined();
    });

    test('in-flight invalidation rearms an equal data-only answer', async () => {
        const state = fixture();
        const mounted = render(<state.Badge id={0}/>);
        await state.settle(0, 1);
        await act(async () => { state.cache.invalidate(0); });
        expect(state.calls).toEqual([0, 0]);
        await act(async () => { state.cache.invalidate(0); });
        await state.settle(1, 2);
        expect(state.calls).toEqual([0, 0, 0]);
        await state.settle(2, 3);
        expect(state.calls).toEqual([0, 0, 0]);
        expect(mounted.container.textContent).toBe('user 0');
        mounted.unmount();
    });

    test('accessing an escaped view outside render does not widen field subscriptions', async () => {
        const state = fixture();
        const first = state.cache.load(0);
        state.pending[0].resolve({id: 0, name: 'user 0'});
        await first;
        let escaped: {data: IUser | undefined; error: string | undefined} = {data: undefined, error: undefined};
        let renders = 0;
        class Reader extends AntiHookComponent {
            public render() {
                renders++;
                escaped = this.useResource(state.cache, 0);
                return <span>{escaped.data?.name}</span>;
            }
        }
        const mounted = render(<Reader/>);
        expect(escaped?.error).toBeUndefined();
        const before = renders;
        await act(async () => {
            state.cache.setError(0, 'outside-only');
        });
        expect(mounted.container.textContent).toBe('user 0');
        expect(state.calls).toEqual([0]);
        mounted.unmount();
        expect(renders - before).toBe(0);
    });
});
