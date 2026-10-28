import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {IDependency} from '@/Carburetor/Derived/Models';

describe('computed dependency publication gaps', () => {
    test('ownDependency refuses inherited ids', () => {
        const inherited = {source: {} as never, reads: new Set(), published: false, observed: false};
        const record = Object.assign(Object.create({hostile: inherited}), {safe: inherited});
        expect(computedDependencies.ownDependency(record, 'safe')).toBe(inherited);
        expect(computedDependencies.ownDependency(record, 'hostile')).toBeUndefined();
    });

    test('publication switches weak source slots and clears retired routes', () => {
        const first = {}, second = {};
        const firstSlot = {current: undefined as IDependency['previous'], key: ':first', recorder: undefined};
        const secondSlot = {current: undefined as IDependency['previous'], key: ':second', recorder: undefined};
        const slots = new WeakMap<object, typeof firstSlot>();
        slots.set(first, firstSlot);
        slots.set(second, secondSlot);
        const active = new Map([[':first', firstSlot]]);
        const dependencies = {':second': {
            source: second, reads: new Set(), published: false, observed: false,
            previous: undefined, overlap: 0,
        } as IDependency};
        computedDependencies.publishActiveReads(dependencies, active, slots);
        expect(active.get(':second')).toBe(secondSlot);
        expect(active.has(':first')).toBe(false);
        expect(firstSlot.current).toBeUndefined();
        expect(secondSlot.current).toBe(dependencies[':second']);
    });

    test('publication deletes an active route when its source has no weak slot', () => {
        const source = {};
        const stale = {current: undefined as IDependency['previous'], key: ':source', recorder: undefined};
        const active = new Map([[':source', stale]]);
        const dependency = {
            source, reads: new Set(), published: false, observed: false,
            previous: undefined, overlap: 0,
        } as IDependency;
        computedDependencies.publishActiveReads({':source': dependency}, active, new WeakMap());
        expect(active.has(':source')).toBe(false);
        expect(stale.current).toBeUndefined();
    });

    test('unsubscribing the final external dependent releases its upstream bridge', () => {
        let unsubscriptions = 0;
        const external = {
            subscribe: () => 'upstream',
            unsubscribe: () => { unsubscriptions++; },
        } as never;
        computedDependencies.subscribe(external, () => undefined, {id: 'dependent'});
        computedDependencies.unsubscribe(external, 'dependent');
        expect(unsubscriptions).toBe(1);
    });
});
