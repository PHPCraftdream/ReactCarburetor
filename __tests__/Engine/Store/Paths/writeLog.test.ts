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

    test('falls back to true once the baseline predates the watermark', () => {
        const log = new WriteLog(4);

        log.record(1, setOf('a', 'b'));
        log.record(2, setOf('c', 'd'));
        // A fifth distinct path overflows the 4-entry index: it resets, raising the watermark to 3.
        log.record(3, setOf('e'));

        expect(log.matches(2, setOf('unrelated'))).toBe(true);
        // A baseline at the watermark was taken after everything forgotten.
        expect(log.matches(3, setOf('unrelated'))).toBe(false);
    });

    test('answers precisely for writes recorded after a reset', () => {
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
