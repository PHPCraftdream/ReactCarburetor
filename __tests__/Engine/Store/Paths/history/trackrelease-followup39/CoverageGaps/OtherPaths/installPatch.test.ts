import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";

describe('installPatch', () => {
    test('installs and removes nested values according to existence flags', () => {
        const root = {branch: {value: 1}};
        installPatch(root, {
            segments: ['branch', 'value'],
            previous: 1,
            next: 2,
            previousExists: true,
            nextExists: true,
        } as never, false);
        expect(root.branch.value).toBe(2);
        installPatch(root, {
            segments: ['branch', 'value'],
            previous: 1,
            next: 2,
            previousExists: true,
            nextExists: true,
        } as never, true);
        expect(root.branch.value).toBe(1);
        installPatch(root, {
            segments: ['branch', 'extra'],
            previous: undefined,
            next: 3,
            previousExists: false,
            nextExists: true,
        } as never, true);
        expect(Object.hasOwn(root.branch, 'extra')).toBe(false);
    });
});
