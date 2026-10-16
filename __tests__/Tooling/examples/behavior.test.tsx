import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {Carburetor, AntiHookComponent, waitForUpdate} from '@/Carburetor';
import {AutosaveDraft} from '../../../examples/api/components/AutosaveDraft';
import {ConfigView, configResource} from '../../../examples/api/resources/resource-carburetor/suspend';
import {PostList, postCache} from '../../../examples/api/resources/resource-cache/list';
import {store} from '../../../examples/api/tooling/WaitForUpdate';
import {fetchConfig} from '../../../examples/api/resources/endpoints/config';
import {fetchPost} from '../../../examples/api/resources/endpoints/posts';
import {fetchUser} from '../../../examples/api/resources/endpoints/user';

const userStore = store;

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

describe('ConfigView example suspends and refreshes (docs/examples/resources.md)', () => {
    const setup = async () => {
        fetchConfig.use(() => Promise.resolve({theme: 'dark'}));
        // The slot remembers the fresh answer of a previous test; start clean.
        configResource.clear();
        await act(async () => {
            await configResource.load();
        });

        class TestBoundary extends React.Component<{children?: React.ReactNode}, {error?: string}> {
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

        const mounted = render(
            <TestBoundary>
                <React.Suspense fallback={<span className="spinner"/>}>
                    <ConfigView/>
                </React.Suspense>
            </TestBoundary>
        );

        return {mounted};
    };

    test('a refresh with fresh data re-renders the component', async () => {
        const {mounted} = await setup();
        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('dark');

        fetchConfig.use(() => Promise.resolve({theme: 'light'}));
        await act(async () => {
            await configResource.refresh();
        });

        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('light');
    });

    test('a failed refresh after a success reaches the error boundary', async () => {
        const {mounted} = await setup();
        expect(mounted.container.querySelector('.theme')?.textContent).toEqual('dark');

        // React logs the error its boundary caught; that log is expected here.
        const errors = rstest.spyOn(console, 'error').mockImplementation(() => {});
        fetchConfig.use(() => Promise.reject(new Error('offline')));
        await act(async () => {
            await configResource.refresh().catch(() => undefined);
        });

        expect(mounted.container.querySelector('.error')?.textContent).toContain('offline');
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });
});

describe('PostList example tracks stale through useResource (docs/examples/resources.md)', () => {
    test('the row renders fresh data and then marks itself stale after invalidation', async () => {
        fetchPost.use((id: string) => Promise.resolve({id, title: 'First'}));
        const {container, unmount} = render(<PostList postIds={['p1']}/>);
        await act(async () => {});
        expect(container.querySelector('.title')?.textContent).toEqual('First');
        expect(container.querySelector('li')?.className).not.toContain('stale');

        // The refetch must hang, so stale stays visible until the assertion below.
        fetchPost.use(() => new Promise<{id: string; title: string}>(() => {}));
        await act(async () => {
            postCache.invalidate('p1');
        });

        expect(container.querySelector('li')?.className).toContain('stale');
        unmount();
    });
});

describe('waitForUpdate must be subscribed before a synchronous publish (docs/examples/tooling.md)', () => {
    test('a subscription created first catches the loading publish inside load()', async () => {
        let resolveLoad!: () => void;
        const deferred = new Promise<void>((resolve) => {
            resolveLoad = resolve;
        });
        fetchUser.use(() => deferred.then(() => ({name: 'Ada'})));

        let result: boolean | undefined;
        await act(async () => {
            const updated = waitForUpdate(userStore, 2000);
            void store.load('u1');
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
