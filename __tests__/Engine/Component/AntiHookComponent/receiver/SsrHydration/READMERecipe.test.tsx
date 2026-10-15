// Guards the README SSR → hydration recipe: the copy below must stay in sync
// with the README block, and hydrating its payload must not mismatch.
// Imported before react-dom/client so the global reportError capture is in
// place when react-dom picks its reportGlobalError implementation.
// RECIPE-START
import * as React from 'react';
import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {
    CarburetorProvider,
    CarburetorScope,
    ScopedAntiHookComponent,
    ResourceCache,
    carburetorToken,
} from '@/Carburetor';
const loadUser = async (id: string): Promise<{name: string}> => ({name: `User ${id}`});
const userToken = carburetorToken(
    () => new ResourceCache(loadUser, {ttl: 30_000}),
    'ssr-example-users',
);
class UserScreen extends ScopedAntiHookComponent {
    render() {
        const cache = this.resolve(userToken);
        const user = this.useResource(cache, 'a1');
        return <span>{user.data?.name ?? 'Loading…'}</span>;
    }
}
const tree = (scope: CarburetorScope) => <CarburetorProvider scope={scope}><UserScreen/></CarburetorProvider>;
export async function renderRequest() {
    const scope = new CarburetorScope();
    await scope.get(userToken).load('a1');
    const markup = renderToString(tree(scope));
    const payload = JSON.stringify(scope.dehydrate()).replace(/</g, '\\u003c');
    return {markup, payload};
}
export function hydratePage(container: HTMLElement, payload: string) {
    const scope = new CarburetorScope();
    scope.hydrate(JSON.parse(payload) as Record<string, unknown>, [userToken]);
    return hydrateRoot(container, tree(scope));
}
// RECIPE-END

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {act} from 'react';
import {rstest} from '@rstest/core';
import {enableReactActEnvironment} from '../../../../../reactActEnvironment';

enableReactActEnvironment();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

/** Extract the fenced block after a marker line, as scripts/consumer-fixture/checkExamples.mjs does. */
const readRecipeBlock = (file: string, marker: string, mustContain: string): string => {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== marker) continue;
        let start = i + 1;
        while (start < lines.length && !/^\s*`{3,}/.test(lines[start])) start++;
        const open = lines[start]?.match(/^\s*`{3,}\s*(\S*)/);
        if (!open || !['ts', 'tsx'].includes(open[1])) continue;
        let end = start + 1;
        while (end < lines.length && !new RegExp('^\\s*`{3,}\\s*$').test(lines[end])) end++;
        const code = lines.slice(start + 1, end).join('\n');
        if (code.includes(mustContain)) return code;
        i = end;
    }
    throw new Error(`No ${mustContain} example block after ${marker} in ${file}`);
};

const readSelfRecipe = (): string => {
    const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/);
    const start = lines.indexOf('// RECIPE-START');
    const end = lines.indexOf('// RECIPE-END');
    if (start < 0 || end < 0) throw new Error('Recipe markers missing');
    return lines.slice(start + 1, end).join('\n');
};

const normalizeImport = (code: string): string => code.replace("from 'react-carburetor'", "from '@/Carburetor'");

let loadSpy: ReturnType<typeof rstest.spyOn> | undefined;

afterEach(() => {
    loadSpy?.mockRestore();
    loadSpy = undefined;
    document.body.innerHTML = '';
});

describe('README hydration recipe', () => {
    test('the README block stays in sync with this file', () => {
        const readme = readRecipeBlock(resolve(root, 'README.md'), '<!-- example:compile -->', 'renderRequest');
        expect(normalizeImport(readme)).toEqual(readSelfRecipe());
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
