import {Carburetor, computed, IComputed} from '@/Carburetor';
import {C} from '@/Carburetor/Derived/Models';
import {ILeafVersion} from '@/Carburetor/Derived/Freshness/Models';
import {IDict} from '@/Carburetor/Models/Base';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

const token = (value: IComputed<unknown>): number =>
    (value as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();
type Seam = {[C.recompute]: (wasUnobserved?: boolean) => void; [C.versions]: IDict<ILeafVersion>};

describe('R44-C02 baseline eligibility boundary', () => {
    test.each([1, 8, 32])('M=%s observed changed/equal and native-downstream routes', M => {
        for (const equal of [false, true]) for (const downstream of [false, true]) {
            const stores = Array.from({length: M}, () => new Carburetor({n: 1}));
            let phase: {snapshot: IDict<ILeafVersion>; entered: boolean} | undefined;
            let bodies = 0;
            const value = computed(read => {
                if (phase) phase.entered = true;
                bodies++;
                const sum = stores.reduce((n, store) => n + read(store).n, 0);
                return equal ? 1 : sum;
            });
            const consumer = downstream ? computed(read => read(value)) : value;
            const seam = value as unknown as Seam;
            const original = seam[C.recompute];
            seam[C.recompute] = function(wasUnobserved?: boolean): void {
                const previous = phase;
                phase = {snapshot: this[C.versions], entered: false};
                try { original.call(this, wasUnobserved); }
                finally { phase = previous; }
            };
            const keys = Object.keys;
            const count = (body: () => void) => {
                let calls = 0, entries = 0;
                Object.keys = object => {
                    const result = keys(object);
                    if (phase && !phase.entered && object === phase.snapshot) { calls++; entries += result.length; }
                    return result;
                };
                try { body(); return {calls, entries}; }
                finally { Object.keys = keys; }
            };
            const seen: number[] = [];
            let id: string | undefined;
            try {
                expect(count(() => { id = consumer.subscribe(() => seen.push(consumer.get())); }))
                    .toEqual({calls: 1, entries: 0});
                const zero = {calls: 0, entries: 0};
                expect(count(() => {})).toEqual(zero);
                expect(count(() => { for (let i = 0; i < 16; i++) consumer.get(); })).toEqual(zero);
                expect(count(() => {
                    phase = {snapshot: seam[C.versions], entered: false};
                    try { Object.keys(phase.snapshot); } finally { phase = undefined; }
                })).toEqual({calls: 1, entries: M});
                const before = bodies;
                expect(count(() => { stores[0].update(draft => { draft.n++; }); consumer.get(); })).toEqual(zero);
                expect(bodies).toBe(before + 1);
                expect(consumer.get()).toBe(equal ? 1 : M + 1);
                expect(seen).toEqual(equal ? [] : [M + 1]);
                expect(value.getVersion()).toBe(equal ? 0 : 1);
                expect(consumer.getVersion()).toBe(equal ? 0 : 1);
                consumer.unsubscribe(id!); id = undefined;
                const released = token(value);
                expect(count(() => { stores[0].update(draft => { draft.n++; }); value.get(); }))
                    .toEqual({calls: 1, entries: M});
                expect(value.get()).toBe(equal ? 1 : M + 2);
                expect(token(value)).toBe(released + (equal ? 0 : 1));
                expect(count(() => { stores[0].update(draft => { draft.n++; }); value.get(); })).toEqual(zero);
                expect(value.get()).toBe(equal ? 1 : M + 3);
                expect(token(value)).toBe(released + (equal ? 0 : 2));
            } finally {
                if (id !== undefined) consumer.unsubscribe(id);
                Reflect.deleteProperty(seam, C.recompute);
            }
        }
    });
});
