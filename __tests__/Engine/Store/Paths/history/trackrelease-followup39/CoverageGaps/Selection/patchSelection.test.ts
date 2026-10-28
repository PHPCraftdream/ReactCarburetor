import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {planSelectionPatch} from '@/Carburetor/Store/Utils/Selection/Patch/Plan/planSelectionPatch';
import {patchSelection} from '@/Carburetor/Store/Utils/Selection/Patch/patchSelection';

describe('patchSelection', () => {
    test('patches a primitive leaf and retains unchanged spine branches', () => {
        const prior = {left: {n: 1}, right: {n: 2}};
        const ledger = new WeakMap<object, unknown>();
        const live = {left: {n: 3}, right: prior.right};
        const before = reconcileSelection<typeof prior>(undefined, prior, undefined, undefined, undefined, ledger);
        const plan = planSelectionPatch('rows', ['rows.left.n'], 40)!;
        const result = patchSelection(before, live, plan, ledger, undefined);
        expect(result?.left.n).toBe(3);
        expect(result?.right).toBe(before.right);
        expect(before.left.n).toBe(1);
    });

    test('requests full reconciliation when a changed leaf is a container', () => {
        const before = {item: {n: 1}};
        const ledger = new WeakMap<object, unknown>();
        const plan = planSelectionPatch('', ['item'], 30)!;
        expect(patchSelection(before, {item: {n: 2}}, plan, ledger, undefined)).toBeUndefined();
    });
});
