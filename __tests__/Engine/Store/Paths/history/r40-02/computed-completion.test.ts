import {computed} from '@/Carburetor';
import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {ReadStore} from './ReadStore';

const installed = (store: ReadStore): Set<string> => {
    const index = store[S.subscriberIndex] as unknown as {readsById: Map<string, Set<string>>};
    return index.readsById.values().next().value!;
};

describe('R40-02 computed completion', () => {
    test('recompute retains the pruned subscription identity and drift answer', () => {
        const store = new ReadStore();
        const value = computed(read => read(store).items.r1.title);
        const id = value.subscribe(() => {});
        try {
            const reads = installed(store);
            expect([...reads]).toEqual(['items.r1.title']);
            const baseline = store.getVersion();
            store.change(d => { d.items.r2.title = 'sibling'; });
            expect(store[CARBURETOR_HAS_DRIFT](baseline, reads)).toBe(false);
            store.change(d => { d.items.r1.title = 'changed'; });
            expect(value.get()).toBe('changed');
            expect(installed(store)).toBe(reads);
            expect(store.filed).toHaveLength(1);
            expect(store[CARBURETOR_HAS_DRIFT](baseline, reads)).toBe(true);
        } finally { value.unsubscribe(id); }
        expect(store.indexSizes()).toEqual([0, 0, 0, 0]);
    });

    test('late published reads extend the index without pruning already-filed paths', () => {
        const store = new ReadStore();
        const value = computed(read => read(store).items.r1);
        const id = value.subscribe(() => {});
        try {
            const reads = installed(store);
            expect([...reads]).toEqual(['items.r1.~p']);
            const result = value.get();
            const baseline = store.getVersion();
            expect(result.title).toBe('t1');
            expect(installed(store)).toBe(reads);
            expect(reads.has('items.r1.title')).toBe(true);
            store.change(d => { d.items.r2.title = 'sibling'; });
            expect(store[CARBURETOR_HAS_DRIFT](baseline, reads)).toBe(false);
            store.change(d => { d.items.r1.title = 'late'; });
            expect(store[CARBURETOR_HAS_DRIFT](baseline, reads)).toBe(true);
            expect(value.get().title).toBe('late');
        } finally { value.unsubscribe(id); }
        expect(store.indexSizes()).toEqual([0, 0, 0, 0]);
    });
});
