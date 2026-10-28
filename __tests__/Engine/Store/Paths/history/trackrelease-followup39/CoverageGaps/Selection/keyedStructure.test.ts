import {patchKeyedStructure} from '@/Carburetor/Store/Utils/Selection/Patch/Structure/patchKeyedStructure';
import {AddedMembers} from '@/Carburetor/Store/Utils/Selection/Patch/Structure/AddedMembers';

describe('patchKeyedStructure', () => {
    test('inserts and removes keys in live order while preserving kept identity', () => {
        const kept = {n: 1};
        const previous = {kept};
        const live = {kept, added: {n: 2}};
        const raw = {kept, added: live.added};
        const added = new AddedMembers(new WeakMap(), undefined, undefined);
        const result = patchKeyedStructure(previous, live, raw, new Set(['added', 'removed']), added);
        expect(result && Object.keys(result)).toEqual(['kept', 'added']);
        expect(result?.kept).toBe(kept);
        expect(result?.added).toEqual({n: 2});
        expect(added.commit()).toBe(true);
    });

    test('refuses replacing an existing written key', () => {
        const prior = {key: {n: 1}};
        expect(patchKeyedStructure(prior, {key: {n: 2}}, {key: {n: 2}}, new Set(['key']),
            new AddedMembers(new WeakMap(), undefined, undefined))).toBeUndefined();
    });
});
