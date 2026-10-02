import assert from 'node:assert/strict';

/** Exercise the built public API.
 *
 * @param runtime - runtime exports from one or more compatible module formats.
 */
export const runRound31Checks = (runtime, {baseline = false} = {}) => {
    const {Carburetor, CarburetorHistory, ResourceCache, EResourceStatus, transaction, computed} = runtime;
    class Actions extends Carburetor {
        /** Publish tracked writes.
         *
         * @param body - draft mutation.
         */
        change(body) { this.update(body); }
    }
    const results = [];
    const check = (kind, observed, valid) => {
        results.push({kind, observed, valid});
        if (!baseline) assert.equal(valid, true, `${kind}: ${JSON.stringify(observed)}`);
    };
    for (const kind of ['map', 'set']) {
        const first = kind === 'map' ? new Map([['a', 1], ['b', 2]]) : new Set(['a', 'b']);
        const next = kind === 'map' ? new Map([['b', 2], ['a', 1]]) : new Set(['b', 'a']);
        const store = new Carburetor({value: first});
        const events = [];
        const stop = store.watch(view => view.value, value => events.push([...value.keys()]));
        store.setData({value: next});
        stop();
        check(`ordered-${kind}`, {events, live: [...store.getData().value.keys()]},
            events.length === 1 && events[0].join(',') === 'b,a');
    }
    {
        const store = new Carburetor({tick: 0, date: new Date(NaN)});
        let notifications = 0;
        const stop = store.watch(view => ({parity: view.tick % 2, date: view.date}), () => notifications++);
        store.setData({tick: 2, date: new Date(NaN)});
        stop();
        check('invalid-date', {notifications, liveTick: store.getData().tick}, notifications === 0);
    }
    {
        const count = 32;
        const cache = new ResourceCache(async rowId => ({rowId}), {ttl: Infinity, maxEntries: Infinity});
        const entries = {};
        for (let rowId = 0; rowId < count; rowId++) {
            Object.defineProperty(entries, cache.keyOf(rowId), {
                value: {status: EResourceStatus.Success, data: {rowId}, error: undefined, updatedAt: 1,
                    refreshing: false, invalidated: false, failed: false},
                enumerable: true, writable: true, configurable: false,
            });
        }
        const held = {entries};
        cache.setData(held);
        let roots = 0, rows = 0, publications = 0;
        const id = cache.subscribe(() => publications++);
        const ownKeys = Reflect.ownKeys;
        Reflect.ownKeys = object => {
            if (Object.hasOwn(object, 'entries')) roots++;
            if (Object.hasOwn(object, 'rowId')) rows++;
            return ownKeys(object);
        };
        try { cache.forgetAll(); } finally { Reflect.ownKeys = ownKeys; cache.unsubscribe(id); }
        const left = Object.keys(cache.getData().entries).length;
        const heldCount = Object.keys(held.entries).length;
        check('readonly-bulk', {count, roots, rows, publications, left, heldCount},
            roots <= 1 && rows <= count && publications === 1 && left === 0 && heldCount === count);
    }
    {
        const rows = [];
        rows.length = 65536;
        rows[0] = 1;
        rows[65535] = 2;
        const store = new Carburetor({marker: 0, rows});
        let notifications = 0, selected;
        const stop = store.watch(view => ({parity: view.marker % 2, rows: view.rows}), value => {
            notifications++;
            selected = value;
        });
        const hasOwn = Object.prototype.hasOwnProperty;
        let indexChecks = 0;
        Object.prototype.hasOwnProperty = function (key) {
            if (Array.isArray(this) && typeof key === 'number') indexChecks++;
            return hasOwn.call(this, key);
        };
        try { store.setData({marker: 2, rows}); } finally { Object.prototype.hasOwnProperty = hasOwn; }
        const next = rows.slice();
        next[7] = undefined;
        store.setData({marker: 2, rows: next});
        stop();
        check('sparse-selection', {indexChecks, notifications, length: selected?.rows.length,
            ownUndefined: selected && Object.hasOwn(selected.rows, 7), hole: selected && !(8 in selected.rows)},
        indexChecks <= 16 && notifications === 1 && selected.rows.length === 65536 &&
            Object.hasOwn(selected.rows, 7) && !(8 in selected.rows));
    }
    {
        class Captured extends Actions {
            /** Ownership calls after initialization. */
            captures = 0;
            /** Count authoritative captures.
             *
             * @param own - graph ownership function.
             */
            captureHistory(own) { this.captures++; return super.captureHistory(own); }
        }
        const store = new Captured({n: 0, rows: Array.from({length: 128}, (_, rowId) => ({rowId}))});
        const history = new CarburetorHistory(store);
        store.captures = 0;
        transaction(() => {
            store.change(view => { view.n = 1; });
            store.change(view => { view.n = 0; });
        });
        const canceledCaptures = store.captures;
        const canceledUndo = history.canUndo();
        store.change(view => { view.n = 3; });
        const undo = history.undo();
        const oldValue = store.getData().n;
        const redo = history.redo();
        const newValue = store.getData().n;
        history.disconnect();
        check('scalar-cancellation', {canceledCaptures, canceledUndo, undo, redo, oldValue, newValue},
            canceledCaptures === 0 && !canceledUndo && undo && redo && oldValue === 0 && newValue === 3);
    }
    {
        const cache = new ResourceCache(async id => id, {ttl: Infinity, maxEntries: Infinity});
        for (let id = 0; id < 4096; id++) cache.resolve(id);
        for (let id = 0; id < 64; id++) cache.resolve(id);
        cache.resolve(4096);
        const stringify = JSON.stringify;
        let hotSerializations = 0;
        JSON.stringify = (...args) => { hotSerializations++; return stringify(...args); };
        let checksum = 0;
        try { for (let id = 0; id < 64; id++) checksum += Number(cache.resolve(id).key); }
        finally { JSON.stringify = stringify; }
        const configured = new ResourceCache(async id => id,
            {ttl: Infinity, maxEntries: Infinity, keyCacheSize: 8192});
        for (let id = 0; id < 4097; id++) configured.resolve(id);
        let configuredSerializations = 0;
        JSON.stringify = (...args) => { configuredSerializations++; return stringify(...args); };
        try { for (let id = 0; id < 4097; id++) configured.resolve(id); }
        finally { JSON.stringify = stringify; }
        check('bounded-key-memo', {hotSerializations, configuredSerializations, checksum},
            hotSerializations === 0 && configuredSerializations === 0 && checksum === 2016);
    }
    {
        const store = new Actions({left: 1, right: 1, useLeft: true});
        const readable = Object.fromEntries(['getUID', 'getVersion', 'getData', 'read', 'subscribe', 'unsubscribe']
            .map(key => [key, store[key].bind(store)]));
        const value = computed(read => {
            const view = read(readable);
            return view.useLeft ? view.left : view.right;
        });
        const events = [];
        const id = value.subscribe(() => events.push(value.get()));
        assert.equal(value.get(), 1);
        store.change(view => { view.useLeft = false; });
        store.change(view => { view.left = 2; });
        store.change(view => { view.right = 3; });
        const current = value.get();
        value.unsubscribe(id);
        check('readable-computed', {events, current, methods: Object.keys(readable)},
            events.length === 1 && events[0] === 3 && current === 3);
    }
    return results;
};
