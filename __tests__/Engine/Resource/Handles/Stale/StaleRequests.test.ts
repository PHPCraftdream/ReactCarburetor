import {ResourceCarburetor} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';

const sleep = async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, ms));
};

describe('stale entries request again (D4)', () => {
    test('a stale ResourceCarburetor answer is refreshed through load', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        }, {ttl: 40});

        await resource.load('a');
        await sleep(60);

        // Past the ttl the entry is stale: load must not serve it silently.
        await resource.load('a');
        expect(calls).toEqual(['a', 'a']);
    });

    test('a stale ResourceCarburetor entry suspends on a fresh request', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        }, {ttl: 40});

        await resource.load('a');
        await sleep(60);

        let caught: unknown;
        try {
            resource.suspend('a');
        } catch (thrown: unknown) {
            caught = thrown;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(calls).toEqual(['a', 'a']);
        await (caught as Promise<void>);
    });

    test('a stale ResourceCache entry is reloaded through load and suspend', async () => {
        const calls: string[] = [];
        const cache = new ResourceCache<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        }, {ttl: 40});

        await cache.load('a');
        await sleep(60);
        await cache.load('a');
        expect(calls).toEqual(['a', 'a']);

        await sleep(60);
        // SWR: stale Success suspends with the old value and revalidates in background.
        expect(cache.suspend('a')).toBe('answer-a');
        await new Promise(done => setImmediate(done));
        expect(calls).toEqual(['a', 'a', 'a']);
    });
});
