/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor} = await load();
class Store extends Carburetor {
    paths = [];
    run(fn) { this.update(fn); }
    emitUpdate(installation, deferred) { this.paths = [...this.writes]; super.emitUpdate(installation, deferred); }
}
const store = new Store({rows: Array.from({length: 10000}, (_, id) => ({id, title: 'T' + id, done: false}))});
const before = store.getData().rows.slice();
let wokenOf200 = 0;
for (let i = 0; i < 200; i++) store.subscribe(() => { wokenOf200++; }, {reads: new Set(['rows.' + (i * 37) + '.title'])});
const start = performance.now();
store.run(draft => { draft.rows = draft.rows.map(row => row.id === 3700 ? {...row, title: 'changed'} : row); });
const mapMs = performance.now() - start;
const rows = store.getData().rows;
emit({mapMs, paths: store.paths.length, wokenOf200, exactLeaf: store.paths.join(',') === 'rows.3700.title',
    valid: rows.every((row, i) => row.id === i && row.done === false && row.title === (i === 3700 ? 'changed' : 'T' + i)
        && (i === 3700 ? row !== before[i] : row === before[i]))});
