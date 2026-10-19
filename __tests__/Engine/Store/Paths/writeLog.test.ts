import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {WriteLog} from "@/Carburetor/Store/Paths/WriteLog";

describe('WriteLog accumulated attribution (R39-01)', () => {
    test('a newer baseline accepts the retained superset, not just the latest publication', () => {
        const log = new WriteLog();
        const older = {};
        const current = {};
        log.record(1, setOf('old'), new Map([['old', new Set([older])]]));
        log.record(2, setOf('new'), new Map([['new', new Set([current])]]));
        log.record(3, setOf('new'), new Map([['new', new Set([current])]]));
        expect(log.targetsSince(0)?.get('old')?.has(older)).toBe(true);
        expect(log.targetsSince(2)?.get('old')?.has(older)).toBe(true);
        expect(log.targetsSince(2)?.get('new')?.has(current)).toBe(true);
    });

    test('a current publication missing one path cannot use its older attribution', () => {
        const log = new WriteLog();
        const older = {};
        log.record(1, setOf('old'), new Map([['old', new Set([older])]]));
        log.record(2, setOf('old', 'new'), new Map([['new', new Set([{}])]]));
        expect(log.targetsSince(1)).toBeUndefined();
        expect(log.pathsSince(1)).toEqual(['old', 'new']);
        log.record(3, setOf('new'), new Map([['new', new Set([{}])]]));
        expect(log.targetsSince(2)?.has('old')).toBe(false);
    });
});

const setOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('WriteLog (R16-05)', () => {
    test('enumerates recent concrete paths and declines incomplete history', () => {
        const log = new WriteLog();
        log.record(1, setOf('items.a.title'));
        expect(log.pathsSince(1)).toEqual([]);
        expect(log.pathsSince(0)).toEqual(['items.a.title']);
        log.record(2, setOf(WILDCARD_PATH));
        expect(log.pathsSince(1)).toBeUndefined();
    });

    test('declines paths older than the watermark', () => {
        const log = new WriteLog(1);
        log.record(1, setOf('items.a.title'));
        expect(log.pathsSince(0)).toBeUndefined();
    });

    test('reports no drift when nothing was written since the baseline', () => {
        const log = new WriteLog();

        log.record(1, setOf('items.a.title'));

        expect(log.matches(1, setOf('items.a.title'))).toBe(false);
    });

    test('matches a write to exactly the same path', () => {
        const log = new WriteLog();

        log.record(1, setOf('items.a.title'));

        expect(log.matches(0, setOf('items.a.title'))).toBe(true);
    });

    test('does not match a write to an unrelated path', () => {
        const log = new WriteLog();

        log.record(1, setOf('items.b.title'));

        expect(log.matches(0, setOf('items.a.title'))).toBe(false);
    });

    test('matches a write to an ancestor of a read path', () => {
        const log = new WriteLog();

        // The read is items.a.title; the write replaces the whole items.a branch.
        log.record(1, setOf('items.a'));

        expect(log.matches(0, setOf('items.a.title'))).toBe(true);
    });

    test('matches a write to a descendant of a read path', () => {
        const log = new WriteLog();

        // The read is items.a; the write lands on one field below it.
        log.record(1, setOf('items.a.title'));

        expect(log.matches(0, setOf('items.a'))).toBe(true);
    });

    test('does not match a sibling path that merely shares a prefix string', () => {
        const log = new WriteLog();

        // items.ab must not be treated as a descendant of items.a.
        log.record(1, setOf('items.ab.title'));

        expect(log.matches(0, setOf('items.a'))).toBe(false);
    });

    test('a wildcard write always matches, whatever was read', () => {
        const log = new WriteLog();

        log.record(1, setOf(WILDCARD_PATH));

        expect(log.matches(0, setOf('items.a.title'))).toBe(true);
    });

    test('a wildcard read always matches once the version has moved', () => {
        const log = new WriteLog();

        log.record(1, setOf('unrelated.path'));

        expect(log.matches(0, setOf(WILDCARD_PATH))).toBe(true);
    });

    test('only counts writes strictly after the baseline version', () => {
        const log = new WriteLog();

        log.record(1, setOf('items.a.title'));
        log.record(2, setOf('items.b.title'));

        // A baseline of 1 already accounts for the version-1 write.
        expect(log.matches(1, setOf('items.a.title'))).toBe(false);
        expect(log.matches(1, setOf('items.b.title'))).toBe(true);
        expect(log.matches(0, setOf('items.a.title'))).toBe(true);
    });

    test('keeps eviction precise after refreshing an indexed path', () => {
        const log = new WriteLog(4);
        log.record(1, setOf('a.b'));
        log.record(2, setOf('c.d'));
        log.record(3, setOf('a.b'));
        log.record(4, setOf('e.f'));

        expect(log.matches(2, setOf('unrelated'))).toBe(false);
        expect(log.matches(2, setOf('a.b'))).toBe(true);
        expect(log.matches(0, setOf('unrelated'))).toBe(true);
        expect(log.getWatermark()).toBe(2);
    });

    test('keeps raw and recent tracking bounded and recovers after an eviction reset', () => {
        const log = new WriteLog(2);
        const raw = {};
        log.record(1, setOf('a'), [['a', raw]]);
        log.record(2, setOf('b'), [['b', raw]]);
        log.record(3, setOf('c'), [['c', raw]]);

        expect(log.pathsSince(2)).toEqual(['c']);
        expect(log.pathsSince(1)).toEqual(['b', 'c']);
        expect(log.targetsSince(2)).toBeUndefined();
        expect(log.targetsSince(3)).toBeUndefined();
        log.record(4, setOf('c'), [['c', raw]]);
        expect(log.targetsSince(3)?.has('c')).toBe(true);
        expect(log.targetsSince(3)?.has('d')).toBe(false);
    });

    test('refreshes order, preserves ancestor relationships, and handles same-version ties', () => {
        const log = new WriteLog(3);
        log.record(1, setOf('root.a.value'));
        log.record(2, setOf('other'));
        log.record(3, setOf('root.a.value'));
        expect(log.matches(2, setOf('root.a'))).toBe(true);
        expect(log.matches(2, setOf('unrelated'))).toBe(false);
        expect(log.getWatermark()).toBe(2);
    });

    test('bounds recent same-version retention at capacity', () => {
        const log = new WriteLog(2);
        for (let index = 0; index < 80; index++) log.record(1, setOf(`p${index}`));
        const state = log as unknown as {recent: {entries: Map<string, unknown>}};
        expect(state.recent.entries.size).toBeLessThanOrEqual(2);
        expect(log.pathsSince(1)).toEqual([]);
    });

    test('an oversized emit still observes a later wildcard in that publication', () => {
        const log = new WriteLog(1);
        log.record(1, setOf('a', WILDCARD_PATH));
        expect(log.getWildcardVersion()).toBe(1);
        expect(log.matches(0, setOf('unrelated'))).toBe(true);
    });

    test('matches a small exhaustive reference oracle across capacities', () => {
        for (let capacity = 1; capacity <= 4; capacity++) {
            const log = new WriteLog(capacity);
            const publications: Array<[number, string]> = [];
            for (let version = 1; version <= 6; version++) {
                const path = ['a.x', 'b.y', 'a.z'][version % 3];
                publications.push([version, path]);
                log.record(version, setOf(path));
                for (let baseline = 0; baseline <= version; baseline++) {
                    for (const read of ['a', 'a.x', 'b.y', 'unrelated']) {
                        const expected = log.matches(baseline, setOf(read));
                        const intersects = publications.some(([v, write]) => v > baseline
                            && (write === read || read.startsWith(`${write}.`) || write.startsWith(`${read}.`)));
                        if (baseline >= log.getWatermark()) expect(expected).toBe(intersects);
                        else expect(expected).toBe(true);
                    }
                }
            }
        }
    });
    test('falls back to true once the baseline predates the watermark', () => {
        const log = new WriteLog(4);

        log.record(1, setOf('a', 'b'));
        log.record(2, setOf('c', 'd'));
        log.record(3, setOf('e'));

        expect(log.matches(0, setOf('unrelated'))).toBe(true);
        expect(log.matches(1, setOf('unrelated'))).toBe(false);
        expect(log.matches(2, setOf('unrelated'))).toBe(false);
        expect(log.matches(3, setOf('unrelated'))).toBe(false);
    });

    test('answers precisely for writes recorded after eviction', () => {
        const log = new WriteLog(4);

        log.record(1, setOf('a', 'b', 'c', 'd', 'e'));
        log.record(2, setOf('x.y'));

        expect(log.matches(1, setOf('x.y'))).toBe(true);
        expect(log.matches(1, setOf('x'))).toBe(true);
        expect(log.matches(1, setOf('unrelated'))).toBe(false);
    });

    test('rewriting the same path costs no capacity', () => {
        const log = new WriteLog(2);

        for (let version = 1; version <= 100; version++) {
            log.record(version, setOf('a.b'));
        }

        expect(log.matches(99, setOf('a.b'))).toBe(true);
        expect(log.matches(99, setOf('unrelated'))).toBe(false);
    });
});
