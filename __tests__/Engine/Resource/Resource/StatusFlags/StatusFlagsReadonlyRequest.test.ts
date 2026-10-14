import {EResourceStatus, IResourceData, ResourceCarburetor} from '@/Carburetor';

describe('ResourceCarburetor status flags capability on request start (F3)', () => {
    test('load succeeds when isIdle is a readonly non-configurable flag', async () => {
        const resource = new ResourceCarburetor<string, string>(async key => `answer-${key}`);

        // Seed an idle slot whose isIdle flag is frozen: readonly and non-configurable,
        // while every other field stays writable.
        const seeded = {
            ...resource.getData(),
            data: 'seed' as string | undefined,
            updatedAt: 1 as number | undefined,
        };
        Object.defineProperty(seeded, 'isIdle', {
            value: true, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(seeded as IResourceData<string>);

        // The request start capability check ignores the status flags; whatever happens
        // next must not throw on the readonly flag write nor strand the readonly flag.
        await expect(resource.load('a')).resolves.toBeUndefined();

        const data = resource.getData();
        expect(data.status).toBe(EResourceStatus.Success);
        expect(data.isSuccess).toBe(true);
        expect(data.isIdle).toBe(false);
        expect(data.data).toBe('answer-a');
    });
});
