/* oxlint-disable react/globals -- Render counters are intentional test instrumentation. */
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {useResourceValue} from '@/Interop';

/**
 * Subscription precision for status flags: a reader that consumes only `isError` must
 * re-render when the entry settles to Error and must not re-render when it settles to
 * Success with fresh data (the flag did not change).
 */

const fixture = () => {
    const gates: Array<PromiseWithResolvers<unknown>> = [];
    const renders = {flag: 0, selector: 0};
    const cache = new ResourceCache<unknown, string>(() => {
        const gate = Promise.withResolvers<unknown>();
        gates.push(gate);
        return gate.promise;
    }, {ttl: Infinity});

    /** Class reader that touches nothing but the view's `isError` flag. */
    class ErrorBadge extends AntiHookComponent {
        public render() {
            renders.flag++;
            const view = this.useResource(cache, 'a');
            return <span>{view.isError ? 'error' : 'ok'}</span>;
        }
    }

    /** Hook reader whose selector consumes nothing but the view's `isError` flag. */
    const SelectorBadge = () => {
        // oxlint-disable-next-line react/immutability -- Positive selector render-count control.
        renders.selector++;
        const isError = useResourceValue(cache, 'a', view => view.isError);
        return <span>{isError ? 'error' : 'ok'}</span>;
    };

    const settle = async (index: number, value: unknown, reject = false) => {
        await act(async () => {
            if (reject) gates[index].reject(value);
            else gates[index].resolve(value);
            await gates[index].promise.catch(() => undefined);
        });
    };

    return {cache, gates, renders, ErrorBadge, SelectorBadge, settle};
};

describe('status flag subscription precision', () => {
    test('class reader of view.isError re-renders for Pending -> Error', async () => {
        const state = fixture();
        const mounted = render(<state.ErrorBadge/>);
        // The commit starts the deferred load and installs the subscription first.
        await act(async () => {});
        expect(state.gates).toHaveLength(1);
        expect(state.cache.getEntry('a').isPending).toBe(true);
        const before = state.renders.flag;

        await state.settle(0, new Error('offline'), true);
        expect(mounted.container.textContent).toBe('error');
        expect(state.renders.flag).toBeGreaterThan(before);
        mounted.unmount();
    });

    test('class reader of view.isError skips Pending -> Success data-only update', async () => {
        const state = fixture();
        const mounted = render(<state.ErrorBadge/>);
        await act(async () => {});
        expect(state.cache.getEntry('a').isPending).toBe(true);
        const before = state.renders.flag;

        await state.settle(0, {name: 'fresh'});
        expect(mounted.container.textContent).toBe('ok');
        expect(state.cache.getEntry('a').isSuccess).toBe(true);
        expect(state.renders.flag).toBe(before);
        mounted.unmount();
    });

    test('useResourceValue selector isError re-renders for Pending -> Error', async () => {
        const state = fixture();
        const mounted = render(<state.SelectorBadge/>);
        await act(async () => {});
        expect(state.gates).toHaveLength(1);
        expect(state.cache.getEntry('a').isPending).toBe(true);
        const before = state.renders.selector;

        await state.settle(0, new Error('offline'), true);
        expect(mounted.container.textContent).toBe('error');
        expect(state.renders.selector).toBeGreaterThan(before);
        mounted.unmount();
    });

    test('useResourceValue selector isError skips Pending -> Success data-only update', async () => {
        const state = fixture();
        const mounted = render(<state.SelectorBadge/>);
        await act(async () => {});
        expect(state.cache.getEntry('a').isPending).toBe(true);
        const before = state.renders.selector;

        await state.settle(0, {name: 'fresh'});
        expect(mounted.container.textContent).toBe('ok');
        expect(state.renders.selector).toBe(before);
        mounted.unmount();
    });
});
