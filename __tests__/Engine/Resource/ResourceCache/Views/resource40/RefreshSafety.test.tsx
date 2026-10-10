/* oxlint-disable react/globals -- Render counters and render-phase flags are intentional test instrumentation. */
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, diagnostics} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {useResourceValue} from '@/Interop';

interface IUser {
    id: number;
    name: string;
    other: string;
}

interface IArgs { id: number; }
type Field = 'name' | 'other' | 'error';

class SafetyCache extends ResourceCache<IUser, IArgs> {
    public get observerCount(): number { return Object.keys(this[S.subscribers]).length; }

    public write(id: number, field: Field, value: string): void {
        const key = this.resolve({id}).key;
        this.update(draft => {
            if (field === 'error') draft.entries[key].error = value;
            else draft.entries[key].data![field] = value;
        });
    }
}

const fixture = (ttl: number = Infinity) => {
    const calls: number[] = [];
    const pending: Array<PromiseWithResolvers<IUser>> = [];
    const renderLoads: number[] = [];
    let rendering = false;
    let renders = 0;
    const cache = new SafetyCache(args => {
        if (rendering) renderLoads.push(args.id);
        calls.push(args.id);
        const request = Promise.withResolvers<IUser>();
        pending.push(request);
        return request.promise;
    }, {ttl});
    const Reader = ({args, field = 'name', suspend}: {
        args: IArgs;
        field?: Field;
        suspend?: Promise<void>;
    }) => {
        rendering = true;
        try {
            renders++;
            const value = useResourceValue(cache, args,
                view => field === 'error' ? view.error : view.data?.[field]);
            if (suspend) throw suspend;
            return <span>{value ?? '…'}</span>;
        } finally {
            rendering = false;
        }
    };
    class ClassReader extends AntiHookComponent<{args: IArgs}> {
        public render() {
            rendering = true;
            try {
                return <span>{this.useResource(cache, this.props.args).data?.name ?? '…'}</span>;
            } finally {
                rendering = false;
            }
        }
    }
    const answer = (index: number, name: string = `user ${calls[index]}`) =>
        pending[index].resolve({id: calls[index], name, other: `other ${calls[index]}`});
    const settle = async (index: number, name?: string) => {
        await act(async () => { answer(index, name); });
    };
    const preload = async (id: number) => {
        const loaded = cache.load({id});
        answer(pending.length - 1);
        await loaded;
    };
    return {cache, calls, pending, renderLoads, Reader, ClassReader, settle, preload,
        renders: () => renders};
};

describe('R40-04 useResourceValue refresh safety', () => {
    test('a parent switching from name to an unread other field sees its latest value immediately', async () => {
        const state = fixture();
        await state.preload(0);
        const args = {id: 0};
        const Parent = ({field}: {field: Field}) => <state.Reader args={args} field={field}/>;
        const mounted = render(<Parent field="name"/>);
        try {
            const before = state.renders();
            await act(async () => { state.cache.write(0, 'other', 'latest other'); });
            expect(state.renders()).toBe(before);
            expect(mounted.container.textContent).toBe('user 0');
            mounted.rerender(<Parent field="other"/>);
            expect(mounted.container.textContent).toBe('latest other');
            await act(async () => { state.cache.write(0, 'other', 'next other'); });
            expect(mounted.container.textContent).toBe('next other');
            expect(state.calls).toEqual([0]);
        } finally {
            mounted.unmount();
        }
    });

    test('a parent switching from name to an unread error sees its latest value immediately', async () => {
        const state = fixture();
        await state.preload(0);
        const args = {id: 0};
        const Parent = ({field}: {field: Field}) => <state.Reader args={args} field={field}/>;
        const mounted = render(<Parent field="name"/>);
        try {
            const before = state.renders();
            await act(async () => { state.cache.write(0, 'error', 'latest error'); });
            expect(state.renders()).toBe(before);
            expect(mounted.container.textContent).toBe('user 0');
            mounted.rerender(<Parent field="error"/>);
            expect(mounted.container.textContent).toBe('latest error');
            await act(async () => { state.cache.write(0, 'error', 'next error'); });
            expect(mounted.container.textContent).toBe('next error');
            expect(state.calls).toEqual([0]);
        } finally {
            mounted.unmount();
        }
    });

    test('an unrelated parent rerender after TTL expiry starts exactly one post-render refresh', async () => {
        const now = rstest.spyOn(Date, 'now').mockReturnValue(100);
        let mounted: ReturnType<typeof render> | undefined;
        try {
            const state = fixture(10);
            await state.preload(0);
            const args = {id: 0};
            const Parent = ({tick}: {tick: number}) => <div data-tick={tick}><state.Reader args={args}/></div>;
            mounted = render(<Parent tick={0}/>);
            expect(state.calls).toEqual([0]);
            now.mockReturnValue(111);
            expect(state.cache.getEntry(args).stale).toBe(true);
            mounted.rerender(<Parent tick={1}/>);
            expect(state.renderLoads).toEqual([]);
            expect(state.calls).toEqual([0, 0]);
            expect(mounted.container.textContent).toBe('user 0');
            mounted.rerender(<Parent tick={2}/>);
            expect(state.calls).toEqual([0, 0]);
            await state.settle(1, 'fresh');
            expect(mounted.container.textContent).toBe('fresh');
            expect(state.calls).toEqual([0, 0]);
        } finally {
            mounted?.unmount();
            now.mockRestore();
        }
    });

    test('mutating retired args A after equivalent B replaces it cannot redirect entry zero reads', async () => {
        const state = fixture();
        await state.preload(0);
        const a = {id: 0};
        const b = {id: 0};
        const mounted = render(<state.Reader args={a}/>);
        try {
            const registrations = state.cache.observerCount;
            mounted.rerender(<state.Reader args={b}/>);
            expect(state.cache.observerCount).toBe(registrations);
            a.id = 1;
            await act(async () => { state.cache.write(0, 'name', 'entry zero updated'); });
            expect(mounted.container.textContent).toBe('entry zero updated');
            expect(state.calls).toEqual([0]);
            expect(state.cache.resolve({id: 1}).present).toBe(false);
        } finally {
            mounted.unmount();
        }
        expect(state.cache.observerCount).toBe(0);
    });

    test('a class reader before a hook shares one pending load without a render-load diagnostic', async () => {
        const state = fixture();
        const wasEnabled = diagnostics.isEnabled();
        const reported: string[] = [];
        const error = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            reported.push(args.map(String).join(' '));
        });
        let mounted: ReturnType<typeof render> | undefined;
        diagnostics.setEnabled(true);
        try {
            mounted = render(<><state.ClassReader args={{id: 0}}/><state.Reader args={{id: 0}}/></>);
            expect(state.calls).toEqual([0]);
            expect(state.renderLoads).toEqual([]);
            await state.settle(0, 'shared');
            expect(mounted.container.textContent).toBe('sharedshared');
            expect(state.calls).toEqual([0]);
            expect(reported.filter(message => message.startsWith('Carburetor: ')
                && /load/i.test(message) && /render/i.test(message))).toEqual([]);
        } finally {
            mounted?.unmount();
            error.mockRestore();
            diagnostics.setEnabled(wasEnabled);
        }
        expect(state.cache.observerCount).toBe(0);
    });

    test('an abandoned Suspense args render neither loads nor leaks and committed fields still arrive', async () => {
        const state = fixture();
        const blocked = Promise.withResolvers<void>();
        const current = {id: 0};
        const abandoned = {id: 1};
        const Parent = ({suspended}: {suspended: boolean}) =>
            <React.Suspense fallback={<span>waiting</span>}>
                <state.Reader args={suspended ? abandoned : current}
                    field={suspended ? 'other' : 'name'} suspend={suspended ? blocked.promise : undefined}/>
            </React.Suspense>;
        const mounted = render(<Parent suspended={false}/>);
        try {
            await state.settle(0);
            const registrations = state.cache.observerCount;
            expect(registrations).toBeGreaterThan(0);
            const before = state.renders();
            mounted.rerender(<Parent suspended/>);
            expect(state.renders()).toBeGreaterThan(before);
            expect(mounted.container.textContent).toContain('waiting');
            expect(state.calls).toEqual([0]);
            expect(state.cache.resolve(abandoned).present).toBe(false);
            expect(state.cache.observerCount).toBeLessThanOrEqual(registrations);
            await act(async () => { state.cache.write(0, 'name', 'committed update'); });
            mounted.rerender(<Parent suspended={false}/>);
            expect(mounted.container.textContent).toBe('committed update');
            expect(state.cache.observerCount).toBe(registrations);
            await act(async () => { blocked.resolve(); });
            await act(async () => { state.cache.write(0, 'name', 'delivered'); });
            expect(mounted.container.textContent).toBe('delivered');
            expect(state.calls).toEqual([0]);
            expect(state.renderLoads).toEqual([]);
        } finally {
            mounted.unmount();
        }
        expect(state.cache.observerCount).toBe(0);
        await act(async () => { state.cache.invalidateAll(); });
        expect(state.calls).toEqual([0]);
    });

    test('StrictMode replay deduplicates pending loads and cleans every subscription on unmount', async () => {
        const state = fixture();
        const mounted = render(<React.StrictMode>
            <state.Reader args={{id: 0}}/><state.Reader args={{id: 0}}/>
        </React.StrictMode>);
        try {
            expect(state.calls).toEqual([0]);
            expect(state.cache.observerCount).toBeGreaterThan(0);
            await state.settle(0);
            expect(mounted.container.textContent).toBe('user 0user 0');
            await act(async () => { state.cache.invalidate({id: 0}); });
            expect(state.calls).toEqual([0, 0]);
            await act(async () => { state.cache.invalidate({id: 0}); });
            expect(state.calls).toEqual([0, 0]);
            expect(state.renderLoads).toEqual([]);
        } finally {
            mounted.unmount();
        }
        expect(state.cache.observerCount).toBe(0);
        await state.settle(1, 'after unmount');
        await act(async () => { state.cache.invalidateAll(); });
        expect(state.calls).toEqual([0, 0]);
        expect(state.cache.observerCount).toBe(0);
    });
});
