import {Carburetor} from "@/Carburetor/Store/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {SubscriberIndex} from "@/Carburetor/Store/Paths/SubscriberIndex";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

const readsOf = (...paths: TPath[]): Set<TPath> => new Set(paths);
const compareIds = (a: string, b: string): number => a.localeCompare(b);
const ids = (index: SubscriberIndex, path: TPath): string[] =>
    Array.from(index.match(readsOf(path))).sort(compareIds);

class InspectableIndex extends SubscriberIndex {
    public branchAt(path: TPath): string | {id: string; count: number} | Map<string, number> | undefined {
        return this.branch.get(path);
    }
}

describe('SubscriberIndex branch reference counts', () => {
    test('removing siblings preserves their shared ancestor until the last read leaves', () => {
        const index = new InspectableIndex();

        index.add('reader', readsOf('a.b', 'a.c'));
        expect(index.branchAt('a')).toEqual({id: 'reader', count: 2});

        index.add('reader', readsOf('a.c'));
        expect(index.branchAt('a')).toBe('reader');
        expect(ids(index, 'a')).toEqual(['reader']);
        expect(index.hasReaderAt('a')).toBe(true);
        expect(ids(index, 'a.b')).toEqual([]);

        index.remove('reader');
        expect(index.branchAt('a')).toBeUndefined();
        expect(index.hasReaderAt('a')).toBe(false);
    });

    test('promotion and demotion preserve counts for each id', () => {
        const index = new InspectableIndex();

        index.add('first', readsOf('a.b', 'a.c', 'a.d'));
        index.add('second', readsOf('a.e', 'a.f'));
        expect(index.branchAt('a')).toEqual(new Map([['first', 3], ['second', 2]]));

        index.add('first', readsOf('a.c', 'a.d'));
        index.remove('second');
        expect(index.branchAt('a')).toEqual({id: 'first', count: 2});
        expect(ids(index, 'a')).toEqual(['first']);

        index.add('first', readsOf('a.d'));
        expect(index.branchAt('a')).toBe('first');
        index.remove('first');
        expect(index.branchAt('a')).toBeUndefined();
    });

    test('addPath consults exact filing when its shared read set was amended first', () => {
        const index = new InspectableIndex();
        const shared = readsOf('a.b');

        index.add('reader', shared);
        shared.add('a.c');
        index.addPath('reader', 'a.c');
        index.addPath('reader', 'a.c');
        expect(index.branchAt('a')).toEqual({id: 'reader', count: 2});

        index.add('reader', readsOf('a.c'));
        expect(index.branchAt('a')).toBe('reader');
        expect(ids(index, 'a')).toEqual(['reader']);
    });

    test('escaped keys retain the true ancestor, and wildcard stays separate', () => {
        const index = new InspectableIndex();
        const parent = joinPath('', 'a.b~c');

        index.add('reader', readsOf(joinPath(parent, 'x.y'), joinPath(parent, 'z')));
        index.add('all', readsOf(WILDCARD_PATH));
        index.add('reader', readsOf(joinPath(parent, 'z')));

        expect(index.branchAt(parent)).toBe('reader');
        expect(index.branchAt('a')).toBeUndefined();
        expect(index.hasReaderAt(parent)).toBe(true);
        expect(index.hasReaderAt('a')).toBe(false);
        expect(index.hasReaderAt('unrelated')).toBe(false);
        expect(ids(index, parent)).toEqual(['all', 'reader']);
        expect(ids(index, 'a')).toEqual(['all']);
    });

    test('public re-subscription still receives a parent replacement', () => {
        class TestStore extends Carburetor<{a: {b: number; c: number}}> {
            public replaceA(next: {b: number; c: number}): void {
                this.update(draft => { draft.a = next; });
            }
        }

        const store = new TestStore({a: {b: 1, c: 2}});
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'reader', reads: readsOf('a.b', 'a.c')});
        store.subscribe(() => wakes++, {id: 'reader', reads: readsOf('a.c')});
        store.replaceA({b: 3, c: 4});

        expect(wakes).toBe(1);
        store.unsubscribe('reader');
        store.replaceA({b: 5, c: 6});
        expect(wakes).toBe(1);
    });
});

/** Reference model: the subscribers that should match a write to `path` for these registrations. */
const expectedMatches = (registrations: Array<[string, string[]]>, path: TPath): string[] => {
    const matched = new Set<string>();

    for (const [id, reads] of registrations) {
        for (const read of reads) {
            if (read === path || read === '*' || path.startsWith(`${read}.`) || read.startsWith(`${path}.`)) {
                matched.add(id);
            }
        }
    }

    return [...matched].sort(compareIds);
};

describe('SubscriberIndex filing differential (R30-09: in-place ancestor walk)', () => {
    test('filed paths match exact, ancestor and descendant writes like the reference model', () => {
        const index = new SubscriberIndex();
        const registrations: Array<[string, string[]]> = [
            ['one', ['rows']],
            ['leaf', ['rows.0.cells.2']],
            ['mid', ['rows.0.cells']],
            ['star', ['*']],
            ['other', ['config.theme']],
        ];

        for (const [id, reads] of registrations) {
            index.add(id, readsOf(...reads));
        }

        for (const write of ['rows', 'rows.0', 'rows.0.cells', 'rows.0.cells.2', 'config', 'config.theme']) {
            expect(ids(index, write as TPath)).toEqual(expectedMatches(registrations, write));
        }
    });

    test('unfile restores the exact pre-filing match set, ancestors included', () => {
        const index = new SubscriberIndex();

        index.add('a', readsOf('rows.0.cells.2'));
        index.add('b', readsOf('rows.0.cells.2', 'rows.1'));
        index.add('c', readsOf('rows.0'));

        expect(ids(index, 'rows.0.cells.2')).toEqual(['a', 'b', 'c']);

        index.remove('b');

        expect(ids(index, 'rows.0.cells.2')).toEqual(['a', 'c']);
        expect(ids(index, 'rows.0')).toEqual(['a', 'c']);
        expect(Array.from(index.match(readsOf('rows.1'))).sort(compareIds)).toEqual([]);

        index.remove('a');

        expect(index.hasReaderAt('rows.0.cells')).toBe(false);
        expect(index.hasReaderAt('rows.0.cells.2')).toBe(false);
    });

    test('re-registering with a moved path keeps branch counts consistent', () => {
        const index = new SubscriberIndex();

        index.add('a', readsOf('rows.0.cells.1', 'rows.0.cells.2'));

        expect(ids(index, 'rows.0.cells.1')).toEqual(['a']);
        expect(ids(index, 'rows.0.cells.2')).toEqual(['a']);

        index.add('a', readsOf('rows.0.cells.1', 'rows.0.cells.3'));

        expect(ids(index, 'rows.0.cells.2')).toEqual([]);
        expect(ids(index, 'rows.0.cells.3')).toEqual(['a']);
        expect(ids(index, 'rows.0.cells.1')).toEqual(['a']);
        expect(ids(index, 'rows.0')).toEqual(['a']);

        index.add('b', readsOf('rows.0.cells.1'));

        expect(ids(index, 'rows.0.cells.1')).toEqual(['a', 'b']);

        index.remove('a');

        expect(ids(index, 'rows.0.cells.1')).toEqual(['b']);
        expect(ids(index, 'rows.0')).toEqual(['b']);
    });
});
