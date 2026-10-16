// D2 for ResourceCache: handles are instance-bound and drop event arguments, so
// onClick={cache.load} is safe for a parameterless cache; a cache with parameters rejects
// the assignment at compile time and never feeds the event to the loader at runtime.
import * as React from 'react';
import {act} from 'react';
import {render, fireEvent} from '@testing-library/react';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';

/** A zero-argument loader recording every call's arguments. */
const recorded = () => {
    const callArgs: unknown[][] = [];
    const load = async (...args: unknown[]): Promise<string> => {
        callArgs.push(args);
        return 'answer';
    };
    return {callArgs, load};
};

const isSignalOnly = (args: unknown[]): boolean =>
    args.length === 1 && args[0] instanceof AbortSignal;

describe('ResourceCache handles are bound and drop event arguments (D2)', () => {
    test('onClick={cache.load} hands the loader only a signal', async () => {
        const loader = recorded();
        const cache = new ResourceCache<string>(loader.load);

        const {container} = render(<button onClick={cache.load}>go</button>);
        try {
            await act(async () => {
                fireEvent.click(container.querySelector('button')!);
            });

            expect(loader.callArgs).toHaveLength(1);
            expect(isSignalOnly(loader.callArgs[0])).toBe(true);
            expect(cache.getData().entries.null?.status).toBe(EResourceStatus.Success);
        } finally {
            container.remove();
        }
    });

    test('addEventListener passes a DOM event; the loader still sees only a signal', async () => {
        const loader = recorded();
        const cache = new ResourceCache<string>(loader.load);

        const element = document.createElement('button');
        element.addEventListener('click', cache.load);
        document.body.appendChild(element);
        try {
            element.dispatchEvent(new Event('click'));
            await act(async () => {
                await Promise.resolve();
            });

            expect(loader.callArgs).toHaveLength(1);
            expect(isSignalOnly(loader.callArgs[0])).toBe(true);
        } finally {
            element.remove();
        }
    });

    test('a detached clear() still clears every entry', async () => {
        const loader = recorded();
        const cache = new ResourceCache<string>(loader.load);

        await cache.load();
        const {clear} = cache;
        clear();

        expect(Object.keys(cache.getData().entries)).toHaveLength(0);
    });

    test('a parameterized cache never passes the event to the loader', async () => {
        const loader = recorded();
        const cache = new ResourceCache<string, [id: string]>(loader.load);

        const {container} = render(
            // @ts-expect-error — the mouse event is not a valid loader argument
            <button onClick={cache.load}>go</button>,
        );
        try {
            await act(async () => {
                fireEvent.click(container.querySelector('button')!);
            });

            expect(loader.callArgs).toHaveLength(1);
            expect(isSignalOnly(loader.callArgs[0])).toBe(true);
        } finally {
            container.remove();
        }
    });
});
