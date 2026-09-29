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
