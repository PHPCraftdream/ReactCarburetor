import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {CarburetorScope} from '@/Carburetor/Component/Scope/CarburetorScope';
import {CARBURETOR_FLUSH, SCOPE_TESTING_VISIT} from '@/Carburetor/Store/Utils/Models';

interface IFlushableStore {
    [CARBURETOR_FLUSH]?: () => boolean;
}

/** Synchronously drains pending work for a carburetor or its owning scope tree.
 *
 * @param target - the store or scope whose pending notifications should be delivered
 */
export const flush = <T extends object, E extends object>(target: Carburetor<T, E> | CarburetorScope): void => {
    if (target instanceof CarburetorScope) {
        flushStoreTree(target);
        return;
    }
    (target as unknown as IFlushableStore)[CARBURETOR_FLUSH]?.();
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
        for (const store of stores) progressed = (store[CARBURETOR_FLUSH]?.() ?? false) || progressed;
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
