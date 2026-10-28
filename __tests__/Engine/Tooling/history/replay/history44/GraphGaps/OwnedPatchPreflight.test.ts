import {preflightOwnedPatches} from '@/Carburetor/Tooling/Graph/canInstallOwnedPatch';
import {IWritePatch} from '@/Carburetor/Models/Paths';

const patch = (
    segments: string[],
    previous: unknown,
    next: unknown,
    extra: Partial<IWritePatch> = {},
): IWritePatch => ({
    segments, previous, next, previousExists: true, nextExists: true, replacesBranch: false, ...extra,
});

describe('preflightOwnedPatches', () => {
    test('admits installable patches without mutating held graph and rejects impossible descriptors', () => {
        const held = {box: {n: 1}, list: [1]};
        expect(preflightOwnedPatches(held, [patch(['box', 'n'], 1, 2)])).toBeUndefined();
        expect(held.box.n).toBe(1);
        expect(preflightOwnedPatches(held, [patch(['box'], null, {n: 2}), patch(['box', 'n'], 1, 2)])).not.toBe(false);
        expect(preflightOwnedPatches(held, [patch([], undefined, 1)])).toBe(false);
        expect(preflightOwnedPatches(held, [patch(['missing', 'n'], 0, 1)])).toBe(false);
        expect(preflightOwnedPatches({box: null}, [patch(['box', 'n'], 0, 1)])).toBe(false);
        expect(preflightOwnedPatches({box: 7}, [patch(['box', 'n'], 1, 2)])).toBe(false);
        expect(preflightOwnedPatches(Object.preventExtensions({}), [patch(['fresh'], undefined, 1)])).toBe(false);
        const frozen = Object.defineProperty({}, 'locked', {value: 1, configurable: false});
        expect(preflightOwnedPatches(frozen, [patch(['locked'], 1, undefined, {nextExists: false})])).toBe(false);
        expect(preflightOwnedPatches({list: Object.freeze([1])}, [patch(['list', '1'], undefined, 2)])).toBe(false);
        const badLength = [1];
        expect(preflightOwnedPatches({list: badLength}, [patch(['list', 'length'], 1, 1.5)])).toBe(false);
        const fixedTail = [1, 2];
        Object.defineProperty(fixedTail, '1', {value: 2, configurable: false});
        expect(preflightOwnedPatches({list: fixedTail}, [patch(['list', 'length'], 2, 1)])).toBe(false);
        const fixedLength = [1];
        Object.defineProperty(fixedLength, 'length', {value: 1, writable: false});
        expect(preflightOwnedPatches({list: fixedLength}, [patch(['list', '2'], undefined, 3)])).toBe(false);
        expect(preflightOwnedPatches({list: [1]}, [patch(['list', '1'], undefined, 2)])).toBeUndefined();
        const proto = preflightOwnedPatches({}, [
            patch(['__proto__'], undefined, {safe: true}),
            patch(['__proto__', 'safe'], true, false),
        ]);
        expect(proto).not.toBe(false);
        expect(Object.prototype.hasOwnProperty.call(proto, '__proto__')).toBe(true);
        expect(Object.getOwnPropertyDescriptor(proto, '__proto__')?.value).toEqual({safe: false});
        expect(preflightOwnedPatches({__proto__: null}, [patch(['__proto__'], undefined, 1)])).toBeUndefined();
        expect(preflightOwnedPatches(Object.preventExtensions({}), [patch(['__proto__'], undefined, 1)])).toBe(false);
        const replaceExisting = Object.defineProperty({}, 'slot', {value: 1, configurable: false, writable: true});
        expect(preflightOwnedPatches(replaceExisting, [patch(['slot'], 1, 2)])).toBeUndefined();
    });
});
