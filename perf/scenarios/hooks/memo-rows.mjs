/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-02: one row edited under `useCarburetorValue(s, d => d.rows)` rendered as React.memo rows:
// how many rows re-render, and what the edit costs. Args: [rows=1000] [samples=9]
import {emit, load, median, setupReact} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 9);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, tags: {a: id}})), draft: ''});

let rowRenders = 0;
const Row = React.memo(({row}) => {
    rowRenders++;
    return React.createElement('li', null, row.title);
});
const selectRows = d => d.rows;
const List = () => {
    const list = useCarburetorValue(s, selectRows);
    return React.createElement('ul', null, list.map(row => React.createElement(Row, {key: row.id, row})));
};
flushSync(() => root.render(React.createElement(List)));

global.gc?.();
const times = [];
const perEdit = [];
for (let i = 0; i < samples; i++) {
    rowRenders = 0;
    const start = performance.now();
    flushSync(() => s.run(d => { d.rows[5].title = 'edit ' + i; }));
    times.push(performance.now() - start);
    perEdit.push(rowRenders);
}
// A second row and a push must still reach the rendered list.
flushSync(() => s.run(d => { d.rows[9].title = 'nine'; }));
flushSync(() => s.run(d => { d.rows.push({id: rows, title: 'pushed', tags: {a: rows}}); }));
const items = container.querySelectorAll('li');
emit({
    rowRendersPerEdit: median(perEdit), editMs: median(times),
    text: `${items[5].textContent}|${items[9].textContent}|${items[items.length - 1].textContent}|${items.length}`,
});
root.unmount();
