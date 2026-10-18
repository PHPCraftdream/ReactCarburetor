import {ResourceCache} from '@/Carburetor/Resource/Cache/ResourceCache';
import {ResourceCarburetor} from '@/Carburetor';

describe('ttl freshness boundary: the cache answer aged exactly ttl is fresh', () => {
    test('a cache entry aged exactly ttl is fresh; ttl 0 in the same millisecond is fresh', async () => {
        // The slot answer memory still treats >= ttl as stale; this boundary
        // difference between cache and slot is a documented open item.
        const calls: string[] = [];
        const realNow = Date.now;
        let now = 1_000;
        Date.now = () => now;
        try {
            const cache = new ResourceCache<string, [string]>(async key => {
                calls.push(key);
                return `answer-${key}`;
            }, {ttl: 500});

            await cache.load('a');
            now = 1_500; // exactly ttl old: still fresh, no reload
            await cache.load('a');
            expect(calls).toEqual(['a']);

            // ttl 0: the settled answer is fresh within the same millisecond.
            const immediate = new ResourceCache<string, [string]>(async key => {
                calls.push(`0-${key}`);
                return `answer-${key}`;
            }, {ttl: 0});
            await immediate.load('a');
            await immediate.load('a');
            expect(calls).toEqual(['a', '0-a']);
        } finally {
            Date.now = realNow;
        }
    });

    test('a remembered slot answer aged exactly ttl is stale (memory and cache agree)', async () => {
        const calls: string[] = [];
        const realNow = Date.now;
        let now = 1_000;
        Date.now = () => now;
        try {
            const resource = new ResourceCarburetor<string, [string]>(async key => {
                calls.push(key);
                return `answer-${key}`;
            }, {ttl: 500});

            await resource.load('a');
            now = 1_500;
            await resource.load('a');
            expect(calls).toEqual(['a', 'a']);
        } finally {
            Date.now = realNow;
        }
    });
});
