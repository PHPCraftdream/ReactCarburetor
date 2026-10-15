// Guards the README SSR → hydration recipe by exercising the exported example
// in examples/readme/App/Ssr.tsx (the source of the README block): hydrating
// its payload must not mismatch.
// The example is imported before react-dom/client so the global reportError
// capture is in place when react-dom picks its reportGlobalError implementation.
import {renderRequest, hydratePage} from '../../../../../../examples/readme/App/Ssr';

import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {ResourceCache} from '@/Carburetor';
import {enableReactActEnvironment} from '../../../../../reactActEnvironment';
import {Counter} from '../../../../../../examples/readme/Counter';

enableReactActEnvironment();

let loadSpy: ReturnType<typeof rstest.spyOn> | undefined;

afterEach(() => {
    loadSpy?.mockRestore();
    loadSpy = undefined;
    document.body.innerHTML = '';
});

describe('README hydration recipe', () => {
    test('the actual exported README Counter component renders and increments', async () => {
        const {container} = render(<Counter/>);
        const button = container.querySelector('button') as HTMLButtonElement;
        expect(button.textContent).toBe('0');
        await act(async () => button.click());
        expect(button.textContent).toBe('1');
    });

    test('hydration renders the server markup without a mismatch or a second request', async () => {
        loadSpy = rstest.spyOn(ResourceCache.prototype, 'load');
        const {markup, payload} = await renderRequest();

        expect(markup).toContain('User a1');
        expect(loadSpy).toHaveBeenCalledTimes(1);

        const container = document.createElement('div');
        container.innerHTML = markup;
        document.body.appendChild(container);
        const before = container.textContent;

        let root!: ReturnType<typeof hydratePage>;
        await act(async () => {
            root = hydratePage(container, payload);
        });
        await act(async () => {});

        expect(container.textContent).toEqual(before);
        expect(container.textContent).toContain('User a1');
        // A fresh TTL and a hydrated entry: the client must not fetch again.
        expect(loadSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
            root.unmount();
        });
    });

    test('an empty payload makes the client fetch on its own', async () => {
        loadSpy = rstest.spyOn(ResourceCache.prototype, 'load');
        const {markup} = await renderRequest();
        const serverCalls = loadSpy.mock.calls.length;

        const container = document.createElement('div');
        container.innerHTML = markup;
        document.body.appendChild(container);

        const errors = rstest.spyOn(console, 'error').mockImplementation(() => {});

        const reported: unknown[] = [];
        const onError = (event: ErrorEvent): void => { reported.push(event.error); };
        window.addEventListener('error', onError);

        let root!: ReturnType<typeof hydratePage>;
        await act(async () => {
            root = hydratePage(container, '{}');
        });
        await act(async () => {});

        // An empty payload cannot match the markup: React reports a recoverable
        // mismatch through the global reportError (the report lands in a
        // scheduled task, so it is taken after the flush act; console stays
        // clean, so the suite guard is satisfied by the capture).
        // React 18 may route the same report through console.error instead.
        expect(reported.length + errors.mock.calls.length).toBeGreaterThan(0);
        expect(loadSpy.mock.calls.length).toEqual(serverCalls + 1);

        expect(container.textContent).toContain('User a1');

        await act(async () => {
            root.unmount();
        });
        errors.mockRestore();
        window.removeEventListener('error', onError);
    });
});
