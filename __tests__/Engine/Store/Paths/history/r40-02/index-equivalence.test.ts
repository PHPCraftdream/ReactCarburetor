import {SubscriberIndex} from '@/Carburetor/Store/Paths/SubscriberIndex';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {transferCompletedReads} from '@/Carburetor/Store/Tracking/Observation/transferCompletedReads';
import {ReadStore} from './ReadStore';

const referencePrune = (reads: Set<string>): Set<string> => new Set([...reads].filter(marker =>
    !marker.endsWith('.~p') || ![...reads].some(path => path !== marker && path.startsWith(marker.slice(0, -2)))
));

describe('R40-02 subscriber index equivalence', () => {
    test('completed sets match the independent pruning oracle and all wake decisions', () => {
        let seed = 7;
        const random = (limit: number): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed % limit;
        };
        const segments = ['items', 'r0', 'r1', 'r2', 'owner', 'name', 'title', 'done', 'filter', 'text', 'a~1b', '~0p'];
        const randomPath = (): string => Array.from(
            {length: 1 + random(4)}, () => segments[random(segments.length)]
        ).join('.');
        const fullIndex = new SubscriberIndex();
        const completedIndex = new SubscriberIndex();
        const oracleIndex = new SubscriberIndex();
        const pairs: Array<{full: Set<string>; completed: ReadonlySet<string>; oracle: Set<string>}> = [];
        for (let i = 0; i < 80; i++) {
            const reads = new Set<string>();
            const leaves = 1 + random(4);
            for (let j = 0; j < leaves; j++) {
                const path = randomPath();
                const parts = path.split('.');
                for (let depth = 1; depth < parts.length; depth++) reads.add(parts.slice(0, depth).join('.') + '.~p');
                reads.add(path);
                if (random(4) === 0) reads.add(path + '.~k');
                if (random(5) === 0) reads.add(path + '.~p');
            }
            if (i === 0) reads.add('*');
            const oracle = referencePrune(reads);
            const completed = completeReads(new Set(reads));
            fullIndex.add(String(i), reads);
            completedIndex.add(String(i), completed as Set<string>);
            oracleIndex.add(String(i), oracle);
            pairs.push({full: reads, completed, oracle});
        }
        let comparisons = 0;
        for (let i = 0; i < 300; i++) {
            const writes = new Set<string>();
            const count = 1 + random(3);
            for (let j = 0; j < count; j++) {
                const path = randomPath();
                writes.add(random(6) === 0 ? path + '.~k' : path);
            }
            if (i === 0) writes.add('*');
            const full = fullIndex.match(writes);
            expect(completedIndex.match(writes)).toEqual(full);
            expect(oracleIndex.match(writes)).toEqual(full);
            comparisons += pairs.length;
        }
        expect(comparisons).toBe(24000);
        expect(pairs.reduce((sum, pair) => sum + pair.full.size - pair.oracle.size, 0)).toBeGreaterThan(0);
        for (const pair of pairs) expect(new Set(pair.completed)).toEqual(pair.oracle);
    });

    test('5000 completed hook-row subscribers retain exactly 5000 exact entries and fully unsubscribe', () => {
        const store = new ReadStore(0);
        const ids: string[] = [];
        let mounted: number[] = [];
        try {
            for (let i = 0; i < 5000; i++) {
                const reads = completeReads(new Set(['items.~p', `items.r${i}.~p`, `items.r${i}.title`]));
                ids.push(store.subscribe(() => {}, transferCompletedReads(reads)));
            }
            mounted = store.indexSizes();
        } finally {
            for (const id of ids) store.unsubscribe(id);
        }
        expect(store.indexSizes()).toEqual([0, 0, 0, 0]);
        expect(mounted).toEqual([5000, 5001, 5000, 0]);
    });
});
