import {CarburetorHistory, EResourceStatus, ResourceCache, getInitialCacheEntry} from '@/Carburetor';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';

const ready = (data: unknown): IResourceEntry<unknown> => ({
    ...getInitialCacheEntry<unknown>(), status: EResourceStatus.Success, data, updatedAt: 1,
});

interface ILinkedCacheData extends IResourceCacheData<unknown> {
    links: Map<object, object>;
}

const makeReadonlyGraph = (cache: ResourceCache<unknown, string>, count: number) => {
    const entries: Record<string, IResourceEntry<unknown>> = {};
    const keys: string[] = [];
    for (let index = 0; index < count; index++) {
        const key = cache.keyOf(`row-${index}`);
        keys.push(key);
        Object.defineProperty(entries, key, {
            value: ready({rowId: index, detail: {value: index}}), enumerable: true,
            writable: true, configurable: false,
        });
    }

    const root: ILinkedCacheData = {entries, links: new Map<object, object>()};
    const first = entries[keys[0]];
    root.links.set(root, entries);
    root.links.set(entries, first);
    root.links.set(first, root);
    for (const key of keys.slice(1)) root.links.set(entries[key], entries[key]);
    Object.defineProperty(root.links, 'owner', {
        value: root, enumerable: true, writable: false, configurable: false,
    });
    cache.setData(root);

    return {keys, links: root.links};
};

const linksOf = (state: IResourceCacheData<unknown>): Map<object, object> => {
    if (!('links' in state) || !(state.links instanceof Map)) {
        throw new Error('Expected the owned graph to retain its native links');
    }
    return state.links;
};

const expectNativeBacklinks = (state: IResourceCacheData<unknown>, keys: string[]): void => {
    const links = linksOf(state);
    expect(links.get(state)).toBe(state.entries);
    const detachedFirst = links.get(state.entries);
    if (!detachedFirst || !('data' in detachedFirst)) {
        throw new Error('Expected the links graph to retain its first entry');
    }
    expect(detachedFirst.data).toMatchObject({rowId: 0});
    expect(links.get(detachedFirst)).toBe(state);
    expect(Object.getOwnPropertyDescriptor(links, 'owner')).toMatchObject({
        value: state, enumerable: true, writable: false, configurable: false,
    });
    expect(Object.keys(state.entries)).toEqual(keys);
};

describe('ResourceCache settled readonly bulk forget', () => {
    test('owns a locked graph once, publishes once, and leaves the held endpoint unchanged', () => {
        const count = 32;
        let loads = 0;
        const cache = new ResourceCache<unknown, string>(async () => { loads++; return undefined; }, {ttl: Infinity});
        const {keys, links} = makeReadonlyGraph(cache, count);
        const held = cache.getData();
        let callbacks = 0;
        const subscription = cache.subscribe(() => { callbacks++; });
        const version = cache.getVersion();
        const ownKeys = Reflect.ownKeys;
        let rootVisits = 0;
        let rowVisits = 0;

        Reflect.ownKeys = (target: object): Array<string | symbol> => {
            if (Object.hasOwn(target, 'entries')) rootVisits++;
            if (Object.hasOwn(target, 'rowId')) rowVisits++;
            return ownKeys(target);
        };
        try {
            cache.forgetAll();
        } finally {
            Reflect.ownKeys = ownKeys;
        }

        const live = cache.getData();
        expect(rootVisits).toBe(1);
        expect(rowVisits).toBe(count);
        expect(Object.keys(live.entries)).toEqual([]);
        expect(cache.getVersion()).toBe(version + 1);
        expect(callbacks).toBe(1);
        expect(loads).toBe(0);
        expect(Object.keys(held.entries)).toEqual(keys);
        expect(Object.getOwnPropertyDescriptor(held.entries, keys[0])).toMatchObject({
            enumerable: true, writable: true, configurable: false,
        });
        expect(held.entries[keys[0]].data).toMatchObject({rowId: 0});

        expect(linksOf(live)).not.toBe(links);
        expectNativeBacklinks(live, []);
        cache.unsubscribe(subscription);
    });

    test('readonly removal remains undoable and redoable with native backlinks and flags intact', () => {
        const cache = new ResourceCache<unknown, string>(async () => undefined, {ttl: Infinity});
        const history = new CarburetorHistory(cache);
        const {keys} = makeReadonlyGraph(cache, 3);
        const held = cache.getData();

        cache.forgetAll();
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        expect(history.undo()).toBe(true);
        const restored = cache.getData();
        expectNativeBacklinks(restored, keys);
        expect(Object.getOwnPropertyDescriptor(restored.entries, keys[0])).toMatchObject({
            enumerable: true, writable: true, configurable: false,
        });
        expect(history.redo()).toBe(true);
        expectNativeBacklinks(cache.getData(), []);
        expect(Object.keys(held.entries)).toEqual(keys);
        history.disconnect();
    });
});

describe('ResourceCache active forgetAll reentry', () => {
    test('an abort listener can restore and start a new owner without reviving the cancelled answer', async () => {
        const signals: AbortSignal[] = [];
        const answers: Array<(value: string) => void> = [];
        const cache = new ResourceCache<string, string>((_key, signal) => {
            signals.push(signal);
            return new Promise<string>((resolve) => { answers.push(resolve); });
        }, {ttl: Infinity});
        const original = cache.load('old');
        let replacement: Promise<void> | undefined;

        signals[0].addEventListener('abort', () => {
            cache.restore({entries: {}});
            replacement = cache.load('new');
        });

        cache.forgetAll();
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        if (!replacement) throw new Error('Abort listener did not create a replacement request');
        expect(cache.getEntry('new').status).toBe(EResourceStatus.Pending);

        answers[0]('cancelled-old-answer');
        answers[1]('restored-new-owner');
        await Promise.all([original, replacement]);

        expect(cache.getEntry('old').data).toBeUndefined();
        expect(cache.getEntry('new')).toMatchObject({
            status: EResourceStatus.Success, data: 'restored-new-owner',
        });
    });
});
describe('ResourceCache bulk forget extension hooks', () => {
    test('subclass abort and removal hooks still run once per locked key', () => {
        class HookCache extends ResourceCache<unknown, string> {
            public abortedKeys: string[] = [];
            public removalBatches: string[][] = [];

            protected abortKey(key: string): void {
                this.abortedKeys.push(key);
                super.abortKey(key);
            }

            protected removeEntries(keys: string[], deferNotification: boolean): void {
                this.removalBatches.push([...keys]);
                super.removeEntries(keys, deferNotification);
            }
        }

        const cache = new HookCache(async () => undefined, {ttl: Infinity});
        const {keys} = makeReadonlyGraph(cache, 3);
        const version = cache.getVersion();
        let callbacks = 0;
        const subscription = cache.subscribe(() => { callbacks++; });

        cache.forgetAll();

        expect(cache.abortedKeys).toEqual(keys);
        expect(cache.removalBatches).toEqual(keys.map((key) => [key]));
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        expect(cache.getVersion()).toBe(version + 1);
        expect(callbacks).toBe(1);
        cache.unsubscribe(subscription);
    });

    test('a throwing per-key override leaves readonly partial state and closes the bulk phase', () => {
        class ThrowOnceCache extends ResourceCache<unknown, string> {
            public throwOnKey: string | undefined;
            private thrown: boolean = false;

            protected forgetKey(key: string): void {
                if (!this.thrown && key === this.throwOnKey) {
                    this.thrown = true;
                    throw new Error('stop');
                }
                super.forgetKey(key);
            }
        }

        const cache = new ThrowOnceCache(async () => undefined, {ttl: Infinity});
        const {keys} = makeReadonlyGraph(cache, 3);
        const held = cache.getData();
        const version = cache.getVersion();
        let callbacks = 0;
        const subscription = cache.subscribe(() => { callbacks++; });
        cache.throwOnKey = keys[1];

        expect(() => cache.forgetAll()).toThrow('stop');
        const partial = cache.getData();
        expectNativeBacklinks(partial, keys.slice(1));
        expect(Object.getOwnPropertyDescriptor(held.entries, keys[0])).toMatchObject({
            enumerable: true, writable: true, configurable: false,
        });
        expect(held.entries[keys[0]].data).toMatchObject({rowId: 0});
        expect(cache.getVersion()).toBe(version + 1);
        expect(callbacks).toBe(1);

        cache.forgetAll();
        expect(Object.keys(cache.getData().entries)).toEqual([]);
        expect(cache.getVersion()).toBe(version + 2);
        expect(callbacks).toBe(2);
        cache.unsubscribe(subscription);
    });
});
