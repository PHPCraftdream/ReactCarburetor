import {CarburetorHistory, ResourceCache, ResourceCarburetor} from '@/Carburetor';

const cacheNames = ['ttl', 'loader', 'maxEntries', 'eviction', 'runtimeRecords', 'viewCache',
    'restoreGeneration', 'removalEpoch', 'bulkDepth', 'lastKeyArgs', 'lastKeyJson', 'lastKeyValue',
    'keyMutationReported', 'primedKeys', 'primedHead', 'primedTail', 'keyCacheSize',
    'runtimeFor', 'hasRequest', 'installState', 'touch', 'finishBulk', 'forgetKey', 'isStale',
    'evict', 'removeEntries', 'isRetentionFree', 'abortKey', 'keyOf', 'pathOf', 'fetch',
    'markLoading', 'isCurrent', 'settleSuccess', 'settleFailure', 'reconcileFailure',
    'reconcileFailureWrite', 'primed', 'touchPrimed'];
const slotNames = ['loader', 'runtime', 'operationVersion', 'ensureRuntime', 'reconcileError',
    'cancelInFlight', 'start', 'keyOf', 'isCurrent', 'settleSuccess', 'settleError'];

/** Shadows application names without relying on engine internals. */
const shadow = (store: object, name: string): void => {
    Object.defineProperty(store, name, {value: 'domain', writable: true, configurable: true});
};

describe('R40-01 resource subclass names', () => {
    test('cache and slot own no string-named engine fields', () => {
        expect(Object.getOwnPropertyNames(new ResourceCache(async () => 1))).toEqual([]);
        expect(Object.getOwnPropertyNames(new ResourceCarburetor(async () => 1))).toEqual([]);
    });

    test.each(cacheNames)('cache shadow %s preserves load, invalidation, history and delivery', async name => {
        let calls = 0;
        const cache = new ResourceCache<string, string>(async args => `${args}:${++calls}`, {ttl: Infinity});
        shadow(cache, name);
        const history = new CarburetorHistory(cache);
        let deliveries = 0;
        const id = cache.subscribe(() => { deliveries++; });
        await cache.load('a');
        expect(cache.getEntry('a').data).toBe('a:1');
        await cache.load('a');
        expect(calls).toBe(1);
        cache.invalidate('a');
        expect(cache.getEntry('a').invalidated).toBe(true);
        await cache.load('a');
        expect(cache.getEntry('a').data).toBe('a:2');
        const before = cache.snapshot();
        cache.forget('a');
        expect(cache.getEntry('a').data).toBeUndefined();
        history.undo();
        expect(cache.snapshot()).toEqual(before);
        history.redo();
        expect(cache.getEntry('a').data).toBeUndefined();
        expect(deliveries).toBe(8);
        expect(Reflect.get(cache, name)).toBe('domain');
        cache.unsubscribe(id);
        history.disconnect();
    });

    test.each(slotNames)('slot shadow %s preserves load, reload, history and delivery', async name => {
        let calls = 0;
        const slot = new ResourceCarburetor<string, string>(async args => `${args}:${++calls}`);
        shadow(slot, name);
        const history = new CarburetorHistory(slot);
        let deliveries = 0;
        const id = slot.subscribe(() => { deliveries++; });
        await slot.load('a');
        expect(slot.getData().data).toBe('a:1');
        await slot.reload();
        expect(slot.getData().data).toBe('a:2');
        expect(calls).toBe(2);
        const before = slot.snapshot();
        await slot.load('b');
        expect(slot.getData().data).toBe('b:3');
        history.undo();
        expect(slot.getData().data).toBe('a:2');
        history.redo();
        expect(slot.getData().data).toBe('b:3');
        slot.restore(before);
        expect(slot.getData().data).toBe('a:2');
        expect(deliveries).toBe(9);
        expect(Reflect.get(slot, name)).toBe('domain');
        slot.unsubscribe(id);
        history.disconnect();
    });
});
