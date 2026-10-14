import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

const fixture = () => {
    const gates: Array<PromiseWithResolvers<unknown>> = [];
    const cache = new ResourceCache<unknown, string>(() => {
        const gate = Promise.withResolvers<unknown>();
        gates.push(gate);
        return gate.promise;
    }, {ttl: Infinity});
    return {cache, gates};
};

describe('status flags observed from a missing cache entry (default-only creation suppression)', () => {
    test('class reader of isIdle', async () => {
        const {cache, gates} = fixture();
        class Badge extends AntiHookComponent {
            public render() {
                const view = this.useResource(cache, 'a');
                return <span>{view.isIdle ? 'idle' : 'started'}</span>;
            }
        }
        const mounted = render(<Badge/>);
        await act(async () => {});
        const afterStart = mounted.container.textContent;
        await act(async () => { gates[0].resolve(1); await gates[0].promise; });
        expect([afterStart, mounted.container.textContent]).toEqual(['started', 'started']);
    });

    test('class reader of isPending', async () => {
        const {cache, gates} = fixture();
        class Badge extends AntiHookComponent {
            public render() {
                const view = this.useResource(cache, 'a');
                return <span>{view.isPending ? 'loading' : 'not'}</span>;
            }
        }
        const mounted = render(<Badge/>);
        await act(async () => {});
        const afterStart = mounted.container.textContent;
        await act(async () => { gates[0].resolve(1); await gates[0].promise; });
        expect([afterStart, mounted.container.textContent]).toEqual(['loading', 'not']);
    });

    test('hook reader of isPending', async () => {
        const {cache, gates} = fixture();
        const Badge = () => <span>{useResourceValue(cache, 'a', view => view.isPending) ? 'loading' : 'not'}</span>;
        const mounted = render(<Badge/>);
        await act(async () => {});
        const afterStart = mounted.container.textContent;
        await act(async () => { gates[0].resolve(1); await gates[0].promise; });
        expect([afterStart, mounted.container.textContent]).toEqual(['loading', 'not']);
    });

    test('control: class reader of status', async () => {
        const {cache, gates} = fixture();
        class Badge extends AntiHookComponent {
            public render() {
                const view = this.useResource(cache, 'a');
                return <span>{view.status}</span>;
            }
        }
        const mounted = render(<Badge/>);
        await act(async () => {});
        const afterStart = mounted.container.textContent;
        await act(async () => { gates[0].resolve(1); await gates[0].promise; });
        expect([afterStart, mounted.container.textContent]).toEqual(['pending', 'success']);
    });
});
