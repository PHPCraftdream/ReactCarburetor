import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

/** A loader that records each call's arguments and answers a fixed string. */
const makeLoader = () => {
    const calls: unknown[][] = [];
    const load = async (...args: unknown[]): Promise<string> => {
        calls.push(args);
        return 'answer';
    };
    return {calls, load};
};

const flush = async (): Promise<void> => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
};

describe('ResourceCache with a custom key option', () => {
    test('read paths use the same key the custom key function produced', async () => {
        const loader = makeLoader();
        // Every argument maps to one shared key, so 'b' must see 'a''s stored answer.
        const cache = new ResourceCache<string, [id: string]>(loader.load, {key: () => 'shared'});

        await cache.load('a');
        expect(cache.getEntry('b').data).toBe('answer');
        expect(cache.resolve('b').view.data).toBe('answer');
        expect(cache.getFailure('b')).toBeUndefined();
    });

    test('read paths validate the custom key result like load does', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, [id: string]>(loader.load, {key: () => undefined});

        // The handles reject on key failure, read paths still throw.
        await expect(cache.load('a')).rejects.toThrow(TypeError);
        expect(() => cache.getEntry('a')).toThrow(TypeError);
        expect(() => cache.resolve('a')).toThrow(TypeError);
        await expect(cache.refresh('a')).rejects.toThrow(TypeError);
    });

    test('a mounted component reading another argument sees the answer loaded under the shared key', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, [id: string]>(loader.load, {key: () => 'shared'});
        await cache.load('a');

        class Row extends AntiHookComponent<{cache: ResourceCache<string, [id: string]>}> {
            public render() {
                const entry = this.useResource(this.props.cache, 'b');

                return React.createElement('span', {className: 'value'}, entry.data || entry.status);
            }
        }

        const container = render(React.createElement(Row, {cache})).container;
        await flush();

        // 'b' resolves through the custom key to the answer stored under 'a': the component
        // shows the loaded data, and the component read costs no extra loader request.
        expect(container.querySelector('.value')?.textContent).toBe('answer');
        // One loader request in total: the component read hit the same custom key.
        expect(loader.calls.map(call => call[0])).toEqual(['a']);
    });

    test('a string custom key result is encoded, not stored as a raw dictionary key', async () => {
        const loader = makeLoader();
        // Raw 'toString' would collide with Object.prototype and the entry would be unreadable.
        const cache = new ResourceCache<string, [id: string]>(loader.load, {key: () => 'toString'});

        await cache.load('a');

        expect(cache.getEntry('a').status).toBe(EResourceStatus.Success);
        expect(cache.getEntry('a').data).toBe('answer');
    });

    test('number 5 and string "5" encode to different keys in one cache', async () => {
        const cache = new ResourceCache<string, [id: string | number]>(
            async (value: string | number): Promise<string> => typeof value === 'number' ? 'num' : 'str',
            {key: (value: string | number): string | number => value},
        );

        await cache.load(5);
        await cache.load('5');

        expect(cache.getEntry(5).data).toBe('num');
        expect(cache.getEntry('5').data).toBe('str');
    });

    test('prototype-hazard and edge keys stay readable and distinct', async () => {
        const cache = new ResourceCache<string, [id: string]>(
            async (id: string): Promise<string> => `data:${id}`,
            {key: (id: string): string => id},
        );

        for (const key of ['toString', 'constructor', '__proto__', '*', '']) {
            await cache.load(key);
            expect(cache.getEntry(key).status).toBe(EResourceStatus.Success);
            expect(cache.getEntry(key).data).toBe(`data:${key}`);
        }
    });

    test('a snapshot taken under a hazardous custom key restores readably', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, [id: string]>(loader.load, {key: () => 'toString'});

        await cache.load('a');
        const snapshot = cache.snapshot();

        const restored = new ResourceCache<string, [id: string]>(loader.load, {key: () => 'toString'});
        restored.fromJSON(snapshot);

        expect(restored.getEntry('a').status).toBe(EResourceStatus.Success);
        expect(restored.getEntry('a').data).toBe('answer');
    });
});
