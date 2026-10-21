import {Carburetor} from '@/Carburetor/Store/Carburetor';
import {ComponentUpdateThrottle} from '@/Carburetor/Store/Scheduling/ComponentUpdateThrottle';
import {carburetorToken} from '@/Carburetor/Component/Scope/carburetorToken';
import {CarburetorScope} from '@/Carburetor/Component/Scope/CarburetorScope';
import {transaction} from '@/Carburetor/Store/Transaction/transaction';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';
import {flush, createTestScope} from '@/Testing';

class Counter extends Carburetor<{n: number}> {
    public increment(): void { this.draft.n++; this.emitUpdate(); }
    public writeOnly(): void { this.draft.n++; }
}

class Counted extends Counter {
    public disposed = 0;
    public dispose(): void { this.disposed++; super.dispose(); }
}

const delayScheduler = (): ComponentUpdateThrottle => new ComponentUpdateThrottle(40);

describe('Testing engine', () => {
    test('flush drains throttled updates without waiting for the timeout', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        store.setData({n: 1});
        flush(store);
        expect(calls).toBe(1);
        store.dispose();
    });

    test('flush disposed store and scope is a no-op', () => {
        const store = new Counter({n: 0}, delayScheduler());
        store.dispose();
        expect(() => flush(store)).not.toThrow();
        const scope = createTestScope();
        scope.dispose();
        expect(() => flush(scope)).not.toThrow();
    });

    test('flush retains subscribers and does not publish draft writes', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        store.increment();
        flush(store);
        expect(store.getData().n).toBe(1);
        expect(calls).toBe(1);
        store.dispose();
    });

    test('flush in a transaction does not prematurely close the batch', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        transaction(() => {
            store.setData({n: 1});
            flush(store);
            expect(calls).toBe(0);
        });
        expect(calls).toBe(0);
        flush(store);
        expect(calls).toBe(1);
        store.dispose();
    });

    test('scope owns replaced instances and flush drains scheduled children', () => {
        const root = createTestScope();
        const child = root.child([]);
        const token = carburetorToken(() => { throw new Error('factory invoked'); }, 'testing/owned');
        const old = new Counted({n: 0}, delayScheduler());
        const current = new Counted({n: 0}, delayScheduler());
        child.set(token, old);
        child.set(token, current);
        let calls = 0;
        old.subscribe(() => calls++);
        current.subscribe(() => calls++);
        old.setData({n: 1});
        current.setData({n: 1});
        flush(root);
        expect(calls).toBe(2);
        root.dispose();
        expect(old.disposed).toBe(1);
        expect(current.disposed).toBe(1);
    });

    test('flush crosses schedulers requeued on earlier stores', () => {
        const root = createTestScope();
        const child = root.child([]);
        const tokenA = carburetorToken(() => { throw new Error('factory invoked'); }, 'testing/A');
        const tokenB = carburetorToken(() => { throw new Error('factory invoked'); }, 'testing/B');
        const a = new Counter({n: 0}, delayScheduler());
        const b = new Counter({n: 0}, delayScheduler());
        root.set(tokenA, a);
        child.set(tokenB, b);
        const delivered: string[] = [];
        a.subscribe(() => delivered.push('A' + a.getData().n));
        b.subscribe(() => { delivered.push('B1'); a.setData({n: 2}); });
        a.setData({n: 1});
        b.setData({n: 1});
        flush(root);
        expect(delivered).toEqual(['A1', 'B1', 'A2']);
        flush(root);
        expect(delivered).toEqual(['A1', 'B1', 'A2']);
        root.dispose();
    });

    test('flush handles null and primitive overrides', () => {
        const nullToken = carburetorToken(() => null, 'testing/null-override');
        const numberToken = carburetorToken(() => 0, 'testing/number-override');
        const scope = createTestScope([[nullToken, null], [numberToken, 42]]);
        expect(() => flush(scope)).not.toThrow();
        scope.dispose();
    });

    test('flush waits for throttled delivery and repeated flush is stable', () => {
        const store = new Counter({n: 0}, delayScheduler());
        const delivered: number[] = [];
        store.watch(data => data.n, next => delivered.push(next));
        store.setData({n: 1});
        expect(delivered).toEqual([]);
        flush(store);
        expect(delivered).toEqual([1]);
        flush(store);
        expect(delivered).toEqual([1]);
        store.dispose();
    });

    test('disposing a queued store suppresses pending callbacks', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        store.setData({n: 1});
        store.dispose();
        flush(store);
        expect(calls).toBe(0);
    });

    test('draft-only write stays unpublished until an emitting write', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        store.writeOnly();
        const baseline = store.getVersion();
        flush(store);
        expect(store.getVersion()).toBe(baseline);
        expect(calls).toBe(0);
        store.increment();
        flush(store);
        expect(store.getData().n).toBe(2);
        expect(calls).toBe(1);
        store.dispose();
    });

    test('scope factory overrides and lazy instances are disposed idempotently', () => {
        let factories = 0;
        const token = carburetorToken(() => { factories++; return new Counted({n: 0}); }, 'testing/lazy');
        const countToken = carburetorToken(() => { factories++; return 0; }, 'testing/count');
        const override = new Counted({n: 2});
        const scope = createTestScope([[token, override], [countToken, 7]]);
        expect(scope.get(token)).toBe(override);
        expect(scope.get(countToken)).toBe(7);
        expect(factories).toBe(0);
        const lazyToken = carburetorToken(() => { factories++; return new Counted({n: 1}); }, 'testing/lazy2');
        const lazy = scope.get(lazyToken);
        expect(factories).toBe(1);
        scope[Symbol.dispose]();
        scope.dispose();
        expect(override.disposed).toBe(1);
        expect((lazy as Counted).disposed).toBe(1);
    });

    test('flush is guarded during an active update wave', () => {
        const store = new Counter({n: 0}, delayScheduler());
        let calls = 0;
        store.subscribe(() => calls++);
        store.setData({n: 1});
        updateWave.begin();
        try {
            flush(store);
            expect(calls).toBe(0);
        } finally {
            updateWave.end();
        }
        flush(store);
        expect(calls).toBe(1);
        store.dispose();
    });

    test('store target flush only drains its own scheduler', () => {
        const first = new Counter({n: 0}, delayScheduler());
        const second = new Counter({n: 0}, delayScheduler());
        const delivered: string[] = [];
        first.subscribe(() => {
            delivered.push('first');
            second.setData({n: 1});
        });
        second.subscribe(() => delivered.push('second'));
        first.setData({n: 1});
        flush(first);
        expect(delivered).toEqual(['first']);
        flush(second);
        expect(delivered).toEqual(['first', 'second']);
        first.dispose();
        second.dispose();
    });
});
