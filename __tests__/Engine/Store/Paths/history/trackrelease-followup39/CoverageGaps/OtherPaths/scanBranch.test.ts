import {scanBranch} from "@/Carburetor/Store/Paths/Diff/Order/scanBranch";

describe('scanBranch', () => {
    test('counts differences and records equal subtrees', () => {
        const equal = {stable: true};
        const budget = {unchanged: new Map<object, object>(), changes: 0};
        expect(scanBranch({nested: equal, value: 1}, {nested: {stable: true}, value: 2}, budget)).toBe('differ');
        expect(budget.changes).toBe(1);
        expect(budget.unchanged.get(equal)).toEqual({stable: true});
    });
    test('rejects locked length and accepts equal branches', () => {
        expect(scanBranch({a: 1}, {a: 1}, {unchanged: new Map(), changes: 0})).toBe('equal');
        const old = [1]; Object.defineProperty(old, 'length', {writable: false});
        expect(scanBranch(old, [1, 2], {unchanged: new Map(), changes: 0})).toBe('blocked');
    });
});
