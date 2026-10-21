import {hasLeftPath} from '@/Carburetor/Store/Tracking/Aliases/hasLeftPath';

describe('hasLeftPath', () => {
    const value = {n: 1};
    const other = {n: 2};

    test('an object still at its path has not left it', () => {
        expect(hasLeftPath({a: {b: value}}, 'a.b', value)).toBe(false);
        expect(hasLeftPath({list: [other, value]}, 'list.1', value)).toBe(false);
    });

    test('a different object at the path, or a missing key, means it has left', () => {
        expect(hasLeftPath({a: {b: other}}, 'a.b', value)).toBe(true);
        expect(hasLeftPath({list: [other, value]}, 'list.0', value)).toBe(true);
        expect(hasLeftPath({a: {}}, 'a.b', value)).toBe(true);
        expect(hasLeftPath({}, 'toString', value)).toBe(true);
    });

    test('a null or primitive on the way means it has left', () => {
        expect(hasLeftPath({a: null}, 'a.b', value)).toBe(true);
        expect(hasLeftPath({a: 5}, 'a.b', value)).toBe(true);
    });

    test('a native collection or class instance on the way cannot be told, so it has not provably left', () => {
        class Holder {
            public b = other;
        }

        expect(hasLeftPath({m: new Map([['b', other]])}, 'm.b', value)).toBe(false);
        expect(hasLeftPath({m: new Holder()}, 'm.b', value)).toBe(false);
    });

    test('without a root nothing is provable', () => {
        expect(hasLeftPath(undefined, 'a.b', value)).toBe(false);
    });

    test('the root path is the root itself', () => {
        expect(hasLeftPath(value, '', value)).toBe(false);
        expect(hasLeftPath(other, '', value)).toBe(true);
    });

    test('escaped separators and tildes resolve to the real keys', () => {
        expect(hasLeftPath({'a.b': {c: value}}, 'a~1b.c', value)).toBe(false);
        expect(hasLeftPath({'a~b': value}, 'a~0b', value)).toBe(false);
        expect(hasLeftPath({'a~1': value}, 'a~01', value)).toBe(false);
        expect(hasLeftPath({'~.': value}, '~0~1', value)).toBe(false);
        expect(hasLeftPath({a: {b: {c: value}}}, 'a~1b.c', value)).toBe(true);
    });
});
