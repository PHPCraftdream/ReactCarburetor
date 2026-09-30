/** Exercises supported alias subscriptions and reversible array descriptors in an installed build.
 *
 * @param assert - the consumer's strict assertion module
 * @param producer - the store build
 * @param recorder - the history/computed build
 * @param label - the mixed-module direction
 */
export const checkEngineBoundaries = async (assert, producer, recorder, label) => {
    const completed = [];
    const selectors = [
        ['map-value', view => view.map.get('row').n],
        ['set-member', view => view.set.values().next().value.n],
        ['map-key', view => view.keys.keys().next().value.n],
        ['native-own', view => view.map.member.n],
        ['root-link', view => view.map.get('root').row.n],
    ];
    for (const [kind, select] of selectors) {
        const row = {n: 1};
        const state = {row, other: 0, map: new Map([['row', row]]),
            set: new Set([row]), keys: new Map([[row, 'value']])};
        if (kind === 'root-link') state.map.set('root', state);
        Object.defineProperty(state.map, 'member', {value: row, configurable: true});
        const store = new producer.Carburetor(state);
        const events = [];
        const stop = store.watch(select, value => events.push(value));
        const derived = new recorder.Computed(get => select(get(store)));
        let wakes = 0;
        const id = derived.subscribe(() => { wakes++; });
        assert.equal(derived.get(), 1);
        const paths = new Set();
        assert.equal(select(store.read(path => paths.add(path))), 1);
        store.update(draft => { draft.other = 1; });
        assert.deepStrictEqual(events, []);
        assert.equal(wakes, 0);
        const version = store.getVersion();
        store.update(draft => { draft.row.n = 2; });
        assert.equal(store.getData().map.get('row'), store.getData().row);
        assert.deepStrictEqual(events, [2], label + ': ' + kind + ' alias notification');
        assert.equal(derived.get(), 2);
        assert.equal(wakes, 1);
        assert.equal(store.hasDriftSince(version, paths), true);
        stop();
        derived.unsubscribe(id);
        completed.push(label + ':alias-' + kind);
    }
    for (const nested of [false, true]) {
        for (const truncate of [false, true]) {
            const initial = [];
            initial[0] = 1;
            initial[2] = 3;
            const store = new producer.Carburetor(nested ? {items: initial} : initial);
            const history = new recorder.CarburetorHistory(store);
            const version = store.getVersion();
            store.update(draft => {
                const array = nested ? draft.items : draft;
                Object.defineProperty(array, 'length', truncate
                    ? {value: 1, writable: false} : {writable: false});
            });
            const array = () => nested ? store.getData().items : store.getData();
            assert.equal(store.getVersion(), version + 1);
            assert.equal(Object.getOwnPropertyDescriptor(array(), 'length').writable, false);
            assert.equal(history.undo(), true);
            assert.equal(array().length, 3);
            assert.equal(Object.hasOwn(array(), 1), false);
            assert.equal(array()[0], 1);
            assert.equal(array()[2], 3);
            assert.equal(Object.getOwnPropertyDescriptor(array(), 'length').writable, true);
            assert.equal(history.redo(), true);
            assert.equal(array().length, truncate ? 1 : 3);
            assert.equal(Object.getOwnPropertyDescriptor(array(), 'length').writable, false);
            history.disconnect();
            completed.push(label + ':length-' + (nested ? 'nested-' : 'root-') +
                (truncate ? 'truncate' : 'flag-only'));
        }
    }
    {
        const store = new producer.Carburetor([1, 2]);
        const history = new recorder.CarburetorHistory(store);
        class Reader extends recorder.AntiHookComponent {
            /** Keeps the array facade stable across descriptor transitions. */
            view = this.connect(store);
            /** This descriptor probe needs no rendered markup. */
            render() { return null; }
        }
        const reader = new Reader({});
        const check = length => {
            assert.equal(reader.view.length, length);
            assert.equal(Object.getOwnPropertyDescriptor(reader.view, 'length').value, length);
        };
        check(2);
        store.update(draft => {
            Object.defineProperty(draft, 'length', {value: 1, writable: false});
        });
        check(1);
        assert.equal(history.undo(), true);
        check(2);
        assert.equal(history.redo(), true);
        check(1);
        store.setData([4, 5, 6]);
        check(3);
        history.disconnect();
        completed.push(label + ':connected-length-descriptor');
    }
    {
        let calls = 0;
        const cache = new producer.ResourceCache(async () => { calls++; return 'ready'; });
        const id = cache.subscribe(() => {
            if (cache.getEntry('k').status === 'pending') cache.abort('k');
        });
        try {
            await assert.rejects(cache.load('k'), error => error.name === 'AbortError');
            assert.equal(calls, 0);
            assert.equal(cache.getEntry('k').status, 'idle');
        } finally {
            cache.unsubscribe(id);
        }
        await cache.load('k');
        assert.equal(calls, 1);
        assert.equal(cache.getEntry('k').data, 'ready');
        completed.push(label + ':cache-preloader-cancel');
    }
    return completed;
};
