import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

describe('ResourceCache with undefined values', () => {
    test('suspend returns a settled undefined value without fetching again', async () => {
        let calls = 0;
        const cache = new ResourceCache<string | undefined, string>(() => {
            calls++;

            return Promise.resolve(undefined);
        });

        await cache.load('a');

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
        expect(cache.suspend('a')).toBeUndefined();
        expect(calls).toEqual(1);
    });

    test('a failed refresh preserves a successful undefined value', async () => {
        let rejectRefresh: (error: Error) => void = () => undefined;
        let calls = 0;
        const cache = new ResourceCache<string | undefined, string>(() => {
            calls++;

            if (calls === 1) {
                return Promise.resolve(undefined);
            }

            return new Promise<string | undefined>((_resolve, reject) => {
                rejectRefresh = reject;
            });
        });

        await cache.load('a');
        const refresh = cache.refresh('a');

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
        expect(cache.getEntry('a').refreshing).toBeTruthy();

        rejectRefresh(new Error('offline'));
        await refresh;

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
        expect(cache.getEntry('a').refreshing).toBeFalsy();
        expect(cache.getEntry('a').failed).toBeTruthy();
        expect(cache.suspend('a')).toBeUndefined();
    });
});
