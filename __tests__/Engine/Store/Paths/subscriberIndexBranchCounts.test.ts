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

describe('R42-S02 public subscriber matching', () => {
    interface IData {
        box: {left: {n: number}; right: {n: number}};
        spare: {n: number};
    }
    class Store extends Carburetor<IData> {
        public change(fn: (draft: IData) => void): void { this.update(fn); }
    }
    const makeStore = (): Store => new Store({box: {left: {n: 0}, right: {n: 0}}, spare: {n: 0}});

    test.each([false, true])('mixed overlapping writes preserve union through refile/remove and bucket transitions (reverse=%s)', reverse => {
        const store = makeStore();
        const calls: string[] = [];
        const register = (id: string, reads?: string[]): void => {
            store.subscribe(() => { calls.push(id); }, {id, reads});
        };
        const expectWindow = (expected: string[]): void => {
            expect([...calls].sort()).toEqual([...expected].sort());
            expect(new Set(calls).size).toBe(calls.length);
            calls.length = 0;
        };
        const siblings = (): void => store.change(d => {
            if (reverse) { d.box.right.n++; d.box.left.n++; }
            else { d.box.left.n++; d.box.right.n++; }
        });
        const overlapping = (): void => store.change(d => {
            if (reverse) {
                d.box.right.n++;
                d.box.left.n++;
                d.box.left = {n: d.box.left.n + 1};
            } else {
                d.box.left = {n: d.box.left.n + 1};
                d.box.left.n++;
                d.box.right.n++;
            }
        });
        register('all');
        register('broad1', ['box']);
        register('broad2', ['box']);
        register('left', ['box.left.n']);
        register('mixed', ['box.left', 'box.right.n']);
        register('spare', ['spare.n']);
        register('empty', []);
        try {
            siblings();
            expectWindow(['all', 'broad1', 'broad2', 'left', 'mixed']);
            expect(store.getData().box).toEqual({left: {n: 1}, right: {n: 1}});
            overlapping();
            expectWindow(['all', 'broad1', 'broad2', 'left', 'mixed']);
            expect(store.getData().box).toEqual({left: {n: 3}, right: {n: 2}});

            register('broad2', ['spare.n']); // Demote the shared exact bucket.
            register('mixed', ['box.right.n']); // Drop one shared branch contribution.
            overlapping();
            expectWindow(['all', 'broad1', 'left', 'mixed']);
            store.change(d => { d.spare.n++; });
            expectWindow(['all', 'spare', 'broad2']);
            store.unsubscribe('broad1');
            register('broad3', ['box']);
            register('broad4', ['box']); // Promote a fresh bucket, not a remembered identity.
            siblings();
            expectWindow(['all', 'broad3', 'broad4', 'left', 'mixed']);
            store.unsubscribe('broad4');
            store.unsubscribe('left');
            store.change(d => { d.box.left.n++; });
            expectWindow(['all', 'broad3']);
            store.change(d => { d.box = {left: {n: 10}, right: {n: 11}}; d.box.right.n++; });
            expectWindow(['all', 'broad3', 'mixed']);
            expect(store.getData().box).toEqual({left: {n: 10}, right: {n: 12}});
        } finally {
            for (const id of ['all', 'broad1', 'broad2', 'broad3', 'broad4', 'left', 'mixed', 'spare', 'empty']) {
                store.unsubscribe(id);
            }
        }
    });

    test('escaped dot and tilde segments do not match lexical lookalikes', () => {
        class EscapedStore extends Carburetor<{
            box: {'a.b': {n: number}; 'a~b': {n: number}; a: {b: {n: number}}};
        }> {
            public edit(): void { this.update(d => { d.box['a.b'].n++; d.box['a~b'].n++; }); }
            public nested(): void { this.update(d => { d.box.a.b.n++; }); }
        }
        const store = new EscapedStore({box: {'a.b': {n: 0}, 'a~b': {n: 0}, a: {b: {n: 0}}}});
        const calls: string[] = [];
        for (const [id, reads] of [
            ['dot', ['box.a~1b.n']], ['tilde', ['box.a~0b.n']], ['nested', ['box.a.b.n']],
            ['broad1', ['box']], ['broad2', ['box']],
        ] as Array<[string, string[]]>) {
            store.subscribe(() => { calls.push(id); }, {id, reads});
        }
        try {
            store.edit();
            expect(calls).toEqual(['dot', 'broad1', 'broad2', 'tilde']);
            calls.length = 0;
            store.nested();
            expect(calls).toEqual(['nested', 'broad1', 'broad2']);
            expect(store.getData().box).toEqual({'a.b': {n: 1}, 'a~b': {n: 1}, a: {b: {n: 1}}});
        } finally {
            for (const id of ['dot', 'tilde', 'nested', 'broad1', 'broad2']) store.unsubscribe(id);
        }
    });

    test('reentrant publication sees new registrations without inheriting the outer match', () => {
        const store = makeStore();
        const calls: string[] = [];
        let nested = false;
        store.subscribe(() => {
            calls.push('all');
            if (nested) return;
            nested = true;
            store.unsubscribe('removed');
            store.subscribe(() => { calls.push('replacement'); }, {id: 'replaced', reads: ['spare.n']});
            store.subscribe(() => { calls.push('late'); }, {id: 'late', reads: ['box']});
            store.change(d => { d.box.left.n++; d.box.right.n++; });
        }, {id: 'all'});
        store.subscribe(() => { calls.push('broad'); }, {id: 'broad', reads: ['box']});
        store.subscribe(() => { calls.push('removed'); }, {id: 'removed', reads: ['box']});
        store.subscribe(() => { calls.push('old'); }, {id: 'replaced', reads: ['box']});
        try {
            store.change(d => { d.box.left.n++; d.box.right.n++; });
            expect(calls).toEqual(['all', 'all', 'broad', 'late', 'broad']);
            expect(store.getData().box).toEqual({left: {n: 2}, right: {n: 2}});
            calls.length = 0;
            store.change(d => { d.spare.n++; });
            expect(calls).toEqual(['all', 'replacement']);
        } finally {
            for (const id of ['all', 'broad', 'removed', 'replaced', 'late']) store.unsubscribe(id);
        }
    });
});
