import {acquire, internals, makeStore, pathsSince, spyPaths, targetsSince} from './support';

/** Whether a write made now is enumerable from the version just before it. */
const tracked = (store: ReturnType<typeof makeStore>): boolean => {
    const baseline = store.getVersion();
    store.change(d => { d.rows[0].a = baseline + 1000; });
    return pathsSince(store, baseline) !== undefined;
};

describe('protocol owners are counted (R39-04 release)', () => {
    test('one owner enables tracking and its release disables it', () => {
        const store = makeStore();
        expect(tracked(store)).toBe(false);
        const release = acquire(store);
        expect(tracked(store)).toBe(true);
        release();
        expect(tracked(store)).toBe(false);
        expect(internals(store).writeLog.trackedSince).toBe(Infinity);
        expect(internals(store).writeTargets.enabled).toBe(false);
    });

    test('releasing one of two owners keeps tracking; the last release disables it', () => {
        const store = makeStore();
        const first = acquire(store);
        const second = acquire(store);
        first();
        expect(tracked(store)).toBe(true);
        expect(targetsSince(store, store.getVersion() - 1)?.has('rows.0.a')).toBe(true);
        second();
        expect(tracked(store)).toBe(false);
    });

    test('release order is irrelevant across three owners', () => {
        const store = makeStore();
        const owners = [acquire(store), acquire(store), acquire(store)];
        owners[1]();
        expect(tracked(store)).toBe(true);
        owners[0]();
        expect(tracked(store)).toBe(true);
        owners[2]();
        expect(tracked(store)).toBe(false);
    });

    test('a double release is a no-op: it neither drops a live owner nor corrupts the count', () => {
        const store = makeStore();
        const first = acquire(store);
        const second = acquire(store);
        first();
        first();
        first();
        expect(tracked(store)).toBe(true);
        second();
        second();
        expect(tracked(store)).toBe(false);
        const third = acquire(store);
        expect(tracked(store)).toBe(true);
        third();
        expect(tracked(store)).toBe(false);
    });

    test('a later owner re-tracks from the current version: older baselines are unanswerable', () => {
        const store = makeStore();
        const first = acquire(store);
        const old = store.getVersion();
        store.change(d => { d.rows[0].a = 1; });
        expect(pathsSince(store, old)).toEqual(['rows.0.a']);
        first();
        store.change(d => { d.rows[0].a = 2; });
        store.change(d => { d.rows[0].a = 3; });

        const second = acquire(store);
        const fresh = store.getVersion();
        expect(internals(store).writeLog.trackedSince).toBe(fresh);
        store.change(d => { d.other.b = 1; });
        expect(pathsSince(store, old)).toBeUndefined();
        expect(targetsSince(store, old)).toBeUndefined();
        expect(pathsSince(store, fresh)).toEqual(['other.b']);
        expect(targetsSince(store, fresh)?.has('other.b')).toBe(true);
        second();
    });

    test('a watch created after full release patches again after exactly one conservative answer', () => {
        const store = makeStore();
        const stopFirst = store.watch(d => d.rows, () => undefined);
        stopFirst();
        const seen: unknown[] = [];
        const stop = store.watch(d => d.rows, next => { seen.push(JSON.parse(JSON.stringify(next))); });
        const answers = spyPaths(store);
        store.change(d => { d.rows[0].a = 1; });
        store.change(d => { d.rows[0].a = 2; });
        expect(seen).toEqual([[{a: 1}], [{a: 2}]]);
        expect(answers.length).toBe(2);
        expect(answers.every(answer => answer !== undefined)).toBe(true);
        stop();
    });

    test('a release inside an open transaction cannot let a partial proof pass for the publication', () => {
        const store = makeStore();
        const first = acquire(store);
        const baseline = store.getVersion();
        let second: (() => void) | undefined;
        store.change(d => {
            d.rows[0].a = 1;
            first();
            second = acquire(store);
            d.rows[0].a = 2;
        });
        // The path is still enumerable, but a proof that missed part of the publication is dropped.
        expect(pathsSince(store, store.getVersion() - 1)).toEqual(['rows.0.a']);
        expect(targetsSince(store, store.getVersion() - 1)).toBeUndefined();
        expect(baseline).toBeLessThan(store.getVersion());
        second?.();
    });
});
