import {ResourceCarburetor} from '@/Carburetor';
import {flush} from '../Resource/Keys/helpers';

describe('ResourceCarburetor key function call count', () => {
    test('the key function runs once per load/refresh/suspend call', async () => {
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(
            async key => `answer-${key}`,
            {key: (id: string) => { calls += 1; return id; }},
        );

        calls = 0;
        await resource.load('a'); // miss
        expect(calls).toBe(1);

        calls = 0;
        await resource.load('a'); // memory/state hit
        expect(calls).toBe(1);

        calls = 0;
        await resource.refresh('a');
        expect(calls).toBe(1);

        calls = 0;
        resource.suspend('a'); // served from state, no request
        expect(calls).toBe(1);
        await flush();

        // clear() itself computes no key; the next handle call computes exactly one again.
        resource.clear();
        calls = 0;
        await resource.load('a'); // a miss now: the memory was dropped
        expect(calls).toBe(1);
    });

    test('suspend on a miss computes the key once', async () => {
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(
            async key => `answer-${key}`,
            {key: (id: string) => { calls += 1; return id; }},
        );

        calls = 0;
        // A fresh resource has no data: suspend must throw the in-flight request promise.
        let caught: unknown;
        try {
            resource.suspend('c');
        } catch (thrown) {
            caught = thrown;
        }
        expect(caught).toBeInstanceOf(Promise);
        expect(calls).toBe(1);
        // Settle the request so nothing is left running after the test.
        await (caught as Promise<void>);
    });
});
