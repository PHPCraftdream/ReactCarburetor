import {SubscriberIndex} from "@/Carburetor/Store/Paths/SubscriberIndex";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

const paths = (...values: TPath[]): TPathSet => new Set(values);

class ObservableIndex extends SubscriberIndex {
    public exactAt(path: TPath): string | Set<string> | undefined {
        return this.exact.get(path);
    }

    public branchAt(path: TPath): string | {id: string; count: number} | Map<string, number> | undefined {
        return this.branch.get(path);
    }
}

describe('SubscriberIndex targeted gaps', () => {
    test('ignores removing an unknown id and unregistering a missing bucket', () => {
        const index = new ObservableIndex();
        index.remove('missing');
        index.add('reader', paths('root.child'));
        index.remove('reader');
        expect(index.exactAt('root.child')).toBeUndefined();
        expect(index.branchAt('root')).toBeUndefined();
    });

    test('multi-write matching visits a shared exact Set once and preserves all matches', () => {
        const index = new ObservableIndex();
        index.add('one', paths('a', 'b'));
        index.add('two', paths('a', 'b'));
        expect([...index.match(paths('a', 'b'))].sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
        ))
            .toEqual(['one', 'two']);
    });

    test('adding an already-filed path is idempotent and wildcard remains observable', () => {
        const index = new ObservableIndex();
        index.add('reader', paths('root.left', 'root.right'));
        index.addPath('reader', 'root.left');
        expect(index.branchAt('root')).toEqual({id: 'reader', count: 2});
        index.addPath('reader', WILDCARD_PATH);
        expect([...index.match(paths('other'))]).toEqual(['reader']);
    });

    test('re-registration does not duplicate an identical branch contribution', () => {
        const index = new ObservableIndex();
        index.add('reader', paths('root.child'));
        index.add('reader', paths('root.child'));
        expect(index.branchAt('root')).toBe('reader');
        expect(index.exactAt('root.child')).toBe('reader');
    });

    test('unregistering a missing branch contribution leaves another reader intact', () => {
        const index = new ObservableIndex();
        index.add('first', paths('root.one', 'root.two'));
        index.add('second', paths('root.three'));
        index.remove('absent');
        expect(index.branchAt('root')).toEqual(new Map([['first', 2], ['second', 1]]));
    });
});
