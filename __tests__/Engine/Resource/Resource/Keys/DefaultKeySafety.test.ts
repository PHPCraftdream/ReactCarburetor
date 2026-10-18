import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {ResourceCarburetor} from '@/Carburetor';

/** A loader that records its calls and answers a fixed string. */
const recorded = () => {
    const calls: unknown[] = [];
    const load = async (...args: unknown[]): Promise<string> => {
        calls.push(args[0]);
        return 'answer';
    };
    return {calls, load};
};

describe('the default key rejects non-JSON-safe arguments (development)', () => {
    test('a slot load rejects instead of serving a collided answer', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [unknown]>(loader.load);

        await expect(resource.load(new Map([['region', 'EU']]) as unknown as never))
            .rejects.toThrow(TypeError);
        await expect(resource.load(new Map([['region', 'US']]) as unknown as never))
            .rejects.toThrow(/`key` option/u);
        expect(loader.calls).toEqual([]);

        // The rejection is a promise, not a synchronous throw.
        let sync: unknown;
        try {
            void resource.load(10n as unknown as never);
        } catch (error: unknown) {
            sync = error;
        }
        expect(sync).toBeUndefined();
        await expect(resource.load(10n as unknown as never)).rejects.toThrow(/`key` option/u);

        await expect(resource.load(Number.NaN)).rejects.toThrow(/`key` option/u);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        await expect(resource.load(circular as unknown as never)).rejects.toThrow(/`key` option/u);
        await expect(resource.load(new Date(0) as unknown as never)).rejects.toThrow(/`key` option/u);
        await expect(resource.load(((): void => undefined) as unknown as never)).rejects.toThrow(/`key` option/u);

        // JSON-safe arguments still load, including a nested plain structure and trailing undefined.
        await resource.load({id: 'a', tags: ['x']});
        await resource.load('b', undefined);
        expect(loader.calls).toEqual([{id: 'a', tags: ['x']}, 'b']);
    });

    test('a cache refresh rejects when its key cannot be derived', async () => {
        const loader = recorded();
        const cache = new ResourceCache<string, [unknown]>(loader.load);

        await cache.load('a');
        await expect(cache.refresh(new Set([1]) as unknown as never)).rejects.toThrow(/`key` option/u);
        expect(loader.calls).toEqual(['a']);
        await expect(cache.load(Number.POSITIVE_INFINITY)).rejects.toThrow(TypeError);
    });
});
