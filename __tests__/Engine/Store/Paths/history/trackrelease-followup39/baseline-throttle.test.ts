import {Carburetor, ComponentUpdateThrottle} from '@/Carburetor';
import {patchFromWriteLog} from '@/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {CARBURETOR_TRACK_TARGETS} from '@/Carburetor/Store/Utils/Models';

class Store extends Carburetor<{rows: Array<{n: number}>}> {
    public edit(n: number): void { this.update(d => { d.rows[0].n = n; }); }
}
class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

test('an older baseline costs exactly one full reconcile, then only two-path patches', () => {
    const store = new Store({rows: Array.from({length: 100}, () => ({n: 0}))});
    let reads = 0;
    const live = store.read(() => { reads++; }).rows;
    let ledger = new WeakMap<object, unknown>();
    let previous = reconcileSelection(undefined, live, undefined, undefined, undefined, ledger);
    const old = store.getVersion();
    const first = store[CARBURETOR_TRACK_TARGETS]();
    first();
    store.edit(1);
    const release = store[CARBURETOR_TRACK_TARGETS]();
    let baseline = old;
    let full = 0;
    const costs: number[] = [];
    for (const n of [2, 3, 4]) {
        store.edit(n);
        reads = 0;
        const patched = patchFromWriteLog(store, baseline, previous, live, ledger, undefined);
        if (patched === undefined) {
            full++;
            const nextLedger = new WeakMap<object, unknown>();
            previous = reconcileSelection(previous, live, undefined, undefined, ledger, nextLedger);
            ledger = nextLedger;
        } else previous = patched;
        costs.push(reads);
        expect((previous as Array<{n: number}>)[0].n).toBe(n);
        baseline = store.getVersion();
    }
    expect(full).toBe(1);
    expect(costs[0]).toBeGreaterThan(100);
    expect(costs.slice(1)).toEqual([2, 2]);
    release();
});

test('release/reacquire inside a throttle window cancels old delivery and keeps the new watch correct', () => {
    const throttle = new ManualThrottle();
    const store = new Store({rows: [{n: 0}]}, throttle);
    const old: number[] = [];
    const next: number[] = [];
    const stop = store.watch(d => d.rows, value => { old.push(value[0].n); });
    store.edit(1);
    stop();
    store.edit(2);
    const resume = store.watch(d => d.rows, value => { next.push(value[0].n); });
    store.edit(3);
    throttle.flush();
    expect(old).toEqual([]);
    expect(next).toEqual([3]);
    store.edit(4);
    throttle.flush();
    expect(next).toEqual([3, 4]);
    resume();
    store.edit(5);
    throttle.flush();
    expect(next).toEqual([3, 4]);
});
