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
    {
        const store = new producer.Carburetor({item: {a: 1, b: 2}, other: 0});
        const history = new recorder.CarburetorHistory(store);
        const orders = [];
        const stop = store.watch(view => Object.keys(view.item), order => orders.push(order));
        let leafChanges = 0;
        const stopLeaf = store.watch(view => view.item.a, () => { leafChanges++; });
        store.setData({item: {b: 2, a: 1}, other: 0});
        assert.deepStrictEqual(orders, [['b', 'a']]);
        assert.equal(leafChanges, 0);
        assert.equal(history.undo(), true);
        assert.deepStrictEqual(Object.keys(store.getData().item), ['a', 'b']);
        assert.equal(history.redo(), true);
        assert.deepStrictEqual(Object.keys(store.getData().item), ['b', 'a']);
        const version = store.getVersion();
        store.setData({item: {b: 2, a: 1}, other: 0});
        assert.equal(store.getVersion(), version);
        stop();
        stopLeaf();
        history.disconnect();
        completed.push(label + ':key-order-replacement');
    }
    {
        const store = new producer.Carburetor({a: 1, b: 2});
        const history = new recorder.CarburetorHistory(store);
        store.update(draft => { delete draft.a; });
        assert.deepStrictEqual(Object.keys(store.getData()), ['b']);
        assert.equal(history.undo(), true);
        assert.deepStrictEqual(Object.keys(store.getData()), ['a', 'b']);
        assert.equal(history.redo(), true);
        assert.deepStrictEqual(Object.keys(store.getData()), ['b']);
        assert.equal(history.undo(), true);
        const orders = [];
        const stop = store.watch(view => ({...view}), value => orders.push(Object.keys(value)));
        store.update(draft => {
            const value = draft.a;
            delete draft.a;
            draft.a = value;
        });
        assert.deepStrictEqual(orders, [['b', 'a']]);
        assert.equal(history.undo(), true);
        assert.deepStrictEqual(Object.keys(store.getData()), ['a', 'b']);
        assert.equal(history.redo(), true);
        assert.deepStrictEqual(Object.keys(store.getData()), ['b', 'a']);
        stop();
        history.disconnect();
        completed.push(label + ':key-order-deletion-selection');
    }
    {
        const store = new producer.Carburetor({item: {a: 1, b: 1}, other: 0});
        const changes = [];
        const stop = store.watch(view => view.item, value => changes.push({...value}));
        store.update(draft => { draft.item.a = 2; });
        store.update(draft => { draft.item.b = 2; });
        assert.deepStrictEqual(changes, [{a: 2, b: 1}, {a: 2, b: 2}]);
        store.setData({item: {b: 2, a: 2}, other: 0});
        store.update(draft => { draft.item.b = 3; });
        store.update(draft => { draft.item.a = 4; });
        assert.deepStrictEqual(changes.slice(2), [{b: 2, a: 2}, {b: 3, a: 2}, {b: 3, a: 4}]);
        stop();
        completed.push(label + ':watch-complete-leaf-reads');
    }
    {
        const old = {id: 1};
        const next = {id: 1};
        const store = new producer.Carburetor({a: old, map: new Map([['old', old], ['new', next]])});
        store.read(() => {}).map.get('old');
        const version = store.getVersion();
        store.update(draft => { draft.a = next; });
        assert.equal(store.getVersion(), version);
        const changes = [];
        const stop = store.watch(view => view.map.get('new').id, value => changes.push(value));
        store.update(draft => { draft.a.id = 2; });
        assert.deepStrictEqual(changes, [2]);
        assert.equal(store.getData().a, store.getData().map.get('new'));
        stop();
        completed.push(label + ':native-equal-content-retarget');
    }
    {
        const row = {};
        Object.defineProperty(row, 'n', {value: 2, writable: false, enumerable: true, configurable: true});
        const store = new producer.Carburetor({other: 0, row});
        const saved = store.snapshot();
        saved.other = 7;
        saved.row.n = 1;
        store.restore(saved);
        assert.equal(store.getData().other, 7);
        assert.equal(store.getData().row.n, 1);
        saved.row.n = -1;
        assert.equal(store.getData().row.n, 1);
        completed.push(label + ':readonly-snapshot-restore');
    }
    {
        const row = {};
        Object.defineProperty(row, 'n', {value: 1, writable: false, enumerable: true, configurable: true});
        const store = new producer.Carburetor({row});
        const history = new recorder.CarburetorHistory(store);
        const next = {};
        Object.defineProperty(next, 'n', {value: 2, writable: false, enumerable: true, configurable: true});
        store.setData({row: next});
        for (let replay = 0; replay < 2; replay++) {
            assert.equal(history.undo(), true);
            assert.equal(store.getData().row.n, 1);
            assert.equal(Object.getOwnPropertyDescriptor(store.getData().row, 'n').writable, false);
            assert.equal(history.redo(), true);
            assert.equal(store.getData().row.n, 2);
            assert.equal(Object.getOwnPropertyDescriptor(store.getData().row, 'n').writable, false);
        }
        history.disconnect();
        completed.push(label + ':readonly-history-replay');
    }
    {
        const row = {};
        Object.defineProperty(row, 'x', {value: 1, writable: false, enumerable: true, configurable: true});
        const store = new producer.Carburetor({row});
        const history = new recorder.CarburetorHistory(store);
        store.update(draft => { draft.row = {x: 2}; });
        assert.equal(history.canUndo(), true);
        assert.equal(history.undo(), true);
        assert.equal(store.getData().row.x, 1);
        assert.equal(Object.getOwnPropertyDescriptor(store.getData().row, 'x').writable, false);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().row.x, 2);
        history.disconnect();
        completed.push(label + ':readonly-branch-admission');
    }
    {
        const initial = {other: 0};
        Object.defineProperty(initial, 'row', {
            value: {n: 1}, writable: false, configurable: false, enumerable: true,
        });
        const store = new producer.Carburetor(initial);
        const saved = store.snapshot();
        saved.other = 4;
        saved.row.n = 2;
        const changes = [];
        const stop = store.watch(view => view.other, value => changes.push(value));
        store.restore(saved);
        assert.equal(store.getData().other, 4);
        assert.equal(store.getData().row.n, 2);
        assert.equal(store.getVersion(), 1);
        assert.deepStrictEqual(changes, [4]);
        saved.row.n = -1;
        assert.equal(store.getData().row.n, 2);
        stop();
        completed.push(label + ':locked-object-restore');
    }
    for (const branch of [false, true]) {
        const store = new producer.Carburetor(branch ? {item: {a: 1, b: 1}} : {x: 1});
        const history = new recorder.CarburetorHistory(store);
        const changes = [];
        const stop = store.watch(view => branch ? [view.item.a, view.item.b] : view.x,
            value => changes.push(value));
        const failure = new Error('observer failed');
        const detach = store.attachPatchListener({
            /** Delivers the exact consumer error after an effective mutation. */
            patch() { throw failure; },
        });
        assert.throws(() => store.update(draft => {
            if (branch) draft.item = {a: 2, b: 2};
            else draft.x = 2;
        }), error => error === failure);
        assert.equal(store.getVersion(), 1);
        assert.deepStrictEqual(changes, branch ? [[2, 2]] : [2]);
        detach();
        assert.equal(history.undo(), true);
        assert.deepStrictEqual(store.getData(), branch ? {item: {a: 1, b: 1}} : {x: 1});
        stop();
        history.disconnect();
        completed.push(label + ':throwing-observer-' + (branch ? 'branch' : 'scalar'));
    }
    for (const addition of [false, true]) {
        const store = new producer.Carburetor(addition ? {} : {row: {x: 1}});
        const history = new recorder.CarburetorHistory(store);
        const row = {x: 2};
        Object.defineProperty(row, 'x', {
            value: 2, enumerable: true, writable: false, configurable: false,
        });
        store.update(draft => { draft.row = row; });
        assert.equal(history.undo(), true);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().row.x, 2);
        assert.equal(Object.getOwnPropertyDescriptor(store.getData().row, 'x').writable, false);
        assert.equal(Object.getOwnPropertyDescriptor(store.getData().row, 'x').configurable, false);
        const version = store.getVersion();
        assert.throws(() => store.update(draft => { draft.row.x = 3; }), TypeError);
        assert.equal(store.getVersion(), version);
        history.disconnect();
        completed.push(label + ':new-restrictive-' + (addition ? 'addition' : 'replacement'));
    }
    for (const status of [producer.EResourceStatus.Idle,
        producer.EResourceStatus.Success, producer.EResourceStatus.Error]) {
        const resource = new producer.ResourceCarburetor(async () => 'answer');
        const history = new recorder.CarburetorHistory(resource);
        const next = {...resource.getData(), status, updatedAt: 7,
            data: status === producer.EResourceStatus.Success ? 'saved' : undefined,
            error: status === producer.EResourceStatus.Error ? 'failed' : undefined};
        Object.defineProperty(next, 'status', {
            value: status, enumerable: true, writable: false, configurable: false,
        });
        resource.setData(next);
        assert.equal(history.undo(), true);
        assert.equal(history.redo(), true);
        assert.equal(resource.getData().status, status);
        assert.equal(resource.getData().updatedAt, 7);
        assert.equal(Object.getOwnPropertyDescriptor(resource.getData(), 'status').writable, false);
        assert.equal(Object.getOwnPropertyDescriptor(resource.getData(), 'status').configurable, false);
        assert.equal(history.canUndo(), true);
        assert.equal(history.canRedo(), false);
        history.disconnect();
        completed.push(label + ':readonly-resource-' + status);
    }
    {
        const resource = new producer.ResourceCarburetor(async () => new Map());
        const history = new recorder.CarburetorHistory(resource);
        const next = {...resource.getData(), status: producer.EResourceStatus.Pending,
            updatedAt: 7, data: new Map()};
        next.data.set('root', next);
        Object.defineProperty(next, 'status', {
            value: producer.EResourceStatus.Pending, enumerable: true, writable: false, configurable: false,
        });
        resource.setData(next);
        assert.equal(history.undo(), true);
        assert.equal(history.redo(), true);
        assert.equal(resource.getData().status, producer.EResourceStatus.Idle);
        assert.equal(resource.getData().updatedAt, 7);
        assert.equal(Object.getOwnPropertyDescriptor(resource.getData(), 'status').writable, false);
        assert.equal(resource.getData().data.get('root'), resource.getData());
        history.disconnect();
        completed.push(label + ':readonly-transient-slot');
    }
    for (const kind of ['pending', 'refreshing', 'both']) {
        const cache = new producer.ResourceCache(async () => new Map());
        const history = new recorder.CarburetorHistory(cache);
        const key = cache.keyOf('k');
        const pending = kind !== 'refreshing';
        const entry = {status: pending ? producer.EResourceStatus.Pending : producer.EResourceStatus.Success,
            refreshing: kind !== 'pending', data: new Map(), updatedAt: 9,
            error: undefined, invalidated: false, failed: false};
        const state = {entries: {[key]: entry}};
        entry.data.set('root', state);
        entry.data.set('entry', entry);
        if (pending) Object.defineProperty(entry, 'status', {
            value: entry.status, enumerable: true, writable: false, configurable: false,
        });
        if (kind !== 'pending') Object.defineProperty(entry, 'refreshing', {
            value: true, enumerable: true, writable: false, configurable: false,
        });
        cache.setData(state);
        assert.equal(history.undo(), true);
        assert.equal(history.redo(), true);
        const restored = cache.getData().entries[key];
        assert.equal(restored.status, pending ? producer.EResourceStatus.Idle : producer.EResourceStatus.Success);
        assert.equal(restored.refreshing, false);
        assert.equal(restored.updatedAt, 9);
        if (pending) assert.equal(Object.getOwnPropertyDescriptor(restored, 'status').writable, false);
        if (kind !== 'pending') assert.equal(Object.getOwnPropertyDescriptor(restored, 'refreshing').writable, false);
        assert.equal(restored.data.get('root'), cache.getData());
        assert.equal(restored.data.get('entry'), restored);
        history.disconnect();
        completed.push(label + ':readonly-transient-cache-' + kind);
    }
    return completed;
};
