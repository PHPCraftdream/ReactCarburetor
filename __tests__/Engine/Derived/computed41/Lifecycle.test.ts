import {computed} from '@/Carburetor';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';
// Reuse the baseline Computed fixture without moving baseline files.
// oxlint-disable-next-line carburetor-internal/no-parent-import
import {CounterCarburetor, ExternalComputed} from '../Computed/fixtures';

describe('R41-02 observer lifetime', () => {
    test('queued old settlement cannot notify a new registration', () => {
        const store = new CounterCarburetor({n: 1});
        const value = computed(read => read(store).n);
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        updateWave.begin();
        try {
            store.setN(2);
            value.unsubscribe(id);
            expect(value.get()).toEqual(2);
            value.subscribe(() => events.push(value.get()), {id});
        } finally {
            updateWave.end();
        }
        expect(events).toEqual([]);
        store.setN(3);
        expect(events).toEqual([3]);
        value.unsubscribe(id);
        store.setN(4);
        expect(value.get()).toEqual(4);
        expect(events).toEqual([3]);
    });

    test('last leaver inside delivery may resubscribe without obsolete publication', () => {
        const store = new CounterCarburetor({n: 1});
        const value = computed(read => read(store).n);
        const events: number[] = [];
        value.subscribe(() => {
            events.push(value.get());
            value.unsubscribe('same');
            value.subscribe(() => events.push(value.get() * 10), {id: 'same'});
        }, {id: 'same'});
        store.setN(2);
        expect(events).toEqual([2]);
        store.setN(3);
        expect(events).toEqual([2, 30]);
        value.unsubscribe('same');
    });

    test('failed first subscribe and failed resubscribe release edges and retry with current value', () => {
        const source = new ExternalComputed(1);
        const value = computed(read => read(source));
        source.failSubscribe = true;
        expect(() => value.subscribe(() => {})).toThrow('attachment failed');
        expect(source.listeners.size).toEqual(0);
        source.failSubscribe = false;
        const first = value.subscribe(() => {});
        value.unsubscribe(first);
        source.set(2);
        expect(value.get()).toEqual(2);
        source.failSubscribe = true;
        expect(() => value.subscribe(() => {})).toThrow('attachment failed');
        expect(source.listeners.size).toEqual(0);
        source.failSubscribe = false;
        const events: number[] = [];
        const id = value.subscribe(() => events.push(value.get()));
        source.set(3);
        expect(events).toEqual([3]);
        value.unsubscribe(id);
    });

    test('external teardown can resubscribe reentrantly with a new baseline', () => {
        const source = new ExternalComputed(1);
        const value = computed(read => read(source));
        const unsubscribe = source.unsubscribe;
        let rejoin = true;
        const events: number[] = [];
        source.unsubscribe = id => {
            unsubscribe(id);
            if (rejoin) {
                rejoin = false;
                value.subscribe(() => events.push(value.get()), {id: 'new'});
            }
        };
        const id = value.subscribe(() => {});
        value.unsubscribe(id);
        source.set(2);
        expect(events).toEqual([2]);
        value.unsubscribe('new');
        source.set(3);
        expect(value.get()).toEqual(3);
        expect(events).toEqual([2]);
    });

    test('released cached view rejoins its recorder and late reads extend the live edge', () => {
        const store = new CounterCarburetor({n: 1});
        const value = computed(read => {
            const view = read(store);
            return () => view.n;
        });
        const first = value.subscribe(() => {});
        const old = value.get();
        expect(old()).toEqual(1);
        value.unsubscribe(first);
        let deliveries = 0;
        const id = value.subscribe(() => { deliveries++; });
        expect(old()).toEqual(1);
        store.setN(2);
        expect(value.get()()).toEqual(2);
        expect(deliveries).toEqual(1);
        value.unsubscribe(id);
    });
});
