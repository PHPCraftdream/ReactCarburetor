import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {rstest} from '@rstest/core';

const flush = async (): Promise<void> => {
    await new Promise((resolve: () => void) => setTimeout(resolve, 0));
};

/** Runs one block with the global removed, restoring whatever was there afterwards. */
const withoutAbortController = async (run: () => Promise<void>): Promise<void> => {
    const scope = globalThis as {AbortController?: unknown};
    const saved = scope.AbortController;

    scope.AbortController = undefined;

    try {
        await run();
    } finally {
        scope.AbortController = saved;
    }
};

describe('resource loads without a global AbortController (R5-04)', () => {
    test('ResourceCarburetor.load still works and reports the degradation once', async () => {
        // The diagnostic routes through console.error, and the suite's console guard fails
        // a test that lets output through uncaptured: capture it, assert it, restore.
        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });

        await withoutAbortController(async () => {
            let observed: unknown;

            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                observed = signal;

                return Promise.resolve('loaded');
            });

            await resource.load(undefined);

            expect(resource.getData().status).toEqual(EResourceStatus.Success);
            expect(resource.getData().data).toEqual('loaded');
            expect(observed).toEqual({aborted: false});
        });

        spy.mockRestore();

        expect(reports.length).toEqual(1);
        expect(String(reports[0][0])).toContain('AbortController');
    });

    test('ResourceCarburetor.abort still discards a late answer without the global', async () => {
        await withoutAbortController(async () => {
            let resolveLoad: (value: string) => void = () => undefined;

            const resource = new ResourceCarburetor<string>((): Promise<string> => {
                return new Promise<string>((resolve: (value: string) => void) => {
                    resolveLoad = resolve;
                });
            });

            const loading = resource.load(undefined);
            resource.abort();

            resolveLoad('too late');
            await loading;
            await flush();

            expect(resource.getData().status).toEqual(EResourceStatus.Idle);
            expect(resource.getData().data).toBeUndefined();
        });
    });

    test('ResourceCache.load still works without the global', async () => {
        await withoutAbortController(async () => {
            const cache = new ResourceCache<string, string>(() => Promise.resolve('loaded'));

            await cache.load('a');

            expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
            expect(cache.getEntry('a').data).toEqual('loaded');
        });
    });

    test('ResourceCache.forget still discards a late answer without the global', async () => {
        await withoutAbortController(async () => {
            let resolveLoad: (value: string) => void = () => undefined;

            const cache = new ResourceCache<string, string>((): Promise<string> => {
                return new Promise<string>((resolve: (value: string) => void) => {
                    resolveLoad = resolve;
                });
            });

            void cache.load('a');
            cache.forget('a');

            resolveLoad('too late');
            await flush();

            expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
            expect(cache.getEntry('a').data).toBeUndefined();
        });
    });
});
