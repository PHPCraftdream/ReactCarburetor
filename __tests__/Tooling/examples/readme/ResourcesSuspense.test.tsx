import {act, render} from '@testing-library/react';
import {expect, rstest, test} from '@rstest/core';
import {enableReactActEnvironment} from '../../../reactActEnvironment';

enableReactActEnvironment();

const loadUserPage = (): Promise<{UserPage: () => JSX.Element}> =>
    import('../../../../examples/readme/Resources/UserPage') as Promise<{UserPage: () => JSX.Element}>;

const okFetch = (body: unknown): typeof fetch =>
    rstest.fn(async () => new Response(JSON.stringify(body), {status: 200})) as unknown as typeof fetch;

describe('README resources + Suspense scenario (examples/readme/Resources/UserPage.tsx)', () => {
    let errors: ReturnType<typeof rstest.spyOn> | undefined;

    beforeEach(() => {
        rstest.resetModules();
        errors = rstest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errors?.mockRestore();
        rstest.unstubAllGlobals();
    });

    test('the page suspends on the fallback and then renders the loaded user', async () => {
        rstest.stubGlobal('fetch', okFetch({id: 'a1', name: 'Ada'}));
        const {UserPage} = await loadUserPage();

        const {container} = render(<UserPage/>);
        expect(container.textContent).toContain('Loading…');

        await act(async () => {});
        expect(container.textContent).toContain('Ada');
        expect(container.textContent).not.toContain('Loading…');
    });

    test('a failing request reaches the error boundary with a working retry', async () => {
        const fetchMock = rstest.fn(async () => new Response('no', {status: 500}));
        rstest.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
        const {UserPage} = await loadUserPage();

        const {container} = render(<UserPage/>);
        await act(async () => {});

        expect(container.querySelector('[role="alert"]')?.textContent).toContain('User request failed: 500');
        expect(fetchMock).toHaveBeenCalled();

        // Retry after the backend recovers: invalidate + remount the suspended child.
        rstest.stubGlobal('fetch', okFetch({id: 'a1', name: 'Ada'}));
        const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement;
        await act(async () => {
            retry.click();
        });
        await act(async () => {});

        expect(container.textContent).toContain('Ada');
    });
});
