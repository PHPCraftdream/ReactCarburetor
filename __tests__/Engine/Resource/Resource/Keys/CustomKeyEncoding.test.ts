import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";

describe('ResourceCarburetor with a custom key option', () => {
    const makeResource = (): ResourceCarburetor<string, [id: string]> =>
        new ResourceCarburetor<string, [id: string]>(
            async (id: string): Promise<string> => `data:${id}`,
            {key: (id: string): string => id},
        );

    test('prototype-hazard and edge keys stay readable and distinct', async () => {
        const resource = makeResource();

        for (const key of ['toString', 'constructor', '__proto__', '*', '']) {
            await resource.load(key);
            expect(resource.getData().status).toBe(EResourceStatus.Success);
            expect(resource.getData().data).toBe(`data:${key}`);
        }
    });

    test('a snapshot under a hazardous custom key restores readably', async () => {
        const resource = makeResource();
        await resource.load('toString');
        const snapshot = resource.snapshot();
        // The wire key is the encoded form, not the raw string.
        expect(snapshot.key).toBe('"toString"');

        const restored = makeResource();
        restored.fromJSON(snapshot);

        expect(restored.getData().status).toBe(EResourceStatus.Success);
        expect(restored.getData().data).toBe('data:toString');
    });
});
