import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, Store} from './fixture.mjs';

let cases = 0;
for (const marker of ['lock', 'order']) {
    const store = new Store({stamp: null, items: [1, 2], row: {first: 1, last: 2}});
    const history = new api.CarburetorHistory(store);
    let wakes = 0;
    const id = store.subscribe(() => wakes++);
    try {
        store.run(d => {
            d.stamp = new Date(1000);
            d.stamp = null;
            if (marker === 'lock') Object.defineProperty(d.items, 'length', {value: 1, writable: false});
            else { delete d.row.first; d.row.first = 1; }
        });
        for (let i = 0; i < 2; i++) {
            assert.equal(history.undo(), true);
            assert.equal(store.getData().stamp, null);
            assert.deepEqual(Object.keys(store.getData().row), ['first', 'last']);
            assert.deepEqual(store.getData().items, [1, 2]);
            assert.equal(Object.getOwnPropertyDescriptor(store.getData().items, 'length').writable, true);
            assert.equal(history.redo(), true);
            if (marker === 'lock') {
                assert.deepEqual(store.getData().items, [1]);
                assert.equal(Object.getOwnPropertyDescriptor(store.getData().items, 'length').writable, false);
            } else assert.deepEqual(Object.keys(store.getData().row), ['last', 'first']);
        }
        assert.equal(wakes, 5);
        assert.equal(history.canRedo(), false);
        cases++;
    } finally { store.unsubscribe(id); history.disconnect(); }
}
emit({cases, structuralReplayCorrect: true, publicationCorrect: true});
