// suspendResource: the Suspense read in one call, plus a readonly pin on the class reader facade.
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, EResourceStatus} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {IResourceEntry, IResourceView} from '@/Carburetor/Models/Resource';

const ready = (name: string): IResourceEntry<{name: string}> => {
    const data = {name};
    return {
        status: EResourceStatus.Success, data, error: undefined, updatedAt: Date.now(),
        isIdle: false, isPending: false, isSuccess: true, isError: false,
        refreshing: false, invalidated: false, failed: false,
    };
};

interface IViewProps {
    cache: ResourceCache<{name: string}, [string]>;
    id: string;
    tick?: number;
}

interface IBoundaryState {
    message: string | undefined;
}

class Boundary extends React.Component<{children?: React.ReactNode}, IBoundaryState> {
    public state: IBoundaryState = {message: undefined};

    public static getDerivedStateFromError(error: unknown): IBoundaryState {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    public render() {
        if (this.state.message !== undefined) {
            return <div className="failed">{this.state.message}</div>;
        }
        return this.props.children;
    }
}

// No `?.` on user: suspendResource returns T, not T | undefined — the pin is the direct read.
class SuspendView extends AntiHookComponent<IViewProps> {
    public render() {
        const user = this.suspendResource(this.props.cache, this.props.id);
        return <span className="value">{user.name}</span>;
    }
}

describe('suspendResource', () => {
    test('renders the fallback while pending, then the name once the deferred load settles', async () => {
        const calls: string[] = [];
        const pending: Array<PromiseWithResolvers<{name: string}>> = [];
        const cache = new ResourceCache<{name: string}, [string]>(id => {
            calls.push(id);
            const request = Promise.withResolvers<{name: string}>();
            pending.push(request);
            return request.promise;
        }, {ttl: Infinity});

        const mounted = render(
            <Boundary>
                <React.Suspense fallback={<div className="fallback">loading</div>}>
                    <SuspendView cache={cache} id="a"/>
                </React.Suspense>
            </Boundary>
        );
        try {
            expect(mounted.container.querySelector('.fallback')).not.toBeNull();

            await act(async () => {
                pending[0].resolve({name: 'ann'});
                await pending[0].promise;
            });

            expect(mounted.container.querySelector('.value')?.textContent).toBe('ann');
            expect(mounted.container.querySelector('.fallback')).toBeNull();
            expect(calls).toEqual(['a']);
        } finally {
            mounted.unmount();
        }
    });

    test('a background refresh of the entry re-renders with the new name; another entry does not', async () => {
        const calls: string[] = [];
        const answers = [{name: 'ann II'}, {name: 'other'}];
        let served = 0;
        const cache = new ResourceCache<{name: string}, [string]>(id => {
            calls.push(id);
            return Promise.resolve(answers[Math.min(served++, answers.length - 1)]);
        }, {ttl: Infinity});
        cache.setData({entries: {[cache.resolve('a').key]: ready('ann')}});

        let renders = 0;
        class NameView extends AntiHookComponent<IViewProps> {
            public render() {
                renders++;
                const user = this.suspendResource(this.props.cache, this.props.id);
                return <span>{user.name}</span>;
            }
        }

        const mounted = render(<NameView cache={cache} id="a" tick={0}/>);
        try {
            expect(mounted.container.textContent).toBe('ann');
            const initial = renders;

            await act(async () => {
                await cache.refresh('a');
            });
            expect(mounted.container.textContent).toBe('ann II');
            expect(renders).toBeGreaterThan(initial);

            const afterOwnRefresh = renders;
            await act(async () => {
                await cache.refresh('b');
            });
            expect(renders).toBe(afterOwnRefresh);
            expect(mounted.container.textContent).toBe('ann II');
        } finally {
            mounted.unmount();
        }
    });

    test('a slow background refresh wakes a suspended component when it lands', async () => {
        // The gate is created outside the loader, so the refresh is genuinely held in flight
        // until the test resolves it — the component must stay on the old data meanwhile.
        const gate = Promise.withResolvers<{name: string}>();
        const cache = new ResourceCache<{name: string}, [string]>(() => gate.promise, {ttl: Infinity});
        cache.setData({entries: {[cache.resolve('a').key]: ready('ann')}});

        let renders = 0;
        class SlowView extends AntiHookComponent<IViewProps> {
            public render() {
                renders++;
                const user = this.suspendResource(this.props.cache, this.props.id);
                return <span className="value">{user.name}</span>;
            }
        }

        const mounted = render(<SlowView cache={cache} id="a"/>);
        try {
            expect(mounted.container.querySelector('.value')?.textContent).toBe('ann');
            const initial = renders;

            await act(async () => {
                const landing = cache.refresh('a');
                expect(mounted.container.querySelector('.value')?.textContent).toBe('ann');
                expect(renders).toBe(initial);
                gate.resolve({name: 'grace'});
                await landing;
            });

            expect(mounted.container.querySelector('.value')?.textContent).toBe('grace');
            expect(renders).toBeGreaterThan(initial);

            const afterOwnRefresh = renders;
            await act(async () => {
                await cache.refresh('b');
            });
            expect(renders).toBe(afterOwnRefresh);
            expect(mounted.container.querySelector('.value')?.textContent).toBe('grace');
        } finally {
            mounted.unmount();
        }
    });

    test('a held refresh whose settled updatedAt equals the old one still wakes via the data field', async () => {
        const realNow = Date.now;
        let now = 1_000;
        Date.now = () => now;
        try {
            // The entry is pre-seeded and ready, so no load runs at mount: the only loader
            // call is the background refresh, served by the held gate created outside it.
            const gate = Promise.withResolvers<{name: string}>();
            const cache = new ResourceCache<{name: string}, [string]>(() => gate.promise, {ttl: Infinity});
            cache.setData({entries: {[cache.resolve('a').key]: ready('ann')}});

            const mounted = render(
                <Boundary>
                    <React.Suspense fallback={<div className="fallback">loading</div>}>
                        <SuspendView cache={cache} id="a"/>
                    </React.Suspense>
                </Boundary>
            );
            try {
                expect(mounted.container.querySelector('.value')?.textContent).toBe('ann');

                // now stays 1_000, so the settled entry's updatedAt equals the seeded one:
                // only the whole-data write can wake the reader.
                await act(async () => {
                    const landing = cache.refresh('a');
                    gate.resolve({name: 'grace'});
                    await landing;
                });

                expect(mounted.container.querySelector('.value')?.textContent).toBe('grace');
            } finally {
                mounted.unmount();
            }
        } finally {
            Date.now = realNow;
        }
    });
});

describe('class reader facade', () => {
    test('the facade is readonly: assignment throws TypeError', () => {
        const cache = new ResourceCache<{name: string}, [string]>(
            () => Promise.reject(new Error('unexpected load')), {ttl: Infinity});
        cache.setData({entries: {[cache.resolve('a').key]: ready('ann')}});

        const views: Array<IResourceView<{name: string}>> = [];
        class Pin extends AntiHookComponent<IViewProps> {
            public render() {
                const view = this.useResource(this.props.cache, this.props.id);
                views.push(view);
                const name = view.data?.name;
                return <span>{name ?? ''}</span>;
            }
        }

        const mounted = render(<Pin cache={cache} id="a" tick={0}/>);
        try {
            expect(mounted.container.textContent).toBe('ann');
            mounted.rerender(<Pin cache={cache} id="a" tick={1}/>);
            expect(mounted.container.textContent).toBe('ann');
            expect(views.length).toBe(2);
            expect(() => { (views[0] as {data?: unknown}).data = undefined; }).toThrow(TypeError);
        } finally {
            mounted.unmount();
        }
    });

    test("useResource builds the view through the source's own fieldView factory", () => {
        const builtinView: IResourceView<{name: string}> = {
            status: EResourceStatus.Success, data: {name: 'builtin'}, error: undefined,
            updatedAt: Date.now(), isIdle: false, isPending: false, isSuccess: true,
            isError: false, refreshing: false, invalidated: false, failed: false, stale: false,
        } as unknown as IResourceView<{name: string}>;
        const factoryCalls: Array<unknown> = [];
        const factoryReturns: Array<IResourceView<{name: string}>> = [];
        const capturedViews: Array<IResourceView<{name: string}>> = [];
        const fieldView = (
            _resolution: unknown, record: unknown
        ): IResourceView<{name: string}> => {
            factoryCalls.push(record);
            const facade = {...builtinView, data: {name: 'factory'}};
            factoryReturns.push(facade);
            return facade;
        };
        const source = {
            getUID: () => 'custom-source',
            getVersion: () => 0,
            subscribe: () => 'id',
            unsubscribe: () => undefined,
            load: () => Promise.reject(new Error('unexpected load')),
            resolve: (id: string) => ({
                key: id, path: `entries.${id}`, view: builtinView, present: true, fieldView,
            }),
        };

        class FactoryView extends AntiHookComponent<{source: typeof source; id: string}> {
            public render() {
                const view = this.useResource(this.props.source, this.props.id);
                capturedViews.push(view as IResourceView<{name: string}>);
                return <span>{view.data.name}</span>;
            }
        }

        const mounted = render(<FactoryView source={source} id="a"/>);
        try {
            expect(mounted.container.textContent).toBe('factory');
            expect(factoryCalls).toHaveLength(1);
            expect(capturedViews[0]).toBe(factoryReturns[0]);
        } finally {
            mounted.unmount();
        }
    });
});
