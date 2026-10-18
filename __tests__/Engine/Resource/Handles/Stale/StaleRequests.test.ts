import {ResourceCarburetor} from '@/Carburetor';
import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {flush} from '../../Resource/Keys/helpers';

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

    test('a stale ResourceCarburetor entry suspends with stale data and revalidates', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        }, {ttl: 200});

        await resource.load('a');
        await sleep(250);

        // SWR: stale Success suspends with the visible answer and revalidates in background.
        expect(resource.suspend('a')).toBe('answer-a');
        expect(calls).toEqual(['a', 'a']);
        await flush();
        await sleep(10);
        expect(resource.suspend('a')).toBe('answer-a');
        expect(calls).toEqual(['a', 'a']);
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

    test('an ongoing background revalidation keeps serving the stale answer', async () => {
        const calls: string[] = [];
        let release: (value: string) => void = () => undefined;
        const resource = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return new Promise<string>(resolve => { release = resolve; });
        }, {ttl: 150});

        const loading = resource.load('a');
        release('answer-a-1');
        await loading;
        await sleep(200);

        // SWR: the first suspend serves stale data and starts a background revalidation.
        expect(resource.suspend('a')).toBe('answer-a-1');
        await flush();
        // The background start has run: the slot is Pending, but the second suspend must
        // still serve the visible stale answer instead of throwing a promise.
        expect(resource.suspend('a')).toBe('answer-a-1');
        expect(calls).toEqual(['a', 'a']);

        release('answer-a-2');
        await flush();
        expect(resource.suspend('a')).toBe('answer-a-2');
        expect(calls).toEqual(['a', 'a']);
    });
});
