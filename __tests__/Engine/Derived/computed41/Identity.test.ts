import {Computed, computed} from '@/Carburetor';
// Reuse the baseline Computed fixture without moving baseline files.
// oxlint-disable-next-line carburetor-internal/no-parent-import
import {CounterCarburetor, ExternalComputed} from '../Computed/fixtures';

/** Domain names intentionally duplicate engine roles to exercise the subclass contract. */
class Named extends Computed<number> {
    public uid = 'total';
    public version = 'domain';
    public value = 'domain';
    public valid = false;
    public versions = 'domain';
    public dependencies = 'domain';
    public announced = 'domain';
    public body = 'domain';
    public options = 'domain';
    public onDependencyChanged = () => { throw new Error('domain callback'); };
    public markStale = this.onDependencyChanged;
    public settle = this.onDependencyChanged;
    public recompute = this.onDependencyChanged;
    public deliver = this.onDependencyChanged;
}

describe('R41-01 Computed domain collisions', () => {
    test('native graph delivers 3 -> 4 despite shared domain ids and callback shadows', () => {
        const a = new CounterCarburetor({n: 1});
        const b = new CounterCarburetor({n: 2});
        const first = new Named(read => read(a).n);
        const second = new Named(read => read(b).n);
        const sum = computed(read => read(first) + read(second));
        const events: number[] = [];
        const id = sum.subscribe(() => events.push(sum.get()));
        expect(sum.get()).toEqual(3);
        b.setN(3);
        expect(sum.get()).toEqual(4);
        expect(events).toEqual([4]);
        expect(first.getUID()).not.toEqual(second.getUID());
        expect(second.version).toEqual('domain');
        expect(second.value).toEqual('domain');
        sum.unsubscribe(id);
    });

    test('external failed attachment rolls back and later subscribes successfully', () => {
        const external = new ExternalComputed(2);
        const source = new CounterCarburetor({n: 1});
        const value = new Named(read => read(source).n + read(external));
        external.failSubscribe = true;
        expect(() => value.subscribe(() => {}, {id: 'failed'})).toThrow('attachment failed');
        expect(external.listeners.size).toEqual(0);
        external.failSubscribe = false;
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        expect(value.get()).toEqual(3);
        external.set(3);
        expect(events).toEqual([4]);
        value.unsubscribe(id);
        expect(external.listeners.size).toEqual(0);
    });
});
