/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-02: useCarburetorValue must not re-run a stable selector nor deep-compare the selection
// after unrelated writes; an inline selector still runs but skips the deep compare.
// Args: [rows=10000] [samples=15]
import {emit, load, median, setupReact} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 15);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: id % 2 === 0})), draft: ''});

let stableRuns = 0;
let inlineRuns = 0;
let bumpStable;
let bumpInline;
const selectRows = d => {
    stableRuns++;
    return d.rows;
};
const Stable = () => {
    const list = useCarburetorValue(s, selectRows);
    const [, setTick] = React.useState(0);
    bumpStable = () => setTick(value => value + 1);
    return React.createElement('ul', {className: 'stable'}, `${list[5].title}|${list.length}`);
};
const Inline = () => {
    const list = useCarburetorValue(s, d => {
        inlineRuns++;
        return d.rows;
    });
    const [, setTick] = React.useState(0);
    bumpInline = () => setTick(value => value + 1);
    return React.createElement('ul', {className: 'inline'}, `${list[5].title}|${list.length}`);
};
flushSync(() => root.render(React.createElement('div', null, React.createElement(Stable), React.createElement(Inline))));

// Phase A: re-render after no write at all — the stable selector must not run.
const noWrite = [];
stableRuns = 0;
for (let i = 0; i < samples; i++) {
    global.gc?.();
    const start = performance.now();
    flushSync(bumpStable);
    noWrite.push(performance.now() - start);
}
const stableNoWriteSelectorRuns = stableRuns;

// Phase B: re-render after an unrelated write — the cost R33-02 removes.
const write = [];
stableRuns = 0;
for (let i = 0; i < samples; i++) {
    s.run(d => { d.draft = 'd' + i; });
    global.gc?.();
    const start = performance.now();
    flushSync(bumpStable);
    write.push(performance.now() - start);
}
const stableWriteSelectorRuns = stableRuns;

// Phase C: inline selector — must still run per render, only the deep compare disappears.
const inline = [];
inlineRuns = 0;
for (let i = 0; i < samples; i++) {
    global.gc?.();
    const start = performance.now();
    flushSync(bumpInline);
    inline.push(performance.now() - start);
}
const inlineRunsTotal = inlineRuns;

// Correctness tail: both lists see a field edit and a push.
flushSync(() => s.run(d => { d.rows[5].title = 'edited'; }));
flushSync(() => s.run(d => { d.rows.push({id: rows, title: 'pushed', done: false}); }));
flushSync(bumpStable);
const uls = container.querySelectorAll('ul');
const text = `${uls[0].textContent}|${uls[1].textContent}`;

root.unmount();
emit({
    stableNoWriteMs: median(noWrite), stableNoWriteSelectorRuns,
    stableWriteMs: median(write), stableWriteSelectorRuns,
    inlineRenderMs: median(inline), inlineRuns: inlineRunsTotal, text,
});
