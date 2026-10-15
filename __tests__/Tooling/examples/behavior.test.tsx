import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {Carburetor, ResourceCarburetor, ResourceCache, waitForUpdate, AntiHookComponent} from '@/Carburetor';
import {AutosaveDraft} from '../../../examples/components/AutosaveDraft';

describe('AutosaveDraft example reads tracked state (docs/examples/components.md)', () => {
    test('the exported component tracks text and invokes its injected save callback', () => {
        rstest.useFakeTimers();
        try {
            const draft = new Carburetor<{text: string}>({text: ''});
            const saves: string[] = [];
            const {container, unmount} = render(<AutosaveDraft draft={draft} save={(text) => saves.push(text)}/>);
            expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toEqual('');
            act(() => {
                rstest.advanceTimersByTime(500);
            });
            expect(saves).toEqual(['']);

            void act(() => draft.setData({text: 'next'}));
            expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toEqual('next');
            act(() => {
                rstest.advanceTimersByTime(500);
            });
            expect(saves).toEqual(['', 'next']);

            void act(() => draft.setData({text: 'pending'}));
            unmount();
            act(() => {
                rstest.advanceTimersByTime(500);
            });
            expect(saves).toEqual(['', 'next']);
        } finally {
            rstest.useRealTimers();
        }
    });
});

describe('ConfigView example (docs/examples/resources.md)', () => {
    const setup = async () => {
        let next: () => Promise<{theme: string}> = () => Promise.resolve({theme: 'dark'});
        const resource = new ResourceCarburetor<{theme: string}, void>(() => next());
        await act(async () => {
            await resource.load();
        });

        class ConfigBoundary extends React.Component<{children?: React.ReactNode}, {error?: string}> {
            public state: {error?: string} = {};

            public static getDerivedStateFromError(error: unknown): {error: string} {
                return {error: error instanceof Error ? error.message : String(error)};
            }

            public render() {
                return this.state.error === undefined
                    ? this.props.children
                    : <span className="error">{this.state.error}</span>;
            }
        }

        class ConfigView extends AntiHookComponent {
            public render() {
                const view = this.useCarburetor(resource);
                const value = resource.suspend(undefined);

                return <span className={view.isPending ? 'theme refreshing' : 'theme'}>{value.theme}</span>;
            }
        }

        const mounted = render(
            <ConfigBoundary>
                <React.Suspense fallback={<span className="spinner"/>}>
                    <ConfigView/>
                </React.Suspense>
            </ConfigBoundary>
        );

        return {resource, mounted, setNext: (loader: typeof next) => { next = loader; }};
    };

    test('a reload with fresh data re-renders the component', async () => {
        const {resource, mounted, setNext} = await setup();
        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('dark');

        setNext(() => Promise.resolve({theme: 'light'}));
        await act(async () => {
            await resource.reload();
        });

        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('light');
    });

    test('a failed reload after a success reaches the error boundary', async () => {
        const {resource, mounted, setNext} = await setup();
        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('dark');

        // React logs the error its boundary caught; that log is expected here.
        const errors = rstest.spyOn(console, 'error').mockImplementation(() => {});
        setNext(() => Promise.reject(new Error('offline')));
        await act(async () => {
            await resource.reload().catch(() => undefined);
        });

        expect(mounted.container.querySelector('.error')?.textContent).toEqual('offline');
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });
});

describe('PostListItem example tracks stale through useResource (docs/examples/resources.md)', () => {
    test('the row renders fresh data and then marks itself stale after invalidation', async () => {
        let post = {id: 'p1', title: 'First'};
        // The refetch must hang, so stale stays visible until the test ends.
        let allowResolve = true;
        const cache = new ResourceCache<{id: string; title: string}, string>(() => {
            if (allowResolve) {
                return Promise.resolve(post);
            }

            return new Promise(() => {});
        });

        class Row extends AntiHookComponent {
            public render() {
                const view = this.useResource(cache, 'p1');

                if (view.isSuccess && view.data !== undefined) {
                    return <li className={view.stale ? 'stale' : undefined}>{view.data.title}</li>;
                }

                return <li className="status">{view.status}</li>;
            }
        }

        const {container} = render(<Row/>);
        await act(async () => {});
        expect(container.querySelector('li')?.textContent).toEqual('First');
        expect(container.querySelector('li')?.className).not.toContain('stale');

        // The refetch must hang, so stale stays visible until the assertion below.
        allowResolve = false;
        await act(async () => {
            cache.invalidate('p1');
        });

        expect(container.querySelector('li')?.className).toContain('stale');
    });
});

describe('waitForUpdate must be subscribed before a synchronous publish (docs/examples/tooling.md)', () => {
    test('a subscription created first catches the loading publish inside load()', async () => {
        let resolveLoad!: () => void;
        const deferred = new Promise<void>((resolve) => {
            resolveLoad = resolve;
        });

        class UserStore extends Carburetor<{user: {name: string} | undefined; loading: boolean}> {
            public async load(): Promise<void> {
                this.update((d) => {
                    d.loading = true;
                });
                await deferred;
                this.update((d) => {
                    d.user = {name: 'Ada'};
                    d.loading = false;
                });
            }
        }

        const store = new UserStore({user: undefined, loading: false});
        let result: boolean | undefined;
        await act(async () => {
            const updated = waitForUpdate(store, 2000);
            void store.load();
            await updated;
            result = store.getData().loading;
        });

        expect(result).toBe(true);

        resolveLoad();
        await act(async () => {});
    });
});

describe('setData wakes only readers of changed paths (docs/examples/stores.md)', () => {
    test('an equal replacement wakes nobody, a changed field wakes only its reader', () => {
        const store = new Carburetor<{a: number; b: number}>({a: 0, b: 0});
        let rendersA = 0;
        let rendersB = 0;

        class ReaderA extends AntiHookComponent {
            public render() {
                rendersA++;

                return <span className="a">{this.useCarburetor(store).a}</span>;
            }
        }

        class ReaderB extends AntiHookComponent {
            public render() {
                rendersB++;

                return <span className="b">{this.useCarburetor(store).b}</span>;
            }
        }

        const {unmount} = render(<div><ReaderA/><ReaderB/></div>);
        expect(rendersA).toEqual(1);
        expect(rendersB).toEqual(1);

        act(() => {
            store.setData({a: 1, b: 0});
        });
        expect(rendersA).toEqual(2);
        expect(rendersB).toEqual(1);

        act(() => {
            store.setData({a: 1, b: 0});
        });
        expect(rendersA).toEqual(2);
        expect(rendersB).toEqual(1);

        unmount();
    });
});
