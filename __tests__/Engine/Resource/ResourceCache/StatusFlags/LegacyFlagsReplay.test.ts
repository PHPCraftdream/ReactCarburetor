import {EResourceStatus} from '@/Carburetor';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {normalizeOwnedCacheReplay} from '@/Carburetor/Resource/Cache/State/normalizeOwnedCacheReplay';

const lock = (owner: object, key: string): void => {
    const value = (owner as Record<string, unknown>)[key];
    Object.defineProperty(owner, key, {value, enumerable: true, configurable: false, writable: false});
};

describe('owned cache replay adds flags to legacy entries (F4)', () => {
    test('a legacy entry without flag fields gains them in the copy branch', () => {
        // A legacy Pending entry predating the status flags: no is* fields at all.
        const legacy = {
            status: EResourceStatus.Pending, data: undefined, error: undefined, updatedAt: 17,
            refreshing: false, invalidated: false, failed: false,
        } as unknown as IResourceEntry<unknown>;
        lock(legacy, 'status');
        // A locked neighbor that is normalized in the same pass.
        const neighbor = {
            status: EResourceStatus.Idle, isIdle: true, isPending: false, isSuccess: false, isError: false,
            data: undefined, error: undefined, updatedAt: 5,
            refreshing: false, invalidated: false, failed: false,
        } as unknown as IResourceEntry<unknown>;
        lock(neighbor, 'status');
        const entries = {a: legacy, b: neighbor};
        const root: IResourceCacheData<unknown> = {entries};

        const copied = normalizeOwnedCacheReplay(root, entries, undefined);

        const a = copied.entries.a as Record<string, unknown>;
        expect(a.status).toBe(EResourceStatus.Idle);
        expect(a).toMatchObject({isIdle: true, isPending: false, isSuccess: false, isError: false});
        expect(Object.getOwnPropertyDescriptor(a, 'status'))
            .toMatchObject({writable: false, configurable: false, value: EResourceStatus.Idle});
        const b = copied.entries.b as Record<string, unknown>;
        expect(b).toMatchObject({status: EResourceStatus.Idle, isIdle: true, isPending: false});
        // The originals are untouched.
        expect((legacy as Record<string, unknown>).isIdle).toBeUndefined();
        expect(legacy.status).toBe(EResourceStatus.Pending);
    });
});
