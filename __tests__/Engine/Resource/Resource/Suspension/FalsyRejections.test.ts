import {ResourceCarburetor} from "@/Carburetor/Resource/ResourceCarburetor";

describe('ResourceCarburetor falsy rejections', () => {
    test.each([0, false, '', undefined])('suspend rethrows the raw rejection %p', async (failure: unknown) => {
        const resource = new ResourceCarburetor<string, void>(() => Promise.reject(failure));

        await resource.load(undefined);

        let caught = false;
        let thrown: unknown;

        try {
            resource.suspend(undefined);
        } catch (error: unknown) {
            caught = true;
            thrown = error;
        }

        expect(caught).toBe(true);
        expect(thrown).toBe(failure);
    });
});
