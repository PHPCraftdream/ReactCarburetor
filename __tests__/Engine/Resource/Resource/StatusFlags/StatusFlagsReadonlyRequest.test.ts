import {EResourceStatus, IResourceData, ResourceCarburetor} from '@/Carburetor';

describe('ResourceCarburetor status flags capability on request start (F3)', () => {
    test('load succeeds when isIdle is a readonly non-configurable flag', async () => {
        const resource = new ResourceCarburetor<string, [string]>(async key => `answer-${key}`);

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

const freezeSnapshot = <T>(state: IResourceData<T>): IResourceData<T> => {
    const snapshot = {...state};
    for (const field of ['status', 'data', 'error', 'updatedAt', 'isIdle', 'isPending', 'isSuccess', 'isError']) {
        Object.defineProperty(snapshot, field, {
            value: snapshot[field as keyof IResourceData<T>],
            writable: false, enumerable: true, configurable: true,
        });
    }
    return snapshot;
};

describe('settlement handles a readonly public replacement', () => {
    test('a keyless frozen setData does not strand an in-flight success', async () => {
        let resolveLoader: (value: string) => void = () => undefined;
        const resource = new ResourceCarburetor<string, []>(
            () => new Promise<string>(resolve => { resolveLoader = resolve; })
        );
        const pending = resource.load();
        const snapshot = freezeSnapshot(resource.getData());
        resource.setData(snapshot);
        resolveLoader('late');
        await expect(pending).resolves.toBeUndefined();
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('late');
    });

    test('a keyless frozen setData does not break abort', async () => {
        let resolveLoader: (value: string) => void = () => undefined;
        const resource = new ResourceCarburetor<string, []>(
            () => new Promise<string>(resolve => { resolveLoader = resolve; })
        );
        const pending = resource.load();
        resource.setData(freezeSnapshot(resource.getData()));
        expect(() => resource.abort()).not.toThrow();
        resolveLoader('late');
        await expect(pending).resolves.toBeUndefined();
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
    });

    test('a keyless frozen setData does not strand an in-flight error', async () => {
        let rejectLoader: (error: unknown) => void = () => undefined;
        const resource = new ResourceCarburetor<string, []>(
            () => new Promise<string>((_, reject) => { rejectLoader = reject; })
        );
        const pending = resource.load();
        resource.setData(freezeSnapshot(resource.getData()));
        rejectLoader(new Error('boom'));
        await expect(pending).resolves.toBeUndefined();
        expect(resource.getData().status).toBe(EResourceStatus.Error);
        expect(resource.getData().error).toBe('boom');
    });
});
