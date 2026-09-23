import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {createAbortHandle} from "@/Carburetor/Resource/createAbortHandle";
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

describe('abort delivery survives a throwing listener (R7-03)', () => {
    test('abort() delivers to every listener even when one throws, and the error does not escape', async () => {
        // The throwing listener is reported through diagnostics, which routes through
        // console.error: capture it, assert on it, restore — the console guard otherwise
        // fails the test.
        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });

        await withoutAbortController(async () => {
            const calls: string[] = [];
            const handle = createAbortHandle();

            handle.signal.addEventListener('abort', (): void => {
                calls.push('throwing');
                throw new Error('listener boom');
            });
            handle.signal.addEventListener('abort', (): void => {
                calls.push('second');
            });

            expect((): void => handle.abort()).not.toThrow();
            expect(calls).toEqual(['throwing', 'second']);
            expect(handle.signal.aborted).toBe(true);
        });

        spy.mockRestore();

        // The degradation report also fires when this file runs before any other shim use,
        // so look for the listener error itself rather than counting reports.
        const messages: string[] = reports.map((args: unknown[]): string => String(args[0]));

        expect(messages.some((message: string): boolean => {
            return message.includes('listener boom');
        })).toBe(true);
    });

    test('a throwing listener no longer leaves a resource stuck Pending', async () => {
        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });

        await withoutAbortController(async () => {
            let resolveLoad: (value: string) => void = () => undefined;
            let observed: AbortSignal | undefined;

            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                observed = signal;
                signal.addEventListener('abort', (): void => {
                    throw new Error('listener boom');
                });
                signal.addEventListener('abort', (): void => undefined);

                return new Promise<string>((resolve: (value: string) => void): void => {
                    resolveLoad = resolve;
                });
            });

            const loading = resource.load(undefined);

            expect(resource.getData().status).toEqual(EResourceStatus.Pending);
            expect((): void => resource.abort()).not.toThrow();

            resolveLoad('too late');
            await loading;
            await flush();

            expect(observed?.aborted).toBe(true);
            expect(resource.getData().status).toEqual(EResourceStatus.Idle);
            expect(resource.getData().data).toBeUndefined();
        });

        spy.mockRestore();

        const messages: string[] = reports.map((args: unknown[]): string => String(args[0]));

        expect(messages.some((message: string): boolean => {
            return message.includes('listener boom');
        })).toBe(true);
    });
});

describe('the fallback signal carries the rest of the advertised surface (R7-04)', () => {
    test('throwIfAborted does nothing before abort and throws an abort error after', async () => {
        await withoutAbortController(async () => {
            const handle = createAbortHandle();

            expect((): void => handle.signal.throwIfAborted()).not.toThrow();

            handle.abort();

            let thrown: unknown;

            try {
                handle.signal.throwIfAborted();
            } catch (error: unknown) {
                thrown = error;
            }

            expect(thrown instanceof Error).toBe(true);
            expect((thrown as Error).name).toEqual('AbortError');
            expect(String((thrown as Error).message)).toContain('abort');
        });
    });

    test('onabort fires exactly once when the signal aborts', async () => {
        await withoutAbortController(async () => {
            let calls = 0;
            const handle = createAbortHandle();

            const handler = (): void => {
                calls += 1;
            };

            handle.signal.onabort = handler;

            expect(handle.signal.onabort).toBe(handler);

            handle.abort();
            handle.abort();

            expect(calls).toEqual(1);
        });
    });

    test('reassigning onabort replaces the handler instead of accumulating', async () => {
        await withoutAbortController(async () => {
            let firstCalls = 0;
            let secondCalls = 0;
            const handle = createAbortHandle();

            handle.signal.onabort = (): void => {
                firstCalls += 1;
            };
            handle.signal.onabort = (): void => {
                secondCalls += 1;
            };

            handle.abort();

            expect(firstCalls).toEqual(0);
            expect(secondCalls).toEqual(1);
        });
    });

    test('setting onabort back to null detaches the handler', async () => {
        await withoutAbortController(async () => {
            let calls = 0;
            const handle = createAbortHandle();

            const handler = (): void => {
                calls += 1;
            };

            handle.signal.onabort = handler;

            expect(handle.signal.onabort).toBe(handler);
            // The accessor must stay non-enumerable like the listener surface: the R5-04
            // equality test compares enumerable properties only.
            expect(Object.keys(handle.signal)).toEqual(['aborted']);

            handle.signal.onabort = null;

            expect(handle.signal.onabort).toBeNull();

            handle.abort();

            expect(calls).toEqual(0);
        });
    });

    test('a loader using throwIfAborted and onabort starts and settles under both resource classes', async () => {
        await withoutAbortController(async () => {
            const resource = new ResourceCarburetor<string>((_args: undefined, signal: AbortSignal) => {
                signal.throwIfAborted();
                signal.onabort = (): void => undefined;

                return Promise.resolve('loaded');
            });

            await resource.load(undefined);

            expect(resource.getData().status).toEqual(EResourceStatus.Success);
            expect(resource.getData().data).toEqual('loaded');

            const cache = new ResourceCache<string, string>((_args: string, signal: AbortSignal): Promise<string> => {
                signal.throwIfAborted();
                signal.onabort = (): void => undefined;

                return Promise.resolve('loaded');
            });

            await cache.load('a');

            expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
            expect(cache.getEntry('a').data).toEqual('loaded');
        });
    });
});
