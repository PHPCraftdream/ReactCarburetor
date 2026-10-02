import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {basename, isAbsolute, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';

const dist = process.argv[2];
if (!dist || !isAbsolute(dist)) {
    throw new Error('Pass an absolute production distribution root: dist/cjs-prod or dist/esm-prod');
}
const format = basename(dist);
if (format !== 'cjs-prod' && format !== 'esm-prod') {
    throw new Error('Distribution root must end in cjs-prod or esm-prod');
}
const require = createRequire(import.meta.url);
const load = relative => {
    const file = resolve(dist, `${relative}.${format === 'cjs-prod' ? 'js' : 'mjs'}`);
    return format === 'cjs-prod' ? require(file) : import(pathToFileURL(file).href);
};
const [{Carburetor}, {CarburetorHistory}, {transaction}] = await Promise.all([
    load('Carburetor/Store/Carburetor'),
    load('Carburetor/Tooling/CarburetorHistory'),
    load('Carburetor/Store/Transaction/transaction'),
]);

const rowCounts = [0, 32, 128, 512];
const rounds = 5;
const originalOwnKeys = Reflect.ownKeys;

const sample = (rows, canceled) => {
    class Store extends Carburetor {
        /** History ownership calls after initialization. */
        captures = 0;

        /** Count authoritative captures.
         *
         * @param own - graph ownership function.
         */
        captureHistory(own) {
            this.captures++;
            return super.captureHistory(own);
        }

        /** Publish one scalar change.
         *
         * @param value - next leaf value.
         */
        write(value) {
            this.update(draft => { draft.value = value; });
        }
    }
    const store = new Store({
        value: 0,
        rows: Array.from({length: rows}, (_, rowId) => ({rowId, detail: {value: rowId}})),
    });
    const history = new CarburetorHistory(store);
    store.captures = 0;
    let rowVisits = 0;
    Reflect.ownKeys = target => {
        if (target !== null && typeof target === 'object' && Object.hasOwn(target, 'rowId')) rowVisits++;
        return originalOwnKeys(target);
    };
    const started = performance.now();
    try {
        if (canceled) {
            transaction(() => {
                store.write(1);
                store.write(0);
            });
        } else {
            transaction(() => { store.write(1); });
        }
    } finally {
        Reflect.ownKeys = originalOwnKeys;
    }
    const elapsedMs = performance.now() - started;
    const counts = {captureCalls: store.captures, rowVisits};

    if (canceled) {
        assert.equal(store.getData().value, 0);
        assert.equal(history.canUndo(), false);
        assert.equal(history.canRedo(), false);
    } else {
        assert.equal(store.getData().value, 1);
        assert.equal(history.canUndo(), true);
        assert.equal(history.undo(), true);
        assert.equal(store.getData().value, 0);
        assert.equal(history.canRedo(), true);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().value, 1);
        assert.equal(history.canUndo(), true);
        assert.equal(history.canRedo(), false);
    }
    const finalValue = store.getData().value;
    const cursor = {canUndo: history.canUndo(), canRedo: history.canRedo()};
    history.disconnect();
    return {elapsedMs, finalValue, ...cursor, ...counts};
};

const results = [];
for (const rows of rowCounts) {
    const cases = {canceled: [], changed: []};
    for (let round = 0; round < rounds; round++) {
        const order = round % 2 === 0 ? ['canceled', 'changed'] : ['changed', 'canceled'];
        for (const kind of order) cases[kind].push(sample(rows, kind === 'canceled'));
    }
    results.push({rows, rounds, cases});
}
console.log(JSON.stringify({benchmark: 'history-scalar-cancellation', dist, format, rowCounts, results}));
