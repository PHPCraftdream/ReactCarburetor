import * as React from 'react';
import {createRoot} from 'react-dom/client';
import * as api from '@/Carburetor';
import * as interop from '@/Interop';
import {checkOwnership, checkCommittedControl} from '../../../../../perf/scenarios/components42/checks.mjs';

import {enableReactActEnvironment} from '../../../../reactActEnvironment';

enableReactActEnvironment();

const env = {React, createRoot, api, interop};
describe('R42-A01 committed selection ownership', () => {
    for (const self of [true, false]) for (const strict of [true, false]) {
        for (const stateful of [true, false]) for (const resume of [true, false]) {
            for (const swap of [true, false]) {
                const label = `${self ? 'self' : 'child'} suspension / strict=${strict}`;
                const lane = `${stateful ? 'state' : 'props'} / ${resume ? 'resume' : 'cancel'} / swap=${swap}`;
                test(`${label} / ${lane}`, async () => {
                    await checkOwnership(env, {self, strict, stateful, resume, swap});
                });
            }
        }
    }
    test.each([false, true])('class selector throw reaches the consumer boundary / strict=%s', async strict => {
        class Store extends api.Carburetor<{a: number; b: number; boom: boolean}> {
            public readonly active = new Map<string, string[]>();
            public readonly callbacks: api.TSubscriber[] = [];
            public readonly installed: string[][] = [];

            public edit(): void {
                this.update(data => { data.boom = true; });
            }

            public subscribe(callback: api.TSubscriber, options: api.ISubscribeOptions = {}): string {
                const id = super.subscribe(callback, options);
                const reads = [...(options.reads ?? [])];
                this.active.set(id, reads);
                this.installed.push(reads);
                this.callbacks.push(callback);
                return id;
            }

            public unsubscribe(id: string): void {
                this.active.delete(id);
                super.unsubscribe(id);
            }
        }

        const store = new Store({a: 1, b: 2, boom: false});
        const consumerError = new Error('class selection failed');
        const caught: unknown[] = [];
        const originalError = console.error;
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            if (!args.some(value => value === consumerError)) originalError(...args);
        });
        class Owner extends api.AntiHookComponent {
            private readonly pick = this.connectSelection(() => store, data => {
                if (data.boom) {
                    void data.b;
                    throw consumerError;
                }
                return data.a;
            });

            public render(): React.ReactNode {
                return <p>{this.pick()}</p>;
            }
        }

        class Boundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
            public state = {failed: false};

            public static getDerivedStateFromError(error: unknown): {failed: boolean} {
                caught.push(error);
                return {failed: true};
            }

            public render(): React.ReactNode {
                return this.state.failed ? <p>caught</p> : this.props.children;
            }
        }

        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const child = <Boundary><Owner /></Boundary>;
        try {
            await React.act(async () => root.render(strict ? <React.StrictMode>{child}</React.StrictMode> : child));
            expect(container.textContent).toBe('1');
            expect(store.active.size).toBe(1);
            const installedBeforeThrow = store.installed.length;
            await React.act(async () => store.edit());
            expect(container.textContent).toBe('caught');
            expect(caught.length).toBeGreaterThan(0);
            for (const error of caught) expect(error).toBe(consumerError);
            expect(store.installed.length).toBe(installedBeforeThrow);
            expect(store.active.size).toBe(0);
            const late = [...store.callbacks];
            await React.act(async () => root.unmount());
            await React.act(async () => { for (const callback of late) callback(); });
            expect(store.active.size).toBe(0);
            expect(store.installed.length).toBe(installedBeforeThrow);
            expect(container.textContent).toBe('');
        } finally {
            await React.act(async () => root.unmount());
            container.remove();
            errorSpy.mockRestore();
        }
    });
    test.each(['raw', 'hook'])('%s positive retained-DOM control', async kind => {
        await checkOwnership(env, {kind, self: false, resume: true});
    });
    test.each(['selected', 'hook'])('%s equal-valued speculative lane retains committed reads', async kind => {
        await checkOwnership(env, {kind, equal: true});
    });
    test.each(['selected', 'hook'])('%s committed equal migration and warm memo control', async kind => {
        await checkCommittedControl(env, kind);
    });
});
