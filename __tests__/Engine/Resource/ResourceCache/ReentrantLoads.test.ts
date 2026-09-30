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

    test('forgetAll aborts pending and refreshing requests and filters their late answers', async () => {
        const resolvers: Record<string, Array<(value: string) => void>> = {};
        const signals: Record<string, AbortSignal[]> = {};
        const cache = new ResourceCache<string, string>((key, signal) => {
            (signals[key] ??= []).push(signal);

            return new Promise<string>((resolve) => {
                (resolvers[key] ??= []).push(resolve);
            });
        });
        const firstReady = cache.load('ready');

        resolvers.ready[0]('stored');
        await firstReady;

        const refreshing = cache.refresh('ready');
        const pending = cache.load('pending');
        let callbacks = 0;
        const id = cache.subscribe(() => { callbacks++; });
        const baseline = cache.getVersion();

        cache.forgetAll();

        expect(signals.ready[1].aborted).toBeTruthy();
        expect(signals.pending[0].aborted).toBeTruthy();
        expect(cache.getVersion() - baseline).toEqual(1);
        expect(callbacks).toEqual(1);
        expect(Object.keys(cache.getData().entries)).toEqual([]);

        resolvers.ready[1]('late-ready');
        resolvers.pending[0]('late-pending');
        await Promise.all([refreshing, pending]);

        expect(Object.keys(cache.getData().entries)).toEqual([]);
        cache.unsubscribe(id);
    });

    test('forgetAll retains a new cross-key request if its key was absent initially', async () => {
        const resolvers: Record<string, (value: string) => void> = {};
        const signals: Record<string, AbortSignal> = {};
        const cache = new ResourceCache<string, string>((key, signal) => {
            signals[key] = signal;

            return new Promise<string>((resolve) => { resolvers[key] = resolve; });
        });
        const original = cache.load('a');
        let other: Promise<void> | undefined;

        signals.a.addEventListener('abort', () => { other = cache.load('b'); });
        cache.forgetAll();

        expect(signals.a.aborted).toBeTruthy();
        expect(signals.b.aborted).toBeFalsy();
        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Pending);

        resolvers.a('late');
        resolvers.b('new');
        await Promise.all([original, other]);
        expect(cache.getEntry('b').data).toEqual('new');
    });

    test('forgetAll still visits a cross-key replacement if that key was in the initial list', async () => {
        const resolvers: Record<string, Array<(value: string) => void>> = {};
        const signals: Record<string, AbortSignal[]> = {};
        const cache = new ResourceCache<string, string>((key, signal) => {
            (signals[key] ??= []).push(signal);

            return new Promise<string>((resolve) => { (resolvers[key] ??= []).push(resolve); });
        });
        const original = cache.load('a');
        const ready = cache.load('b');

        resolvers.b[0]('stored');
        await ready;

        let replacement: Promise<void> | undefined;

        signals.a[0].addEventListener('abort', () => { replacement = cache.refresh('b'); });
        cache.forgetAll();

        expect(signals.b[1].aborted).toBeTruthy();
        expect(Object.keys(cache.getData().entries)).toEqual([]);

        resolvers.a[0]('late-a');
        resolvers.b[1]('late-b');
        await Promise.all([original, replacement]);
        expect(Object.keys(cache.getData().entries)).toEqual([]);
    });

    test('forgetAll consumes a deferred loading emit without a later wildcard', async () => {
        let resolve: (value: string) => void = () => undefined;
        const cache = new ResourceCache<string, string>(() => new Promise<string>((done) => { resolve = done; }));
        let pending: Promise<void> | undefined;

        try {
            cache.suspend('a');
        } catch (value: unknown) {
            pending = value as Promise<void>;
        }

        let callbacks = 0;
        const id = cache.subscribe(() => { callbacks++; });
        cache.forgetAll();

        expect(callbacks).toEqual(1);
        expect(cache.getVersion()).toEqual(1);
        await Promise.resolve();
        expect(callbacks).toEqual(1);
        expect(cache.getVersion()).toEqual(1);

        resolve('late');
        await pending;
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        cache.unsubscribe(id);
    });

    test('forgetAll uses fresh draft state after an abort listener replaces the root', async () => {
        const signals: Record<string, AbortSignal> = {};
        let resolve: (value: string) => void = () => undefined;
        const cache = new ResourceCache<string, string>((key, signal) => {
            signals[key] = signal;

            return new Promise<string>((done) => { resolve = done; });
        });
        const original = cache.load('a');

        signals.a.addEventListener('abort', () => {
            cache.setData({entries: {
                [cache.keyOf('a')]: {status: EResourceStatus.Success, data: 'restored-a',
                    error: undefined, updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false},
                [cache.keyOf('new')]: {status: EResourceStatus.Success, data: 'restored-new',
                    error: undefined, updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false},
            }});
        });

        cache.forgetAll();

        expect(cache.getEntry('a').status).toEqual(EResourceStatus.Idle);
        expect(cache.getEntry('new').data).toEqual('restored-new');
        expect((cache as unknown as {eviction: {count: number}}).eviction.count)
            .toBe(Object.keys(cache.getData().entries).length);

        resolve('late');
        await original;
    });

    test('forgetAll called from an abort listener shares the outer publication', async () => {
        let resolve: (value: string) => void = () => undefined;
        let signal: AbortSignal | undefined;
        const cache = new ResourceCache<string, string>((_key, currentSignal) => {
            signal = currentSignal;

            return new Promise<string>((done) => { resolve = done; });
        });
        const request = cache.load('a');
        let callbacks = 0;

        const id = cache.subscribe(() => { callbacks++; });
        signal?.addEventListener('abort', () => { cache.forgetAll(); });
        const baseline = cache.getVersion();

        cache.forgetAll();

        expect(Object.keys(cache.getData().entries)).toEqual([]);
        expect(cache.getVersion() - baseline).toEqual(1);
        expect(callbacks).toEqual(1);

        resolve('late');
        await request;
        cache.unsubscribe(id);
    });

    test('a subscriber reentering after forgetAll gets a separate publication', async () => {
        const cache = new ResourceCache<string, string>((key) => key === 'a'
            ? Promise.resolve('ready') : new Promise<string>(() => undefined));

        await cache.load('a');

        let callbacks = 0;
        const id = cache.subscribe(() => {
            callbacks++;

            if (callbacks === 1) {
                void cache.load('b');
            }
        });
        const baseline = cache.getVersion();

        cache.forgetAll();

        expect(cache.getVersion() - baseline).toEqual(2);
        expect(callbacks).toEqual(2);
        expect(cache.getEntry('b').status).toEqual(EResourceStatus.Pending);
        cache.unsubscribe(id);
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
        expect((cache as unknown as {eviction: {count: number}}).eviction.count).toBe(0);
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
