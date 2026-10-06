/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-06: React.memo rows under `useCarburetorValue(s, d => d.rows)` after an insert at the top and a one-row move.
// The control edit proves the render counter counts. Args: [rows=2000]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 2000);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`}))});
let renders = 0;
const Row = React.memo(({row}) => { renders++; return React.createElement('li', null, row.title); });
const selectRows = d => d.rows;
const List = () => React.createElement('ul', null, useCarburetorValue(s, selectRows).map(row => React.createElement(Row, {key: row.id, row})));
flushSync(() => root.render(React.createElement(List)));

const measure = write => {
    renders = 0;
    flushSync(() => s.run(write));
    return renders;
};
const memoRowRendersOnUnshift = measure(d => { d.rows.unshift({id: -1, title: 'new'}); });
const memoRowRendersOnMove = measure(d => { const [moved] = d.rows.splice(rows, 1); d.rows.splice(1, 0, moved); });
const editRenders = measure(d => { d.rows[10].title = 'edited'; });
const items = container.querySelectorAll('li');
emit({
    memoRowRendersOnUnshift, memoRowRendersOnMove, editRenders,
    text: `${items[0].textContent}|${items[1].textContent}|${items[2].textContent}|${items[10].textContent}|${items.length}`,
});
root.unmount();
