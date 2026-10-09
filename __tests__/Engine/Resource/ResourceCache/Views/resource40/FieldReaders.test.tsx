/* oxlint-disable react/globals -- Render counters and render-phase flags are intentional test instrumentation. */
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

interface IUser {
    id: number;
    name: string;
    other: string;
}

class FieldCache extends ResourceCache<IUser, number> {
    /** Writes an unread field without invalidating the answer. */
    public setError(id: number, error: string): void {
        const key = this.resolve(id).key;
        this.update(draft => { draft.entries[key].error = error; });
    }

    public setOther(id: number, other: string): void {
        const key = this.resolve(id).key;
        this.update(draft => { draft.entries[key].data!.other = other; });
    }

    /** Writes the displayed field without requesting a refresh. */
    public rename(id: number, name: string): void {
        const key = this.resolve(id).key;
        this.update(draft => { draft.entries[key].data!.name = name; });
    }
}

const fixture = () => {
    const calls: number[] = [];
    const pending: Array<PromiseWithResolvers<IUser>> = [];
    let rendering = false;
    let loadedDuringRender = false;
    const cache = new FieldCache(id => {
        loadedDuringRender ||= rendering;
        calls.push(id);
        const request = Promise.withResolvers<IUser>();
        pending.push(request);
        return request.promise;
    }, {ttl: Infinity});
    const hookRenders = Array.from({length: 50}, () => 0);
    const classRenders = Array.from({length: 50}, () => 0);
    const source: IResourceSource<IUser, number> = cache;

    const HookBadge = ({id}: {id: number}) => {
        rendering = true;
        try {
            hookRenders[id]++;
            const view: IResourceView<IUser> = useResourceValue(source, id);
            return <span>{view.data?.name ?? '…'}</span>;
        } finally {
            rendering = false;
        }
    };
    class ClassBadge extends AntiHookComponent<{id: number}> {
        public render() {
            rendering = true;
            try {
                classRenders[this.props.id]++;
                const view: IResourceView<IUser> = this.useResource(source, this.props.id);
                return <span>{view.data?.name ?? '…'}</span>;
            } finally {
                rendering = false;
            }
        }
    }
    const settle = async (start: number, end: number, name?: string) => {
        await act(async () => {
            for (let index = start; index < end; index++) {
                const id = calls[index];
                pending[index].resolve({id, name: name ?? `user ${id}`, other: `other ${id}`});
            }
        });
    };
    return {cache, calls, pending, hookRenders, classRenders, HookBadge, ClassBadge, settle,
        loadedDuringRender: () => loadedDuringRender};
};

const mountPairs = (state: ReturnType<typeof fixture>) => render(
    <div>{Array.from({length: 50}, (_, id) => <React.Fragment key={id}>
        <state.HookBadge id={id}/><state.ClassBadge id={id}/>
    </React.Fragment>)}</div>
);

describe('R40-04 useResourceValue field readers', () => {
    test('interop exports the resource hook', () => {
        expect(typeof useResourceValue).toBe('function');
    });

    test('50 data.name readers match class mount and equal invalidateAll counts exactly', async () => {
        const state = fixture();
        const mounted = mountPairs(state);
        await state.settle(0, 50);
        expect(state.calls).toEqual(Array.from({length: 50}, (_, id) => id));
        expect(state.hookRenders).toEqual(Array(50).fill(2));
        expect(state.hookRenders).toEqual(state.classRenders);
        const text = state.calls.map(id => `user ${id}user ${id}`).join('');
        expect(mounted.container.textContent).toBe(text);
        state.hookRenders.fill(0);
        state.classRenders.fill(0);
        await act(async () => { state.cache.invalidateAll(); });
        expect(state.calls.slice(50)).toEqual(Array.from({length: 50}, (_, id) => id));
        await state.settle(50, 100);
        expect(state.calls).toHaveLength(100);
        expect(state.hookRenders).toEqual(Array(50).fill(2));
        expect(state.hookRenders).toEqual(state.classRenders);
        expect(mounted.container.textContent).toBe(text);
        expect(state.loadedDuringRender()).toBe(false);
        mounted.unmount();
    });

    test('invalidate(args) reloads only that entry and delivers its changed name', async () => {
        const state = fixture();
        const mounted = render(<><state.HookBadge id={0}/><state.HookBadge id={1}/></>);
        await state.settle(0, 2);
        const unrelatedRenders = state.hookRenders[1];
        await act(async () => { state.cache.invalidate(0); });
        expect(state.calls).toEqual([0, 1, 0]);
        expect(mounted.container.textContent).toBe('user 0user 1');
        await state.settle(2, 3, 'changed');
        expect(mounted.container.textContent).toBe('changeduser 1');
        expect(state.hookRenders[1]).toBe(unrelatedRenders);
        expect(state.calls).toEqual([0, 1, 0]);
        expect(state.loadedDuringRender()).toBe(false);
        mounted.unmount();
    });

    test('unread error writes do not render, but displayed data writes do', async () => {
        const state = fixture();
        const loaded = state.cache.load(0);
        state.pending[0].resolve({id: 0, name: 'user 0', other: 'other 0'});
        await loaded;
        const mounted = render(<state.HookBadge id={0}/>);
        const before = state.hookRenders[0];
        await act(async () => { state.cache.setError(0, 'unread'); });
        expect(state.cache.getEntry(0).error).toBe('unread');
        expect(state.hookRenders[0]).toBe(before);
        await act(async () => { state.cache.rename(0, 'visible'); });
        expect(state.hookRenders[0]).toBe(before + 1);
        expect(mounted.container.textContent).toBe('visible');
        expect(state.calls).toEqual([0]);
        mounted.unmount();
    });

    test('data.other readers ignore data.name writes but render on data.other writes', async () => {
        const state = fixture();
        const loaded = state.cache.load(0);
        state.pending[0].resolve({id: 0, name: 'user 0', other: 'other 0'});
        await loaded;
        let renders = 0;
        const OtherReader = () => {
            renders++;
            const view = useResourceValue(state.cache, 0);
            return <span>{view.data?.other ?? '…'}</span>;
        };
        const mounted = render(<OtherReader/>);
        try {
            const before = renders;
            await act(async () => { state.cache.rename(0, 'changed name'); });
            expect(state.cache.getEntry(0).data?.name).toBe('changed name');
            expect(renders).toBe(before);
            expect(mounted.container.textContent).toBe('other 0');
            await act(async () => { state.cache.setOther(0, 'changed other'); });
            expect(state.cache.getEntry(0).data?.other).toBe('changed other');
            expect(renders).toBe(before + 1);
            expect(mounted.container.textContent).toBe('changed other');
            expect(state.calls).toEqual([0]);
        } finally {
            mounted.unmount();
        }
    });

    test('invalidation during an equal refresh rearms once after settlement', async () => {
        const state = fixture();
        const mounted = render(<state.HookBadge id={0}/>);
        await state.settle(0, 1);
        await act(async () => { state.cache.invalidate(0); });
        expect(state.calls).toEqual([0, 0]);
        await act(async () => { state.cache.invalidate(0); });
        expect(state.calls).toEqual([0, 0]);
        await state.settle(1, 2);
        expect(state.calls).toEqual([0, 0, 0]);
        expect(mounted.container.textContent).toBe('user 0');
        await state.settle(2, 3);
        expect(state.calls).toEqual([0, 0, 0]);
        expect(state.cache.getEntry(0).invalidated).toBe(false);
        expect(state.cache.getEntry(0).refreshing).toBe(false);
        expect(state.loadedDuringRender()).toBe(false);
        mounted.unmount();
    });
});
