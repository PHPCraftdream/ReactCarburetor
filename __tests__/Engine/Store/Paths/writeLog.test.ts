import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {WriteLog} from "@/Carburetor/Store/Paths/WriteLog";

const setOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('WriteLog (R16-05)', () => {
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

        log.record(1, setOf('a'));
        log.record(2, setOf('b'));
        log.record(3, setOf('c'));
        log.record(4, setOf('d'));
        // Overflows the 4-entry ring: the version-1 entry ("a") is evicted, so the watermark
        // becomes 1 and a baseline strictly below it can no longer be answered precisely.
        log.record(5, setOf('e'));

        expect(log.matches(0, setOf('unrelated'))).toBe(true);
        // A baseline of exactly the watermark already accounts for the evicted write, so the
        // precise answer still holds for it: nothing written after it concerns "unrelated".
        expect(log.matches(1, setOf('unrelated'))).toBe(false);
    });

    test('still answers precisely for a baseline at or above the watermark after overflow', () => {
        const log = new WriteLog(4);

        log.record(1, setOf('a'));
        log.record(2, setOf('b'));
        log.record(3, setOf('c'));
        log.record(4, setOf('d'));
        log.record(5, setOf('e'));

        // Versions 2-5 are still fully represented in the ring.
        expect(log.matches(2, setOf('c'))).toBe(true);
        expect(log.matches(2, setOf('unrelated'))).toBe(false);
    });

    test('a write touching several paths costs several entries against the capacity', () => {
        const log = new WriteLog(3);

        log.record(1, setOf('a', 'b', 'c'));
        log.record(2, setOf('d'));

        // One write of 3 paths already fills a 3-entry ring: "a" is evicted by "d" alone,
        // so a baseline predating that write can no longer be answered precisely.
        expect(log.matches(0, setOf('a'))).toBe(true);
        // A baseline of 1 already accounts for the evicted write, so the precise answer still
        // holds: only "d" landed after it, and "a" is unrelated to "d".
        expect(log.matches(1, setOf('a'))).toBe(false);
    });
});
