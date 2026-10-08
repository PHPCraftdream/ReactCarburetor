import {acquire, makeStore, pathsSince, thousandWrites} from './support';

describe('writes after the last selection consumer left (R39-04 release)', () => {
    test.each([false, true])('a released watch leaves a store at most three Maps and 2000 Sets per 1000 writes, nested=%s',
        nested => {
            const store = makeStore();
            const stop = store.watch(d => d.rows, () => undefined);
            const baseline = store.getVersion();
            store.change(d => { d.rows[0].a = 1; });
            // While the consumer lives, proofs are retained and the fast path can enumerate writes.
            expect(pathsSince(store, baseline)).toEqual(['rows.0.a']);
            stop();
            store.change(d => { d.rows[0].a = 2; });

            const counts = thousandWrites(store, nested);
            console.info('R39-04 released watch, constructors per 1000 writes:', counts);
            expect(counts.sets).toBeGreaterThanOrEqual(1000);
            expect(counts.maps).toBeLessThanOrEqual(3);
            expect(counts.sets).toBeLessThanOrEqual(2000);
            const after = store.getVersion();
            store.change(d => { d.rows[0].a = 3; });
            expect(pathsSince(store, after)).toBeUndefined();
        });

    test.each([false, true])('a released protocol owner behaves like a store that never had one, nested=%s', nested => {
        const never = makeStore();
        const released = makeStore();
        const release = acquire(released);
        released.change(d => { d.rows[0].a = 1; });
        release();
        released.change(d => { d.rows[0].a = 1; });
        never.change(d => { d.rows[0].a = 1; });
        never.change(d => { d.rows[0].a = 1; });

        const reference = thousandWrites(never, nested);
        const counts = thousandWrites(released, nested);
        expect(counts.maps).toBeLessThanOrEqual(3);
        expect(counts.sets).toBeLessThanOrEqual(2000);
        expect(counts.maps).toBeLessThanOrEqual(reference.maps);
        expect(counts.sets).toBeLessThanOrEqual(reference.sets);
    });

    test('while a consumer lives the store records proofs for each write', () => {
        const store = makeStore();
        const release = acquire(store);
        const baseline = store.getVersion();
        for (let n = 1; n <= 50; n++) store.change(d => { d.rows[0].a = n; });
        expect(pathsSince(store, baseline)).toEqual(['rows.0.a']);
        release();
    });
});
