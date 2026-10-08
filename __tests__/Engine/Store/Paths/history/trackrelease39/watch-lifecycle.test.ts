import {makeStore, pathsSince, spyPaths, thousandWrites} from './support';

const tracked = (store: ReturnType<typeof makeStore>): boolean => {
    const baseline = store.getVersion();
    store.change(d => { d.rows[0].a = baseline + 1000; });
    return pathsSince(store, baseline) !== undefined;
};

describe('watch owns tracking for its lifetime (R39-04 release)', () => {
    test('the disposer releases; a second disposer call is harmless', () => {
        const store = makeStore();
        const stop = store.watch(d => d.rows, () => undefined);
        expect(tracked(store)).toBe(true);
        stop();
        stop();
        expect(tracked(store)).toBe(false);
    });

    test('two watches: stopping one keeps the other patching and tracked', () => {
        const store = makeStore();
        const seen: unknown[] = [];
        const first = store.watch(d => d.rows, () => undefined);
        const second = store.watch(d => d.rows, next => { seen.push(JSON.parse(JSON.stringify(next))); });
        const answers = spyPaths(store);
        first();
        first();
        expect(tracked(store)).toBe(true);
        expect(seen.length).toBe(1);
        expect(answers.some(answer => answer !== undefined)).toBe(true);
        second();
        expect(tracked(store)).toBe(false);
    });

    test('a stopped watch never re-enables tracking, even if its callback was already selected', () => {
        const store = makeStore();
        let stop = (): void => undefined;
        stop = store.watch(d => d.rows, () => { stop(); });
        store.change(d => { d.rows[0].a = 1; });
        store.change(d => { d.rows[0].a = 2; });
        expect(tracked(store)).toBe(false);
    });

test('a watch whose selection turns primitive stops owning tracking until it is an object again', () => {
        const store = makeStore();
        const stop = store.watch(d => (d.tick === 0 ? d.rows : d.tick), () => undefined);
        expect(tracked(store)).toBe(true);
        store.change(d => { d.tick = 1; });
        expect(tracked(store)).toBe(false);
        store.change(d => { d.tick = 0; });
        expect(tracked(store)).toBe(true);
        stop();
        expect(tracked(store)).toBe(false);
    });

    test('a primitive watch never owns tracking', () => {
        const store = makeStore();
        const stop = store.watch(d => d.tick, () => undefined);
        expect(tracked(store)).toBe(false);
        stop();
    });

    test('watch / stop cycles do not accumulate owners', () => {
        const store = makeStore();
        for (let i = 0; i < 20; i++) store.watch(d => d.rows, () => undefined)();
        expect(tracked(store)).toBe(false);
        const counts = thousandWrites(store, true);
        expect(counts.maps).toBeLessThanOrEqual(3);
        expect(counts.sets).toBeLessThanOrEqual(2000);
    });
});
