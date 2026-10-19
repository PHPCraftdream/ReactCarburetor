import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {Carburetor, computed, transaction} from '@/Carburetor';
import {ComponentUpdateThrottle} from '@/Carburetor/Store/Scheduling/ComponentUpdateThrottle';
import {TPath} from '@/Carburetor/Models/Paths';
import {IUpdateScheduler} from '@/Carburetor/Models/Store';

type State = {
    items: number[];
    noise: number;
    flag?: boolean;
    a?: number;
    b?: number;
    tree?: {nested: {value: number; extra: number}};
};

class CountingStore extends Carburetor<State> {
    public driftProbes = 0;

    /**
     * @param state - Initial store state.
     * @param scheduler - Optional update scheduler.
     */
    constructor(state: State, scheduler?: IUpdateScheduler) {
        super(state, scheduler ? {scheduler} : undefined);
        const original = this[CARBURETOR_HAS_DRIFT];
        this[CARBURETOR_HAS_DRIFT] = ((baseline: number, reads: ReadonlySet<TPath>): boolean => {
            this.driftProbes++;
            return original?.call(this, baseline, reads) ?? true;
        });
    }

    public mutate = (fn: (draft: State) => void): void => this.update(fn);
    public writeNoise = (): void => this.mutate(draft => { draft.noise++; });
    public writeItem = (): void => this.mutate(draft => { draft.items[0]++; });
}

/** Creates a computed value that sums a fan-in of store-backed leaves.
 *
 * @param store - Store whose items provide the leaf values.
 * @param count - Number of item leaves to include.
 * @param onCompute - Optional callback invoked when the computed value runs.
 */
const makeFanIn = (
    store: CountingStore, count: number, onCompute?: () => void
): ReturnType<typeof computed<number>> => {
    const leaves = Array.from({length: count}, (_, index) => computed(read => read(store).items[index] ?? 0));
    return computed(read => {
        onCompute?.();
        return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
    });
};

class ControlledThrottle extends ComponentUpdateThrottle {
    public flush = (): void => this.letsUpdate();
}

describe('leaf watermark freshness', () => {
    test('same-store leaf growth invalidates probes; foreign writes do not', () => {
        const count = 100;
        const store = new CountingStore({items: Array.from({length: count}, (_, index) => index), noise: 0});
        const foreign = new CountingStore({items: [0], noise: 0});
        const computeCount = {value: 0};
        const value = makeFanIn(store, count, () => { computeCount.value++; });
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(4950);
        store.driftProbes = 0;
        store.writeNoise();
        expect(value.get()).toBe(4950);
        expect(store.driftProbes).toBe(100);
        store.driftProbes = 0;
        for (let index = 0; index < 10; index++) {
            foreign.writeNoise();
            expect(value.get()).toBe(4950);
        }
        expect(store.driftProbes).toBe(0);
        store.driftProbes = 0;
        store.writeNoise();
        expect(value.get()).toBe(4950);
        expect(store.driftProbes).toBe(100);
        store.driftProbes = 0;
        store.writeItem();
        expect(value.get()).toBe(4951);
        expect(computeCount.value).toBe(2);
        value.unsubscribe(id);
    });

    test('foreign write before same-store watermark control performs no leaf probes', () => {
        const count = 100;
        const store = new CountingStore({items: Array.from({length: count}, (_, index) => index), noise: 0});
        const foreign = new CountingStore({items: [0], noise: 0});
        const value = makeFanIn(store, count);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(4950);
        store.driftProbes = 0;
        foreign.writeNoise();
        expect(value.get()).toBe(4950);
        expect(store.driftProbes).toBe(0);
        value.unsubscribe(id);
    });

    test('late read growth invalidates an established watermark', () => {
        const store = new CountingStore({items: [1, 2], noise: 0});
        const foreign = new CountingStore({items: [0], noise: 0});
        const value = computed(read => read(store).items);
        const id = value.subscribe(() => undefined);
        const liveItems = value.get();
        expect(liveItems[0]).toBe(1);
        store.writeNoise();
        expect(value.get()[0]).toBe(1);
        store.driftProbes = 0;
        expect(liveItems[1]).toBe(2);
        foreign.writeNoise();
        expect(value.get()[0]).toBe(1);
        expect(store.driftProbes).toBeGreaterThan(0);
        value.unsubscribe(id);
    });
});

describe('watermark correctness guards', () => {
    test('early subscriber reentrant read sees fresh outer computed', () => {
        const store = new CountingStore({items: [0], noise: 0});
        const outer = computed(read => read(store).items[0]);
        store.subscribe(() => { expect(outer.get()).toBe(1); });
        const id = outer.subscribe(() => undefined);
        expect(outer.get()).toBe(0);
        store.writeItem();
        expect(outer.get()).toBe(1);
        outer.unsubscribe(id);
    });

    test('early source pull can suppress dynamic downstream delivery', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        let deliveries = 0;
        store.subscribe(() => { inner.get(); });
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(10);
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('independent observers each receive one early-pull scenario delivery', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        let first = 0;
        let second = 0;
        store.subscribe(() => { inner.get(); });
        const firstId = outer.subscribe(() => { first++; });
        const secondId = outer.subscribe(() => { second++; });
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(first).toBe(1);
        expect(second).toBe(1);
        outer.unsubscribe(firstId);
        outer.unsubscribe(secondId);
    });

    test('three computed levels exercise an early dynamic source pull', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const middle = computed(read => read(inner) + 1);
        const outer = computed(read => read(middle) * 10);
        let deliveries = 0;
        store.subscribe(() => { inner.get(); });
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(30);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(20);
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('source pull reads the computed dependency twice in one callback', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        let deliveries = 0;
        store.subscribe(() => { inner.get(); inner.get(); });
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(10);
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('subscribed source observer without a get preserves dynamic delivery', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        let deliveries = 0;
        store.subscribe(() => undefined);
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(10);
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('ordinary dynamic update delivers without an early source pull', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        let deliveries = 0;
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(10);
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('early pull replaces a throttled dynamic list callback before flush', () => {
        const throttle = new ControlledThrottle(10000);
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2}, throttle);
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => [read(inner), read(inner) * 10]);
        let deliveries = 0;
        store.subscribe(() => { inner.get(); });
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toEqual([2, 20]);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toEqual([1, 10]);
        expect(deliveries).toBe(0);
        throttle.flush();
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('early store subscriber pull keeps dynamic outer fresh', () => {
        const store = new CountingStore({items: [0], noise: 0, flag: false, a: 1, b: 2});
        const inner = computed(read => read(store).flag ? read(store).a : read(store).b);
        const outer = computed(read => read(inner) * 10);
        store.subscribe(() => { inner.get(); });
        const id = outer.subscribe(() => undefined);
        expect(outer.get()).toBe(20);
        store.mutate(draft => { draft.flag = true; });
        expect(outer.get()).toBe(10);
        outer.unsubscribe(id);
    });

    test('throttled delivery callback waits for flush', () => {
        const throttle = new ControlledThrottle(10000);
        const store = new CountingStore({items: [1], noise: 0}, throttle);
        const outer = computed(read => read(store).items[0]);
        let deliveries = 0;
        const id = outer.subscribe(() => { deliveries++; });
        expect(outer.get()).toBe(1);
        store.writeItem();
        expect(outer.get()).toBe(2);
        expect(deliveries).toBe(0);
        throttle.flush();
        expect(deliveries).toBe(1);
        outer.unsubscribe(id);
    });

    test('observer transitions preserve fresh reads across subscribe cycles', () => {
        const store = new CountingStore({items: [1], noise: 0});
        const outer = computed(read => read(store).items[0]);
        expect(outer.get()).toBe(1);
        store.writeItem();
        const first = outer.subscribe(() => undefined);
        expect(outer.get()).toBe(2);
        outer.unsubscribe(first);
        store.writeItem();
        const second = outer.subscribe(() => undefined);
        expect(outer.get()).toBe(3);
        outer.unsubscribe(second);
    });

    test('transaction writes are fresh inside the transaction body', () => {
        const store = new CountingStore({items: [1], noise: 0});
        const outer = computed(read => read(store).items[0]);
        const id = outer.subscribe(() => undefined);
        expect(outer.get()).toBe(1);
        transaction(() => {
            store.writeItem();
            expect(outer.get()).toBe(2);
        });
        expect(outer.get()).toBe(2);
        outer.unsubscribe(id);
    });

    test('equal cloned data replacement keeps the computed value correct', () => {
        const store = new CountingStore({items: [0], noise: 0, tree: {nested: {value: 3, extra: 4}}});
        const view = computed(read => read(store).tree);
        const id = view.subscribe(() => undefined);
        const live = view.get();
        expect(live?.nested.value).toBe(3);
        store.setData({items: [0], noise: 0, tree: {nested: {value: 3, extra: 4}}});
        const current = view.get();
        expect(current?.nested.value).toBe(3);
        expect(view.get()?.nested.value).toBe(3);
        view.unsubscribe(id);
    });
});
