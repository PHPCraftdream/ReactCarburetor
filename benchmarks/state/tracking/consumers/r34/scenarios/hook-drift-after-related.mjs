/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-01: a `useCarburetorValue` list component re-rendered by its own state after an unrelated
// write, before and after one related write re-ran its selector with the same read set.
// Args: [rows=10000] [stable|inline] [samples=15]
import {countWriteLogMatches, emit, load, median, setupReact} from '../harness/lib.mjs';

const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const inline = process.argv[3] === 'inline';
const samples = Number(process.argv[4] ?? 15);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: id % 2 === 0})), draft: ''});
const matches = countWriteLogMatches(s);

const selectRows = d => d.rows;
let bump;
let renders = 0;
const List = () => {
    const list = useCarburetorValue(s, inline ? (d => d.rows) : selectRows);
    const [, setTick] = React.useState(0);
    bump = () => setTick(value => value + 1);
    renders++;
    return React.createElement('ul', null, `${list[5].title}|${list[7].title}|${list.length}`);
};
flushSync(() => root.render(React.createElement(List)));

const phase = label => {
    global.gc?.();
    matches.calls = 0;
    const times = [];
    for (let i = 0; i < samples; i++) {
        s.run(d => { d.draft = label + i; });
        const start = performance.now();
        flushSync(() => bump());
        times.push(performance.now() - start);
    }
    return {ms: median(times), calls: matches.calls};
};

const before = phase('before');
flushSync(() => s.run(d => { d.rows[5].title = 'edited'; }));
const after = phase('after');
// Correctness tail: related edits, a push and a parent render must all still land.
flushSync(() => s.run(d => { d.rows[7].title = 'again'; }));
flushSync(() => s.run(d => { d.rows.push({id: rows, title: 'new', done: false}); }));
flushSync(() => bump());
emit({
    renderBeforeMs: before.ms, writeLogMatchesBefore: before.calls,
    renderAfterMs: after.ms, writeLogMatchesAfter: after.calls,
    renders, text: container.textContent,
});
root.unmount();
