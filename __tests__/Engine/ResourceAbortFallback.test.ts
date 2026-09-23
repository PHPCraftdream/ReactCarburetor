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

describe('the fallback signal satisfies a standard loader (R6-01)', () => {
    test('a loader calling addEventListener starts and settles under both resource classes', async () => {
        // The module-level `reported` flag was consumed by the first test above, so neither
        // block below lets the development diagnostic through the console guard.
        await withoutAbortController(async () => {
            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                signal.addEventListener('abort', (): void => undefined);

                return Promise.resolve('loaded');
            });

            await resource.load(undefined);

            expect(resource.getData().status).toEqual(EResourceStatus.Success);
            expect(resource.getData().data).toEqual('loaded');

            const cache = new ResourceCache<string, string>((_args: string, signal: AbortSignal) => {
                signal.addEventListener('abort', (): void => undefined);

                return Promise.resolve('loaded');
            });

            await cache.load('a');

            expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
            expect(cache.getEntry('a').data).toEqual('loaded');
        });
    });

    test('aborting an in-flight load fires the registered abort listener', async () => {
        await withoutAbortController(async () => {
            let aborts = 0;
            let resolveLoad: (value: string) => void = () => undefined;

            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                signal.addEventListener('abort', (): void => {
                    aborts += 1;
                });

                return new Promise<string>((resolve: (value: string) => void) => {
                    resolveLoad = resolve;
                });
            });

            const loading = resource.load(undefined);
            resource.abort();

            expect(aborts).toEqual(1);

            resolveLoad('too late');
            await loading;
            await flush();

            expect(resource.getData().status).toEqual(EResourceStatus.Idle);
        });
    });

    test('removeEventListener stops a listener from firing', async () => {
        await withoutAbortController(async () => {
            let kept = 0;
            let removed = 0;
            let resolveLoad: (value: string) => void = () => undefined;

            const onRemoved = (): void => {
                removed += 1;
            };

            const onKept = (): void => {
                kept += 1;
            };

            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                signal.addEventListener('abort', onRemoved);
                signal.addEventListener('abort', onKept);
                signal.removeEventListener('abort', onRemoved);

                return new Promise<string>((resolve: (value: string) => void) => {
                    resolveLoad = resolve;
                });
            });

            const loading = resource.load(undefined);
            resource.abort();

            expect(removed).toEqual(0);
            expect(kept).toEqual(1);

            resolveLoad('too late');
            await loading;
            await flush();

            expect(resource.getData().status).toEqual(EResourceStatus.Idle);
        });
    });
});
