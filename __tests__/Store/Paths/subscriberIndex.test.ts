import {pathsIntersect, SubscriberIndex, TPath, TPathSet, WILDCARD_PATH} from "../../../lib/src/Carburetor";

const setOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

/** The straightforward scan the index replaces — the reference implementation. */
const matchByScan = (readsById: Map<string, TPathSet>, writes: TPathSet): Set<string> => {
    const matched = new Set<string>();

    readsById.forEach((reads: TPathSet, id: string) => {
        if (pathsIntersect(reads, writes)) {
            matched.add(id);
        }
    });

    return matched;
};

const sorted = (ids: Set<string>): string[] => Array.from(ids).sort();

describe('SubscriberIndex', () => {
    test('matches a write to the path that was read', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('a'));

        expect(sorted(index.match(setOf('a')))).toEqual(['reader']);
        expect(sorted(index.match(setOf('b')))).toEqual([]);
    });

    test('matches readers sitting below the written path', () => {
        const index = new SubscriberIndex();

        index.add('deep', setOf('items.a1.title'));

        expect(sorted(index.match(setOf('items.a1')))).toEqual(['deep']);
        expect(sorted(index.match(setOf('items')))).toEqual(['deep']);
        expect(sorted(index.match(setOf('items.a2')))).toEqual([]);
    });

    test('matches readers sitting above the written path', () => {
        const index = new SubscriberIndex();

        index.add('container', setOf('items'));

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['container']);
        expect(sorted(index.match(setOf('order.0')))).toEqual([]);
    });

    test('a wildcard reader is matched by everything, and a wildcard write matches everyone', () => {
        const index = new SubscriberIndex();

        index.add('everything', setOf(WILDCARD_PATH));
        index.add('narrow', setOf('a'));

        expect(sorted(index.match(setOf('whatever.path')))).toEqual(['everything']);
        expect(sorted(index.match(setOf(WILDCARD_PATH)))).toEqual(['everything', 'narrow']);
    });

    test('re-adding an id replaces its paths', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('a'));
        index.add('reader', setOf('b'));

        expect(sorted(index.match(setOf('a')))).toEqual([]);
        expect(sorted(index.match(setOf('b')))).toEqual(['reader']);
    });

    test('removing an id drops all of its paths', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('items.a1.title', 'order'));
        index.remove('reader');

        expect(sorted(index.match(setOf('items')))).toEqual([]);
        expect(sorted(index.match(setOf('order.0')))).toEqual([]);
        expect(sorted(index.match(setOf(WILDCARD_PATH)))).toEqual([]);
    });

    test('agrees with a full scan over randomised path sets', () => {
        const segments = ['items', 'order', 'a1', 'a2', 'title', 'done', 'meta'];
        let seed = 20260920;

        // Deterministic pseudo-random, so a failure is reproducible.
        const next = (bound: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed % bound;
        };

        const randomPath = (): TPath => {
            const depth = 1 + next(3);
            const parts: string[] = [];

            for (let i = 0; i < depth; i++) {
                parts.push(segments[next(segments.length)]);
            }

            return parts.join('.');
        };

        for (let round = 0; round < 200; round++) {
            const index = new SubscriberIndex();
            const readsById = new Map<string, TPathSet>();

            for (let subscriber = 0; subscriber < 12; subscriber++) {
                const reads = new Set<TPath>();
                const count = 1 + next(3);

                for (let i = 0; i < count; i++) {
                    reads.add(next(10) === 0 ? WILDCARD_PATH : randomPath());
                }

                const id = 'subscriber' + subscriber;
                readsById.set(id, reads);
                index.add(id, reads);
            }

            const writes = new Set<TPath>();
            const writeCount = 1 + next(4);

            for (let i = 0; i < writeCount; i++) {
                writes.add(randomPath());
            }

            expect(sorted(index.match(writes))).toEqual(sorted(matchByScan(readsById, writes)));
        }
    });
});
