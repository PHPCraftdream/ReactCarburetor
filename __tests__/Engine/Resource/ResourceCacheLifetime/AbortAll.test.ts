import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";
import {persist} from "@/Carburetor/Tooling/persist";

const makeLoader = () => {
    const pending: Array<{key: string; signal: AbortSignal; resolve: (value: string) => void}> = [];
    const load = (key: string, signal: AbortSignal): Promise<string> => new Promise((resolve) => {
        pending.push({key, signal, resolve});
    });

    return {pending, load};
};

describe('ResourceCache abortAll', () => {
    test('pending and refreshing entries publish once with precise paths and persistence', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        const ready = cache.load('ready');

        loader.pending[0].resolve('old');
        await ready;

        const refresh = cache.refresh('ready');
        const first = cache.load('a');
        const second = cache.load('b');
        const seen = [0, 0, 0, 0];
        const ids = [
            cache.subscribe(() => { seen[0]++; }),
            cache.subscribe(() => { seen[1]++; }, {reads: new Set([cache.pathOf('a')])}),
            cache.subscribe(() => { seen[2]++; }, {reads: new Set([cache.pathOf('ready')])}),
            cache.subscribe(() => { seen[3]++; }, {reads: new Set([cache.pathOf('missing')])}),
        ];
        const saved: string[] = [];
        const dispose = persist(cache, {key: 'cache', storage: {
            getItem: () => null,
            setItem: (_key, value) => { saved.push(value); },
            removeItem: () => undefined,
        }});
        const before = cache.getVersion();

        cache.abortAll();

        expect(cache.getVersion() - before).toBe(1);
        expect(seen).toEqual([1, 1, 1, 0]);
        expect(saved).toHaveLength(1);
        expect(cache.getEntry('ready').data).toBe('old');
        expect(cache.getEntry('ready').refreshing).toBe(false);
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Idle);
        expect(cache.getEntry('b').status).toBe(EResourceStatus.Idle);
        expect(Object.keys(cache.getData().entries)).toHaveLength(3);
        expect(loader.pending.slice(1).every(({signal}) => signal.aborted)).toBe(true);

        loader.pending.slice(1).forEach(({resolve}) => resolve('late'));
        await Promise.all([refresh, first, second]);
        dispose();
        ids.forEach((id) => cache.unsubscribe(id));
    });

    test('abort listeners can replace a later snapshot request and keep its answer', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load);
        const first = cache.load('a');
        const second = cache.load('b');
        let replacementA: Promise<void> | undefined;
        let replacementB: Promise<void> | undefined;

        loader.pending[0].signal.addEventListener('abort', () => {
            replacementA = cache.load('a');
            cache.abort('b');
            replacementB = cache.load('b');
        });
        const before = cache.getVersion();

        cache.abortAll();

        expect(cache.getVersion() - before).toBe(1);
        expect(loader.pending).toHaveLength(4);
        expect(loader.pending[0].signal.aborted).toBe(true);
        expect(loader.pending[1].signal.aborted).toBe(true);
        expect(loader.pending[2].signal.aborted).toBe(false);
        expect(loader.pending[3].signal.aborted).toBe(false);
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Pending);
        expect(cache.getEntry('b').status).toBe(EResourceStatus.Pending);

        loader.pending.forEach(({resolve}, index) => resolve(`answer-${index}`));
        await Promise.all([first, second, replacementA, replacementB]);
        expect(cache.getEntry('a').data).toBe('answer-2');
        expect(cache.getEntry('b').data).toBe('answer-3');
    });

    test('subscriber reentry after delivery publishes separately', () => {
        const cache = new ResourceCache<string, string>(() => new Promise(() => undefined));

        void cache.load('a');
        void cache.load('b');

        let callbacks = 0;
        const id = cache.subscribe(() => {
            callbacks++;
            if (callbacks === 1) {
                void cache.load('c');
            }
        });
        const before = cache.getVersion();

        cache.abortAll();

        expect(cache.getVersion() - before).toBe(2);
        expect(callbacks).toBe(2);
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Idle);
        expect(cache.getEntry('c').status).toBe(EResourceStatus.Pending);
        cache.unsubscribe(id);
    });
});
