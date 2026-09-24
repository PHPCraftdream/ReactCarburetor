import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('ResourceCache reentrant loads', () => {
    test('a synchronous subscriber joins the request before the loader runs', async () => {
        let resolve: (value: string) => void = () => undefined;
        let calls = 0;
        const cache = new ResourceCache<string, string>(() => {
            calls++;

            return new Promise<string>((done) => {
                resolve = done;
            });
        });
        let joined: Promise<void> | undefined;

        cache.subscribe(() => {
            joined = cache.load('a');
        }, {id: 'reentrant', reads: readsOf(cache.pathOf('a'))});

        const request = cache.load('a');

        expect(joined).toBe(request);
        expect(calls).toEqual(1);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);

        resolve('loaded');
        await request;

        expect(cache.getEntry('a').data).toEqual('loaded');
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Success);
    });

    test('a distinct key started during notification remains independent', async () => {
        const resolvers: Record<string, (value: string) => void> = {};
        const calls: string[] = [];
        const cache = new ResourceCache<string, string>((key) => {
            calls.push(key);

            return new Promise<string>((resolve) => {
                resolvers[key] = resolve;
            });
        });
        let second: Promise<void> | undefined;

        cache.subscribe(() => {
            if (!second) {
                second = cache.load('b');
            }
        }, {id: 'second-key', reads: readsOf(cache.pathOf('a'))});

        const first = cache.load('a');

        expect(calls).toEqual(['b', 'a']);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Pending);

        resolvers.a('a-data');
        resolvers.b('b-data');
        await Promise.all([first, second]);

        expect(cache.getEntry('a').data).toEqual('a-data');
        expect(cache.getEntry('b').data).toEqual('b-data');
    });

    test('abort during loading notification prevents an already-obsolete loader call', async () => {
        let calls = 0;
        const cache = new ResourceCache<string, string>(() => {
            calls++;

            return Promise.resolve('late');
        });
        let aborted = false;

        cache.subscribe(() => {
            if (!aborted) {
                aborted = true;
                cache.abort('a');
            }
        }, {id: 'abort', reads: readsOf(cache.pathOf('a'))});

        await cache.load('a');

        expect(calls).toEqual(0);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('a').data).toBeUndefined();
    });

    test('an abort listener can retry the same key without joining the cancelled request', async () => {
        const resolvers: Array<(value: string) => void> = [];
        const signals: AbortSignal[] = [];
        const cache = new ResourceCache<string, string>((_key, signal) => {
            signals.push(signal);

            return new Promise<string>((resolve) => {
                resolvers.push(resolve);
            });
        });
        const original = cache.load('a');
        let retry: Promise<void> | undefined;

        signals[0].addEventListener('abort', () => {
            retry = cache.load('a');
        });

        cache.abort('a');

        expect(retry).toBeDefined();
        expect(retry).not.toBe(original);
        expect(signals[0].aborted).toBeTruthy();
        expect(signals[1].aborted).toBeFalsy();
        expect(resolvers).toHaveLength(2);
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);

        resolvers[0]('cancelled');
        resolvers[1]('retried');
        await Promise.all([original, retry]);

        expect(cache.getEntry('a').data).toEqual('retried');
    });

    test('a different-key load started by an abort listener remains registered', async () => {
        const resolvers: Record<string, (value: string) => void> = {};
        const signals: Record<string, AbortSignal> = {};
        const cache = new ResourceCache<string, string>((key, signal) => {
            signals[key] = signal;

            return new Promise<string>((resolve) => {
                resolvers[key] = resolve;
            });
        });
        const original = cache.load('a');
        let other: Promise<void> | undefined;

        signals.a.addEventListener('abort', () => {
            other = cache.load('b');
        });

        cache.abort('a');

        expect(signals.a.aborted).toBeTruthy();
        expect(signals.b.aborted).toBeFalsy();
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Pending);

        resolvers.a('cancelled');
        resolvers.b('other');
        await Promise.all([original, other]);

        expect(cache.getEntry('b').data).toEqual('other');
    });

    test('forget preserves a same-key request started by an abort listener', async () => {
        const resolvers: Array<(value: string) => void> = [];
        const signals: AbortSignal[] = [];
        let calls = 0;
        const cache = new ResourceCache<string, string>((_key, signal) => {
            calls++;
            signals.push(signal);

            return new Promise<string>((resolve) => {
                resolvers.push(resolve);
            });
        });
        const original = cache.load('a');
        let replacement: Promise<void> | undefined;

        signals[0].addEventListener('abort', () => {
            replacement = cache.load('a');
        });

        cache.forget('a');

        expect(replacement).toBeDefined();
        expect(replacement).not.toBe(original);
        expect(signals[1].aborted).toBeFalsy();
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);

        resolvers[0]('cancelled');
        resolvers[1]('replacement');
        await Promise.all([original, replacement]);

        expect(cache.getEntry('a').data).toEqual('replacement');
        await cache.load('a');
        expect(calls).toEqual(2);
    });

    test('forgetAll preserves a same-key request started during cancellation', async () => {
        const resolvers: Array<(value: string) => void> = [];
        const signals: AbortSignal[] = [];
        const cache = new ResourceCache<string, string>((_key, signal) => {
            signals.push(signal);

            return new Promise<string>((resolve) => {
                resolvers.push(resolve);
            });
        });
        const original = cache.load('a');
        let replacement: Promise<void> | undefined;

        signals[0].addEventListener('abort', () => {
            replacement = cache.load('a');
        });

        cache.forgetAll();

        expect(replacement).toBeDefined();
        expect(signals[1].aborted).toBeFalsy();
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Pending);

        resolvers[0]('cancelled');
        resolvers[1]('replacement');
        await Promise.all([original, replacement]);

        expect(cache.getEntry('a').data).toEqual('replacement');
    });

    test('settling without a stored entry clears request bookkeeping', async () => {
        const resolvers: Array<(value: string) => void> = [];
        let calls = 0;
        const cache = new ResourceCache<string, string>(() => {
            calls++;

            return new Promise<string>((resolve) => {
                resolvers.push(resolve);
            });
        });
        const first = cache.load('a');

        cache.setData({entries: {}});
        resolvers[0]('discarded');
        await first;

        const second = cache.load('a');

        expect(calls).toEqual(2);
        resolvers[1]('fresh');
        await second;
        expect(cache.getEntry('a').data).toEqual('fresh');
    });

    test('failed settlement without a stored entry also permits a fresh load', async () => {
        const rejectors: Array<(error: Error) => void> = [];
        let calls = 0;
        const cache = new ResourceCache<string, string>(() => {
            calls++;

            return new Promise<string>((_resolve, reject) => {
                rejectors.push(reject);
            });
        });
        const first = cache.load('a');

        cache.setData({entries: {}});
        rejectors[0](new Error('discarded'));
        await first;

        const second = cache.load('a');

        expect(calls).toEqual(2);
        rejectors[1](new Error('fresh failure'));
        await second;
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Error);
    });
});
