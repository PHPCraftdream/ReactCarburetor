import {Carburetor, computed} from '@/Carburetor';
// Reuse the baseline Computed fixture without moving baseline files.
// oxlint-disable-next-line carburetor-internal/no-parent-import
import {ExternalComputed} from '../Computed/fixtures';

class Store extends Carburetor<{left: number; right: number}> {
    public put(right: number): void { this.update(draft => { draft.right = right; }); }
    public putLeft(left: number): void { this.update(draft => { draft.left = left; }); }
}
class Flag extends Carburetor<{right: boolean; tick: number}> {
    public flip(): void { this.update(draft => { draft.right = !draft.right; }); }
    public tick(): void { this.update(draft => { draft.tick++; }); }
}

describe('R41-03 dependency bookkeeping', () => {
    test.each([1, 8, 64])('D=%s changes read sets without retained-edge churn', D => {
        const flag = new Flag({right: false, tick: 0});
        const sources = Array.from({length: D}, () => new Store({left: 1, right: 2}));
        let attachments = 0;
        for (const source of sources) {
            const original = source.subscribe.bind(source);
            source.subscribe = (callback, options) => { attachments++; return original(callback, options); };
        }
        const value = computed(read => {
            const control = read(flag);
            void control.tick;
            return sources.reduce((sum, source) => sum + (control.right ? read(source).right : read(source).left), 0);
        });
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        expect(value.get()).toEqual(D);
        flag.flip();
        expect(value.get()).toEqual(2 * D);
        expect(events).toEqual([2 * D]);
        expect(attachments).toEqual(2 * D);
        flag.tick();
        expect(attachments).toEqual(2 * D);
        expect(events).toEqual([2 * D]);
        value.unsubscribe(id);
    });

    test('ordered setup rolls back partial failure in reverse, then retries', () => {
        const a = new ExternalComputed(1, 'a');
        const b = new ExternalComputed(2, 'b');
        const log: string[] = [];
        for (const source of [a, b]) {
            const subscribe = source.subscribe;
            const unsubscribe = source.unsubscribe;
            source.subscribe = (callback, options) => {
                log.push('+' + source.getUID());
                return subscribe(callback, options);
            };
            source.unsubscribe = id => { log.push('-' + source.getUID()); unsubscribe(id); };
        }
        b.failSubscribe = true;
        const value = computed(read => read(a) + read(b));
        expect(() => value.subscribe(() => {})).toThrow('attachment failed');
        // The external bridge releases its own failed upstream id first. Outer rollback
        // sees no bridge for b, so it adds no second -b; a is released last.
        expect(log).toEqual(['+a', '+b', '-b', '-a']);
        expect(a.listeners.size + b.listeners.size).toEqual(0);
        b.failSubscribe = false;
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        b.set(3);
        expect(events).toEqual([4]);
        value.unsubscribe(id);
    });

    test('failed read-set replacement restores the published late-read route', () => {
        const flag = new Flag({right: false, tick: 0});
        const store = new Store({left: 1, right: 2});
        const failure = new ExternalComputed(1, 'failure');
        const value = computed(read => {
            const changed = read(flag).right;
            const view = read(store);
            void view.left;
            if (changed) { void view.right; read(failure); }
            return () => view.right;
        });
        const id = value.subscribe(() => {});
        const prior = value.get();
        failure.failSubscribe = true;
        const report = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            flag.flip();
            expect(() => value.get()).toThrow('attachment failed');
            expect(report.mock.calls).toEqual([[
                'Carburetor: a computation threw while a wave was drained: attachment failed. ' +
                'The remaining deferred computations were settled anyway.',
            ]]);
        } finally {
            report.mockRestore();
        }
        expect(failure.listeners.size).toEqual(0);
        expect(prior()).toEqual(2);
        failure.failSubscribe = false;
        expect(value.get()()).toEqual(2);
        let delivered = 0;
        value.subscribe(() => { delivered++; }, {id: 'observer'});
        store.put(3);
        expect(delivered).toEqual(1);
        expect(value.get()()).toEqual(3);
        value.unsubscribe(id);
        value.unsubscribe('observer');
    });

    test('same-id replacement ignores old-view late reads but extends the replacement precisely', () => {
        const flag = new Flag({right: false, tick: 0});
        const old = new Store({left: 1, right: 2});
        const next = new Store({left: 10, right: 20});
        old.getUID = () => 'same-source';
        next.getUID = () => 'same-source';
        const value = computed(read => {
            const useNext = read(flag).right;
            const view = read(useNext ? next : old);
            void view.left;
            return () => view.right;
        });
        let deliveries = 0;
        const id = value.subscribe(() => { deliveries++; });
        const oldView = value.get();
        expect(oldView()).toEqual(2);
        old.put(3);
        expect(value.get()()).toEqual(3);
        flag.flip();
        const before = deliveries;
        // An old source with a reused id must not file right against next's edge.
        void oldView();
        next.put(21);
        expect(deliveries).toEqual(before);
        expect(value.get()()).toEqual(21);
        old.put(4);
        expect(deliveries).toEqual(before);
        next.put(22);
        expect(deliveries).toEqual(before + 1);
        expect(value.get()()).toEqual(22);
        value.unsubscribe(id);
    });

    test('body failure restores old-source recorder after a same-id speculative read', () => {
        const flag = new Flag({right: false, tick: 0});
        const old = new Store({left: 1, right: 2});
        const next = new Store({left: 10, right: 20});
        old.getUID = next.getUID = () => 'reused';
        let fail = true;
        let bodyRuns = 0;
        const value = computed(read => {
            bodyRuns++;
            const changed = read(flag).right;
            const view = read(changed ? next : old);
            void view.left;
            if (changed && fail) throw new Error('body41');
            return () => view.right;
        });
        let deliveries = 0;
        const id = value.subscribe(() => { deliveries++; });
        const prior = value.get();
        const report = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            flag.flip();
            expect(() => value.get()).toThrow('body41');
            expect(report.mock.calls).toEqual([[
                'Carburetor: a computation threw while a wave was drained: body41. ' +
                'The remaining deferred computations were settled anyway.',
            ]]);
        } finally {
            report.mockRestore();
        }
        expect(prior()).toEqual(2);
        // Return to the published source, then extend through the retained old-id view.
        flag.flip();
        expect(prior()).toEqual(2);
        const before = bodyRuns;
        const beforeDelivery = deliveries;
        next.put(21);
        expect(bodyRuns).toEqual(before);
        expect(deliveries).toEqual(beforeDelivery);
        old.put(3);
        expect(bodyRuns).toEqual(before + 1);
        expect(deliveries).toEqual(beforeDelivery + 1);
        expect(value.get()()).toEqual(3);
        expect(prior()).toEqual(3);
        fail = false;
        flag.flip();
        expect(value.get()()).toEqual(21);
        value.unsubscribe(id);
    });

    test.each([false, true])('scalar retained views cannot trigger hidden evaluations, reused id=%s', reuseId => {
        const flag = new Flag({right: false, tick: 0});
        const old = new Store({left: 1, right: 2});
        const next = new Store({left: 10, right: 20});
        if (reuseId) old.getUID = next.getUID = () => 'scalar-retired41';
        let retained: {readonly left: number; readonly right: number} | undefined;
        let bodyRuns = 0;
        const value = computed(read => {
            bodyRuns++;
            const changed = read(flag).right;
            const view = read(changed ? next : old);
            if (!changed) retained = view;
            return view.left;
        });
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        expect(value.get()).toEqual(1);
        flag.flip();
        expect(value.get()).toEqual(10);
        expect(events).toEqual([10]);
        const before = bodyRuns;
        expect(retained!.right).toEqual(2);
        old.put(3);
        expect(bodyRuns).toEqual(before);
        next.put(21);
        // Equality of scalar left would hide a wrongly filed right dependency without this counter.
        expect(bodyRuns).toEqual(before);
        expect(events).toEqual([10]);
        expect(value.get()).toEqual(10);
        expect(bodyRuns).toEqual(before);
        next.putLeft(11);
        expect(bodyRuns).toEqual(before + 1);
        expect(value.get()).toEqual(11);
        expect(events).toEqual([10, 11]);
        expect(retained!.left).toEqual(1);
        value.unsubscribe(id);
    });

    test.each([false, true])('retained views stay inert through repeated observed switches, reused id=%s', reuseId => {
        const flag = new Flag({right: false, tick: 0});
        const stores = [1, 10, 100].map(left => new Store({left, right: left + 1}));
        if (reuseId) for (const store of stores) store.getUID = () => 'repeated-source41';
        let index = 0;
        const value = computed(read => {
            void read(flag).tick;
            const view = read(stores[index]);
            void view.left;
            return () => view.right;
        });
        const events: number[] = [];
        const id = value.subscribe(() => { events.push(index); });
        const retained = [value.get()];
        for (index = 1; index < stores.length; index++) {
            flag.tick();
            retained.push(value.get());
        }
        index = 2;
        expect(events).toEqual([1, 2]);
        expect(retained[0]()).toEqual(2);
        expect(retained[1]()).toEqual(11);
        stores[2].put(102);
        expect(events).toEqual([1, 2]);
        expect(retained[2]()).toEqual(102);
        stores[2].put(103);
        expect(events).toEqual([1, 2, 2]);
        stores[0].put(3);
        stores[1].put(12);
        expect(events).toEqual([1, 2, 2]);
        expect(value.get()()).toEqual(103);
        value.unsubscribe(id);
    });
});
