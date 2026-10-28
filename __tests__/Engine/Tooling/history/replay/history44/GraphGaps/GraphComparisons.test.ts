import {IWritePatch} from '@/Carburetor/Models/Paths';
import {sameExistingScalarPath} from '@/Carburetor/Tooling/Graph/sameExistingScalarPath';
import {foldDependentPatch} from '@/Carburetor/Tooling/Graph/foldDependentPatch';
import {isSafeScalarPatch} from '@/Carburetor/Tooling/Graph/isSafeScalarPatch';
import {sameHistoryGraph} from '@/Carburetor/Tooling/Graph/sameHistoryGraph';

const patch = (
    segments: string[],
    previous: unknown,
    next: unknown,
    extra: Partial<IWritePatch> = {},
): IWritePatch => ({
    segments, previous, next, previousExists: true, nextExists: true, replacesBranch: false, ...extra,
});

describe('sameExistingScalarPath', () => {
    test('compares existing scalar leaves while refusing missing, closed and mismatched paths', () => {
        expect(sameExistingScalarPath({a: {n: 1}}, {a: {n: 1}}, ['a', 'n'], false)).toBe(true);
        expect(sameExistingScalarPath({a: {n: 1}}, {a: {n: 2}}, ['a', 'n'], false)).toBe(false);
        expect(sameExistingScalarPath({a: {}}, {a: {}}, ['a', 'n'], false)).toBeUndefined();
        expect(sameExistingScalarPath({a: {n: 1}}, {a: null}, ['a', 'n'], false)).toBeUndefined();
        const locked = Object.defineProperty({n: 1}, 'n', {
            value: 1, enumerable: true, writable: false, configurable: false,
        });
        expect(sameExistingScalarPath({a: locked}, {a: locked}, ['a', 'n'], false)).toBeUndefined();
        expect(sameExistingScalarPath({a: [1]}, {a: [1]}, ['a', '0'], false)).toBeUndefined();
        expect(sameExistingScalarPath({a: [1]}, {a: [1]}, ['a', '0'], true)).toBe(true);
        expect(sameExistingScalarPath(new Date(1), {x: 1}, ['x'], false)).toBeUndefined();
        expect(sameExistingScalarPath({a: {n: 1}}, {a: Object.create(null)}, ['a', 'n'], false)).toBeUndefined();
        expect(sameExistingScalarPath({a: {n: 1}}, {a: {n: 1}}, [], false)).toBeUndefined();
        const hidden = Object.defineProperty({}, 'n', {
            value: 1, enumerable: false, writable: true, configurable: true,
        });
        expect(sameExistingScalarPath({a: {n: 1}}, {a: hidden}, ['a', 'n'], false)).toBeUndefined();
        const accessor = Object.defineProperty({}, 'n', {get: () => 1, enumerable: true, configurable: true});
        expect(sameExistingScalarPath({a: {n: 1}}, {a: accessor}, ['a', 'n'], false)).toBeUndefined();
    });
});

describe('foldDependentPatch', () => {
    test('folds owned descendants and same-path replacements but preserves intervening conflicts', () => {
        const first = patch(['box'], null, {n: 1});
        const pending = [first];
        expect(foldDependentPatch(pending, patch(['box', 'n'], 1, 2))).toBe(true);
        expect(pending[0].next).toEqual({n: 2});
        expect(foldDependentPatch(pending, patch(['box'], {n: 1}, null))).toBe(true);
        expect(pending[0].next).toBeNull();
        const overlap = [patch(['box'], null, {n: 1}), patch(['box', 'n'], 1, 2)];
        expect(foldDependentPatch(overlap, patch(['box', 'n', 'deep'], 0, 1))).toBe(false);
        expect(foldDependentPatch([], patch(['none', 'x'], 0, 1))).toBe(false);
        const branchGone = [patch(['box'], null, 4)];
        expect(foldDependentPatch(branchGone, patch(['box', 'n'], 1, 2))).toBe(false);
        const repeatedOwners = [patch(['box'], null, {n: 1}), patch(['box'], {n: 1}, {n: 2})];
        expect(foldDependentPatch(repeatedOwners, patch(['box', 'n'], 2, 3))).toBe(true);
        expect(repeatedOwners[0].next).toEqual({n: 1});
        expect(repeatedOwners[1].next).toEqual({n: 3});
        const deletable = [patch(['box'], null, {n: 1})];
        expect(foldDependentPatch(deletable, patch(['box', 'n'], 1, undefined, {nextExists: false}))).toBe(true);
        expect(deletable[0].next).toEqual({});
    });
});

describe('isSafeScalarPatch', () => {
    test('admits only reversible writes to open scalar paths', () => {
        expect(isSafeScalarPatch({a: {n: 1}}, patch(['a', 'n'], 1, 2))).toBe(true);
        expect(isSafeScalarPatch({a: {n: 1}}, patch(['a', 'n'], 1, 2), true)).toBe(true);
        expect(isSafeScalarPatch({a: {n: 1}}, patch(['a', 'n'], 1, {x: 2}))).toBe(false);
        expect(isSafeScalarPatch({a: {}}, patch(['a', 'n'], undefined, 2))).toBe(false);
        expect(isSafeScalarPatch({a: {n: 1}}, patch(['a', 'n'], 1, 2, {replacesBranch: true}))).toBe(false);
        expect(isSafeScalarPatch([1], patch(['0'], 1, 2))).toBe(true);
        expect(isSafeScalarPatch([1], patch(['0'], 1, 2), true)).toBe(true);
        const lockedArray = [1];
        Object.defineProperty(lockedArray, 'length', {value: 1, writable: false});
        expect(isSafeScalarPatch(lockedArray, patch(['0'], 1, 2))).toBe(false);
        expect(isSafeScalarPatch({a: {n: null}}, patch(['a', 'n'], null, 2))).toBe(true);
        expect(isSafeScalarPatch({a: {n: 1}}, patch(['a', 'n'], 1, 2, {nextExists: false}))).toBe(false);
        expect(isSafeScalarPatch({a: {n: 1}}, patch([], 1, 2))).toBe(false);
    });
});

describe('sameHistoryGraph', () => {
    test('compares native contents, descriptors, cycles and alias topology', () => {
        const left: {self?: unknown; a: object; b: object} = {a: {}, b: {}}; left.self = left;
        const right: {self?: unknown; a: object; b: object} = {a: {}, b: {}}; right.self = right;
        expect(sameHistoryGraph(left, right)).toBe(true);
        right.b = right.a;
        expect(sameHistoryGraph(left, right)).toBe(false);
        expect(sameHistoryGraph(new Date(100), new Date(100))).toBe(true);
        expect(sameHistoryGraph(new Date(100), new Date(101))).toBe(false);
        expect(sameHistoryGraph(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
        expect(sameHistoryGraph(new Set([1]), new Set([1]))).toBe(true);
        expect(sameHistoryGraph(new Set([1]), new Set([2]))).toBe(false);
        class Unsupported {}
        expect(sameHistoryGraph(new Unsupported(), new Unsupported())).toBe(false);
        expect(sameHistoryGraph({x: 1}, {x: 2})).toBe(false);
        expect(sameHistoryGraph(NaN, NaN)).toBe(true);
    });
});
