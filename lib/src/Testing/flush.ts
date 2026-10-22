import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {CarburetorScope} from '@/Carburetor/Component/Scope/CarburetorScope';
import {CARBURETOR_FLUSH, CARBURETOR_PERSIST_DRAIN, SCOPE_TESTING_VISIT} from '@/Carburetor/Store/Utils/Models';

interface IFlushableStore {
    [CARBURETOR_FLUSH]?: () => boolean;
    [CARBURETOR_PERSIST_DRAIN]?: Set<() => void>;
}

/** Synchronously drains pending work for a carburetor or its owning scope tree.
 *
 * @param target - the store or scope whose pending notifications and persistence should be delivered
 */
export const flush = <T extends object, E extends object>(target: Carburetor<T, E> | CarburetorScope): void => {
    if (target instanceof CarburetorScope) {
        flushStoreTree(target);
        return;
    }
    const store = target as unknown as IFlushableStore;
    store[CARBURETOR_FLUSH]?.();
    drainPersistWrites(store);
};

/** Invokes every live persistence drain registered for a store.
 *
 * @param store - the store whose pending writes should be completed
 */
const drainPersistWrites = (store: IFlushableStore): void => {
    const drains = store[CARBURETOR_PERSIST_DRAIN];
    if (drains) {
        for (const drain of drains) drain();
    }
};

/** Visits and flushes stores owned by a scope and its descendants.
 *
 * @param scope - the scope whose store tree should be flushed
 */
const flushStoreTree = (scope: CarburetorScope): void => {
    const stores: IFlushableStore[] = [];
    scope[SCOPE_TESTING_VISIT](store => {
        if (store !== null && typeof store === 'object') {
            const candidate = store as IFlushableStore;
            if (typeof candidate[CARBURETOR_FLUSH] === 'function') stores.push(candidate);
        }
    });
    for (let round = 0; round < 50; round++) {
        let progressed = false;
        for (const store of stores) {
            progressed = (store[CARBURETOR_FLUSH]?.() ?? false) || progressed;
            drainPersistWrites(store);
        }
        scope[SCOPE_TESTING_VISIT](store => {
            if (store !== null && typeof store === 'object') {
                const candidate = store as IFlushableStore;
                if (typeof candidate[CARBURETOR_FLUSH] === 'function' && !stores.includes(candidate)) {
                    stores.push(candidate);
                }
            }
        });
        if (!progressed) return;
    }
    throw new Error('Testing flush exceeded 50 pending rounds');
};
