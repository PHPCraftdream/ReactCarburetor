import * as React from 'react';
import {TestCache} from '../Helpers/TestCache';
import {act} from 'react';
import {render} from '@testing-library/react';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

const controlled = (ttl: number = Infinity) => {
    const pending: Array<PromiseWithResolvers<string>> = [];
    const cache = new TestCache<string, string>(() => {
        const request = Promise.withResolvers<string>();
        pending.push(request);
        return request.promise;
    }, {ttl});
    return {cache, pending};
};

class Boundary extends React.Component<{children: React.ReactNode}, {error?: string}> {
    public state: {error?: string} = {};

    public static getDerivedStateFromError(error: unknown): {error: string} {
        return {error: error instanceof Error ? error.message : String(error)};
    }

    public render(): React.ReactNode {
        return this.state.error ? <span className="error">{this.state.error}</span> : this.props.children;
    }
}

const Suspended = ({cache, onRender}: {
    cache: ResourceCache<string, string>;
    onRender?: (rendering: boolean) => void;
}) => {
    onRender?.(true);
    try {
        return <span className="value">{cache.suspend('a')}</span>;
    } finally {
        onRender?.(false);
    }
};

const content = (cache: ResourceCache<string, string>, key: number, onRender?: (rendering: boolean) => void) =>
    <Boundary key={key}>
        <React.Suspense fallback={<span className="waiting">waiting</span>}>
            <Suspended cache={cache} onRender={onRender}/>
        </React.Suspense>
    </Boundary>;

test('a mounted Suspense-only success reader revalidates on its next read without publishing in render', async () => {
    const {cache, pending} = controlled();
    let rendering = false;
    let notifiedDuringRender = false;
    const onRender = (value: boolean) => { rendering = value; };
    const id = cache.subscribe(() => { notifiedDuringRender ||= rendering; }, {
        reads: new Set([cache.exposePathOf('a')]),
    });
    const mounted = render(content(cache, 0, onRender));
    expect(mounted.container.querySelector('.waiting')).not.toBeNull();
    await act(async () => { pending[0].resolve('old'); });
    expect(mounted.container.querySelector('.value')?.textContent).toBe('old');

    await act(async () => { cache.invalidate('a'); });
    expect(pending).toHaveLength(1);
    await act(async () => { mounted.rerender(content(cache, 0, onRender)); });
    expect(pending).toHaveLength(2);
    expect(mounted.container.querySelector('.value')?.textContent).toBe('old');
    expect(cache.getEntry('a')).toMatchObject({refreshing: true, data: 'old'});
    expect(notifiedDuringRender).toBe(false);

    await act(async () => { pending[1].resolve('new'); });
    await act(async () => { mounted.rerender(content(cache, 0, onRender)); });
    expect(mounted.container.querySelector('.value')?.textContent).toBe('new');
    expect(cache.getEntry('a')).toMatchObject({stale: false, refreshing: false});
    mounted.unmount();
    cache.unsubscribe(id);
});

test('a TTL-stale success refetches on a Suspense-only read and keeps the old value visible', async () => {
    const now = rstest.spyOn(Date, 'now').mockReturnValue(100);
    try {
        const {cache, pending} = controlled(10);
        const mounted = render(content(cache, 0));
        await act(async () => { pending[0].resolve('old'); });
        now.mockReturnValue(111);

        await act(async () => { mounted.rerender(content(cache, 0)); });
        expect(pending).toHaveLength(2);
        expect(mounted.container.querySelector('.value')?.textContent).toBe('old');
        await act(async () => { pending[1].resolve('fresh'); });
        await act(async () => { mounted.rerender(content(cache, 0)); });
        expect(mounted.container.querySelector('.value')?.textContent).toBe('fresh');
        expect(cache.getEntry('a').stale).toBe(false);
        mounted.unmount();
    } finally {
        now.mockRestore();
    }
});

test('a failed Suspense request stays disarmed until invalidation, then its boundary recovers', async () => {
    const original = console.error;
    console.error = () => undefined; // React reports handled boundary errors to the console.
    try {
        const {cache, pending} = controlled();
        const mounted = render(content(cache, 0));
        expect(mounted.container.querySelector('.waiting')).not.toBeNull();
        await act(async () => { pending[0].reject(new Error('offline')); });
        expect(mounted.container.querySelector('.error')?.textContent).toBe('offline');
        await act(async () => { mounted.rerender(content(cache, 0)); });
        expect(pending).toHaveLength(1);

        await act(async () => { cache.invalidate('a'); });
        expect(pending).toHaveLength(1);
        await act(async () => { mounted.rerender(content(cache, 1)); });
        expect(mounted.container.querySelector('.waiting')).not.toBeNull();
        expect(pending).toHaveLength(2);
        await act(async () => { pending[1].resolve('recovered'); });
        expect(mounted.container.querySelector('.value')?.textContent).toBe('recovered');
        mounted.unmount();
    } finally {
        console.error = original;
    }
});
