/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-04: public replacements with history attached retain patch-scale recording.
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 9);
const run = operation => {
    const store = new Carburetor({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`}))});
    const history = new CarburetorHistory(store);
    const times = [];
    let entryKind;
    for (let index = 0; index < samples; index++) {
        const next = store.snapshot();
        next.rows[5].title = `Changed ${index}`;
        const start = performance.now();
        if (operation === 'setData') store.setData(next);
        else if (operation === 'restore') store.restore(next);
        else store.fromJSON(next);
        times.push(performance.now() - start);
        entryKind = history.past?.at(-1)?.kind;
        history.undo();
        history.redo();
    }
    const valid = store.getData().rows[5].title === `Changed ${samples - 1}`;
    history.disconnect();
    return {ms: median(times), entryKind, valid};
};
const results = Object.fromEntries(['setData', 'restore', 'fromJSON'].map(operation => [operation, run(operation)]));
emit({
    rows, samples,
    setDataKind: results.setData.entryKind, restoreKind: results.restore.entryKind, fromJSONKind: results.fromJSON.entryKind,
    setDataValid: results.setData.valid, restoreValid: results.restore.valid, fromJSONValid: results.fromJSON.valid,
    setDataMs: results.setData.ms, restoreMs: results.restore.ms, fromJSONMs: results.fromJSON.ms,
});
