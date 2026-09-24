import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

describe('ResourceCache falsy rejections', () => {
    test.each([0, false, '', undefined])('suspend rethrows the raw rejection %p', async (failure: unknown) => {
        const cache = new ResourceCache<string, string>(() => Promise.reject(failure));

        await cache.load('a');

        let caught = false;
        let thrown: unknown;

        try {
            cache.suspend('a');
        } catch (error: unknown) {
            caught = true;
            thrown = error;
        }

        expect(caught).toBe(true);
        expect(thrown).toBe(failure);
    });
});
