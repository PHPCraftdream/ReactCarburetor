import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ResourceCarburetor, ResourceCache, waitForUpdate} from '@/Carburetor';

describe('AutosaveDraft example reads tracked state (docs/examples/components.md)', () => {
    test('the effect re-runs on text changes and the textarea tracks the draft', () => {
        const draft = new Carburetor<{text: string}>({text: ''});
        const saves: string[] = [];

        class AutosaveDraft extends AntiHookComponent {
            protected latestText = '';

            public render() {
                const view = this.useCarburetor(draft);
                this.latestText = view.text;

                return <textarea value={view.text} readOnly/>;
            }

            protected useEffects(): void {
                const autosave = (): (() => void) => {
                    saves.push(this.latestText);

                    return () => {};
                };

                this.useEffect('autosave', autosave, [this.latestText]);
            }
        }

        const {container} = render(<AutosaveDraft/>);
        expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toEqual('');

        act(() => {
            draft.setData({text: 'next'});
        });

        expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toEqual('next');
        expect(saves).toEqual(['', 'next']);
    });
});

describe('ConfigView example re-renders after reload (docs/examples/resources.md)', () => {
    test('the component re-renders with fresh data after reload', async () => {
        let current = {theme: 'dark'};
        const resource = new ResourceCarburetor<{theme: string}, void>(() => Promise.resolve(current));
        await act(async () => {
            await resource.load();
        });

        class ConfigView extends AntiHookComponent {
            public render() {
                const view = this.useCarburetor(resource);
                const value = view.data ?? resource.suspend(undefined);

                return <span className="theme">{value.theme}</span>;
            }
        }

        const {container} = render(<ConfigView/>);
        expect(container.querySelector('.theme')?.textContent).toEqual('dark');

        current = {theme: 'light'};
        await act(async () => {
            await resource.reload();
        });

        expect(container.querySelector('.theme')?.textContent).toEqual('light');
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
