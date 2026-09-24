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
});
